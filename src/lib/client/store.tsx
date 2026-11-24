"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CommitResponse, FeedTx, Pulse, ShopState, TurnResponse, TurnTrace } from "@/lib/api/contracts";
import { summarizeLines, toCommitInput } from "@/lib/domain/bill";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { formatRs } from "@/lib/domain/money";
import type { PaymentProposal, SaleProposal } from "@/lib/domain/types";
import { api, ClientApiError, friendlyError, isOffline, newKey, onOfflineChange, setApiShop, setSimulateOffline as setSimOffline, isSimulatedOffline } from "./api";
import { dequeue, enqueue, flushQueue, listQueue, pendingCount, saveReplay, type QueuedTurn } from "./queue";
import { browserSupabase, supabaseConfigured } from "./supabase";

export type Tab = "munshi" | "khata" | "maal";

export type Sheet =
  | { type: "review"; proposal: SaleProposal; key: string; trace: TurnTrace | null }
  | { type: "payment"; proposal: PaymentProposal; key: string; trace: TurnTrace | null }
  | { type: "reversal"; target: FeedTx | null; key: string }
  | { type: "pulse"; pulse: Pulse }
  | { type: "answer"; answer: string; proposal: SaleProposal | PaymentProposal | null; trace: TurnTrace; tools: Array<{ name: string; ms: number }> }
  | { type: "xray"; txId?: string | null }
  | { type: "parchi"; autoSample?: boolean }
  | { type: "passport" }
  | { type: "wasooli"; customerId: string }
  | { type: "customer"; customerId: string }
  | { type: "product"; productId: string }
  | { type: "settings" }
  | { type: "replays" }
  | { type: "receipt"; commit: CommitResponse; proposal: SaleProposal | null; customerPhone: string | null };

export interface LastCommit {
  response: CommitResponse;
  endpoint: string;
  payload: Record<string, unknown>;
  trace: TurnTrace | null;
  proposal: SaleProposal | null;
  label: string;
  replay: CommitResponse | null;
  committed_at: number;
}

export interface UndoState {
  id: string;
  message: string;
  txId: string;
  until: number;
}

export interface Toast {
  id: string;
  message: string;
  tone: "ok" | "warn" | "err" | "info";
  action?: { label: string; run: () => void };
}

export interface MyShop {
  id: string;
  name: string;
  city: string | null;
  role: string;
  is_demo_shop: boolean;
  is_stage_shop: boolean;
}

interface Store {
  configured: boolean;
  authReady: boolean;
  session: Session | null;
  shops: MyShop[] | null;
  shopId: string | null;
  shop: MyShop | null;
  setShopId: (id: string) => void;
  state: ShopState | null;
  stateError: string | null;
  refresh: () => Promise<void>;
  tab: Tab;
  setTab: (t: Tab) => void;
  sheet: Sheet | null;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;
  xrayOn: boolean;
  setXrayOn: (v: boolean) => void;
  online: boolean;
  simulatedOffline: boolean;
  setSimulatedOffline: (v: boolean) => void;
  pending: number;
  queue: QueuedTurn[];
  flush: () => Promise<void>;
  thinking: boolean;
  submitTurn: (input: { blob?: Blob; mime?: string; text?: string }, key?: string) => Promise<void>;
  confirmSale: (p: SaleProposal, key: string, trace: TurnTrace | null, opts?: { auto?: boolean }) => Promise<CommitResponse>;
  confirmPayment: (customerId: string, amountPaisa: number, key: string, trace?: TurnTrace | null) => Promise<CommitResponse>;
  reverse: (txId: string | null, reason: string) => Promise<CommitResponse>;
  commitPurchase: (payload: Record<string, unknown>) => Promise<CommitResponse>;
  lastCommit: LastCommit | null;
  replayTest: (target?: { endpoint: string; payload: Record<string, unknown> }) => Promise<CommitResponse | null>;
  undo: UndoState | null;
  doUndo: () => Promise<void>;
  dismissUndo: () => void;
  toasts: Toast[];
  toast: (message: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  highlightTx: string | null;
  signInSandbox: () => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<void>;
  signInMagic: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  createShop: (b: { name: string; owner_name?: string; phone?: string; city?: string }) => Promise<void>;
  reloadShops: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useDukaan(): Store {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDukaan outside provider");
  return c;
}

const SHOP_KEY = "dukaanos.shop";

export function DukaanProvider({ children }: { children: ReactNode }) {
  const configured = supabaseConfigured();
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [shops, setShops] = useState<MyShop[] | null>(null);
  const [shopId, setShopIdState] = useState<string | null>(null);
  const [state, setState] = useState<ShopState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("munshi");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [xrayOn, setXrayOn] = useState(false);
  const [online, setOnline] = useState(true);
  const [simulatedOffline, setSimulatedOfflineState] = useState(false);
  const [pending, setPending] = useState(0);
  const [queue, setQueue] = useState<QueuedTurn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [lastCommit, setLastCommit] = useState<LastCommit | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [highlightTx, setHighlightTx] = useState<string | null>(null);
  const flushing = useRef(false);
  const shopRef = useRef<string | null>(null);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info", action?: Toast["action"]) => {
    const id = newKey("t");
    setToasts((t) => [...t.slice(-2), { id, message, tone, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 7000 : 3800);
  }, []);

  const openSheet = useCallback((s: Sheet) => setSheet(s), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  /* ── auth ─────────────────────────────────────────── */
  useEffect(() => {
    setXrayOn(new URLSearchParams(window.location.search).get("xray") === "1");
    setOnline(!isOffline());
    if (!configured) {
      setAuthReady(true);
      return;
    }
    const sb = browserSupabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [configured]);

  const reloadShops = useCallback(async () => {
    const list = await api<MyShop[]>("/api/system/shops", { shop: false });
    setShops(list);
    const saved = localStorage.getItem(SHOP_KEY);
    const pick = list.find((s) => s.id === saved) ?? list[0] ?? null;
    if (pick) {
      setApiShop(pick.id);
      shopRef.current = pick.id;
      setShopIdState(pick.id);
    } else {
      setShopIdState(null);
    }
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) {
      setShops(null);
      setShopIdState(null);
      setState(null);
      return;
    }
    reloadShops().catch((e) => setStateError(friendlyError(e)));
  }, [userId, reloadShops]);

  const setShopId = useCallback((id: string) => {
    localStorage.setItem(SHOP_KEY, id);
    setApiShop(id);
    shopRef.current = id;
    setShopIdState(id);
    setState(null);
    setLastCommit(null);
  }, []);

  /* ── state ─────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!shopRef.current) return;
    try {
      const s = await api<ShopState>("/api/shop/state");
      setState(s);
      setStateError(null);
    } catch (e) {
      if (e instanceof ClientApiError && e.network) return; // offline: keep last truthful snapshot
      setStateError(friendlyError(e));
    }
  }, []);

  const updatePending = useCallback(async () => {
    if (!shopRef.current) return;
    const q = await listQueue(shopRef.current);
    setQueue(q);
    setPending(await pendingCount(shopRef.current));
  }, []);

  /* ── commits ─────────────────────────────────────────── */
  const auditMeta = (trace: TurnTrace | null, extra: Record<string, unknown> = {}) => ({
    transcript: trace?.transcript ?? null,
    transcript_roman: trace?.transcript_roman ?? null,
    model: trace?.model ?? null,
    source: trace?.source ?? "manual",
    latency_ms: trace?.latency_ms ?? null,
    pakphone_ms: trace?.pakphone?.ms_total ?? null,
    pakphone: trace?.pakphone ?? null,
    ...extra,
  });

  const recordCommit = useCallback((response: CommitResponse, endpoint: string, payload: Record<string, unknown>, trace: TurnTrace | null, proposal: SaleProposal | null, label: string) => {
    setLastCommit({ response, endpoint, payload, trace, proposal, label, replay: null, committed_at: Date.now() });
    setHighlightTx(response.transaction_id);
    setTimeout(() => setHighlightTx(null), 1800);
  }, []);

  const negativeStockToast = useCallback((res: CommitResponse) => {
    const w = res.warnings?.[0];
    if (w) {
      toast(`${w.name} stock is now ${formatBaseQty(w.stock_after, w.base_unit)} — Log Restock?`, "warn", {
        label: "Restock",
        run: () => setSheet({ type: "parchi" }),
      });
    }
  }, [toast]);

  const confirmSale = useCallback(async (p: SaleProposal, key: string, trace: TurnTrace | null, opts?: { auto?: boolean }) => {
    const base = toCommitInput(p, key, {});
    const replayPayload = { ...base };
    const payload = { ...base, audit_meta: auditMeta(trace, { tier: p.tier, tier_reasons: p.tier_reasons, channel: opts?.auto ? "tier1-auto" : "tier2-confirm", replay_payload: replayPayload }) };
    const res = await api<CommitResponse>("/api/transactions/commit", { json: payload });
    await dequeue(key).catch(() => undefined);
    recordCommit(res, "/api/transactions/commit", payload, trace, p, summarizeLines(p.lines));
    void refresh();
    void updatePending();
    if (opts?.auto) {
      setUndo({
        id: newKey("u"),
        message: `Cash ${formatRs(res.totals.total_paisa ?? p.total_paisa)} saved (${summarizeLines(p.lines)})`,
        txId: res.transaction_id,
        until: Date.now() + 5000,
      });
    }
    negativeStockToast(res);
    return res;
  }, [recordCommit, refresh, updatePending, negativeStockToast]);

  const confirmPayment = useCallback(async (customerId: string, amountPaisa: number, key: string, trace?: TurnTrace | null) => {
    const base = { idempotency_key: key, customer_id: customerId, amount_paisa: amountPaisa };
    const payload = { ...base, audit_meta: auditMeta(trace ?? null, { channel: "wasooli", replay_payload: base }) };
    const res = await api<CommitResponse>("/api/transactions/payment", { json: payload });
    await dequeue(key).catch(() => undefined);
    recordCommit(res, "/api/transactions/payment", payload, trace ?? null, null, `Wasooli ${formatRs(amountPaisa)}`);
    void refresh();
    void updatePending();
    return res;
  }, [recordCommit, refresh, updatePending]);

  const reverse = useCallback(async (txId: string | null, reason: string) => {
    const base = { idempotency_key: newKey("rev"), transaction_id: txId, reason };
    const payload = { ...base, audit_meta: { channel: reason, replay_payload: base } };
    const res = await api<CommitResponse>("/api/transactions/reverse", { json: payload });
    recordCommit(res, "/api/transactions/reverse", payload, null, null, "Reversal");
    void refresh();
    return res;
  }, [recordCommit, refresh]);

  const commitPurchase = useCallback(async (payload: Record<string, unknown>) => {
    const res = await api<CommitResponse>("/api/transactions/purchase", { json: payload });
    recordCommit(res, "/api/transactions/purchase", payload, null, null, `Restock ${formatRs(res.totals.total_paisa ?? 0)}`);
    void refresh();
    return res;
  }, [recordCommit, refresh]);

  const replayTest = useCallback(async (target?: { endpoint: string; payload: Record<string, unknown> }) => {
    const t = target ?? (lastCommit ? { endpoint: lastCommit.endpoint, payload: lastCommit.payload } : null);
    if (!t) return null;
    const res = await api<CommitResponse>(t.endpoint, { json: t.payload });
    if (!target && lastCommit) setLastCommit({ ...lastCommit, replay: res });
    return res;
  }, [lastCommit]);

  const doUndo = useCallback(async () => {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    try {
      await reverse(u.txId, "undo-5s");
      toast("Undone — stock, cash & chain restored", "ok");
    } catch (e) {
      toast(friendlyError(e), "err");
    }
  }, [undo, reverse, toast]);

  /* ── turns ─────────────────────────────────────────── */
  const handleTurn = useCallback(async (res: TurnResponse, key: string): Promise<"done" | "review"> => {
    switch (res.kind) {
      case "sale":
        if (res.proposal.tier === 1) {
          await confirmSale(res.proposal, key, res.trace, { auto: true });
          return "done";
        }
        setSheet({ type: "review", proposal: res.proposal, key, trace: res.trace });
        return "review";
      case "payment":
        setSheet({ type: "payment", proposal: res.proposal, key, trace: res.trace });
        return "review";
      case "reversal":
        setSheet({ type: "reversal", target: res.target, key });
        return "review";
      case "pulse":
        setSheet({ type: "pulse", pulse: res.pulse });
        return "done";
      case "answer":
        setSheet({ type: "answer", answer: res.answer, proposal: res.proposal, trace: res.trace, tools: res.tools });
        return "done";
      case "purchase":
        setSheet({ type: "parchi" });
        return "done";
      default:
        toast(`Samajh nahi aaya${res.trace.transcript ? `: “${res.trace.transcript}”` : ""} — dobara bolein`, "warn");
        return "done";
    }
  }, [confirmSale, toast]);

  const postTurn = useCallback(async (input: { blob?: Blob; mime?: string; text?: string }) => {
    if (input.blob) {
      const form = new FormData();
      form.append("audio", new File([input.blob], `clip.${(input.mime ?? "audio/webm").split("/")[1]}`, { type: input.mime ?? input.blob.type }));
      if (input.text) form.append("text", input.text);
      return api<TurnResponse>("/api/munshi/turn", { form, timeoutMs: 60_000 });
    }
    return api<TurnResponse>("/api/munshi/turn", { json: { text: input.text }, timeoutMs: 60_000 });
  }, []);

  const submitTurn = useCallback(async (input: { blob?: Blob; mime?: string; text?: string }, givenKey?: string) => {
    const shop = shopRef.current;
    if (!shop) return;
    const key = givenKey ?? newKey("turn");
    const queueIt = async (why: string) => {
      await enqueue({ idempotency_key: key, shop_id: shop, kind: input.blob ? "audio" : "text", blob: input.blob, mime: input.mime, text: input.text });
      await updatePending();
      toast(`${why} · saved to IndexedDB (Pending Sync)`, "warn");
    };
    if (isOffline()) {
      await queueIt("Offline");
      return;
    }
    setThinking(true);
    try {
      const res = await postTurn(input);
      if (input.blob && res.trace.transcript) {
        void saveReplay({ id: key, blob: input.blob, mime: input.mime ?? input.blob.type, transcript: res.trace.transcript, created_at: Date.now() });
      }
      if (res.trace.source === "rules") toast("Model busy — rule-based parse, please review", "info");
      await handleTurn(res, key);
    } catch (e) {
      if (e instanceof ClientApiError && (e.network || ["AI_TIMEOUT", "AI_UNAVAILABLE", "RATE_LIMITED"].includes(e.code))) {
        await queueIt(e.network ? "Network down" : "Munshi busy");
      } else {
        toast(friendlyError(e), "err");
      }
    } finally {
      setThinking(false);
    }
  }, [postTurn, handleTurn, toast, updatePending]);

  const flush = useCallback(async () => {
    const shop = shopRef.current;
    if (!shop || flushing.current || isOffline()) return;
    flushing.current = true;
    try {
      const before = await pendingCount(shop);
      if (!before) return;
      const t0 = performance.now();
      const r = await flushQueue(shop, async (q) => {
        const res = await postTurn({ blob: q.blob, mime: q.mime, text: q.text });
        return handleTurn(res, q.idempotency_key);
      });
      await updatePending();
      await refresh();
      if (r.done || r.review) {
        toast(`Synced ${r.done}${r.review ? ` · ${r.review} need review` : ""} in ${((performance.now() - t0) / 1000).toFixed(1)}s · 0 duplicates`, "ok");
      }
    } finally {
      flushing.current = false;
    }
  }, [postTurn, handleTurn, refresh, updatePending, toast]);

  /* ── connectivity ─────────────────────────────────────────── */
  useEffect(() => {
    const sync = () => {
      const off = isOffline();
      setOnline(!off);
      setSimulatedOfflineState(isSimulatedOffline());
      if (!off) void flush();
    };
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("focus", sync);
    const unsub = onOfflineChange(sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("focus", sync);
      unsub();
    };
  }, [flush]);

  useEffect(() => {
    if (!shopId) return;
    void refresh();
    void updatePending().then(() => flush());
    const t = setInterval(() => {
      if (!isOffline() && document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => clearInterval(t);
  }, [shopId, refresh, updatePending, flush]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo((u) => (u?.id === undo.id ? null : u)), Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(t);
  }, [undo]);

  /* ── sign-in flows (Flow 1) ─────────────────────────────────────────── */
  const signInSandbox = useCallback(async () => {
    const r = await api<{ email: string; password: string; shop_id: string }>("/api/demo/sandbox", { json: {}, auth: false, shop: false, timeoutMs: 60_000 });
    localStorage.setItem(SHOP_KEY, r.shop_id);
    const { error } = await browserSupabase().auth.signInWithPassword({ email: r.email, password: r.password });
    if (error) throw new Error(error.message);
  }, []);

  const signInPassword = useCallback(async (email: string, password: string) => {
    const { error } = await browserSupabase().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signInMagic = useCallback(async (email: string) => {
    const { error } = await browserSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await browserSupabase().auth.signOut();
    localStorage.removeItem(SHOP_KEY);
    setSheet(null);
    setLastCommit(null);
  }, []);

  const createShop = useCallback(async (b: { name: string; owner_name?: string; phone?: string; city?: string }) => {
    const r = await api<{ shop_id: string }>("/api/system/shops", { json: b, shop: false });
    localStorage.setItem(SHOP_KEY, r.shop_id);
    await reloadShops();
  }, [reloadShops]);

  const setSimulatedOffline = useCallback((v: boolean) => {
    setSimOffline(v);
    setSimulatedOfflineState(v);
    toast(v ? "Simulate Offline ON — Wi-Fi OFF behaviour" : "Back online — flushing queue", v ? "warn" : "ok");
  }, [toast]);

  const shop = useMemo(() => shops?.find((s) => s.id === shopId) ?? null, [shops, shopId]);

  const value: Store = {
    configured, authReady, session, shops, shopId, shop, setShopId, state, stateError, refresh,
    tab, setTab, sheet, openSheet, closeSheet, xrayOn, setXrayOn, online, simulatedOffline, setSimulatedOffline,
    pending, queue, flush, thinking, submitTurn, confirmSale, confirmPayment, reverse, commitPurchase,
    lastCommit, replayTest, undo, doUndo, dismissUndo: () => setUndo(null), toasts, toast, highlightTx,
    signInSandbox, signInPassword, signInMagic, signOut, createShop, reloadShops,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CommitResponse, FeedTx, PromiseProposal, Pulse, ShopState, TurnResponse, TurnTrace } from "@/lib/api/contracts";
import { summarizeLines, toCommitInput } from "@/lib/domain/bill";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { formatRs } from "@/lib/domain/money";
import type { PaymentProposal, SaleProposal } from "@/lib/domain/types";
import { api, ClientApiError, friendlyError, isOffline, newKey, onOfflineChange, registerAuthHandlers, setApiShop, setSimulateOffline as setSimOffline, isSimulatedOffline } from "./api";
import { LANG_KEY, type Lang } from "./i18n";
import { applyOptimisticOverlay, dequeue, enqueue, enqueueCommit, flushCommits, flushQueue, listCommits, listQueue, pendingCount, saveReplay, type FlushOutcome, type OptimisticDelta, type QueuedCommit, type QueuedTurn } from "./queue";
import { browserSupabase, supabaseConfigured } from "./supabase";
import { normalizePkPhone } from "@/lib/domain/starter-catalog";
import { loadSnapshot, saveSnapshot, SHOPS_SNAPSHOT, stateSnapshotKey } from "./offline-cache";
import { tryLocalTurn } from "./local-turn";

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
  | { type: "promise"; proposal: PromiseProposal; key: string; trace: TurnTrace | null }
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
  lang: Lang;
  setLang: (l: Lang) => void;
  online: boolean;
  simulatedOffline: boolean;
  setSimulatedOffline: (v: boolean) => void;
  pending: number;
  reviewCount: number;
  queue: QueuedTurn[];
  flush: () => Promise<void>;
  openQueuedReview: (key?: string) => Promise<void>;
  discardQueued: (key: string) => Promise<void>;
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
  signInSandbox: (turnstileToken?: string) => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<void>;
  signInMagic: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signInPhoneOtp: (phone: string) => Promise<string>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  createShop: (b: { name: string; owner_name?: string; phone?: string; city?: string; seed_starter?: boolean }) => Promise<void>;
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
  const [rawState, setRawState] = useState<ShopState | null>(null);
  const [commits, setCommits] = useState<QueuedCommit[]>([]);
  const state = useMemo(() => applyOptimisticOverlay(rawState, commits), [rawState, commits]);
  const [stateError, setStateError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("munshi");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [xrayOn, setXrayOn] = useState(false);
  const [lang, setLangState] = useState<Lang>("en");
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
  const sheetRef = useRef<Sheet | null>(null);
  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);

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
    const savedLang = localStorage.getItem(LANG_KEY);
    if (savedLang === "ur" || savedLang === "en") setLangState(savedLang);
    setOnline(!isOffline());
    if (!configured) {
      setAuthReady(true);
      return;
    }
    const sb = browserSupabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
      // Instant <50ms snapshot hydration only when an active session exists.
      const savedShop = data.session ? localStorage.getItem(SHOP_KEY) : null;
      if (savedShop) {
        void loadSnapshot<ShopState>(stateSnapshotKey(savedShop)).then((cached) => {
          if (cached) setRawState((cur) => cur ?? cached.data);
        });
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [configured]);

  const reloadShops = useCallback(async () => {
    let list: MyShop[];
    try {
      list = await api<MyShop[]>("/api/system/shops", { shop: false });
      void saveSnapshot(SHOPS_SNAPSHOT, list);
    } catch (e) {
      // Cold boot during load-shedding: fall back to the last known shop list instead of spinning.
      const cached = e instanceof ClientApiError && e.network ? await loadSnapshot<MyShop[]>(SHOPS_SNAPSHOT) : null;
      if (!cached) throw e;
      list = cached.data;
    }
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
      setRawState(null);
      setCommits([]);
      return;
    }
    reloadShops().catch((e) => setStateError(friendlyError(e)));
  }, [userId, reloadShops]);

  useEffect(() => {
    registerAuthHandlers({
      onAuthExpired: () => {
        setSession(null);
        setSheet(null);
        toast("Session khatam ho gaya — dobara sign in karein", "warn");
      },
      onShopForbidden: () => {
        localStorage.removeItem(SHOP_KEY);
        setApiShop(null);
        shopRef.current = null;
        setShopIdState(null);
        setRawState(null);
        setCommits([]);
        void reloadShops().catch(() => undefined);
      },
    });
    return () => registerAuthHandlers({});
  }, [reloadShops, toast]);

  const setShopId = useCallback((id: string) => {
    localStorage.setItem(SHOP_KEY, id);
    setApiShop(id);
    shopRef.current = id;
    setShopIdState(id);
    setRawState(null);
    setCommits([]);
    setLastCommit(null);
  }, []);

  /* ── state ─────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!shopRef.current) return;
    const shop = shopRef.current;
    try {
      const s = await api<ShopState>("/api/shop/state");
      setRawState(s);
      setStateError(null);
      void saveSnapshot(stateSnapshotKey(shop), s);
    } catch (e) {
      if (e instanceof ClientApiError && e.network) {
        // offline: keep the in-memory snapshot, or restore the last persisted one on a cold boot
        const cached = await loadSnapshot<ShopState>(stateSnapshotKey(shop));
        if (cached) setRawState((cur) => cur ?? cached.data);
        return;
      }
      setStateError(friendlyError(e));
    }
  }, []);

  const updatePending = useCallback(async () => {
    if (!shopRef.current) return;
    const [q, c] = await Promise.all([listQueue(shopRef.current), listCommits(shopRef.current)]);
    setQueue(q);
    setCommits(c);
    setPending((await pendingCount(shopRef.current)) + c.filter((x) => x.status === "pending").length);
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

  const commitOrQueue = useCallback(async (
    endpoint: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    optimistic: OptimisticDelta,
  ): Promise<{ res: CommitResponse; queued: boolean }> => {
    const shop = shopRef.current;
    const makeOfflineResponse = (): CommitResponse => ({
      status: "COMMITTED",
      http: 202,
      deduplicated: false,
      duplicate_rows: 0,
      rows_for_key: 1,
      type: optimistic.type,
      transaction_id: idempotencyKey,
      seq: -1,
      prev_hash: "pending",
      entry_hash: "pending",
      created_at: new Date().toISOString(),
      rls_shop_id: shop ?? "",
      totals: { total_paisa: optimistic.total_paisa, cash_paid_paisa: optimistic.cash_paid_paisa, credit_paisa: optimistic.credit_paisa },
      journal: [],
      delta: 0,
      warnings: [],
      rpc_ms: 0,
    });

    if (isOffline() && shop) {
      await enqueueCommit({ idempotency_key: idempotencyKey, shop_id: shop, endpoint, payload, optimistic });
      await updatePending();
      toast("Saved offline · Pending Sync", "warn");
      return { res: makeOfflineResponse(), queued: true };
    }
    try {
      const res = await api<CommitResponse>(endpoint, { json: payload });
      return { res, queued: false };
    } catch (e) {
      if (shop && e instanceof ClientApiError && e.network) {
        await enqueueCommit({ idempotency_key: idempotencyKey, shop_id: shop, endpoint, payload, optimistic });
        await updatePending();
        toast("Network down · saved offline (Pending Sync)", "warn");
        return { res: makeOfflineResponse(), queued: true };
      }
      throw e;
    }
  }, [toast, updatePending]);

  const confirmSale = useCallback(async (p: SaleProposal, key: string, trace: TurnTrace | null, opts?: { auto?: boolean }) => {
    const base = toCommitInput(p, key, {});
    const replayPayload = { ...base };
    const payload = { ...base, audit_meta: auditMeta(trace, { tier: p.tier, tier_reasons: p.tier_reasons, channel: opts?.auto ? "tier1-auto" : "tier2-confirm", replay_payload: replayPayload }) };
    const selectedCust = p.customer.candidates.find((c) => c.id === p.customer.selected_id) ?? null;
    const { res, queued } = await commitOrQueue("/api/transactions/commit", payload, key, {
      type: "sale",
      customer_id: p.customer.selected_id,
      customer_name: selectedCust?.name ?? p.customer.mention,
      total_paisa: p.total_paisa,
      cash_paid_paisa: p.cash_paid_paisa,
      credit_paisa: p.credit_paisa,
      discount_paisa: p.discount_paisa,
      lines: p.lines.map((l) => ({
        product_id: l.product_id,
        name: l.name,
        qty_base_units: l.qty_base_units,
        base_unit: l.base_unit,
        line_total_paisa: l.line_total_paisa,
        value_first: l.value_first,
      })),
      label: summarizeLines(p.lines),
    });
    await dequeue(key).catch(() => undefined);
    if (!queued) recordCommit(res, "/api/transactions/commit", payload, trace, p, summarizeLines(p.lines));
    navigator.vibrate?.(12);
    if (!queued) void refresh();
    void updatePending();
    if (opts?.auto && !queued) {
      setUndo({
        id: newKey("u"),
        message: `Cash ${formatRs(res.totals.total_paisa ?? p.total_paisa)} saved (${summarizeLines(p.lines)})`,
        txId: res.transaction_id,
        until: Date.now() + 5000,
      });
    }
    negativeStockToast(res);
    return res;
  }, [commitOrQueue, recordCommit, refresh, updatePending, negativeStockToast]);

  const confirmPayment = useCallback(async (customerId: string, amountPaisa: number, key: string, trace?: TurnTrace | null) => {
    const base = { idempotency_key: key, customer_id: customerId, amount_paisa: amountPaisa };
    const payload = { ...base, audit_meta: auditMeta(trace ?? null, { channel: "wasooli", replay_payload: base }) };
    const custName = rawState?.customers.find((c) => c.id === customerId)?.name ?? null;
    const { res, queued } = await commitOrQueue("/api/transactions/payment", payload, key, {
      type: "payment",
      customer_id: customerId,
      customer_name: custName,
      total_paisa: amountPaisa,
      cash_paid_paisa: amountPaisa,
      credit_paisa: 0,
      label: `Wasooli ${formatRs(amountPaisa)}`,
    });
    await dequeue(key).catch(() => undefined);
    if (!queued) recordCommit(res, "/api/transactions/payment", payload, trace ?? null, null, `Wasooli ${formatRs(amountPaisa)}`);
    navigator.vibrate?.(12);
    if (!queued) void refresh();
    void updatePending();
    return res;
  }, [commitOrQueue, rawState?.customers, recordCommit, refresh, updatePending]);

  const reverse = useCallback(async (txId: string | null, reason: string) => {
    const key = newKey("rev");
    const base = { idempotency_key: key, transaction_id: txId, reason };
    const payload = { ...base, audit_meta: { channel: reason, replay_payload: base } };
    const { res, queued } = await commitOrQueue("/api/transactions/reverse", payload, key, {
      type: "reversal",
      total_paisa: 0,
      cash_paid_paisa: 0,
      credit_paisa: 0,
      reversed_transaction_id: txId,
      label: "Reversal",
    });
    if (!queued) {
      recordCommit(res, "/api/transactions/reverse", payload, null, null, "Reversal");
      void refresh();
    }
    return res;
  }, [commitOrQueue, recordCommit, refresh]);

  const commitPurchase = useCallback(async (payload: Record<string, unknown>) => {
    const key = typeof payload.idempotency_key === "string" ? payload.idempotency_key : newKey("pur");
    const total = Number(payload.total_paisa ?? payload.stated_total_paisa ?? 0) || 0;
    const cash = Number(payload.cash_paid_paisa ?? 0) || 0;
    const { res, queued } = await commitOrQueue("/api/transactions/purchase", { ...payload, idempotency_key: key }, key, {
      type: "purchase",
      supplier_name: typeof payload.supplier_name === "string" ? payload.supplier_name : "Wholesale",
      total_paisa: total,
      cash_paid_paisa: cash,
      credit_paisa: Math.max(0, total - cash),
      label: `Restock ${formatRs(total)}`,
    });
    if (!queued) {
      recordCommit(res, "/api/transactions/purchase", payload, null, null, `Restock ${formatRs(res.totals.total_paisa ?? 0)}`);
      void refresh();
    }
    navigator.vibrate?.(12);
    return res;
  }, [commitOrQueue, recordCommit, refresh]);

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
      navigator.vibrate?.(12);
      toast("Undone — stock, cash & chain restored", "ok");
    } catch (e) {
      toast(friendlyError(e), "err");
    }
  }, [undo, reverse, toast]);

  /* ── turns ─────────────────────────────────────────── */
  const handleTurn = useCallback(async (res: TurnResponse, key: string, opts?: { deferSheet?: boolean }): Promise<FlushOutcome> => {
    switch (res.kind) {
      case "sale":
        if (res.proposal.tier === 1) {
          await confirmSale(res.proposal, key, res.trace, { auto: true });
          return "done";
        }
        if (opts?.deferSheet) {
          return { status: "review", patch: { review_kind: "sale", proposal: res.proposal, trace: res.trace } };
        }
        setSheet({ type: "review", proposal: res.proposal, key, trace: res.trace });
        return "review";
      case "payment":
        if (opts?.deferSheet) {
          return { status: "review", patch: { review_kind: "payment", proposal: res.proposal, trace: res.trace } };
        }
        setSheet({ type: "payment", proposal: res.proposal, key, trace: res.trace });
        return "review";
      case "reversal":
        if (opts?.deferSheet) {
          return { status: "review", patch: { review_kind: "reversal", target: res.target, trace: res.trace } };
        }
        setSheet({ type: "reversal", target: res.target, key });
        return "review";
      case "pulse":
        if (!opts?.deferSheet) setSheet({ type: "pulse", pulse: res.pulse });
        return "done";
      case "answer":
        if (!opts?.deferSheet) setSheet({ type: "answer", answer: res.answer, proposal: res.proposal, trace: res.trace, tools: res.tools });
        return "done";
      case "promise":
        if (opts?.deferSheet) {
          return { status: "review", patch: { review_kind: "promise", proposal: res.proposal, trace: res.trace } };
        }
        setSheet({ type: "promise", proposal: res.proposal, key, trace: res.trace });
        return "review";
      case "purchase":
        if (!opts?.deferSheet) setSheet({ type: "parchi" });
        return "done";
      default:
        toast(`Samajh nahi aaya${res.trace.transcript ? `: “${res.trace.transcript}”` : ""} — dobara bolein`, "warn");
        return "done";
    }
  }, [confirmSale, toast]);

  const postTurn = useCallback(async (input: { blob?: Blob; mime?: string; text?: string }) => {
    if (input.blob) {
      const cleanMime = (input.mime ?? input.blob.type ?? "audio/webm").split(";")[0].trim() || "audio/webm";
      const ext = cleanMime.split("/")[1] || "webm";
      const form = new FormData();
      form.append("audio", new File([input.blob], `clip.${ext}`, { type: cleanMime }));
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
      if (input.text && !input.blob) {
        const local = tryLocalTurn(input.text, state, { offline: true });
        if (local) {
          if (
            local.kind === "sale" &&
            local.proposal.credit_paisa === 0 &&
            local.proposal.discount_paisa === 0 &&
            local.proposal.lines.every((l) => l.kind === "catalog" && (l.match?.score ?? 0) === 1 && l.price_known && !l.number_unresolved)
          ) {
            await confirmSale(local.proposal, key, local.trace, { auto: true });
            return;
          }
          await handleTurn(local, key);
          return;
        }
      }
      await queueIt("Offline");
      return;
    }
    if (input.text && !input.blob) {
      const fast = tryLocalTurn(input.text, state, { offline: false });
      if (fast) {
        await handleTurn(fast, key);
        return;
      }
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
      if (e instanceof ClientApiError && (e.network || ["AI_TIMEOUT", "AI_UNAVAILABLE", "RATE_LIMITED", "AUTH_REQUIRED"].includes(e.code))) {
        await queueIt(e.code === "AUTH_REQUIRED" ? "Session expired" : e.network ? "Network down" : "Munshi busy");
      } else {
        toast(friendlyError(e), "err");
      }
    } finally {
      setThinking(false);
    }
  }, [confirmSale, postTurn, handleTurn, toast, updatePending, state]);

  const openQueuedReview = useCallback(async (key?: string) => {
    const shop = shopRef.current;
    if (!shop) return;
    const all = await listQueue(shop);
    const target = key ? all.find((q) => q.idempotency_key === key) : all.find((q) => q.status === "review");
    if (!target) return;
    if (target.review_kind === "sale" && target.proposal) {
      setSheet({ type: "review", proposal: target.proposal as SaleProposal, key: target.idempotency_key, trace: target.trace ?? null });
      return;
    }
    if (target.review_kind === "payment" && target.proposal) {
      setSheet({ type: "payment", proposal: target.proposal as PaymentProposal, key: target.idempotency_key, trace: target.trace ?? null });
      return;
    }
    if (target.review_kind === "promise" && target.proposal) {
      setSheet({ type: "promise", proposal: target.proposal as PromiseProposal, key: target.idempotency_key, trace: target.trace ?? null });
      return;
    }
    if (target.review_kind === "reversal") {
      setSheet({ type: "reversal", target: target.target ?? null, key: target.idempotency_key });
      return;
    }
    await submitTurn({ blob: target.blob, mime: target.mime, text: target.text }, target.idempotency_key);
  }, [submitTurn]);

  const discardQueued = useCallback(async (key: string) => {
    await dequeue(key);
    await updatePending();
  }, [updatePending]);

  const flush = useCallback(async () => {
    const shop = shopRef.current;
    if (!shop || flushing.current || isOffline()) return;
    flushing.current = true;
    try {
      const [beforeTurns, queuedCommits] = await Promise.all([pendingCount(shop), listCommits(shop)]);
      const pendingCommits = queuedCommits.filter((c) => c.status === "pending").length;
      if (!beforeTurns && !pendingCommits) return;
      const t0 = performance.now();
      const cRes = await flushCommits(shop, (c) => api<CommitResponse>(c.endpoint, { json: c.payload }));
      const r = await flushQueue(shop, async (q) => {
        const res = await postTurn({ blob: q.blob, mime: q.mime, text: q.text });
        return handleTurn(res, q.idempotency_key, { deferSheet: true });
      });
      await updatePending();
      await refresh();
      const totalDone = cRes.done + r.done;
      if (totalDone || r.review) {
        toast(`Synced ${totalDone}${r.review ? ` · ${r.review} need review` : ""} in ${((performance.now() - t0) / 1000).toFixed(1)}s · 0 duplicates`, "ok");
      }
      if (r.review > 0 && !sheetRef.current) {
        await openQueuedReview();
      }
    } finally {
      flushing.current = false;
    }
  }, [postTurn, handleTurn, refresh, updatePending, openQueuedReview, toast]);

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

  const headSeqRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    headSeqRef.current = rawState?.chain_head?.seq;
  }, [rawState?.chain_head?.seq]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    if (!shopId) return;
    void refresh();
    void updatePending().then(() => flushRef.current());
    const onVisible = () => {
      if (document.visibilityState !== "visible" || isOffline()) return;
      const headSeq = headSeqRef.current;
      if (typeof headSeq === "number") {
        void api<{ items: Array<{ seq: number }> }>("/api/shop/feed?limit=1")
          .then((r) => {
            if ((r.items[0]?.seq ?? 0) !== headSeq) void refresh();
          })
          .catch(() => undefined);
      } else {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [shopId, refresh, updatePending]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo((u) => (u?.id === undo.id ? null : u)), Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(t);
  }, [undo]);

  /* ── sign-in flows (Flow 1) ─────────────────────────────────────────── */
  const signInSandbox = useCallback(async (turnstileToken?: string) => {
    const r = await api<{ email: string; password: string; shop_id: string }>("/api/demo/sandbox", {
      json: turnstileToken ? { turnstile_token: turnstileToken } : {},
      auth: false,
      shop: false,
      timeoutMs: 60_000,
    });
    localStorage.setItem(SHOP_KEY, r.shop_id);
    const { error } = await browserSupabase().auth.signInWithPassword({ email: r.email, password: r.password });
    if (error) throw new Error(error.message);
  }, []);

  const signInPassword = useCallback(async (email: string, password: string) => {
    const { error } = await browserSupabase().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signInMagic = useCallback(async (email: string) => {
    const { error } = await browserSupabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    if (error) throw new Error(error.message);
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, token: string) => {
    const { error } = await browserSupabase().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
    if (error) throw new Error(error.message);
  }, []);

  const signInPhoneOtp = useCallback(async (rawPhone: string) => {
    const phone = normalizePkPhone(rawPhone);
    const { error } = await browserSupabase().auth.signInWithOtp({ phone });
    if (error) throw new Error(error.message);
    return phone;
  }, []);

  const verifyPhoneOtp = useCallback(async (rawPhone: string, token: string) => {
    const phone = normalizePkPhone(rawPhone);
    const { error } = await browserSupabase().auth.verifyOtp({ phone, token: token.trim(), type: "sms" });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await browserSupabase().auth.signOut();
    localStorage.removeItem(SHOP_KEY);
    setSheet(null);
    setLastCommit(null);
  }, []);

  const createShop = useCallback(async (b: { name: string; owner_name?: string; phone?: string; city?: string; seed_starter?: boolean }) => {
    const r = await api<{ shop_id: string }>("/api/system/shops", { json: b, shop: false });
    localStorage.setItem(SHOP_KEY, r.shop_id);
    await reloadShops();
  }, [reloadShops]);

  const setSimulatedOffline = useCallback((v: boolean) => {
    setSimOffline(v);
    setSimulatedOfflineState(v);
    toast(v ? "Simulate Offline ON — Wi-Fi OFF behaviour" : "Back online — flushing queue", v ? "warn" : "ok");
  }, [toast]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);

  const shop = useMemo(() => shops?.find((s) => s.id === shopId) ?? null, [shops, shopId]);
  const reviewCount = useMemo(() => queue.filter((q) => q.status === "review").length, [queue]);

  const value: Store = {
    configured, authReady, session, shops, shopId, shop, setShopId, state, stateError, refresh,
    tab, setTab, sheet, openSheet, closeSheet, xrayOn, setXrayOn, lang, setLang, online, simulatedOffline, setSimulatedOffline,
    pending, reviewCount, queue, flush, openQueuedReview, discardQueued, thinking, submitTurn, confirmSale, confirmPayment, reverse, commitPurchase,
    lastCommit, replayTest, undo, doUndo, dismissUndo: () => setUndo(null), toasts, toast, highlightTx,
    signInSandbox, signInPassword, signInMagic, verifyEmailOtp, signInPhoneOtp, verifyPhoneOtp, signOut, createShop, reloadShops,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

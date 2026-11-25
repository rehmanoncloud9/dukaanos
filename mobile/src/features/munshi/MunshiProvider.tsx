import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { summarizeLines, toCommitInput } from "@domain/bill";
import { formatBaseQty } from "@domain/desi-units";
import { formatRs } from "@domain/money";
import { ApiError, apiClient, friendlyApiError, newIdempotencyKey } from "@/core/api/client";
import type { CommitResponse, FeedTx, PaymentProposal, Pulse, SaleProposal, TurnTrace } from "@/core/api/types";
import { saveReplayClip } from "@/core/offline/db";
import { useOffline } from "@/core/offline/OfflineProvider";
import type { QueuedTurn } from "@/core/offline/queue";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { useToast } from "@/core/ui";
import { classifyTurnResponse, deferredFlushOutcome } from "./turnEngine";

export type MunshiModal =
  | { type: "payment"; proposal: PaymentProposal; key: string; trace: TurnTrace | null }
  | { type: "reversal"; target: FeedTx | null; key: string }
  | { type: "pulse"; pulse: Pulse }
  | {
      type: "answer";
      answer: string;
      proposal: SaleProposal | PaymentProposal | null;
      tools: { name: string; ms: number }[];
      trace: TurnTrace;
    }
  | { type: "receipt"; commit: CommitResponse; proposal: SaleProposal | null; customerPhone: string | null }
  | { type: "replays" };

export interface ActiveReviewState {
  proposal: SaleProposal;
  key: string;
  trace: TurnTrace | null;
}

interface MunshiContextValue {
  thinking: boolean;
  modal: MunshiModal | null;
  activeReview: ActiveReviewState | null;
  closeModal: () => void;
  openPulseSheet: (pulse: Pulse) => void;
  openReplaysSheet: () => void;
  openReviewForProposal: (proposal: SaleProposal, key: string, trace: TurnTrace | null) => void;
  openPaymentForProposal: (proposal: PaymentProposal, key: string, trace: TurnTrace | null) => void;
  clearReview: () => void;
  submitTurn: (input: { audioUri?: string; mimeType?: string; text?: string }, givenKey?: string) => Promise<void>;
  confirmSale: (p: SaleProposal, key: string, trace: TurnTrace | null, opts?: { auto?: boolean }) => Promise<CommitResponse>;
  confirmPayment: (customerId: string, amountPaisa: number, key: string, trace?: TurnTrace | null) => Promise<CommitResponse>;
  reverse: (txId: string | null, reason: string) => Promise<CommitResponse>;
  doUndo: () => Promise<void>;
  replayTest: (target?: { endpoint: string; payload: Record<string, unknown> }) => Promise<CommitResponse | null>;
  flushNow: () => Promise<void>;
  openQueuedReview: (key?: string) => Promise<void>;
}

const MunshiContext = createContext<MunshiContextValue | null>(null);

const QUEUEABLE_CODES = new Set(["OFFLINE", "NETWORK", "AI_TIMEOUT", "AI_UNAVAILABLE", "RATE_LIMITED", "AUTH_REQUIRED"]);

export function MunshiProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const {
    shopId,
    xrayOn,
    lastCommit,
    recordCommit,
    setReplayResult,
    undo,
    setUndo,
    invalidateShop,
  } = useShop();
  const { data: state } = useShopState();
  const { online, queue, enqueueTurn, dequeueTurn, flush, registerFlushRunner } = useOffline();

  const [thinking, setThinking] = useState(false);
  const [modal, setModal] = useState<MunshiModal | null>(null);
  const [activeReview, setActiveReview] = useState<ActiveReviewState | null>(null);

  const closeModal = useCallback(() => setModal(null), []);
  const clearReview = useCallback(() => setActiveReview(null), []);
  const openPulseSheet = useCallback((pulse: Pulse) => setModal({ type: "pulse", pulse }), []);
  const openReplaysSheet = useCallback(() => setModal({ type: "replays" }), []);

  const openReviewForProposal = useCallback(
    (proposal: SaleProposal, key: string, trace: TurnTrace | null) => {
      setActiveReview({ proposal, key, trace });
      router.push("/review");
    },
    [router],
  );

  const openPaymentForProposal = useCallback((proposal: PaymentProposal, key: string, trace: TurnTrace | null) => {
    setModal({ type: "payment", proposal, key, trace });
  }, []);

  const buildAuditMeta = (trace: TurnTrace | null, extra: Record<string, unknown> = {}) => ({
    transcript: trace?.transcript ?? null,
    transcript_roman: trace?.transcript_roman ?? null,
    model: trace?.model ?? null,
    source: trace?.source ?? "manual",
    latency_ms: trace?.latency_ms ?? null,
    pakphone_ms: trace?.pakphone?.ms_total ?? null,
    pakphone: trace?.pakphone ?? null,
    ...extra,
  });

  const maybeWarnNegativeStock = useCallback(
    (res: CommitResponse) => {
      const w = res.warnings?.[0];
      if (!w) return;
      toast(`${w.name} stock is now ${formatBaseQty(w.stock_after, w.base_unit)} — Log Restock?`, "warn", {
        label: "Restock",
        run: () => router.push("/parchi"),
      });
    },
    [router, toast],
  );

  const confirmSale = useCallback(
    async (p: SaleProposal, key: string, trace: TurnTrace | null, opts?: { auto?: boolean }) => {
      const base = toCommitInput(p, key, {});
      const payload = {
        ...base,
        audit_meta: buildAuditMeta(trace, {
          tier: p.tier,
          tier_reasons: p.tier_reasons,
          channel: opts?.auto ? "tier1-auto" : "tier2-confirm",
          replay_payload: base,
        }),
      };
      const res = await apiClient.commit(payload, shopId ?? undefined);
      await dequeueTurn(key).catch(() => undefined);
      recordCommit({
        response: res,
        endpoint: "/api/transactions/commit",
        payload: payload as Record<string, unknown>,
        trace,
        proposal: p,
        label: summarizeLines(p.lines),
        replay: null,
        committedAt: Date.now(),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidateShop();

      if (opts?.auto) {
        setUndo({
          id: newIdempotencyKey("undo"),
          message: `Cash ${formatRs(res.totals.total_paisa ?? p.total_paisa)} saved (${summarizeLines(p.lines)})`,
          txId: res.transaction_id,
          until: Date.now() + 5000,
        });
        if (xrayOn) router.push(`/xray?txId=${res.transaction_id}`);
      }
      maybeWarnNegativeStock(res);
      return res;
    },
    [dequeueTurn, invalidateShop, maybeWarnNegativeStock, recordCommit, router, setUndo, shopId, xrayOn],
  );

  const confirmPayment = useCallback(
    async (customerId: string, amountPaisa: number, key: string, trace?: TurnTrace | null) => {
      const base = { idempotency_key: key, customer_id: customerId, amount_paisa: amountPaisa };
      const payload = {
        ...base,
        audit_meta: buildAuditMeta(trace ?? null, { channel: "wasooli", replay_payload: base }),
      };
      const res = await apiClient.payment(payload, shopId ?? undefined);
      await dequeueTurn(key).catch(() => undefined);
      recordCommit({
        response: res,
        endpoint: "/api/transactions/payment",
        payload: payload as Record<string, unknown>,
        trace: trace ?? null,
        proposal: null,
        label: `Wasooli ${formatRs(amountPaisa)}`,
        replay: null,
        committedAt: Date.now(),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidateShop();
      return res;
    },
    [dequeueTurn, invalidateShop, recordCommit, shopId],
  );

  const reverse = useCallback(
    async (txId: string | null, reason: string) => {
      const base = { idempotency_key: newIdempotencyKey("rev"), transaction_id: txId, reason };
      const payload = { ...base, audit_meta: { channel: reason, replay_payload: base } };
      const res = await apiClient.reverse(payload, shopId ?? undefined);
      recordCommit({
        response: res,
        endpoint: "/api/transactions/reverse",
        payload: payload as Record<string, unknown>,
        trace: null,
        proposal: null,
        label: "Reversal",
        replay: null,
        committedAt: Date.now(),
      });
      await invalidateShop();
      return res;
    },
    [invalidateShop, recordCommit, shopId],
  );

  const doUndo = useCallback(async () => {
    if (!undo) return;
    const active = undo;
    setUndo(null);
    try {
      await reverse(active.txId, "undo-5s");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast("Undone — stock, cash & chain restored", "ok");
    } catch (err) {
      toast(friendlyApiError(err), "err");
    }
  }, [reverse, setUndo, toast, undo]);

  const replayTest = useCallback(
    async (target?: { endpoint: string; payload: Record<string, unknown> }) => {
      const chosen = target ?? (lastCommit ? { endpoint: lastCommit.endpoint, payload: lastCommit.payload } : null);
      if (!chosen) return null;
      let res: CommitResponse;
      if (chosen.endpoint.endsWith("/payment")) {
        res = await apiClient.payment(chosen.payload as never, shopId ?? undefined);
      } else if (chosen.endpoint.endsWith("/reverse")) {
        res = await apiClient.reverse(chosen.payload as never, shopId ?? undefined);
      } else if (chosen.endpoint.endsWith("/purchase")) {
        res = await apiClient.purchase(chosen.payload as never, shopId ?? undefined);
      } else {
        res = await apiClient.commit(chosen.payload as never, shopId ?? undefined);
      }
      if (!target && lastCommit) setReplayResult(res);
      return res;
    },
    [lastCommit, setReplayResult, shopId],
  );

  const submitTurn = useCallback(
    async (input: { audioUri?: string; mimeType?: string; text?: string }, givenKey?: string) => {
      if (!shopId) return;
      const key = givenKey ?? newIdempotencyKey("turn");

      const saveOffline = async (why: string) => {
        await enqueueTurn({
          key,
          shopId,
          kind: input.audioUri ? "audio" : "text",
          sourceUri: input.audioUri,
          mime: input.mimeType,
          text: input.text,
        });
        toast(`${why} · saved offline (Pending Sync)`, "warn");
      };

      if (!online) {
        await saveOffline("Offline");
        return;
      }

      setThinking(true);
      try {
        const res = await apiClient.turn(input, shopId);
        if (input.audioUri && res.trace.transcript) {
          void saveReplayClip({
            id: key,
            sourceUri: input.audioUri,
            mime: input.mimeType ?? "audio/mp4",
            transcript: res.trace.transcript,
          });
        }
        if (res.trace.source === "rules") {
          toast("Model busy — rule-based parse, please review", "info");
        }
        const action = classifyTurnResponse(res, key);
        switch (action.type) {
          case "auto_commit_sale":
            await confirmSale(action.proposal, action.key, action.trace, { auto: true });
            break;
          case "open_sale_review":
            openReviewForProposal(action.proposal, action.key, action.trace);
            break;
          case "open_payment":
            setModal({ type: "payment", proposal: action.proposal, key: action.key, trace: action.trace });
            break;
          case "open_reversal":
            setModal({ type: "reversal", target: action.target, key: action.key });
            break;
          case "open_pulse":
            setModal({ type: "pulse", pulse: action.pulse });
            break;
          case "open_answer":
            setModal({
              type: "answer",
              answer: action.answer,
              proposal: action.proposal,
              tools: action.tools,
              trace: action.trace,
            });
            break;
          case "open_parchi":
            router.push("/parchi");
            break;
          case "unknown":
            toast(
              `Samajh nahi aaya${action.transcript ? `: “${action.transcript}”` : ""} — dobara bolein`,
              "warn",
            );
            break;
        }
      } catch (err) {
        if (err instanceof ApiError && (err.network || QUEUEABLE_CODES.has(err.code))) {
          await saveOffline(err.code === "AUTH_REQUIRED" ? "Session expired" : err.network ? "Network down" : "Munshi busy");
        } else {
          toast(friendlyApiError(err), "err");
        }
      } finally {
        setThinking(false);
      }
    },
    [confirmSale, enqueueTurn, online, openReviewForProposal, router, shopId, toast],
  );

  const openQueuedReview = useCallback(
    async (key?: string) => {
      const target: QueuedTurn | undefined = key
        ? queue.find((q) => q.key === key)
        : queue.find((q) => q.status === "review");
      if (!target) return;
      if (target.review_kind === "sale" && target.proposal?.kind === "sale") {
        openReviewForProposal(target.proposal, target.key, target.trace ?? null);
        return;
      }
      if (target.review_kind === "payment" && target.proposal?.kind === "payment") {
        setModal({ type: "payment", proposal: target.proposal, key: target.key, trace: target.trace ?? null });
        return;
      }
      if (target.review_kind === "reversal") {
        setModal({ type: "reversal", target: target.target ?? state?.feed[0] ?? null, key: target.key });
        return;
      }
      await submitTurn(
        { audioUri: target.file_uri ?? undefined, mimeType: target.mime ?? undefined, text: target.text ?? undefined },
        target.key,
      );
    },
    [openReviewForProposal, queue, state?.feed, submitTurn],
  );

  const flushNow = useCallback(async () => {
    if (!shopId || !online) return;
    const pendingBefore = queue.filter((q) => q.status === "pending").length;
    if (pendingBefore === 0) return;

    const t0 = Date.now();
    const result = await flush(shopId, async (q) => {
      const res = await apiClient.turn(
        { audioUri: q.file_uri ?? undefined, mimeType: q.mime ?? undefined, text: q.text ?? undefined },
        shopId,
      );
      if (res.kind === "sale" && res.proposal.tier === 1) {
        await confirmSale(res.proposal, q.key, res.trace, { auto: true });
        return "done";
      }
      return deferredFlushOutcome(res);
    });

    await invalidateShop();
    if (result.done > 0 || result.review > 0) {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      toast(
        `Synced ${result.done}${result.review ? ` · ${result.review} need review` : ""} in ${secs}s · 0 duplicates`,
        "ok",
      );
    }
    if (result.review > 0 && !activeReview && !modal) {
      await openQueuedReview();
    }
  }, [activeReview, confirmSale, flush, invalidateShop, modal, online, openQueuedReview, queue, shopId, toast]);

  useEffect(() => {
    registerFlushRunner(() => flushNow());
    return () => registerFlushRunner(null);
  }, [flushNow, registerFlushRunner]);

  const value = useMemo<MunshiContextValue>(
    () => ({
      thinking,
      modal,
      activeReview,
      closeModal,
      openPulseSheet,
      openReplaysSheet,
      openReviewForProposal,
      openPaymentForProposal,
      clearReview,
      submitTurn,
      confirmSale,
      confirmPayment,
      reverse,
      doUndo,
      replayTest,
      flushNow,
      openQueuedReview,
    }),
    [
      thinking,
      modal,
      activeReview,
      closeModal,
      openPulseSheet,
      openReplaysSheet,
      openReviewForProposal,
      openPaymentForProposal,
      clearReview,
      submitTurn,
      confirmSale,
      confirmPayment,
      reverse,
      doUndo,
      replayTest,
      flushNow,
      openQueuedReview,
    ],
  );

  return <MunshiContext.Provider value={value}>{children}</MunshiContext.Provider>;
}

export function useMunshi() {
  const ctx = useContext(MunshiContext);
  if (!ctx) throw new Error("useMunshi must be used inside MunshiProvider");
  return ctx;
}

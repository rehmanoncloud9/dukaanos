"use client";

import { RotateCcw, ShieldCheck, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { CommitResponse, JournalRow, PakPhoneTrace, TurnTrace } from "@/lib/api/contracts";
import { api, friendlyError } from "@/lib/client/api";
import { useDukaan } from "@/lib/client/store";
import { formatJournal } from "@/lib/domain/money";
import { cx, Pill, Sheet, Spinner, SW } from "./ui";

interface XRayDoc {
  transaction: {
    id: string; seq: number; type: string; total_paisa: number; discount_paisa: number; entry_hash: string; prev_hash: string;
    idempotency_key: string; created_at: string; audit_meta: Record<string, unknown> & { replay_payload?: Record<string, unknown>; transcript?: string; model?: string; latency_ms?: number; pakphone?: PakPhoneTrace; source?: string };
  };
  journal: JournalRow[];
  delta: number;
  hash_valid: boolean;
  rows_for_key: number;
  rls_shop_id: string;
  reversed_by: string | null;
}

const ENDPOINT: Record<string, string> = {
  sale: "/api/transactions/commit",
  payment: "/api/transactions/payment",
  reversal: "/api/transactions/reverse",
  purchase: "/api/transactions/purchase",
};

function Row({ n, title, badge, children }: { n: string; title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="hairline-b grid grid-cols-[26px_1fr] gap-2 px-5 py-3.5">
      <span className="pt-0.5 font-mono text-[12px] text-ink-3">{n}</span>
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold">{title}</span>
          {badge}
        </div>
        <div className="rounded-[10px] bg-canvas px-3 py-2.5 font-mono text-[11.5px] leading-[18px] text-ink">{children}</div>
      </div>
    </div>
  );
}

export function XRaySheet({ txId, onClose }: { txId?: string | null; onClose: () => void }) {
  const { lastCommit, replayTest, state, simulatedOffline, setSimulatedOffline, toast } = useDukaan();
  const target = txId ?? lastCommit?.response.transaction_id ?? state?.feed[0]?.id ?? null;
  const live = lastCommit && lastCommit.response.transaction_id === target ? lastCommit : null;
  const [doc, setDoc] = useState<XRayDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [replay, setReplay] = useState<CommitResponse | null>(live?.replay ?? null);
  const [replaying, setReplaying] = useState(false);
  const [chain, setChain] = useState<{ ok: boolean; code: string; checked: number; ms: number; first_broken_seq?: number } | null>(null);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    api<XRayDoc>(`/api/shop/xray?id=${target}`)
      .then(setDoc)
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [target]);

  const meta = doc?.transaction.audit_meta ?? {};
  const trace: Partial<TurnTrace> = live?.trace ?? { transcript: meta.transcript as string, model: meta.model as string, latency_ms: meta.latency_ms as number, pakphone: meta.pakphone as PakPhoneTrace, source: meta.source as TurnTrace["source"] };
  const journal = live?.response.journal ?? doc?.journal ?? [];
  const hash = live?.response.entry_hash ?? doc?.transaction.entry_hash ?? "";
  const prev = live?.response.prev_hash ?? doc?.transaction.prev_hash ?? "";
  const delta = doc?.delta ?? live?.response.delta ?? 0;
  const pak = trace.pakphone;
  const discount = doc?.transaction.discount_paisa ?? live?.response.totals?.discount_paisa ?? 0;
  const replayTarget = live ? { endpoint: live.endpoint, payload: live.payload } : doc?.transaction.audit_meta?.replay_payload ? { endpoint: ENDPOINT[doc.transaction.type], payload: doc.transaction.audit_meta.replay_payload } : null;

  const doReplay = async () => {
    if (!replayTarget) return;
    setReplaying(true);
    try {
      const r = live ? await replayTest() : await replayTest(replayTarget);
      setReplay(r);
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setReplaying(false);
    }
  };

  const verify = async () => {
    try {
      setChain(await api("/api/shop/chain"));
    } catch (e) {
      toast(friendlyError(e), "err");
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono text-[17px]">{"</>"}</span> X-Ray Inspector
          <Pill tone="cash" mono className="h-5 px-2 text-[10px]">LIVE</Pill>
        </span>
      }
    >
      {loading && !live && (
        <div className="flex items-center gap-2 px-5 py-4 text-[14px] text-ink-2">
          <Spinner /> Loading proof…
        </div>
      )}
      <Row n="01" title={`Transcript${trace.model ? ` (${trace.model.replace(/^gemini-/, "")})` : trace.source === "regex" ? " (regex fast-path)" : ""}`} badge={trace.latency_ms ? <span className="font-mono text-[12px] text-ink-2">{trace.latency_ms}ms</span> : undefined}>
        <span dir="auto" className="font-sans text-[13px]">
          {trace.transcript ? `“${trace.transcript}”` : doc?.transaction.type === "purchase" ? "Parchi OCR import (0 write tools)" : "Seeded / manual entry — no voice turn"}
        </span>
      </Row>
      <Row n="02" title="PakPhone + Desi Math" badge={pak ? <Pill tone="cash" mono className="h-5 px-2 text-[10.5px]">{pak.ms_total}ms</Pill> : undefined}>
        {pak?.customer && (
          <div>
            phonetic(“{pak.customer.mention.toLowerCase()}”) → {pak.customer.candidates[0]?.name ?? "?"} ({pak.customer.candidates[0]?.score.toFixed(2) ?? "–"})
          </div>
        )}
        {pak?.items.map((i, k) => (
          <div key={k}>
            {i.formula || `match(“${i.spoken}”) → ${i.product ?? "QuickAdd"} (${i.score.toFixed(2)})`}
          </div>
        ))}
        {discount > 0 && <div>modifier(“chhor do”) → -{discount / 100} PKR</div>}
        {!pak && <div className="text-ink-2">No PakPhone trace for this entry</div>}
      </Row>
      <Row n="03" title="Balanced Journal" badge={<Pill tone={delta === 0 ? "cash" : "udhaar"} mono className="h-5 px-2 text-[10.5px]">Δ = {delta} {delta === 0 ? "✓" : "✗"}</Pill>}>
        {journal.map((j, k) => (
          <div key={k} className="flex justify-between gap-2">
            <span>
              {j.side} {j.account_code} {j.account_name}
            </span>
            <span className="num">{formatJournal(j.amount_paisa)}</span>
          </div>
        ))}
      </Row>
      <Row n="04" title="SHA-256 Chain + RLS" badge={<Pill mono className="h-5 px-2 text-[10.5px]">RLS ON</Pill>}>
        <div className="break-all">hash: {hash.slice(0, 10)}…{hash.slice(-8)}</div>
        <div className="break-all text-ink-2">prev: {prev.slice(0, 10)}…{prev.slice(-8)}</div>
        <div>shop_id: {(doc?.rls_shop_id ?? live?.response.rls_shop_id ?? "").slice(0, 18)}…</div>
        {doc && <div className={doc.hash_valid ? "text-cash" : "text-udhaar"}>recompute: {doc.hash_valid ? "match ✓" : "MISMATCH ✗"} · rows for key: {doc.rows_for_key}</div>}
        {doc?.reversed_by && <div className="text-udhaar">reversed by {doc.reversed_by.slice(0, 8)}…</div>}
      </Row>

      <div className="space-y-2.5 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <button onClick={doReplay} disabled={!replayTarget || replaying} className="tactile flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-black/15 bg-surface text-[15px] font-semibold disabled:opacity-40">
          {replaying ? <Spinner /> : <RotateCcw size={15} strokeWidth={SW} />} Replay Test
          {replay && (
            <Pill tone={replay.deduplicated ? "cash" : "udhaar"} mono className="ml-1">
              {replay.deduplicated ? `${replay.http} OK · ${replay.duplicate_rows} Dupes` : "NEW ROW?!"}
            </Pill>
          )}
        </button>
        {!replayTarget && <p className="text-center text-[12px] text-ink-2">Replay is available for entries made in-app (seeded history has no client payload).</p>}
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={verify} className="tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] bg-surface-sunken text-[13px] font-semibold">
            <ShieldCheck size={15} strokeWidth={SW} /> Verify chain
          </button>
          <button onClick={() => setSimulatedOffline(!simulatedOffline)} className={cx("tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] text-[13px] font-semibold", simulatedOffline ? "bg-amber-bg text-amber-ink" : "bg-surface-sunken")}>
            <WifiOff size={15} strokeWidth={SW} /> {simulatedOffline ? "Offline ON" : "Simulate Offline"}
          </button>
        </div>
        {chain && (
          <div className={cx("rounded-[12px] px-3 py-2 font-mono text-[12px]", chain.ok ? "bg-cash-bg text-cash-ink" : "bg-udhaar-bg text-udhaar-ink")}>
            {chain.ok ? `CHAIN_OK · ${chain.checked} links recomputed · ${chain.ms}ms` : `CHAIN_BROKEN at #${chain.first_broken_seq} · ${chain.code}`}
          </div>
        )}
      </div>
    </Sheet>
  );
}

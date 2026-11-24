"use client";

import { Camera, FileImage, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CommitResponse } from "@/lib/api/contracts";
import type { ParchiParseResult, ParchiReviewLine } from "@/lib/ai/parchi";
import { api, friendlyError, newKey } from "@/lib/client/api";
import { renderStagedParchi } from "@/lib/client/canvas";
import { prepareImage, type PreparedImage } from "@/lib/client/image";
import { useDukaan } from "@/lib/client/store";
import { formatAmount, formatJournal, formatRs, rupeesToPaisa } from "@/lib/domain/money";
import { cx, Money, Pill, PrimaryButton, SecondaryButton, Sheet, Spinner, SW } from "./ui";

type Stage = "capture" | "parsing" | "review" | "done";

interface EditLine extends ParchiReviewLine {
  choice: "computed" | "written";
}

export function ParchiSheet({ onClose, autoSample }: { onClose: () => void; autoSample?: boolean }) {
  const { commitPurchase, toast, openSheet } = useDukaan();
  const [stage, setStage] = useState<Stage>("capture");
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [res, setRes] = useState<(ParchiParseResult & { api_ms: number }) | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CommitResponse | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const key = useRef(newKey("parchi"));
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  const run = async (file: Blob) => {
    try {
      const prepared = await prepareImage(file);
      setImg(prepared);
      if (prepared.lowRes) toast("Photo bohat chhoti hai (<800px) — retake for best OCR", "warn");
      setStage("parsing");
      const form = new FormData();
      form.append("image", new File([prepared.blob], "parchi.jpg", { type: "image/jpeg" }));
      const r = await api<ParchiParseResult & { api_ms: number }>("/api/parchi/parse", { form, timeoutMs: 60_000 });
      setRes(r);
      setLines(r.lines.map((l) => ({ ...l, choice: "computed" })));
      setCash(String(Math.round(r.lines.reduce((s, l) => s + l.line_total_paisa, 0) / 100)));
      setStage("review");
    } catch (e) {
      toast(friendlyError(e), "err");
      setStage("capture");
    }
  };

  useEffect(() => {
    if (autoSample) void renderStagedParchi().then(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSample]);

  const amountOf = (l: EditLine) => (l.math_mismatch && l.choice === "written" ? l.written_total_paisa ?? l.line_total_paisa : l.line_total_paisa);
  const total = lines.reduce((s, l) => s + amountOf(l), 0);
  const newCount = lines.filter((l) => l.match_status === "new_sku").length;

  const commit = async () => {
    if (!res) return;
    setBusy(true);
    const base = {
      idempotency_key: key.current,
      supplier_name: res.supplier_name,
      cash_paid_paisa: Math.min(total, rupeesToPaisa(Number(cash || 0))),
      stated_total_paisa: res.math_check.extracted_total_paisa,
      lines: lines.map((l) => ({
        ...(l.product_id ? { product_id: l.product_id } : { new_sku: { name: l.name, base_unit: l.base_unit, pack_size_base_units: l.pack_size_base_units } }),
        qty_base_units: l.qty_base_units,
        line_total_paisa: amountOf(l),
        spoken: l.written_name,
      })),
    };
    try {
      const r = await commitPurchase({
        ...base,
        audit_meta: {
          channel: "parchi",
          model: res.model,
          latency_ms: res.latency_ms,
          legibility: res.legibility,
          mismatches: lines.filter((l) => l.math_mismatch).map((l) => ({ name: l.name, choice: l.choice, written: l.written_total_paisa, computed: l.computed_total_paisa })),
          replay_payload: base,
        },
      });
      setDone(r);
      setStage("done");
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const patchLine = (k: string, patch: Partial<EditLine>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== k) return l;
        const n = { ...l, ...patch };
        if (patch.qty_number !== undefined) {
          const per = l.qty_number > 0 ? l.qty_base_units / l.qty_number : l.pack_size_base_units;
          n.qty_base_units = Math.max(1, Math.round(n.qty_number * per));
          if (n.rate_paisa !== null) {
            n.computed_total_paisa = Math.round(n.qty_number * n.rate_paisa);
            n.line_total_paisa = n.computed_total_paisa;
            n.math_mismatch = n.written_total_paisa !== null && n.computed_total_paisa !== n.written_total_paisa;
          }
        }
        return n;
      }),
    );

  return (
    <Sheet
      open
      onClose={onClose}
      title={stage === "review" ? "Parchi OCR Review" : stage === "done" ? "Restocked ✓" : "Wholesale Parchi Scan"}
      right={stage === "review" ? <span className="text-[13px] text-ink-2">{lines.length} items · 0 write tools</span> : undefined}
    >
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])} />
      <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])} />

      {stage === "capture" && (
        <div className="space-y-2.5 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
          <p className="text-[14px] text-ink-2">Matte dark board, 30° off the light. Client compresses to ≤1280px JPEG before upload.</p>
          <PrimaryButton tone="maal" className="w-full" onClick={() => camRef.current?.click()}>
            <Camera size={18} strokeWidth={SW} /> Snap parchi
          </PrimaryButton>
          <SecondaryButton className="flex w-full items-center justify-center gap-2" onClick={() => galRef.current?.click()}>
            <FileImage size={16} strokeWidth={SW} /> Choose from gallery
          </SecondaryButton>
          <button onClick={() => void renderStagedParchi().then(run)} className="tactile flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-maal/50 bg-maal-bg text-[15px] font-semibold text-maal">
            <Wand2 size={16} strokeWidth={SW} /> 1-tap staged field sample (Al-Madina)
          </button>
        </div>
      )}

      {stage === "parsing" && (
        <div className="flex flex-col items-center gap-3 px-5 pb-8 pt-2">
          {img && <img src={img.dataUrl} alt="Parchi" className="max-h-[260px] rounded-[12px] border border-black/10" />}
          <div className="flex items-center gap-2 text-[14px] text-ink-2">
            <Spinner className="text-maal" /> Reading parchi · vision OCR · <span className="font-mono text-[12px]">0 write tools</span>
          </div>
        </div>
      )}

      {stage === "review" && res && (
        <div className="pb-2">
          <div className="mx-5 mb-3 flex items-center gap-3 rounded-[14px] bg-canvas p-2.5">
            {img && <img src={img.dataUrl} alt="" className="h-14 w-14 rounded-[10px] object-cover" />}
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">
                {res.supplier_name} · {res.bill_date ?? new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </div>
              <div className="text-[13px] text-ink-2">
                {res.legibility === "poor" ? "Low legibility — check yellow rows" : "Crinkled handwritten slip parsed"} · {res.latency_ms}ms
              </div>
            </div>
          </div>

          <div className="mx-5 surface-card overflow-hidden">
            {lines.map((l) => (
              <div key={l.key} className={cx("hairline-b px-4 py-3 last:border-b-0", l.math_mismatch && "bg-udhaar-bg/60", !l.math_mismatch && l.low_confidence && "bg-amber-bg/60")}>
                <button className="flex w-full items-start gap-2 text-left" onClick={() => setEditing(editing === l.key ? null : l.key)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[15.5px] font-semibold">
                      {l.name}
                      {l.match_status === "new_sku" && <Pill tone="maal" className="h-5 px-1.5 text-[11px]">New Item</Pill>}
                    </div>
                    <div className="num text-[13px] text-ink-2">
                      {l.math_mismatch
                        ? `${l.qty_number} × Rs. ${formatAmount(l.rate_paisa ?? 0)} = Rs. ${formatAmount(l.computed_total_paisa ?? 0)} · Slip says Rs. ${formatAmount(l.written_total_paisa ?? 0)}`
                        : `${l.qty_number} ${l.unit ?? (l.base_unit === "pcs" ? "pcs" : "")}${l.rate_paisa !== null ? ` @ Rs. ${formatAmount(l.rate_paisa)}` : ""}${l.match_status === "new_sku" ? " · Auto-creates SKU" : ""}`}
                    </div>
                  </div>
                  {l.math_mismatch ? (
                    <span className="rounded-[6px] bg-udhaar px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white">MATH_MISMATCH</span>
                  ) : (
                    <Money paisa={amountOf(l)} className="text-[17px] font-bold" />
                  )}
                </button>
                {l.math_mismatch && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => patchLine(l.key, { choice: "computed" })} className={cx("tactile h-9 rounded-[10px] px-3 text-[13.5px] font-semibold", l.choice === "computed" ? "bg-ink text-white" : "border border-black/15 bg-surface")}>
                      Use {formatRs(l.computed_total_paisa ?? 0)}
                    </button>
                    <button onClick={() => patchLine(l.key, { choice: "written" })} className={cx("tactile h-9 rounded-[10px] px-3 text-[13.5px] font-semibold", l.choice === "written" ? "bg-ink text-white" : "border border-black/15 bg-surface")}>
                      Keep {formatRs(l.written_total_paisa ?? 0)}
                    </button>
                  </div>
                )}
                {editing === l.key && (
                  <div className="mt-2 grid grid-cols-[1fr_80px_100px] gap-1.5">
                    <input value={l.name} onChange={(e) => patchLine(l.key, { name: e.target.value })} className="h-9 rounded-[8px] bg-surface px-2 text-[14px] outline-none" />
                    <input inputMode="decimal" value={l.qty_number} onChange={(e) => patchLine(l.key, { qty_number: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} className="num h-9 rounded-[8px] bg-surface px-2 text-[14px] outline-none" />
                    <input
                      inputMode="numeric"
                      value={amountOf(l) / 100}
                      onChange={(e) => patchLine(l.key, { line_total_paisa: rupeesToPaisa(Number(e.target.value.replace(/[^\d.]/g, "")) || 0), math_mismatch: false })}
                      className="num h-9 rounded-[8px] bg-surface px-2 text-[14px] outline-none"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {res.math_check.extracted_total_paisa !== null && res.math_check.extracted_total_paisa !== total && (
            <div className="mx-5 mt-2 rounded-[12px] bg-amber-bg px-3 py-2 text-[13px] text-amber-ink num">
              Slip total {formatRs(res.math_check.extracted_total_paisa)} ≠ SUM(lines) {formatRs(total)} · Δ {formatRs(res.math_check.extracted_total_paisa - total)}
            </div>
          )}

          <div className="mx-5 mt-3 flex items-center gap-3">
            <span className="text-[13px] text-ink-2">Cash paid now</span>
            <span className="text-[13px] text-ink-2">Rs.</span>
            <input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d]/g, ""))} className="num h-9 w-28 rounded-[8px] bg-canvas px-2 text-[15px] font-semibold outline-none" />
            <span className="ml-auto text-[12.5px] text-ink-2 num">A/P {formatRs(Math.max(0, total - rupeesToPaisa(Number(cash || 0))))}</span>
          </div>

          <div className="hairline-t mt-3 flex items-baseline justify-between px-5 pt-3">
            <span className="text-[14px] text-ink-2">
              Restock Total ({lines.length} SKUs{newCount ? ` · ${newCount} new` : ""})
            </span>
            <Money paisa={total} className="text-[22px] font-bold" />
          </div>
          <div className="flex gap-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
            <SecondaryButton onClick={onClose} className="w-[92px]">
              Cancel
            </SecondaryButton>
            <PrimaryButton tone="maal" busy={busy} disabled={!lines.length || total <= 0} onClick={commit} className="flex-1">
              Restock Commit
            </PrimaryButton>
          </div>
        </div>
      )}

      {stage === "done" && done && (
        <div className="space-y-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="surface-card p-4">
            <div className="text-[15px] font-semibold">{res?.supplier_name}</div>
            <Money paisa={done.totals.total_paisa ?? 0} className="mt-1 block text-[26px] font-bold" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone="cash" mono>Δ = 0 ✓</Pill>
              <Pill mono>#{done.seq} {done.entry_hash.slice(0, 10)}…</Pill>
              {done.math_check && <Pill tone={done.math_check.passed ? "cash" : "amber"} mono>{done.math_check.passed ? "MATH OK" : "MATH_MISMATCH resolved"}</Pill>}
            </div>
            <div className="mt-3 rounded-[10px] bg-canvas p-2.5 font-mono text-[11.5px]">
              {done.journal.map((j, i) => (
                <div key={i} className="flex justify-between">
                  <span>{j.side} {j.account_code} {j.account_name}</span>
                  <span>{formatJournal(j.amount_paisa)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <SecondaryButton className="flex-1" onClick={() => openSheet({ type: "xray", txId: done.transaction_id })}>
              {"</>"} X-Ray
            </SecondaryButton>
            <PrimaryButton className="flex-1" onClick={onClose}>
              Done
            </PrimaryButton>
          </div>
        </div>
      )}
    </Sheet>
  );
}

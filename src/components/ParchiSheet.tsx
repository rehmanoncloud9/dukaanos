"use client";

import { Camera, FileImage, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CommitResponse } from "@/lib/api/contracts";
import type { ParchiParseResult, ParchiReviewLine } from "@/lib/ai/parchi";
import { api, friendlyError, newKey } from "@/lib/client/api";
import { renderStagedParchi } from "@/lib/client/canvas";
import { prepareImage, type PreparedImage } from "@/lib/client/image";
import { useDukaan } from "@/lib/client/store";
import { parseQuantityPhrase, quantityToBaseUnits, requiresExplicitPackSize, type BaseUnit } from "@/lib/domain/desi-units";
import { formatAmount, formatJournal, formatRs, mulDiv } from "@/lib/domain/money";
import { parseRupeeAmount } from "@/lib/domain/urdu-numbers";
import { cx, Money, Pill, PrimaryButton, SecondaryButton, Sheet, Spinner, SW } from "./ui";
import { PriceMemoryCard } from "./PriceMemory";

type Stage = "capture" | "parsing" | "review" | "done";
type AmountChoice = "computed" | "written" | "agreed" | null;

interface EditLine extends ParchiReviewLine {
  choice: AmountChoice;
  reviewed: boolean;
  qtyText: string;
  unitText: string;
  rateText: string;
  totalText: string;
  packText: string;
}

function toAmount(text: string): number | null {
  if (!text.trim()) return null;
  return parseRupeeAmount(text)?.paisa ?? null;
}

function editLine(line: ParchiReviewLine): EditLine {
  const qtyText = line.qty_number === null ? "" : String(line.qty_number);
  const rateText = line.rate_paisa === null ? "" : String(line.rate_paisa / 100);
  const totalText = line.written_total_paisa === null ? "" : String(line.written_total_paisa / 100);
  return {
    ...line,
    choice: line.line_total_paisa === null ? null : "agreed",
    reviewed: !line.manual_review_required,
    qtyText,
    unitText: line.unit ?? "",
    rateText,
    totalText,
    packText: line.conversion_unresolved ? "" : String(line.pack_size_base_units),
  };
}

export function ParchiSheet({ onClose, autoSample }: { onClose: () => void; autoSample?: boolean }) {
  const { commitPurchase, toast, openSheet } = useDukaan();
  const [stage, setStage] = useState<Stage>("capture");
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [res, setRes] = useState<(ParchiParseResult & { api_ms: number }) | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [cash, setCash] = useState("");
  const [statedTotalText, setStatedTotalText] = useState("");
  const [statedTotalPaisa, setStatedTotalPaisa] = useState<number | null>(null);
  const [grandTotalAcknowledged, setGrandTotalAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [done, setDone] = useState<CommitResponse | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const key = useRef(newKey("parchi"));
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!img?.originalPreviewUrl) return;
    return () => URL.revokeObjectURL(img.originalPreviewUrl);
  }, [img]);

  const run = async (file: Blob) => {
    try {
      setParseErr(null);
      const prepared = await prepareImage(file);
      setImg(prepared);
      if (prepared.lowRes) toast("Photo bohat chhoti hai (<800px) — retake for best OCR", "warn");
      setStage("parsing");
      const form = new FormData();
      form.append("image", new File([prepared.blob], "parchi.jpg", { type: "image/jpeg" }));
      let result: ParchiParseResult & { api_ms: number };
      try {
        result = await api<ParchiParseResult & { api_ms: number }>("/api/parchi/parse", { form, timeoutMs: 60_000 });
      } catch (firstErr) {
        // Hedged 503 retry: single retry with 800ms ± 200ms jittered backoff (Phase C)
        const isTransient = firstErr instanceof Error && /503|504|UNAVAILABLE|timeout/i.test(firstErr.message);
        if (isTransient) {
          await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
          try {
            const form2 = new FormData();
            form2.append("image", new File([prepared.blob], "parchi.jpg", { type: "image/jpeg" }));
            result = await api<ParchiParseResult & { api_ms: number }>("/api/parchi/parse", { form: form2, timeoutMs: 60_000 });
          } catch {
            throw firstErr; // propagate original error — UI will show manual fallback
          }
        } else {
          throw firstErr;
        }
      }
      setRes(result);
      setLines(result.lines.map(editLine));
      const extracted = result.math_check.extracted_total_paisa;
      setStatedTotalPaisa(extracted);
      setStatedTotalText(extracted === null ? "" : String(extracted / 100));
      setCash("");
      setGrandTotalAcknowledged(false);
      setStage("review");
    } catch (error) {
      const msg = friendlyError(error);
      setParseErr(msg);
      toast(msg, "err");
      setStage("capture");
    }
  };

  useEffect(() => {
    if (autoSample) void renderStagedParchi().then(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSample]);

  const amountOf = (line: EditLine) => line.line_total_paisa ?? 0;
  const total = lines.reduce((sum, line) => sum + amountOf(line), 0);
  const totalSafe = Number.isSafeInteger(total);
  const newCount = lines.filter((line) => line.match_status === "new_sku").length;
  const hasUnreviewedLine = lines.some((line) => !line.reviewed || line.qty_base_units === null || line.line_total_paisa === null);
  const grandTotalMismatch = statedTotalPaisa === null || statedTotalPaisa !== total;
  const grandTotalNeedsConfirmation = grandTotalMismatch && !grandTotalAcknowledged;
  const cashPaidPaisa = toAmount(cash);

  const patchLine = (keyToPatch: string, patch: Partial<EditLine>) => {
    setGrandTotalAcknowledged(false);
    setLines((current) => current.map((line) => {
      if (line.key !== keyToPatch) return line;
      const changed = { ...line, ...patch, reviewed: false };
      const numericEdit = patch.qtyText !== undefined || patch.unitText !== undefined || patch.rateText !== undefined
        || patch.totalText !== undefined || patch.packText !== undefined || patch.base_unit !== undefined;
      if (numericEdit) {
        changed.choice = null;
        changed.line_total_paisa = null;
        changed.qty_base_units = null;
        changed.rate_paisa = null;
        changed.written_total_paisa = null;
        changed.computed_total_paisa = null;
        changed.math_mismatch = false;
      }
      return changed;
    }));
  };

  const applyManualLine = (line: EditLine) => {
    const quantity = parseQuantityPhrase(`${line.qtyText} ${line.unitText}`.trim());
    if (quantity.unresolved || quantity.hundredths === null || !quantity.unit) {
      toast("Quantity or unit is unclear. Enter a supported number and unit.", "warn");
      return;
    }
    const incompatible = (quantity.unit.family === "mass" && line.base_unit !== "g")
      || (quantity.unit.family === "volume" && line.base_unit !== "ml")
      || (quantity.unit.family === "count" && line.base_unit !== "pcs");
    if (incompatible) {
      toast("Choose a stock unit that matches the written quantity unit.", "warn");
      return;
    }
    if (line.match_status === "matched" && quantity.unit.family === "pack" && requiresExplicitPackSize(line.unitText)) {
      toast("This carton or sack has no catalog conversion. Enter its known contents in kg, g, litre, ml, or pieces.", "warn");
      return;
    }
    let packSize = line.pack_size_base_units;
    if (line.conversion_unresolved && line.match_status === "new_sku") {
      packSize = Number(line.packText);
      if (!Number.isSafeInteger(packSize) || packSize <= 0) {
        toast("Enter the confirmed base-unit size for this package before continuing.", "warn");
        return;
      }
    }
    const rate = toAmount(line.rateText);
    const written = toAmount(line.totalText);
    let qtyBase: number;
    try {
      qtyBase = quantityToBaseUnits(quantity, {
        name: line.name,
        base_unit: line.base_unit,
        pack_size_base_units: packSize,
        unit_price_paisa: rate ?? 0,
      });
    } catch {
      toast("This unit cannot safely convert to the item stock unit.", "warn");
      return;
    }
    if (qtyBase <= 0 || !Number.isSafeInteger(qtyBase)) {
      toast("Quantity must be a positive safe value.", "warn");
      return;
    }
    const computed = rate === null ? null : mulDiv(quantity.hundredths, rate, 100);
    const agree = computed !== null && written !== null && computed === written;
    const writtenMatches = written !== null && computed === null;
    const lineTotal = agree ? computed : writtenMatches ? written : null;
    setGrandTotalAcknowledged(false);
    setLines((current) => current.map((entry) => entry.key !== line.key ? entry : {
      ...entry,
      qty_number: quantity.hundredths! / 100,
      unit: line.unitText,
      pack_size_base_units: packSize,
      conversion_unresolved: false,
      qty_base_units: qtyBase,
      rate_paisa: rate,
      written_total_paisa: written,
      computed_total_paisa: computed,
      line_total_paisa: lineTotal,
      math_mismatch: computed !== null && written !== null && computed !== written,
      choice: agree ? "agreed" : writtenMatches ? "written" : null,
      manual_review_required: true,
      reviewed: false,
      issues: [],
    }));
  };

  const chooseAmount = (line: EditLine, choice: "computed" | "written") => {
    const amount = choice === "computed" ? line.computed_total_paisa : line.written_total_paisa;
    if (amount === null) return;
    setGrandTotalAcknowledged(false);
    setLines((current) => current.map((entry) => entry.key !== line.key ? entry : { ...entry, choice, line_total_paisa: amount, reviewed: false }));
  };

  const confirmLine = (line: EditLine) => {
    if (line.qty_base_units === null || line.qty_base_units <= 0 || line.line_total_paisa === null || line.line_total_paisa < 0) return;
    setLines((current) => current.map((entry) => entry.key !== line.key ? entry : { ...entry, reviewed: true, manual_review_required: false }));
  };

  const commit = async () => {
    if (!res || hasUnreviewedLine || grandTotalNeedsConfirmation || !totalSafe || total <= 0 || cashPaidPaisa === null) return;
    setBusy(true);
    const base = {
      idempotency_key: key.current,
      supplier_name: res.supplier_name,
      cash_paid_paisa: Math.min(total, cashPaidPaisa),
      stated_total_paisa: statedTotalPaisa,
      lines: lines.map((line) => ({
        ...(line.product_id ? { product_id: line.product_id } : { new_sku: { name: line.name, base_unit: line.base_unit, pack_size_base_units: line.pack_size_base_units } }),
        qty_base_units: line.qty_base_units!,
        line_total_paisa: line.line_total_paisa!,
        spoken: line.written_name,
      })),
    };
    try {
      const result = await commitPurchase({
        ...base,
        audit_meta: {
          channel: "parchi",
          model: res.model,
          latency_ms: res.latency_ms,
          legibility: res.legibility,
          mismatches: lines.filter((line) => line.math_mismatch).map((line) => ({ name: line.name, choice: line.choice, written: line.written_total_paisa, computed: line.computed_total_paisa })),
          replay_payload: base,
        },
      });
      setDone(result);
      setStage("done");
    } catch (error) {
      toast(friendlyError(error), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={stage === "review" ? "Parchi OCR Review" : stage === "done" ? "Restocked ✓" : "Wholesale Parchi Scan"}
      right={stage === "review" ? <span className="text-[13px] text-ink-2">{lines.length} items · 0 write tools</span> : undefined}
    >
      <input ref={camRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => event.target.files?.[0] && void run(event.target.files[0])} />
      <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => event.target.files?.[0] && void run(event.target.files[0])} />

      {stage === "capture" && (
        <div className="space-y-2.5 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
          {parseErr && (
            <div className="space-y-2 rounded-[12px] border border-udhaar/30 bg-udhaar-bg px-3.5 py-2.5">
              <p className="text-[13.5px] font-medium text-udhaar-ink">{parseErr}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => img && void run(img.blob)}
                  className="tactile flex h-9 items-center gap-1.5 rounded-[10px] bg-white/60 px-3 text-[13px] font-semibold text-udhaar-ink"
                >
                  Retry OCR
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Manual restock fallback: open an empty review with 1 blank line, preserving idempotency_key
                    const blankResult: ParchiParseResult & { api_ms: number } = {
                      supplier_name: "Wholesale",
                      bill_date: null,
                      legibility: "fair",
                      lines: [],
                      math_check: { passed: false, checked: false, extracted_total_paisa: null, computed_total_paisa: null, delta_paisa: null },
                      manual_review_required: true,
                      new_sku_count: 0,
                      mismatch_count: 0,
                      model: "manual",
                      latency_ms: 0,
                      write_tools_bound: 0,
                      api_ms: 0,
                    };
                    setRes(blankResult);
                    setLines([]);
                    setStatedTotalPaisa(null);
                    setStatedTotalText("");
                    setCash("");
                    setGrandTotalAcknowledged(false);
                    setParseErr(null);
                    setStage("review");
                  }}
                  className="tactile flex h-9 items-center gap-1.5 rounded-[10px] bg-maal px-3 text-[13px] font-semibold text-white"
                >
                  Enter Lines Manually
                </button>
              </div>
            </div>
          )}
          <p className="text-[14px] text-ink-2">Use clear, even light and keep the whole parchi in frame. Upload is resized to a 1280px JPEG; the original stays available for review.</p>
          <PrimaryButton tone="maal" className="w-full" onClick={() => camRef.current?.click()}><Camera size={18} strokeWidth={SW} /> Snap parchi</PrimaryButton>
          <SecondaryButton className="flex w-full items-center justify-center gap-2" onClick={() => galRef.current?.click()}><FileImage size={16} strokeWidth={SW} /> Choose from gallery</SecondaryButton>
          <button onClick={() => void renderStagedParchi().then(run)} className="tactile flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-maal/50 bg-maal-bg text-[15px] font-semibold text-maal"><Wand2 size={16} strokeWidth={SW} /> 1-tap staged field sample</button>
        </div>
      )}

      {stage === "parsing" && (
        <div className="flex flex-col items-center gap-3 px-5 pb-8 pt-2">
          {img && <img src={img.originalPreviewUrl} alt="Original parchi" className="max-h-[260px] rounded-[12px] border border-black/10" />}
          <div className="flex items-center gap-2 text-[14px] text-ink-2"><Spinner className="text-maal" /> Reading parchi · vision OCR · <span className="font-mono text-[12px]">0 write tools</span></div>
        </div>
      )}

      {stage === "review" && res && (
        <div className="pb-2">
          <div className="mx-5 mb-3 flex items-center gap-3 rounded-[14px] bg-canvas p-2.5">
            {img && <img src={img.originalPreviewUrl} alt="Original parchi reference" className="h-14 w-14 rounded-[10px] object-cover" />}
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{res.supplier_name} · {res.bill_date ?? "Date unclear"}</div>
              <div className="text-[13px] text-ink-2">{res.legibility === "poor" ? "Low legibility — review every highlighted row" : "Review transcription against the original"} · {res.latency_ms}ms</div>
            </div>
          </div>

          <div className="mx-5 surface-card overflow-hidden">
            {lines.map((line) => (
              <div key={line.key} className={cx("hairline-b px-4 py-3 last:border-b-0", (line.math_mismatch || !line.reviewed) && "bg-amber-bg/60")}>
                <button className="flex w-full items-start gap-2 text-left" onClick={() => setEditing(editing === line.key ? null : line.key)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[15.5px] font-semibold">
                      {line.name}
                      {line.match_status === "new_sku" && <Pill tone="maal" className="h-5 px-1.5 text-[11px]">New Item</Pill>}
                    </div>
                    <div className="num text-[13px] text-ink-2">
                      {line.qty_number === null ? "Quantity unclear" : `${line.qty_number} ${line.unit ?? "unit unclear"}`}
                      {line.rate_paisa !== null ? ` @ Rs. ${formatAmount(line.rate_paisa)}` : " · Rate unclear"}
                      {line.math_mismatch ? ` · Computed Rs. ${formatAmount(line.computed_total_paisa ?? 0)}; slip Rs. ${formatAmount(line.written_total_paisa ?? 0)}` : ""}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-ink-2">As written: {line.raw.name} · {line.raw.quantity ?? "?"} {line.raw.unit ?? ""} · {line.raw.rate ?? "?"} · {line.raw.line_total ?? "?"}</div>
                  </div>
                  {line.line_total_paisa === null ? <span className="rounded-[6px] bg-amber-ink px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white">REVIEW</span> : <Money paisa={line.line_total_paisa} className="text-[17px] font-bold" />}
                </button>

                {(line.computed_total_paisa !== null && line.written_total_paisa !== null && line.computed_total_paisa !== line.written_total_paisa) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => chooseAmount(line, "computed")} className={cx("tactile h-9 rounded-[10px] px-3 text-[13px] font-semibold", line.choice === "computed" ? "bg-ink text-white" : "border border-black/15 bg-surface")}>Use computed {formatRs(line.computed_total_paisa)}</button>
                    <button onClick={() => chooseAmount(line, "written")} className={cx("tactile h-9 rounded-[10px] px-3 text-[13px] font-semibold", line.choice === "written" ? "bg-ink text-white" : "border border-black/15 bg-surface")}>Keep written {formatRs(line.written_total_paisa)}</button>
                  </div>
                )}

                {editing === line.key && (
                  <div className="mt-2 space-y-2 rounded-[10px] bg-canvas p-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="text-[11px] text-ink-2">Name<input value={line.name} onChange={(event) => patchLine(line.key, { name: event.target.value })} className="mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none" /></label>
                      <label className="text-[11px] text-ink-2">Written unit<input value={line.unitText} onChange={(event) => patchLine(line.key, { unitText: event.target.value, unit: event.target.value })} placeholder="kg, g, pcs, packet…" className="mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none" /></label>
                      <label className="text-[11px] text-ink-2">Stock unit<select disabled={line.match_status === "matched"} value={line.base_unit} onChange={(event) => patchLine(line.key, { base_unit: event.target.value as BaseUnit })} className="mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none disabled:opacity-60"><option value="g">grams (g)</option><option value="ml">millilitres (ml)</option><option value="pcs">pieces (pcs)</option></select></label>
                      <label className="text-[11px] text-ink-2">Base units per package<input disabled={!line.conversion_unresolved || line.match_status === "matched"} inputMode="numeric" value={line.packText} onChange={(event) => patchLine(line.key, { packText: event.target.value.replace(/[^\d]/g, "") })} placeholder={line.conversion_unresolved && line.match_status === "new_sku" ? "required" : String(line.pack_size_base_units)} className="num mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none disabled:opacity-60" /></label>
                      <label className="text-[11px] text-ink-2">Quantity<input inputMode="decimal" value={line.qtyText} onChange={(event) => { const qtyText = event.target.value.replace(/[^\d.]/g, ""); patchLine(line.key, { qtyText, qty_number: qtyText && Number.isFinite(Number(qtyText)) ? Number(qtyText) : null }); }} className="num mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none" /></label>
                      <label className="text-[11px] text-ink-2">Rate (Rs.)<input inputMode="decimal" value={line.rateText} onChange={(event) => patchLine(line.key, { rateText: event.target.value.replace(/[^\d.]/g, "") })} className="num mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none" /></label>
                      <label className="col-span-2 text-[11px] text-ink-2">Written line total (Rs.)<input inputMode="decimal" value={line.totalText} onChange={(event) => patchLine(line.key, { totalText: event.target.value.replace(/[^\d.]/g, "") })} className="num mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none" /></label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SecondaryButton className="h-9" onClick={() => applyManualLine(line)}>Recalculate</SecondaryButton>
                      {line.computed_total_paisa !== null && <button onClick={() => chooseAmount(line, "computed")} className="tactile h-9 rounded-[10px] border border-black/15 bg-surface px-2.5 text-[12px] font-semibold">Use computed {formatRs(line.computed_total_paisa)}</button>}
                      {line.written_total_paisa !== null && <button onClick={() => chooseAmount(line, "written")} className="tactile h-9 rounded-[10px] border border-black/15 bg-surface px-2.5 text-[12px] font-semibold">Use written {formatRs(line.written_total_paisa)}</button>}
                      <PrimaryButton tone="maal" className="ml-auto h-9" disabled={line.line_total_paisa === null || line.qty_base_units === null} onClick={() => confirmLine(line)}>{line.reviewed ? "Confirmed" : "Confirm line"}</PrimaryButton>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mx-5 mt-3 space-y-2 rounded-[12px] bg-canvas p-3">
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <span>Written grand total (Rs.)</span>
              <input inputMode="decimal" value={statedTotalText} onChange={(event) => {
                const text = event.target.value.replace(/[^\d.,]/g, "");
                setStatedTotalText(text);
                setStatedTotalPaisa(toAmount(text));
                setGrandTotalAcknowledged(false);
              }} className="num h-9 w-32 rounded-[8px] bg-surface px-2 text-[14px] text-ink outline-none" placeholder="unclear" />
              {statedTotalPaisa !== null && statedTotalPaisa === total && totalSafe ? <Pill tone="cash" mono>Matches</Pill> : <Pill tone="amber" mono>Check total</Pill>}
            </div>
            {grandTotalMismatch && (
              <div className="text-[13px] text-amber-ink num">
                {statedTotalPaisa === null ? "Grand total is missing or unclear." : `Written total ${formatRs(statedTotalPaisa)} differs from selected line sum ${formatRs(total)}.`}
                <button onClick={() => setGrandTotalAcknowledged(true)} className={cx("ml-2 rounded-[8px] px-2 py-1 font-semibold", grandTotalAcknowledged ? "bg-ink text-white" : "border border-amber-ink/30 bg-surface")}>{grandTotalAcknowledged ? "Confirmed" : "Confirm selected line sum"}</button>
              </div>
            )}
          </div>

          <div className="mx-5 mt-3 flex items-center gap-3">
            <span className="text-[13px] text-ink-2">Cash paid now</span><span className="text-[13px] text-ink-2">Rs.</span>
            <input inputMode="decimal" value={cash} onChange={(event) => setCash(event.target.value.replace(/[^\d.,]/g, ""))} placeholder="required" className="num h-9 w-28 rounded-[8px] bg-canvas px-2 text-[15px] font-semibold outline-none" />
            <span className="ml-auto text-[12.5px] text-ink-2 num">A/P {formatRs(Math.max(0, total - (cashPaidPaisa ?? 0)))}</span>
          </div>

          <div className="hairline-t mt-3 flex items-baseline justify-between px-5 pt-3">
            <span className="text-[14px] text-ink-2">Restock Total ({lines.length} SKUs{newCount ? ` · ${newCount} new` : ""})</span>
            <Money paisa={total} className="text-[22px] font-bold" />
          </div>
          <div className="flex gap-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
            <SecondaryButton onClick={onClose} className="w-[92px]">Cancel</SecondaryButton>
            <PrimaryButton tone="maal" busy={busy} disabled={!lines.length || hasUnreviewedLine || grandTotalNeedsConfirmation || !totalSafe || total <= 0 || cashPaidPaisa === null} onClick={commit} className="flex-1">Restock Commit</PrimaryButton>
          </div>
        </div>
      )}

      {stage === "done" && done && (
        <div className="space-y-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="surface-card p-4">
            <div className="text-[15px] font-semibold">{res?.supplier_name}</div>
            <Money paisa={done.totals.total_paisa ?? 0} className="mt-1 block text-[26px] font-bold" />
            <div className="mt-2 flex flex-wrap gap-1.5"><Pill tone="cash" mono>Δ = 0 ✓</Pill><Pill mono>#{done.seq} {done.entry_hash.slice(0, 10)}…</Pill>{done.math_check && <Pill tone={done.math_check.passed ? "cash" : "amber"} mono>{done.math_check.passed ? "MATH OK" : "MATH_MISMATCH reviewed"}</Pill>}</div>
            <div className="mt-3 rounded-[10px] bg-canvas p-2.5 font-mono text-[11.5px]">{done.journal.map((entry, index) => <div key={index} className="flex justify-between"><span>{entry.side} {entry.account_code} {entry.account_name}</span><span>{formatJournal(entry.amount_paisa)}</span></div>)}</div>
          </div>
          <PriceMemoryCard />
          <div className="flex gap-3"><SecondaryButton className="flex-1" onClick={() => openSheet({ type: "xray", txId: done.transaction_id })}>{"</>"} X-Ray</SecondaryButton><PrimaryButton className="flex-1" onClick={onClose}>Done</PrimaryButton></div>
        </div>
      )}
    </Sheet>
  );
}


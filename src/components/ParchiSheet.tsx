"use client";

import { AlertTriangle, Camera, Check, ChevronDown, ChevronUp, FileImage, Pencil, Plus, ShieldAlert, Trash2, Volume2, Wand2, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommitResponse } from "@/lib/api/contracts";
import type { ParchiParseResult, ParchiReviewLine } from "@/lib/ai/parchi";
import { api, friendlyError, newKey } from "@/lib/client/api";
import { renderStagedParchi } from "@/lib/client/canvas";
import { prepareImage, type PreparedImage } from "@/lib/client/image";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { parseQuantityPhrase, quantityToBaseUnits, requiresExplicitPackSize, type BaseUnit } from "@/lib/domain/desi-units";
import { formatAmount, formatJournal, formatRs, mulDiv } from "@/lib/domain/money";
import { detectParchiMarginAlerts, parchiMarginSpeech } from "@/lib/domain/parchi-margin";
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

function isLineReady(line: ParchiReviewLine): boolean {
  return (
    line.qty_base_units !== null
    && line.qty_base_units > 0
    && line.line_total_paisa !== null
    && !line.math_mismatch
    && !line.conversion_unresolved
    && !line.low_confidence
    && !line.issues.includes("PRODUCT_AMBIGUOUS")
  );
}

function editLine(line: ParchiReviewLine): EditLine {
  const qtyText = line.qty_number === null ? "" : String(line.qty_number);
  const rateText = line.rate_paisa === null ? "" : String(line.rate_paisa / 100);
  const totalText = line.written_total_paisa === null ? "" : String(line.written_total_paisa / 100);
  return {
    ...line,
    choice: line.line_total_paisa === null ? null : "agreed",
    reviewed: isLineReady(line),
    qtyText,
    unitText: line.unit ?? "",
    rateText,
    totalText,
    packText: line.conversion_unresolved ? "" : String(line.pack_size_base_units),
  };
}

function blankResult(): ParchiParseResult & { api_ms: number } {
  return {
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
}

export function ParchiSheet({ onClose, autoSample }: { onClose: () => void; autoSample?: boolean }) {
  const { state, commitPurchase, refresh, toast, openSheet, xrayOn } = useDukaan();
  const [updatingRetailId, setUpdatingRetailId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("capture");
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [rawBlob, setRawBlob] = useState<Blob | null>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [photoExpanded, setPhotoExpanded] = useState(false);
  const [res, setRes] = useState<(ParchiParseResult & { api_ms: number }) | null>(null);
  const [supplierName, setSupplierName] = useState("Wholesale");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [cash, setCash] = useState("");
  const [statedTotalText, setStatedTotalText] = useState("");
  const [statedTotalPaisa, setStatedTotalPaisa] = useState<number | null>(null);
  const [grandTotalAcknowledged, setGrandTotalAcknowledged] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [showAdvancedUnit, setShowAdvancedUnit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingPage, setAddingPage] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [done, setDone] = useState<CommitResponse | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const key = useRef(newKey("parchi"));
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLInputElement>(null);
  const products = state?.products ?? [];
  const recentSuppliers = useMemo(() => {
    const names = new Set<string>();
    for (const t of state?.feed ?? []) {
      if (t.type === "purchase" && !t.is_reversed && t.supplier_name) names.add(t.supplier_name);
    }
    return [...names].slice(0, 5);
  }, [state?.feed]);

  useEffect(() => {
    if (!img?.originalPreviewUrl) return;
    return () => URL.revokeObjectURL(img.originalPreviewUrl);
  }, [img]);

  const run = async (file: Blob, enhance = false) => {
    try {
      setParseErr(null);
      setPhotoExpanded(false);
      setRawBlob(file);
      setEnhanced(enhance);
      const prepared = await prepareImage(file, 1280, 0.75, enhance);
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
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      setRes(result);
      setSupplierName(result.supplier_name || "Wholesale");
      const initialLines = result.lines.map(editLine);
      setLines(initialLines);
      const extracted = result.math_check.extracted_total_paisa;
      setStatedTotalPaisa(extracted);
      setStatedTotalText(extracted === null ? "" : String(extracted / 100));
      setCash("");
      setGrandTotalAcknowledged(false);
      setEditingTotal(false);
      // Auto-expand the first row only if it actually needs manual input (missing qty/unit/total without quick-choice mismatch)
      const firstNeedsEditor = initialLines.find(
        (l) => l.qty_base_units === null || l.conversion_unresolved || (l.line_total_paisa === null && !l.math_mismatch),
      );
      setEditing(firstNeedsEditor?.key ?? null);
      setStage("review");
      const alerts = detectParchiMarginAlerts(initialLines, products);
      if (alerts.length > 0) {
        void speak(parchiMarginSpeech(alerts));
      }
    } catch (error) {
      const msg = friendlyError(error);
      setParseErr(msg);
      toast(msg, "err");
      setStage("capture");
    }
  };

  const appendPage = async (file: Blob) => {
    setAddingPage(true);
    try {
      const prepared = await prepareImage(file);
      const form = new FormData();
      form.append("image", new File([prepared.blob], "parchi-page.jpg", { type: "image/jpeg" }));
      const extra = await api<ParchiParseResult & { api_ms: number }>("/api/parchi/parse", { form, timeoutMs: 60_000 });
      const offset = Date.now().toString(36);
      const more = extra.lines.map((l, idx) => editLine({ ...l, key: `${l.key}-p${offset}-${idx}` }));
      setLines((prev) => [...prev, ...more]);
      if (extra.math_check.extracted_total_paisa && statedTotalPaisa !== null) {
        const combined = statedTotalPaisa + extra.math_check.extracted_total_paisa;
        setStatedTotalPaisa(combined);
        setStatedTotalText(String(combined / 100));
      }
      setGrandTotalAcknowledged(false);
      toast(`${more.length} items from extra page added`, "ok");
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setAddingPage(false);
    }
  };

  const addBlankLine = () => {
    const k = `manual-${Date.now().toString(36)}`;
    const blank: EditLine = {
      key: k,
      raw: { name: "Manual item", quantity: null, unit: null, rate: null, line_total: null },
      written_name: "Manual item",
      match_status: "new_sku",
      product_id: null,
      name: "",
      match_score: 0,
      base_unit: "pcs",
      pack_size_base_units: 1,
      conversion_unresolved: false,
      qty_number: 1,
      unit: "pcs",
      qty_base_units: null,
      rate_paisa: null,
      written_total_paisa: null,
      computed_total_paisa: null,
      line_total_paisa: null,
      math_mismatch: false,
      manual_review_required: true,
      issues: [],
      low_confidence: false,
      confidence: 1,
      choice: null,
      reviewed: false,
      qtyText: "1",
      unitText: "pcs",
      rateText: "",
      totalText: "",
      packText: "1",
    };
    setLines((prev) => [...prev, blank]);
    setEditing(k);
  };

  const openManualEntry = () => {
    setRes(blankResult());
    setSupplierName("Wholesale");
    setLines([]);
    setStatedTotalPaisa(null);
    setStatedTotalText("");
    setCash("");
    setGrandTotalAcknowledged(false);
    setEditingTotal(false);
    setParseErr(null);
    setStage("review");
    addBlankLine();
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

  const duplicatePurchase = useMemo(() => {
    if (!state || total <= 0) return null;
    const cutoff = Date.now() - 3 * 86_400_000;
    const sup = supplierName.trim().toLowerCase();
    return state.feed.find(
      (t) =>
        t.type === "purchase" &&
        !t.is_reversed &&
        new Date(t.created_at).getTime() >= cutoff &&
        t.total_paisa === total &&
        (!sup || sup === "wholesale" || (t.supplier_name ?? "").toLowerCase() === sup),
    ) ?? null;
  }, [state, supplierName, total]);

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

  const saveEditedLine = (line: EditLine) => {
    if (!line.name.trim()) {
      toast("Item ka naam likhein.", "warn");
      return;
    }
    const quantity = parseQuantityPhrase(`${line.qtyText} ${line.unitText}`.trim());
    if (quantity.unresolved || quantity.hundredths === null || !quantity.unit) {
      toast("Quantity aur unit saaf likhein (e.g. 2 kg, 5 pcs).", "warn");
      return;
    }
    const incompatible = (quantity.unit.family === "mass" && line.base_unit !== "g")
      || (quantity.unit.family === "volume" && line.base_unit !== "ml")
      || (quantity.unit.family === "count" && line.base_unit !== "pcs");
    if (incompatible) {
      toast("Stock unit written unit se match nahi karta.", "warn");
      setShowAdvancedUnit(line.key);
      return;
    }
    if (line.match_status === "matched" && quantity.unit.family === "pack" && requiresExplicitPackSize(line.unitText)) {
      toast("Is carton/bori ka size set nahi — kg, g, L, ml, ya pcs mein likhein.", "warn");
      return;
    }
    let packSize = line.pack_size_base_units;
    if (line.conversion_unresolved && line.match_status === "new_sku") {
      packSize = Number(line.packText);
      if (!Number.isSafeInteger(packSize) || packSize <= 0) {
        toast("Pack size (base units) likhein.", "warn");
        setShowAdvancedUnit(line.key);
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
      toast("Unit convert nahi ho saka — unit check karein.", "warn");
      return;
    }
    if (qtyBase <= 0 || !Number.isSafeInteger(qtyBase)) {
      toast("Quantity zero se zyada honi chahiye.", "warn");
      return;
    }
    const computed = rate === null ? null : mulDiv(quantity.hundredths, rate, 100);
    const mismatch = computed !== null && written !== null && computed !== written;
    const lineTotal = computed !== null && written === null
      ? computed
      : written !== null && computed === null
        ? written
        : computed !== null && written !== null && computed === written
          ? computed
          : null;

    if (lineTotal === null && !mismatch) {
      toast("Rate ya line total likhein.", "warn");
      return;
    }

    const choice: AmountChoice = computed !== null && written === null
      ? "computed"
      : written !== null && computed === null
        ? "written"
        : computed !== null && written !== null && computed === written
          ? "agreed"
          : null;

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
      math_mismatch: mismatch,
      choice,
      manual_review_required: mismatch,
      reviewed: !mismatch,
      issues: [],
      low_confidence: false,
    }));
    if (!mismatch) setEditing(null);
  };

  const chooseAmount = (line: EditLine, choice: "computed" | "written") => {
    const amount = choice === "computed" ? line.computed_total_paisa : line.written_total_paisa;
    if (amount === null) return;
    setGrandTotalAcknowledged(false);
    setLines((current) => current.map((entry) => entry.key !== line.key ? entry : {
      ...entry,
      choice,
      line_total_paisa: amount,
      reviewed: entry.qty_base_units !== null && entry.qty_base_units > 0,
      manual_review_required: false,
    }));
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
      supplier_name: supplierName.trim() || res.supplier_name || "Wholesale",
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

  const livePreviewTotal = (line: EditLine): number | null => {
    const q = parseQuantityPhrase(`${line.qtyText} ${line.unitText}`.trim());
    const r = toAmount(line.rateText);
    if (q.unresolved || q.hundredths === null || r === null) return null;
    try {
      return mulDiv(q.hundredths, r, 100);
    } catch {
      return null;
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={stage === "review" ? "پرچی کی تصدیق" : stage === "done" ? "گودام میں درج ہو گیا ✓" : "پرچی اسکین"}
      right={stage === "review" ? (
        <span className="text-[13px] text-ink-2 urdu-ui">
          {lines.length} اشیاء{xrayOn ? " · 0 write tools" : ""}
        </span>
      ) : undefined}
    >
      <input ref={camRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => event.target.files?.[0] && void run(event.target.files[0])} />
      <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => event.target.files?.[0] && void run(event.target.files[0])} />
      <input ref={pageRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => event.target.files?.[0] && void appendPage(event.target.files[0])} />

      {stage === "capture" && (
        <div className="space-y-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
          {parseErr && (
            <div className="space-y-2 rounded-[12px] border border-udhaar/30 bg-udhaar-bg px-3.5 py-2.5">
              <p className="text-[13.5px] font-medium text-udhaar-ink">{parseErr}</p>
              <div className="flex flex-wrap gap-2">
                {rawBlob && (
                  <button
                    type="button"
                    onClick={() => void run(rawBlob, false)}
                    className="tactile flex h-9 items-center gap-1.5 rounded-[10px] bg-white/70 px-3 text-[13px] font-semibold text-udhaar-ink"
                  >
                    Retry OCR
                  </button>
                )}
                {rawBlob && (
                  <button
                    type="button"
                    onClick={() => void run(rawBlob, true)}
                    className="tactile flex h-9 items-center gap-1.5 rounded-[10px] bg-white px-3 text-[13px] font-semibold text-ink"
                  >
                    Contrast Boost Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={openManualEntry}
                  className="tactile flex h-9 items-center gap-1.5 rounded-[10px] bg-maal px-3 text-[13px] font-semibold text-white"
                >
                  Enter Lines Manually
                </button>
              </div>
            </div>
          )}

          <p className="text-[14px] text-ink-2 urdu-ui" dir="rtl">صاف روشنی میں پوری پرچی کی تصویر لیں۔</p>
          <PrimaryButton tone="maal" className="h-14 w-full urdu-ui" onClick={() => camRef.current?.click()}>
            <Camera size={18} strokeWidth={SW} /> پرچی کی تصویر لیں
          </PrimaryButton>
          <SecondaryButton className="flex w-full items-center justify-center gap-2 urdu-ui" onClick={() => galRef.current?.click()}>
            <FileImage size={16} strokeWidth={SW} /> گیلری سے منتخب کریں
          </SecondaryButton>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => void renderStagedParchi().then(run)}
              className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-maal/50 bg-maal-bg px-2 text-[13px] font-semibold text-maal urdu-ui"
            >
              <Wand2 size={14} strokeWidth={SW} /> نمونہ پرچی چیک کریں
            </button>
            <button
              type="button"
              onClick={openManualEntry}
              className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] border border-black/15 bg-surface px-2 text-[13px] font-semibold text-ink urdu-ui"
            >
              <Pencil size={14} strokeWidth={SW} /> خود درج کریں
            </button>
          </div>
        </div>
      )}

      {stage === "parsing" && (
        <div className="flex flex-col items-center gap-3 px-5 pb-8 pt-2">
          {img && <img src={img.originalPreviewUrl} alt="Original parchi" className="max-h-[260px] rounded-[12px] border border-black/10" />}
          <div className="flex items-center gap-2 text-[14px] text-ink-2 urdu-ui">
            <Spinner className="text-maal" />
            <span>پرچی پڑھی جا رہی ہے…</span>
            {xrayOn && <span className="font-mono text-[12px]">· 0 write tools</span>}
          </div>
        </div>
      )}

      {stage === "review" && res && (
        <div className="pb-2">
          {/* Supplier & tappable parchi photo */}
          <div className="mx-5 mb-2.5 rounded-[14px] bg-canvas p-2.5">
            <div className="flex items-center gap-2.5">
              {img && (
                <button
                  type="button"
                  onClick={() => setPhotoExpanded((v) => !v)}
                  aria-label={photoExpanded ? "Hide parchi photo" : "Zoom parchi photo"}
                  className="tactile relative h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-black/10"
                >
                  <img src={img.originalPreviewUrl} alt="Original parchi reference" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded bg-black/65 text-white">
                    <ZoomIn size={10} strokeWidth={SW} />
                  </span>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Supplier / Mandi ka naam"
                  aria-label="Supplier name"
                  className="h-9 w-full rounded-[8px] bg-surface px-2.5 text-[15px] font-semibold outline-none"
                />
                {(res.bill_date || res.legibility === "poor" || xrayOn) && (
                  <div className="mt-1 flex items-center gap-1.5 px-0.5 text-[12px] text-ink-2">
                    {res.bill_date && <span>{res.bill_date}</span>}
                    {res.legibility === "poor" && <span className="font-semibold text-amber-ink">· Handwriting dhundli hai — check karein</span>}
                    {xrayOn && <span className="font-mono">· {res.latency_ms}ms</span>}
                  </div>
                )}
              </div>
            </div>

            {photoExpanded && img && (
              <div className="mt-2.5 space-y-1.5">
                <img src={img.originalPreviewUrl} alt="Full parchi photo" className="max-h-[42dvh] w-full rounded-[10px] bg-surface object-contain" />
                <div className="flex gap-2">
                  {rawBlob && !enhanced && (
                    <button
                      type="button"
                      onClick={() => void run(rawBlob, true)}
                      className="tactile flex h-8 flex-1 items-center justify-center gap-1 rounded-[8px] bg-maal-bg text-[12.5px] font-semibold text-maal"
                    >
                      Faded parchi? Contrast Boost Re-read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPhotoExpanded(false)}
                    className="tactile flex h-8 flex-1 items-center justify-center gap-1 rounded-[8px] bg-surface text-[12.5px] font-semibold text-ink-2"
                  >
                    <ChevronUp size={14} strokeWidth={SW} /> Hide photo
                  </button>
                </div>
              </div>
            )}
          </div>

          {recentSuppliers.length > 0 && (
            <div className="no-scrollbar mx-5 mb-2.5 flex gap-1.5 overflow-x-auto">
              {recentSuppliers.map((sup) => (
                <button
                  key={sup}
                  type="button"
                  onClick={() => setSupplierName(sup)}
                  className={cx("tactile shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-semibold", supplierName === sup ? "border-ink bg-ink text-white" : "border-black/10 bg-surface text-ink-2")}
                >
                  {sup}
                </button>
              ))}
            </div>
          )}

          {duplicatePurchase && (
            <div className="mx-5 mb-2.5 flex items-center gap-2 rounded-[12px] border border-amber-ink/25 bg-amber-bg px-3 py-2 text-[12.5px] font-medium text-amber-ink">
              <AlertTriangle size={15} strokeWidth={SW} className="shrink-0" />
              <span>Duplicate check: {duplicatePurchase.supplier_name} ki {formatRs(duplicatePurchase.total_paisa)} ki parchi (#{duplicatePurchase.seq}) pehle se darj hai.</span>
            </div>
          )}

          {total >= 2_500_000 && (
            <div className="mx-5 mb-2.5 flex items-center gap-2 rounded-[12px] border border-amber-ink/25 bg-amber-bg px-3 py-2 text-[12.5px] font-medium text-amber-ink">
              <AlertTriangle size={15} strokeWidth={SW} className="shrink-0" />
              <span>Bari parchi ({formatRs(total)}) — save karne se pehle rakam zaroor check karein.</span>
            </div>
          )}

          {(() => {
            const marginAlerts = detectParchiMarginAlerts(lines, products);
            if (marginAlerts.length === 0) return null;
            return (
              <div dir="rtl" className="mx-5 mb-3 rounded-[14px] border border-udhaar/25 bg-udhaar-bg/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[13.5px] font-bold text-udhaar-ink urdu-ui">
                    <ShieldAlert size={16} strokeWidth={SW} className="shrink-0" />
                    <span>خبردار: ہول سیل ریٹ بڑھ گیا ({marginAlerts.length})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void speak(parchiMarginSpeech(marginAlerts))}
                    className="tactile inline-flex h-8 items-center gap-1 rounded-full bg-surface px-2.5 text-[12px] font-semibold text-ink urdu-ui"
                  >
                    <Volume2 size={13} strokeWidth={SW} /> سنیں
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {marginAlerts.slice(0, 4).map((a) => (
                    <div key={a.productId} className="flex items-center justify-between gap-2 rounded-[10px] bg-surface px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold text-ink urdu-ui">{a.name}</div>
                        <div className="text-[12px] text-ink-2 urdu-ui">
                          پہلے {formatRs(a.oldCostPaisa)} ← اب {formatRs(a.newCostPaisa)} (+{formatRs(a.deltaPaisa)})
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={updatingRetailId !== null}
                        onClick={async () => {
                          setUpdatingRetailId(a.productId);
                          try {
                            await api("/api/shop/product", { json: { id: a.productId, unit_price_paisa: a.suggestedRetailPaisa } });
                            await refresh();
                            toast(`${a.name} کا نیا ریٹ ${formatRs(a.suggestedRetailPaisa)} سیٹ ہو گیا`, "ok");
                            void speak(`${a.name} کا نیا ریٹ ${Math.round(a.suggestedRetailPaisa / 100)} روپے سیٹ کر دیا گیا ہے۔`);
                          } catch (e) {
                            toast(friendlyError(e), "err");
                          } finally {
                            setUpdatingRetailId(null);
                          }
                        }}
                        className="tactile h-9 shrink-0 rounded-[10px] bg-cash px-3 text-[12px] font-bold text-white urdu-ui disabled:opacity-50"
                      >
                        {updatingRetailId === a.productId ? "…" : `نیا ریٹ ${formatRs(a.suggestedRetailPaisa)}`}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Extracted & editable lines */}
          <div className="mx-5 surface-card overflow-hidden">
            {lines.length === 0 && (
              <div className="px-4 py-5 text-center text-[13.5px] text-ink-2">
                Koi item nahi — neeche “+ Add item” dabayein.
              </div>
            )}
            {lines.map((line) => {
              const isEditing = editing === line.key;
              const needsAttention = !line.reviewed || line.math_mismatch || line.line_total_paisa === null || line.qty_base_units === null;
              const hasMismatchChoices = line.computed_total_paisa !== null && line.written_total_paisa !== null && line.computed_total_paisa !== line.written_total_paisa;
              const canOneTapOk = !line.reviewed && !hasMismatchChoices && line.qty_base_units !== null && line.qty_base_units > 0 && line.line_total_paisa !== null;
              const previewComputed = isEditing ? livePreviewTotal(line) : null;
              const showPackControls = line.match_status === "new_sku" && (line.conversion_unresolved || showAdvancedUnit === line.key);

              return (
                <div key={line.key} className={cx("hairline-b px-4 py-3 last:border-b-0", needsAttention && "bg-amber-bg/50")}>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setEditing(isEditing ? null : line.key)}
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-[15.5px] font-semibold leading-5">
                        <span className="truncate">{line.name || "New item"}</span>
                        {line.match_status === "new_sku" && <Pill tone="maal" className="h-5 px-1.5 text-[11px]">New</Pill>}
                      </div>
                      <div className="num mt-0.5 text-[13px] text-ink-2">
                        {line.qty_number === null ? "Qty check karein" : `${line.qty_number} ${line.unit ?? ""}`.trim()}
                        {line.rate_paisa !== null ? ` × Rs. ${formatAmount(line.rate_paisa)}` : ""}
                        {hasMismatchChoices ? ` · Slip Rs. ${formatAmount(line.written_total_paisa ?? 0)}` : ""}
                      </div>
                      {(needsAttention || xrayOn || isEditing) && line.raw.name !== "Manual item" && (
                        <div className="mt-1 truncate text-[11.5px] text-ink-3">
                          Slip: {line.raw.name} · {line.raw.quantity ?? "?"} {line.raw.unit ?? ""} × {line.raw.rate ?? "?"} = {line.raw.line_total ?? "?"}
                        </div>
                      )}
                    </button>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {line.line_total_paisa === null ? (
                        <button
                          type="button"
                          onClick={() => setEditing(isEditing ? null : line.key)}
                          className="tactile rounded-[8px] bg-amber-ink px-2 py-1 font-mono text-[11px] font-semibold text-white"
                        >
                          CHECK
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(isEditing ? null : line.key)}
                          className="tactile text-right"
                        >
                          <Money paisa={line.line_total_paisa} className="text-[16.5px] font-bold" />
                        </button>
                      )}
                      {canOneTapOk && (
                        <button
                          type="button"
                          onClick={() => confirmLine(line)}
                          className="tactile flex h-8 items-center gap-1 rounded-[8px] bg-cash px-2.5 text-[12px] font-semibold text-white"
                        >
                          <Check size={13} strokeWidth={SW} /> OK
                        </button>
                      )}
                    </div>
                  </div>

                  {hasMismatchChoices && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => chooseAmount(line, "computed")}
                        className={cx("tactile h-10 rounded-[10px] px-3 text-[13px] font-semibold", line.choice === "computed" ? "bg-ink text-white" : "border border-black/15 bg-surface")}
                      >
                        Use {formatRs(line.computed_total_paisa!)}
                      </button>
                      <button
                        type="button"
                        onClick={() => chooseAmount(line, "written")}
                        className={cx("tactile h-10 rounded-[10px] px-3 text-[13px] font-semibold", line.choice === "written" ? "bg-ink text-white" : "border border-black/15 bg-surface")}
                      >
                        Keep {formatRs(line.written_total_paisa!)}
                      </button>
                    </div>
                  )}

                  {isEditing && (
                    <div className="mt-2.5 space-y-2 rounded-[12px] bg-canvas p-2.5">
                      {products.length > 0 && (
                        <select
                          aria-label="Link to Maal item"
                          value={line.product_id ?? ""}
                          onChange={(e) => {
                            const pid = e.target.value || null;
                            const prod = products.find((p) => p.id === pid);
                            if (prod) {
                              patchLine(line.key, {
                                product_id: prod.id,
                                match_status: "matched",
                                name: prod.name,
                                base_unit: prod.base_unit,
                                pack_size_base_units: prod.pack_size_base_units,
                                packText: String(prod.pack_size_base_units),
                                conversion_unresolved: false,
                              });
                            } else {
                              patchLine(line.key, { product_id: null, match_status: "new_sku" });
                            }
                          }}
                          className="h-10 w-full rounded-[8px] bg-surface px-2.5 text-[13.5px] font-medium text-ink outline-none"
                        >
                          <option value="">+ Create as New Maal Item</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({p.base_unit})</option>
                          ))}
                        </select>
                      )}

                      <input
                        value={line.name}
                        onChange={(event) => patchLine(line.key, { name: event.target.value })}
                        placeholder="Item ka naam"
                        aria-label="Item name"
                        className="h-10 w-full rounded-[8px] bg-surface px-2.5 text-[14.5px] font-medium text-ink outline-none"
                      />

                      <div className="grid grid-cols-3 gap-1.5">
                        <label className="text-[11px] text-ink-2">
                          Qty
                          <input
                            inputMode="decimal"
                            value={line.qtyText}
                            onChange={(event) => {
                              const qtyText = event.target.value.replace(/[^\d.]/g, "");
                              patchLine(line.key, { qtyText, qty_number: qtyText && Number.isFinite(Number(qtyText)) ? Number(qtyText) : null });
                            }}
                            className="num mt-0.5 h-10 w-full rounded-[8px] bg-surface px-2 text-[14.5px] text-ink outline-none"
                          />
                        </label>
                        <label className="text-[11px] text-ink-2">
                          Unit
                          <input
                            value={line.unitText}
                            onChange={(event) => patchLine(line.key, { unitText: event.target.value, unit: event.target.value })}
                            placeholder="kg, pcs…"
                            className="mt-0.5 h-10 w-full rounded-[8px] bg-surface px-2 text-[14.5px] text-ink outline-none"
                          />
                        </label>
                        <label className="text-[11px] text-ink-2">
                          Rate (Rs.)
                          <input
                            inputMode="decimal"
                            value={line.rateText}
                            onChange={(event) => patchLine(line.key, { rateText: event.target.value.replace(/[^\d.]/g, "") })}
                            className="num mt-0.5 h-10 w-full rounded-[8px] bg-surface px-2 text-[14.5px] text-ink outline-none"
                          />
                        </label>
                      </div>

                      <div className="flex items-end gap-1.5">
                        <label className="min-w-0 flex-1 text-[11px] text-ink-2">
                          Line total (Rs.){previewComputed !== null && !line.totalText ? ` · Auto ${formatRs(previewComputed)}` : ""}
                          <input
                            inputMode="decimal"
                            value={line.totalText}
                            placeholder={previewComputed !== null ? String(previewComputed / 100) : "Rs."}
                            onChange={(event) => patchLine(line.key, { totalText: event.target.value.replace(/[^\d.]/g, "") })}
                            className="num mt-0.5 h-10 w-full rounded-[8px] bg-surface px-2 text-[14.5px] text-ink outline-none"
                          />
                        </label>
                        {line.match_status === "new_sku" && !line.conversion_unresolved && (
                          <button
                            type="button"
                            onClick={() => setShowAdvancedUnit(showAdvancedUnit === line.key ? null : line.key)}
                            className="tactile flex h-10 shrink-0 items-center gap-1 rounded-[8px] bg-surface px-2.5 text-[12px] font-semibold text-ink-2"
                          >
                            Unit {showPackControls ? <ChevronUp size={12} strokeWidth={SW} /> : <ChevronDown size={12} strokeWidth={SW} />}
                          </button>
                        )}
                      </div>

                      {showPackControls && (
                        <div className="grid grid-cols-2 gap-1.5">
                          <label className="text-[11px] text-ink-2">
                            Stock unit
                            <select
                              value={line.base_unit}
                              onChange={(event) => patchLine(line.key, { base_unit: event.target.value as BaseUnit })}
                              className="mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[13.5px] text-ink outline-none"
                            >
                              <option value="g">grams (g)</option>
                              <option value="ml">millilitres (ml)</option>
                              <option value="pcs">pieces (pcs)</option>
                            </select>
                          </label>
                          <label className="text-[11px] text-ink-2">
                            Units per pack
                            <input
                              inputMode="numeric"
                              value={line.packText}
                              onChange={(event) => patchLine(line.key, { packText: event.target.value.replace(/[^\d]/g, "") })}
                              placeholder={line.conversion_unresolved ? "required" : String(line.pack_size_base_units)}
                              className="num mt-0.5 h-9 w-full rounded-[8px] bg-surface px-2 text-[13.5px] text-ink outline-none"
                            />
                          </label>
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          aria-label="Remove line"
                          onClick={() => {
                            setLines((prev) => prev.filter((x) => x.key !== line.key));
                            setEditing(null);
                          }}
                          className="tactile grid h-10 w-10 place-items-center rounded-[10px] bg-udhaar-bg text-udhaar-ink"
                        >
                          <Trash2 size={15} strokeWidth={SW} />
                        </button>
                        <PrimaryButton tone="maal" className="ml-auto h-10 px-5 text-[14.5px]" onClick={() => saveEditedLine(line)}>
                          Save line
                        </PrimaryButton>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mx-5 mt-2.5 flex items-center gap-2">
            <button type="button" onClick={addBlankLine} className="tactile flex h-9 items-center gap-1 rounded-full border border-black/15 bg-surface px-3.5 text-[13px] font-semibold">
              <Plus size={14} strokeWidth={SW} /> Add item
            </button>
            <button type="button" disabled={addingPage} onClick={() => pageRef.current?.click()} className="tactile flex h-9 items-center gap-1 rounded-full border border-maal/30 bg-maal-bg px-3.5 text-[13px] font-semibold text-maal disabled:opacity-50">
              {addingPage ? <Spinner className="h-3.5 w-3.5" /> : <Camera size={14} strokeWidth={SW} />} + Add Page
            </button>
          </div>

          {/* Grand total check — compact when matched, clear action when mismatched */}
          {!grandTotalMismatch && totalSafe && !editingTotal ? (
            <div className="mx-5 mt-3 flex items-center justify-between rounded-[12px] bg-cash-bg px-3.5 py-2 text-[13px] font-semibold text-cash-ink">
              <span className="flex items-center gap-1.5">
                <Check size={14} strokeWidth={SW} /> Slip total {formatRs(total)} matches
              </span>
              <button type="button" onClick={() => setEditingTotal(true)} className="text-[12px] underline underline-offset-2">
                Edit
              </button>
            </div>
          ) : (
            <div className="mx-5 mt-3 space-y-2 rounded-[12px] bg-amber-bg/70 p-3">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="font-medium text-amber-ink">
                  {statedTotalPaisa === null ? "Slip ka kul total likhein ya line sum confirm karein" : `Slip ${formatRs(statedTotalPaisa)} ≠ Lines ${formatRs(total)}`}
                </span>
                {grandTotalMismatch && (
                  <button
                    type="button"
                    onClick={() => setGrandTotalAcknowledged(true)}
                    className={cx("tactile shrink-0 rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold", grandTotalAcknowledged ? "bg-ink text-white" : "bg-surface text-ink border border-black/15")}
                  >
                    {grandTotalAcknowledged ? "Total confirmed ✓" : "Confirm total"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <span>Slip total (Rs.)</span>
                <input
                  inputMode="decimal"
                  value={statedTotalText}
                  onChange={(event) => {
                    const text = event.target.value.replace(/[^\d.,]/g, "");
                    setStatedTotalText(text);
                    setStatedTotalPaisa(toAmount(text));
                    setGrandTotalAcknowledged(false);
                  }}
                  className="num h-9 w-28 rounded-[8px] bg-surface px-2.5 text-[14px] text-ink outline-none"
                  placeholder="optional"
                />
                {editingTotal && !grandTotalMismatch && (
                  <button type="button" onClick={() => setEditingTotal(false)} className="ml-auto text-[12px] font-semibold text-ink">
                    Done
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 1-tap Cash / Baqi settlement */}
          <div className="mx-5 mt-3 rounded-[12px] bg-canvas p-3" dir="rtl">
            <div className="flex items-center justify-between text-[13px] urdu-ui">
              <span className="font-semibold text-ink">ابھی نقد ادائیگی</span>
              <span className="num font-semibold text-udhaar">
                {xrayOn ? "A/P" : "باقی"} {formatRs(Math.max(0, total - (cashPaidPaisa ?? 0)))}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={total <= 0}
                onClick={() => setCash(String(total / 100))}
                className={cx(
                  "tactile h-10 shrink-0 rounded-[10px] border px-3 text-[13px] font-semibold urdu-ui disabled:opacity-40",
                  cashPaidPaisa !== null && total > 0 && cashPaidPaisa >= total ? "border-ink bg-ink text-white" : "border-black/15 bg-surface text-ink",
                )}
              >
                پوری نقد
              </button>
              <button
                type="button"
                disabled={total <= 0}
                onClick={() => setCash("0")}
                className={cx(
                  "tactile h-10 shrink-0 rounded-[10px] border px-3 text-[13px] font-semibold urdu-ui disabled:opacity-40",
                  cashPaidPaisa === 0 && cash.trim() !== "" ? "border-ink bg-ink text-white" : "border-black/15 bg-surface text-ink",
                )}
              >
                ادھار (0)
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-[10px] bg-surface px-2.5">
                <span className="text-[12.5px] text-ink-2">روپے</span>
                <input
                  inputMode="decimal"
                  aria-label="نقد ادائیگی"
                  value={cash}
                  onChange={(event) => setCash(event.target.value.replace(/[^\d.,]/g, ""))}
                  placeholder="رقم"
                  className="num h-10 w-full bg-transparent text-[15px] font-semibold outline-none"
                />
              </div>
            </div>
          </div>

          <div className="hairline-t mt-3 flex items-baseline justify-between px-5 pt-3">
            <span className="text-[14px] text-ink-2 urdu-ui">کل بل ({lines.length} اشیاء{newCount ? ` · ${newCount} نیا` : ""})</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void speak(`${supplierName} کی پرچی میں ${lines.length} اشیاء ہیں، کل بل ${Math.round(total / 100)} روپے ہے۔`)}
                className="tactile inline-flex h-8 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold text-ink urdu-ui"
              >
                <Volume2 size={13} strokeWidth={SW} /> سنیں
              </button>
              <Money paisa={total} className="text-[22px] font-bold" />
            </div>
          </div>
          <div className="flex gap-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
            <SecondaryButton onClick={onClose} className="w-[92px] urdu-ui">منسوخ</SecondaryButton>
            <PrimaryButton
              tone="maal"
              busy={busy}
              disabled={!lines.length || hasUnreviewedLine || grandTotalNeedsConfirmation || !totalSafe || total <= 0 || cashPaidPaisa === null}
              onClick={commit}
              className="flex-1 urdu-ui"
            >
              گودام میں درج کریں
            </PrimaryButton>
          </div>
        </div>
      )}

      {stage === "done" && done && (
        <div className="space-y-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="surface-card p-4" dir="rtl">
            <div className="text-[15px] font-semibold">{supplierName || res?.supplier_name}</div>
            <Money paisa={done.totals.total_paisa ?? 0} className="mt-1 block text-[26px] font-bold" />
            <div className="mt-1 text-[13px] font-medium text-cash-ink urdu-ui">گودام اور کھاتہ اپ ڈیٹ ہو گیا ✓</div>
            {xrayOn && (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill tone="cash" mono>Δ = 0 ✓</Pill>
                  <Pill mono>#{done.seq} {done.entry_hash.slice(0, 10)}…</Pill>
                  {done.math_check && <Pill tone={done.math_check.passed ? "cash" : "amber"} mono>{done.math_check.passed ? "MATH OK" : "MATH_MISMATCH reviewed"}</Pill>}
                </div>
                <div className="mt-3 rounded-[10px] bg-canvas p-2.5 font-mono text-[11.5px]">
                  {done.journal.map((entry, index) => (
                    <div key={index} className="flex justify-between">
                      <span>{entry.side} {entry.account_code} {entry.account_name}</span>
                      <span>{formatJournal(entry.amount_paisa)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <PriceMemoryCard />
          <div className="flex gap-3">
            {xrayOn && <SecondaryButton className="flex-1" onClick={() => openSheet({ type: "xray", txId: done.transaction_id })}>{"</>"} X-Ray</SecondaryButton>}
            <PrimaryButton className="flex-1 urdu-ui" onClick={onClose}>مکمل</PrimaryButton>
          </div>
        </div>
      )}
    </Sheet>
  );
}

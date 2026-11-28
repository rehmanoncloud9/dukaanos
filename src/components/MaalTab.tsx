"use client";

import { AlertCircle, Box, Camera, Droplets, Home, MessageSquare, Milk, Search, ShieldCheck, Volume2, Wheat } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommitResponse, StateProduct } from "@/lib/api/contracts";
import { api, friendlyError, newKey } from "@/lib/client/api";
import { tr } from "@/lib/client/i18n";
import { inferProductCategory, type ProductCategory } from "@/lib/client/local-db";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { computeReorderForecast, formatReorderLine } from "@/lib/domain/forecast";
import { analyzeMargins } from "@/lib/domain/margin-shield";
import { waLink } from "@/lib/domain/messages";
import { formatAmount, formatRs, rupeesToPaisa } from "@/lib/domain/money";
import { normalizeText } from "@/lib/domain/pakphone";
import { startContinuousScan, isBarcodeDetectorSupported } from "@/lib/client/barcode";
import { VirtualList } from "./VirtualList";
import { cx, Pill, PrimaryButton, Segmented, Sheet, shortDate, SW } from "./ui";

const CATEGORY_META: Record<ProductCategory, { label: string; bg: string; fg: string; Icon: typeof Wheat }> = {
  grains: { label: "دالیں / اناج", bg: "bg-amber-bg", fg: "text-amber-ink", Icon: Wheat },
  liquids: { label: "تیل / مشروبات", bg: "bg-maal-bg", fg: "text-maal", Icon: Droplets },
  dairy: { label: "ڈیری / بیکری", bg: "bg-cash-bg", fg: "text-cash-ink", Icon: Milk },
  cosmetics: { label: "کاسمیٹکس", bg: "bg-udhaar-bg", fg: "text-udhaar-ink", Icon: ShieldCheck },
  household: { label: "گھریلو سامان", bg: "bg-surface-sunken", fg: "text-ink-2", Icon: Home },
  packaged: { label: "پیکٹ سامان", bg: "bg-surface-sunken", fg: "text-ink", Icon: Box },
};

const EMPTY_PRODUCTS: StateProduct[] = [];

/** "4.2 / 25 kg", "2 / 12 tin", "24 / 12 pcs" */
export function stockLabel(p: Pick<StateProduct, "stock_base_units" | "reorder_level_base_units" | "base_unit" | "pack_size_base_units">): string {
  const s = p.stock_base_units;
  const r = p.reorder_level_base_units ?? 0;
  if (p.base_unit !== "pcs" && p.pack_size_base_units > 1000) {
    const f = (v: number) => (v / p.pack_size_base_units).toFixed(Number.isInteger(v / p.pack_size_base_units) ? 0 : 1);
    return `${f(s)} / ${f(r)} پیٹی`;
  }
  if (p.base_unit === "pcs") return `${s} / ${r} عدد`;
  const big = p.base_unit === "g" ? "کلو" : "لیٹر";
  const f = (v: number) => (v / 1000).toFixed(Math.abs(v) % 1000 === 0 ? 0 : 1);
  return `${f(s)} / ${f(r)} ${big}`;
}

export function isLow(p: StateProduct) {
  return p.stock_base_units <= 0 || (p.reorder_level_base_units ?? 0) > 0 && p.stock_base_units <= (p.reorder_level_base_units ?? 0) * 0.25 || (p.days_left !== null && p.days_left <= 2.5);
}

export function MaalTab() {
  const { state, openSheet, refresh, lang, toast, xrayOn } = useDukaan();
  const [filter, setFilter] = useState<"all" | "low" | "untracked">("all");
  const [catFilter, setCatFilter] = useState<ProductCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [newSku, setNewSku] = useState<string | null>(null);
  const scannerRef = useRef<ReturnType<typeof startContinuousScan> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const products = state?.products ?? EMPTY_PRODUCTS;
  const searchIndex = useMemo(
    () => new Map(products.map((p) => [p.id, {
      search: normalizeText([p.name, p.name_ur ?? "", ...(p.aliases ?? [])].join(" ")),
      sort: normalizeText(p.name_ur || p.name),
    }])),
    [products],
  );

  const negative = useMemo(() => products.filter((p) => p.stock_base_units < 0), [products]);
  const marginAlerts = useMemo(() => analyzeMargins(products), [products]);
  const sorted = useMemo(
    () => products.slice().sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || (searchIndex.get(a.id)?.sort ?? "").localeCompare(searchIndex.get(b.id)?.sort ?? "")),
    [products, searchIndex],
  );
  const filtered = useMemo(() => {
    const base = filter === "low" ? sorted.filter(isLow) : filter === "untracked" ? sorted.filter((p) => p.is_quick_added) : sorted;
    if (catFilter === "all") return base;
    return base.filter((p) => inferProductCategory(p.name, [p.name_ur ?? "", ...(p.aliases ?? [])]) === catFilter);
  }, [filter, sorted, catFilter]);
  const q = normalizeText(query);
  const list = useMemo(
    () => {
      const queryTerms = q.split(" ").filter(Boolean);
      return queryTerms.length ? filtered.filter((p) => {
        const text = searchIndex.get(p.id)?.search ?? "";
        return queryTerms.every((term) => text.includes(term));
      }) : filtered;
    },
    [q, filtered, searchIndex],
  );
  const forecast = filter === "low" && state ? computeReorderForecast(products, state.today.cash_in_galla_paisa, 3, 6) : null;

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ tab: string; filter: string }>).detail;
      if (d.tab === "maal") setFilter(d.filter === "low" ? "low" : d.filter === "untracked" ? "untracked" : "all");
    };
    window.addEventListener("dukaan:filter", h);
    return () => window.removeEventListener("dukaan:filter", h);
  }, []);

  const startScan = useCallback(async () => {
    if (!isBarcodeDetectorSupported()) {
      // Fallback: open search with camera icon hint
      toast("اس ڈیوائس پر بارکوڈ اسکین نہیں ہو سکتا — سامان تلاش کریں", "warn");
      return;
    }
    if (!state) return;
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (!videoRef.current) { stream.getTracks().forEach((t) => t.stop()); setScanning(false); return; }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const stop = startContinuousScan(videoRef.current, state.products, (result) => {
        stream.getTracks().forEach((t) => t.stop());
        stop();
        scannerRef.current = null;
        setScanning(false);
        // Look up barcode in catalog (startContinuousScan already matched via aliases)
        if (result.product) {
          openSheet({ type: "product", productId: result.product.id });
        } else {
          setNewSku(result.barcode);
          toast(`نیا بارکوڈ ${result.barcode} — سامان کا نام درج کریں`, "info");
        }
      });
      scannerRef.current = stop;
      // Auto-stop after 15 s
      setTimeout(() => {
        scannerRef.current?.();
        scannerRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        setScanning(false);
      }, 15_000);
    } catch (e) {
      toast("اسکین مکمل نہیں ہوا — دوبارہ کوشش کریں", "err");
      setScanning(false);
    }
  }, [state, openSheet, toast]);

  if (!state) return <div className="surface-card h-[400px] animate-pulse" />;

  return (
    <div className="space-y-3 pb-24">
      {negative.map((p) => (
        <div key={p.id} className="flex items-center gap-2.5 rounded-[14px] bg-udhaar-bg px-3.5 py-2.5">
          <AlertCircle size={16} strokeWidth={1.75} className="shrink-0 text-udhaar-ink" />
          <span className="flex-1 text-[13.5px] font-medium text-udhaar-ink" dir="auto">
            {p.name_ur || p.name} ({formatBaseQty(p.stock_base_units, p.base_unit)})
          </span>
          <button onClick={() => openSheet({ type: "product", productId: p.id })} className="tactile h-8 rounded-full bg-surface px-3 text-[13px] font-semibold text-udhaar-ink">
            {tr("fix", lang)}
          </button>
        </div>
      ))}
      {state.products.some((p) => p.is_quick_added) && filter !== "untracked" && (
        <button
          type="button"
          onClick={() => setFilter("untracked")}
          className="tactile flex w-full items-center justify-between rounded-[14px] bg-amber-bg px-3.5 py-2.5 text-right text-[13.5px] font-semibold text-amber-ink urdu-ui"
          dir="rtl"
        >
          <span>{state.products.filter((p) => p.is_quick_added).length} اشیاء کی مقدار ابھی گنی نہیں گئی</span>
          <span>دیکھیں ←</span>
        </button>
      )}
      {marginAlerts.length > 0 && (
        <button
          type="button"
          onClick={() => openSheet({ type: "margin" })}
          className="tactile flex w-full items-center justify-between rounded-[14px] bg-amber-bg px-3.5 py-2.5 text-left text-[13px] font-semibold text-amber-ink"
        >
          <span dir="auto">
            {lang === "ur"
              ? `${marginAlerts.length} اشیاء پر منافع کم یا نقصان میں ہے`
              : `${marginAlerts.length} items at low margin or loss`}
          </span>
          <span>{tr("marginShield", lang)} →</span>
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<"all" | "low" | "untracked">
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `${tr("all", lang)} (${state.products.length})` },
            { value: "low", label: `${tr("lowStock", lang)} (${sorted.filter(isLow).length})` },
            { value: "untracked", label: `گنتی باقی (${state.products.filter((p) => p.is_quick_added).length})` },
          ]}
        />
        {isBarcodeDetectorSupported() && (
          <button
            onClick={() => void startScan()}
            aria-label={tr("scan", lang)}
            className={cx("tactile flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border border-black/15 px-3 text-[13px] font-semibold", scanning ? "bg-maal text-white" : "bg-surface")}
          >
            <Camera size={15} strokeWidth={1.75} /> {scanning ? tr("scanning", lang) : tr("scan", lang)}
          </button>
        )}
        <button
          type="button"
          onClick={() => setNewSku("")}
          className="tactile flex h-10 shrink-0 items-center rounded-[12px] bg-ink px-3 text-[13px] font-semibold text-white"
        >
          {tr("add", lang)}
        </button>
      </div>
      {/* Hidden video for barcode camera feed */}
      {scanning && <video ref={videoRef} muted playsInline className="w-full rounded-[12px] bg-black aspect-video object-cover" />}
      <div className="relative">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("searchProducts", lang)}
          aria-label="سامان تلاش کریں"
          dir="auto"
          className="h-11 w-full rounded-[12px] border border-black/10 bg-surface pl-10 pr-3 text-[15px] outline-none focus:border-ink"
        />
      </div>
      {forecast && forecast.items.length > 0 && (
        <div className="surface-card p-3.5">
          <div className="flex items-center justify-between">
            <span className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">{tr("reorderList", lang)}</span>
            <span className="num text-[12.5px] font-semibold text-maal">اندازاً {formatRs(forecast.total_reorder_cost_paisa)}</span>
          </div>
          <div className="mt-1.5 space-y-1 text-[12.5px] text-ink-2">
            {forecast.items.slice(0, 3).map((item) => (
              <div key={item.product_id} className="truncate">{formatReorderLine(item)}</div>
            ))}
          </div>
          <a
            href={waLink(null, [`${state.shop.name} — Reorder list:`, ...forecast.items.map((it, idx) => `${idx + 1}. ${formatReorderLine(it)}`)].join("\n"))}
            target="_blank"
            rel="noreferrer"
            className="tactile mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-maal text-[13.5px] font-semibold text-white"
          >
            <MessageSquare size={14} strokeWidth={SW} /> ہول سیل آرڈر واٹس ایپ کریں
          </a>
        </div>
      )}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5" dir="rtl">
        <button
          type="button"
          onClick={() => setCatFilter("all")}
          className={cx("tactile h-9 shrink-0 rounded-full px-3 text-[12.5px] font-semibold urdu-ui", catFilter === "all" ? "bg-ink text-white" : "bg-surface text-ink-2 border border-black/10")}
        >
          تمام ({state.products.length})
        </button>
        {(Object.keys(CATEGORY_META) as ProductCategory[]).map((cat) => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.Icon;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCatFilter(cat)}
              className={cx("tactile flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold urdu-ui", catFilter === cat ? "bg-ink text-white" : "bg-surface text-ink-2 border border-black/10")}
            >
              <Icon size={13} strokeWidth={SW} />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      <div className="surface-card overflow-hidden">
        {list.length === 0 && <div className="px-4 py-6 text-center text-[14px] text-ink-2 urdu-ui">گودام میں کوئی سامان نہیں ملا</div>}
        <VirtualList
          items={list}
          itemHeight={78}
          maxHeightClass="max-h-[56dvh]"
          getKey={(p) => p.id}
          renderItem={(p) => {
            const low = isLow(p);
            const pct = Math.max(0, Math.min(1, (p.reorder_level_base_units ?? 0) > 0 ? p.stock_base_units / (p.reorder_level_base_units as number) : 1));
            const cat = inferProductCategory(p.name, [p.name_ur ?? "", ...(p.aliases ?? [])]);
            const meta = CATEGORY_META[cat];
            const CatIcon = meta.Icon;
            return (
              <div className="hairline-b flex h-[78px] items-center gap-2.5 px-4 last:border-b-0">
                <button
                  type="button"
                  onClick={() => openSheet({ type: "product", productId: p.id })}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-[12px]", meta.bg, meta.fg)} aria-hidden="true">
                    <CatIcon size={18} strokeWidth={SW} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[15.5px] font-semibold truncate">
                      <span className="truncate">{p.name_ur || p.name}</span>
                      {p.is_quick_added && <Pill tone="amber" className="h-5 px-1.5 text-[10.5px]">اس چیز کا مال ابھی درج نہیں ہے</Pill>}
                    </div>
                    <div className="text-[12.5px] text-ink-2 num">
                      {xrayOn ? `خرید ${formatAmount(p.cost_price_paisa)} · ` : ""}قیمت {formatAmount(p.unit_price_paisa)} روپے
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-surface-sunken">
                      <div className={cx("h-1 rounded-full", pct <= 0.25 ? "bg-udhaar" : "bg-maal")} style={{ width: `${Math.max(2, pct * 100)}%` }} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cx("num text-[14.5px] font-bold", low ? "text-udhaar" : "text-ink")}>{stockLabel(p)}</div>
                    {(p.stock_base_units < 0 || low) && (
                      <div className="text-[11.5px] font-semibold text-udhaar urdu-ui" dir="auto">
                        {p.stock_base_units < 0 ? tr("negative", lang) : tr("lowStock", lang)}
                      </div>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="قیمت سنیں"
                  onClick={() => void speak(`${p.name_ur || p.name}، قیمت ${Math.round(p.unit_price_paisa / 100)} روپے، اسٹاک ${stockLabel(p)}۔`)}
                  className="audio-btn tactile shrink-0 urdu-ui"
                >
                  <Volume2 size={14} strokeWidth={SW} />
                  <span>سنیں</span>
                </button>
              </div>
            );
          }}
        />
      </div>
      {newSku !== null && <NewProductSheet initialSku={newSku} onClose={() => setNewSku(null)} onSaved={() => { setNewSku(null); void refresh(); }} />}
    </div>
  );
}

function NewProductSheet({ initialSku, onClose, onSaved }: { initialSku: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useDukaan();
  const [name, setName] = useState("");
  const [sku, setSku] = useState(initialSku);
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [opening, setOpening] = useState("");
  const [reorder, setReorder] = useState("");
  const [unit, setUnit] = useState<"pcs" | "g" | "ml">("pcs");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const mult = unit === "pcs" ? 1 : 1000;
    try {
      await api("/api/shop/product", {
        json: {
          name: name.trim(),
          sku_code: sku.trim() || undefined,
          base_unit: unit,
          pack_size_base_units: mult,
          unit_price_paisa: rupeesToPaisa(Number(price || 0)),
          ...(cost.trim() ? { cost_price_paisa: rupeesToPaisa(Number(cost)) } : {}),
          ...(opening.trim() ? { opening_stock_base_units: Math.max(0, Math.round(Number(opening) * mult)) } : {}),
          ...(reorder.trim() ? { reorder_level_base_units: Math.max(0, Math.round(Number(reorder) * mult)) } : {}),
        },
      });
      toast(`${name.trim()} گودام میں شامل ہو گیا`, "ok");
      onSaved();
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="نیا سامان شامل کریں">
      <div className="space-y-2.5 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="سامان کا نام" className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="بارکوڈ (اختیاری)" className="num h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
        <div className="flex flex-wrap items-center gap-2">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="فروخت کی قیمت (روپے)" className="num h-12 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} placeholder="خرید قیمت" className="num h-12 w-28 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
          <select value={unit} onChange={(e) => setUnit(e.target.value as "pcs" | "g" | "ml")} className="h-12 rounded-[12px] bg-canvas px-3 text-[15px] outline-none">
            <option value="pcs">فی عدد</option>
            <option value="g">فی کلو</option>
            <option value="ml">فی لیٹر</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))} placeholder={`موجود مقدار (${unit === "pcs" ? "عدد" : unit === "g" ? "کلو" : "لیٹر"})`} className="num h-11 rounded-[12px] bg-canvas px-3 text-[14px] outline-none" />
          <input inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^\d.]/g, ""))} placeholder={`کم مقدار کی خبر (${unit === "pcs" ? "عدد" : unit === "g" ? "کلو" : "لیٹر"})`} className="num h-11 rounded-[12px] bg-canvas px-3 text-[14px] outline-none" />
        </div>
        <PrimaryButton className="w-full" busy={busy} disabled={!name.trim() || Number(price) <= 0} onClick={() => void save()}>
          گودام میں محفوظ کریں
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

export function ProductSheet({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { state, refresh, toast, openSheet, xrayOn, helperMode, commitPurchase } = useDukaan();
  const p = state?.products.find((x) => x.id === productId);
  const [price, setPrice] = useState(p ? String(p.unit_price_paisa / 100) : "");
  const [alias, setAlias] = useState("");
  const [restockQty, setRestockQty] = useState("");
  const [restockByPack, setRestockByPack] = useState(Boolean(p && p.pack_size_base_units > 1 && p.pack_size_base_units !== 1000));
  const [restockCost, setRestockCost] = useState("");
  const [restockSupplier, setRestockSupplier] = useState("");
  const [restockPaid, setRestockPaid] = useState<"cash" | "credit">("cash");
  const [restockBusy, setRestockBusy] = useState(false);
  const [reorderInput, setReorderInput] = useState(
    p && p.reorder_level_base_units
      ? String(p.base_unit === "pcs" ? p.reorder_level_base_units : p.reorder_level_base_units / 1000)
      : "",
  );
  const [reorderBusy, setReorderBusy] = useState(false);
  const [adjQty, setAdjQty] = useState("");
  const [adjDir, setAdjDir] = useState<-1 | 1>(-1);
  const [adjReason, setAdjReason] = useState<"wastage" | "spoilage" | "personal_use" | "stock_count">("wastage");
  const [adjBusy, setAdjBusy] = useState(false);

  const supplierHistory = useMemo(() => {
    if (!state || !p) return [];
    return state.feed
      .filter((t) => t.type === "purchase" && !t.is_reversed && t.lines.some((l) => l.product_id === p.id))
      .slice(0, 4)
      .map((t) => {
        const line = t.lines.find((l) => l.product_id === p.id)!;
        return { id: t.id, supplier: t.supplier_name ?? "Wholesale", date: t.created_at, qty: line.qty_base_units, total: line.line_total_paisa };
      });
  }, [state, p]);

  if (!p) return null;
  const unitLabel = p.base_unit === "pcs" ? "عدد" : p.base_unit === "g" ? "کلو" : "لیٹر";
  const hasPackUnit = p.pack_size_base_units > 1 && !(p.base_unit !== "pcs" && p.pack_size_base_units === 1000);
  const packLabel = p.base_unit === "ml" && p.pack_size_base_units >= 4000 ? "ڈبہ" : "پیک";
  const per = p.base_unit === "pcs" ? (p.pack_size_base_units === 1 ? "عدد" : `${p.pack_size_base_units} عدد`) : p.pack_size_base_units === 1000 ? (p.base_unit === "g" ? "کلو" : "لیٹر") : formatBaseQty(p.pack_size_base_units, p.base_unit);
  const parsedRestockQty = Number(restockQty);
  const restockMult = restockByPack && hasPackUnit ? p.pack_size_base_units : (p.base_unit === "pcs" ? 1 : 1000);
  const restockBaseUnits = Number.isFinite(parsedRestockQty) && parsedRestockQty > 0
    ? Math.round(parsedRestockQty * restockMult)
    : 0;
  const suggestedRestockPaisa = !helperMode && p.cost_price_paisa > 0 && restockBaseUnits > 0
    ? Math.round((restockBaseUnits * p.cost_price_paisa) / p.pack_size_base_units)
    : 0;
  const parsedRestockCost = Number(restockCost);
  const restockTotalPaisa = restockCost.trim()
    ? (Number.isFinite(parsedRestockCost) && parsedRestockCost >= 0 ? rupeesToPaisa(parsedRestockCost) : 0)
    : suggestedRestockPaisa;
  const parsedAdjQty = Number(adjQty);
  const adjBaseUnits = Number.isFinite(parsedAdjQty) && parsedAdjQty > 0
    ? Math.round(parsedAdjQty * (p.base_unit === "pcs" ? 1 : 1000))
    : 0;

  const submitManualRestock = async () => {
    if (restockBaseUnits <= 0) return;
    setRestockBusy(true);
    try {
      const cashPaid = restockPaid === "cash" ? restockTotalPaisa : 0;
      const basePayload = {
        idempotency_key: newKey("pur"),
        supplier_name: restockSupplier.trim() || "Wholesale",
        cash_paid_paisa: cashPaid,
        stated_total_paisa: restockTotalPaisa,
        lines: [
          {
            product_id: p.id,
            qty_base_units: restockBaseUnits,
            line_total_paisa: restockTotalPaisa,
            spoken: `${restockQty} ${unitLabel} ${p.name}`,
          },
        ],
      };
      await commitPurchase({
        ...basePayload,
        audit_meta: { channel: "manual-restock", replay_payload: basePayload },
      });
      setRestockQty("");
      setRestockCost("");
      await refresh();
      toast(`${p.name_ur || p.name} کا نیا مال گودام میں درج ہو گیا ✓`, "ok");
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setRestockBusy(false);
    }
  };

  const submitAdj = async () => {
    if (adjBaseUnits <= 0) return;
    setAdjBusy(true);
    try {
      await api<CommitResponse>("/api/transactions/adjust", {
        json: {
          idempotency_key: newKey("adj"),
          product_id: p.id,
          delta_base_units: adjDir * adjBaseUnits,
          reason: adjReason,
          audit_meta: { channel: "product-adjust" },
        },
      });
      setAdjQty("");
      await refresh();
      toast("گودام کا حساب درست ہو گیا ✓", "ok");
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setAdjBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={p.name}>
      <div className="space-y-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Stock", formatBaseQty(p.stock_base_units, p.base_unit)],
            ["Sold 7d", formatBaseQty(p.sold_7d, p.base_unit)],
            ["Days left", p.days_left === null ? "—" : `${p.days_left}d`],
          ].map(([k, v]) => (
            <div key={k} className="surface-card p-3">
              <div className="section-label">{k === "Stock" ? "گودام" : k === "Sold 7d" ? "سات دن کی فروخت" : "باقی دن"}</div>
              <div className="num mt-1 text-[17px] font-bold">{v}</div>
            </div>
          ))}
        </div>
        <div className="rounded-[12px] bg-canvas px-3 py-2 text-[12px] text-ink-2">
          مقدار کا حساب: {" "}
          {p.base_unit === "g"
            ? "1 کلو = 1,000 گرام · 1 پاؤ = 250 گرام · آدھا پاؤ = 125 گرام"
            : p.base_unit === "ml"
              ? "1 لیٹر = 1,000 ملی لیٹر · 1 پاؤ = 250 ملی لیٹر"
              : "1 درجن = 12 عدد"}
        </div>
        <div className="section-label pt-1">فروخت کی قیمت، فی {per}</div>
        <div className="flex flex-wrap items-center gap-2">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className="num h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
          <button
            onClick={async () => {
              try {
                await api("/api/shop/price", { json: { product_id: p.id, unit_price_paisa: rupeesToPaisa(Number(price)) } });
                await refresh();
                toast("قیمت محفوظ ہو گئی", "ok");
              } catch (e) {
                toast(friendlyError(e), "err");
              }
            }}
            className="tactile h-11 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white"
          >
            محفوظ کریں
          </button>
        </div>

        <div className="section-label pt-1">سامان کی آمد درج کریں</div>
        <div className="surface-card space-y-2 p-3">
          {hasPackUnit && (
            <div className="flex gap-1.5 text-[12px]">
              <button type="button" onClick={() => setRestockByPack(true)} className={cx("tactile rounded-full px-2.5 py-1 font-semibold", restockByPack ? "bg-ink text-white" : "bg-canvas text-ink-2")}>
                {packLabel} ({per})
              </button>
              <button type="button" onClick={() => setRestockByPack(false)} className={cx("tactile rounded-full px-2.5 py-1 font-semibold", !restockByPack ? "bg-ink text-white" : "bg-canvas text-ink-2")}>
                {unitLabel}
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              inputMode="decimal"
              value={restockQty}
              onChange={(e) => setRestockQty(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={`آئی ہوئی مقدار (${restockByPack && hasPackUnit ? packLabel : unitLabel})`}
              className="num h-10 rounded-[10px] bg-canvas px-3 text-[14px] outline-none"
            />
            <input
              inputMode="decimal"
              value={restockCost}
              onChange={(e) => setRestockCost(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={suggestedRestockPaisa > 0 ? `اندازاً خرید قیمت ${formatRs(suggestedRestockPaisa)}` : "کل خرید قیمت"}
              className="num h-10 rounded-[10px] bg-canvas px-3 text-[14px] outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={restockSupplier}
              onChange={(e) => setRestockSupplier(e.target.value)}
              placeholder="سپلائر کا نام (اختیاری)"
              className="h-10 min-w-0 flex-1 rounded-[10px] bg-canvas px-3 text-[13.5px] outline-none"
            />
            <select
              value={restockPaid}
              onChange={(e) => setRestockPaid(e.target.value as "cash" | "credit")}
              className="h-10 rounded-[10px] bg-canvas px-2 text-[13px] font-semibold outline-none"
            >
              <option value="cash">نقد ادائیگی</option>
              <option value="credit">ہول سیل ادھار</option>
            </select>
            <button
              type="button"
              disabled={restockBusy || restockBaseUnits <= 0}
              onClick={() => void submitManualRestock()}
              className="tactile h-10 shrink-0 rounded-[10px] bg-maal px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {restockBusy ? "محفوظ ہو رہا ہے…" : "گودام میں درج کریں"}
            </button>
          </div>
        </div>

        <div className="section-label pt-1">موجود مقدار درست کریں</div>
        <div className="surface-card space-y-2 p-3">
          <div className="grid grid-cols-2 gap-1.5">
            <select value={adjDir} onChange={(e) => setAdjDir(Number(e.target.value) as -1 | 1)} className="h-10 rounded-[10px] bg-canvas px-2 text-[13px] font-semibold outline-none">
              <option value={-1}>مقدار گھٹائیں (−)</option>
              <option value={1}>مقدار بڑھائیں (+)</option>
            </select>
            <select value={adjReason} onChange={(e) => setAdjReason(e.target.value as typeof adjReason)} className="h-10 rounded-[10px] bg-canvas px-2 text-[13px] outline-none">
              <option value="wastage">ضائع / خراب</option>
              <option value="spoilage">میعاد ختم</option>
              <option value="personal_use">گھر میں استعمال</option>
              <option value="stock_count">گنتی کی درستگی</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="decimal"
              value={adjQty}
              onChange={(e) => setAdjQty(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={`مقدار (${unitLabel})`}
              className="num h-10 min-w-0 flex-1 rounded-[10px] bg-canvas px-3 text-[14px] outline-none"
            />
            <button
              type="button"
              disabled={adjBusy || adjBaseUnits <= 0}
              onClick={() => void submitAdj()}
              className="tactile h-10 rounded-[10px] bg-udhaar px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {adjBusy ? "محفوظ ہو رہا ہے…" : "درج کریں"}
            </button>
          </div>
        </div>

        {!helperMode && (
          <>
            <div className="section-label pt-1">کم مقدار کی وارننگ</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                inputMode="decimal"
                value={reorderInput}
                onChange={(e) => setReorderInput(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder={`اس مقدار سے کم ہو تو خبر دیں (${unitLabel})`}
                className="num h-10 min-w-0 flex-1 rounded-[10px] bg-canvas px-3 text-[14px] outline-none"
              />
              {p.sold_7d > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const threeDayBase = Math.max(1, Math.round((p.sold_7d / 7) * 3));
                    setReorderInput(String(p.base_unit === "pcs" ? threeDayBase : Math.round((threeDayBase / 1000) * 10) / 10));
                  }}
                  className="tactile h-10 rounded-[10px] bg-maal-bg px-2.5 text-[12px] font-semibold text-maal"
                >
                  تین دن کی خودکار مقدار
                </button>
              )}
              <button
                type="button"
                disabled={reorderBusy}
                onClick={async () => {
                  const n = Number(reorderInput || 0);
                  const baseVal = Math.max(0, Math.round(n * (p.base_unit === "pcs" ? 1 : 1000)));
                  setReorderBusy(true);
                  try {
                    await api("/api/shop/reorder-level", { json: { product_id: p.id, reorder_level_base_units: baseVal } });
                    await refresh();
                    toast("کم مقدار کی وارننگ محفوظ ہو گئی ✓", "ok");
                  } catch (e) {
                    toast(friendlyError(e), "err");
                  } finally {
                    setReorderBusy(false);
                  }
                }}
                className="tactile h-10 rounded-[10px] bg-ink px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                {reorderBusy ? "…" : "محفوظ کریں"}
              </button>
            </div>
          </>
        )}

        {supplierHistory.length > 0 && !helperMode && (
          <div>
            <div className="section-label mb-1.5 pt-1">سپلائر سے پچھلی خریداری</div>
            <div className="surface-card overflow-hidden">
              {supplierHistory.map((s) => (
                <button key={s.id} type="button" onClick={() => openSheet({ type: xrayOn ? "xray" : "entry", txId: s.id })} className="hairline-b flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[13px] last:border-b-0">
                  <div>
                    <div className="font-semibold">{s.supplier}</div>
                    <div className="text-[11.5px] text-ink-2">{shortDate(s.date)} · {formatBaseQty(s.qty, p.base_unit)}</div>
                  </div>
                  <span className="num font-semibold text-maal">{formatRs(s.total)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="section-label pt-1">سامان کے دوسرے نام</div>
        <div className="flex flex-wrap gap-1.5">
          {p.aliases.map((a) => (
            <Pill key={a} dir-auto="true">
              <span dir="auto">{a}</span>
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={alias} onChange={(e) => setAlias(e.target.value)} dir="auto" placeholder="مثلاً کھنڈ" className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
          <button
            disabled={!alias.trim()}
            onClick={async () => {
              try {
                await api("/api/shop/alias", { json: { product_id: p.id, alias } });
                setAlias("");
                await refresh();
              } catch (e) {
                toast(friendlyError(e), "err");
              }
            }}
            className="tactile h-11 rounded-[12px] bg-surface-sunken px-4 text-[14px] font-semibold disabled:opacity-40"
          >
            شامل کریں
          </button>
        </div>
        <PrimaryButton tone="maal" className="w-full" onClick={() => openSheet({ type: "parchi" })}>
          پرچی سے سامان درج کریں
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

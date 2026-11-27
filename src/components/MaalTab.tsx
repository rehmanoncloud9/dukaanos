"use client";

import { AlertCircle, Camera, MessageSquare, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommitResponse, StateProduct } from "@/lib/api/contracts";
import { api, friendlyError, newKey } from "@/lib/client/api";
import { tr } from "@/lib/client/i18n";
import { useDukaan } from "@/lib/client/store";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { computeReorderForecast, formatReorderLine } from "@/lib/domain/forecast";
import { waLink } from "@/lib/domain/messages";
import { formatAmount, formatRs, rupeesToPaisa } from "@/lib/domain/money";
import { startContinuousScan, isBarcodeDetectorSupported } from "@/lib/client/barcode";
import { cx, Pill, PrimaryButton, Segmented, Sheet, shortDate, SW } from "./ui";

/** "4.2 / 25 kg", "2 / 12 tin", "24 / 12 pcs" */
export function stockLabel(p: Pick<StateProduct, "stock_base_units" | "reorder_level_base_units" | "base_unit" | "pack_size_base_units">): string {
  const s = p.stock_base_units;
  const r = p.reorder_level_base_units ?? 0;
  if (p.base_unit !== "pcs" && p.pack_size_base_units > 1000) {
    const f = (v: number) => (v / p.pack_size_base_units).toFixed(Number.isInteger(v / p.pack_size_base_units) ? 0 : 1);
    return `${f(s)} / ${f(r)} tin`;
  }
  if (p.base_unit === "pcs") return `${s} / ${r} pcs`;
  const big = p.base_unit === "g" ? "kg" : "L";
  const f = (v: number) => (v / 1000).toFixed(Math.abs(v) % 1000 === 0 ? 0 : 1);
  return `${f(s)} / ${f(r)} ${big}`;
}

export function isLow(p: StateProduct) {
  return p.stock_base_units <= 0 || (p.reorder_level_base_units ?? 0) > 0 && p.stock_base_units <= (p.reorder_level_base_units ?? 0) * 0.25 || (p.days_left !== null && p.days_left <= 2.5);
}

export function MaalTab() {
  const { state, openSheet, refresh, lang, toast } = useDukaan();
  const [filter, setFilter] = useState<"all" | "low">("all");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [newSku, setNewSku] = useState<string | null>(null);
  const scannerRef = useRef<ReturnType<typeof startContinuousScan> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ tab: string; filter: string }>).detail;
      if (d.tab === "maal") setFilter(d.filter === "low" ? "low" : "all");
    };
    window.addEventListener("dukaan:filter", h);
    return () => window.removeEventListener("dukaan:filter", h);
  }, []);

  const startScan = useCallback(async () => {
    if (!isBarcodeDetectorSupported()) {
      // Fallback: open search with camera icon hint
      toast("Barcode scanner is not supported on this browser — search manually", "warn");
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
          toast(`New barcode ${result.barcode} — 5s mein add karein`, "info");
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
      toast(e instanceof Error ? e.message : "Scan failed", "err");
      setScanning(false);
    }
  }, [state, openSheet, toast]);

  if (!state) return <div className="surface-card h-[400px] animate-pulse" />;
  const negative = state.products.filter((p) => p.stock_base_units < 0);
  const sorted = state.products.slice().sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.name.localeCompare(b.name));
  const q = query.trim().toLowerCase();
  const filtered = filter === "low" ? sorted.filter(isLow) : sorted;
  const list = q ? filtered.filter((p) => p.name.toLowerCase().includes(q) || (p.aliases ?? []).some((a) => a.toLowerCase().includes(q))) : filtered;
  const forecast = filter === "low" ? computeReorderForecast(state.products, state.today.cash_in_galla_paisa, 3, 6) : null;

  return (
    <div className="space-y-3 pb-24">
      {negative.map((p) => (
        <div key={p.id} className="flex items-center gap-2.5 rounded-[14px] bg-udhaar-bg px-3.5 py-2.5">
          <AlertCircle size={16} strokeWidth={1.75} className="shrink-0 text-udhaar-ink" />
          <span className="flex-1 text-[13.5px] font-medium text-udhaar-ink">
            {p.name} stock is now {formatBaseQty(p.stock_base_units, p.base_unit)} — Log Restock?
          </span>
          <button onClick={() => openSheet({ type: "parchi" })} className="tactile h-8 rounded-full bg-surface px-3 text-[13px] font-semibold text-udhaar-ink">
            Fix
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Segmented<"all" | "low">
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `${tr("all", lang)} (${state.products.length})` },
            { value: "low", label: `${tr("lowStock", lang)} (${sorted.filter(isLow).length})` },
          ]}
        />
        {/* Native BarcodeDetector barcode scan button */}
        <button
          onClick={() => void startScan()}
          aria-label="Scan barcode"
          className={cx("tactile flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border border-black/15 px-3 text-[13px] font-semibold", scanning ? "bg-maal text-white" : "bg-surface")}
        >
          <Camera size={15} strokeWidth={1.75} /> {scanning ? "Scanning…" : "Scan"}
        </button>
        <button
          type="button"
          onClick={() => setNewSku("")}
          className="tactile flex h-10 shrink-0 items-center rounded-[12px] bg-ink px-3 text-[13px] font-semibold text-white"
        >
          + Add
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
          placeholder="Search product or alias (e.g. cheeni, oil)…"
          aria-label="Search products"
          dir="auto"
          className="h-11 w-full rounded-[12px] border border-black/10 bg-surface pl-10 pr-3 text-[15px] outline-none focus:border-ink"
        />
      </div>
      {forecast && forecast.items.length > 0 && (
        <div className="surface-card p-3.5">
          <div className="flex items-center justify-between">
            <span className="section-label">Velocity reorder plan</span>
            <span className="num text-[12.5px] font-semibold text-maal">Est. {formatRs(forecast.total_reorder_cost_paisa)}</span>
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
            <MessageSquare size={14} strokeWidth={SW} /> Send Wholesale Order (WhatsApp)
          </a>
        </div>
      )}
      <div className="surface-card overflow-hidden">
        {list.map((p) => {
          const low = isLow(p);
          const pct = Math.max(0, Math.min(1, (p.reorder_level_base_units ?? 0) > 0 ? p.stock_base_units / (p.reorder_level_base_units as number) : 1));
          return (
            <button key={p.id} onClick={() => openSheet({ type: "product", productId: p.id })} className="hairline-b block w-full px-4 py-3.5 text-left last:border-b-0">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[16px] font-semibold">
                    {p.name}
                    {p.is_quick_added && <Pill tone="maal" className="h-5 px-1.5 text-[10.5px]">QuickAdd</Pill>}
                  </div>
                  <div className="text-[13px] text-ink-2 num">
                    Cost Rs. {formatAmount(p.cost_price_paisa)} · Sell Rs. {formatAmount(p.unit_price_paisa)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cx("num text-[15px] font-bold", low ? "text-udhaar" : "text-ink")}>{stockLabel(p)}</div>
                  <div className={cx("text-[12.5px]", low ? "font-semibold text-udhaar" : "text-ink-2")} dir="auto">
                    {p.stock_base_units < 0 ? tr("negative", lang) : low ? tr("lowStock", lang) : tr("healthy", lang)}
                  </div>
                </div>
              </div>
              <div className="mt-2 h-1 rounded-full bg-surface-sunken">
                <div className={cx("h-1 rounded-full", pct <= 0.25 ? "bg-udhaar" : "bg-maal")} style={{ width: `${Math.max(2, pct * 100)}%` }} />
              </div>
            </button>
          );
        })}
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
      toast(`${name.trim()} Maal mein add ho gaya`, "ok");
      onSaved();
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Naya item add karein">
      <div className="space-y-2.5 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item ka naam (e.g. Tapal 95g)" className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Barcode / SKU (optional)" className="num h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
        <div className="flex gap-2">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Sell price (Rs.)" className="num h-12 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Cost (Rs.)" className="num h-12 w-28 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
          <select value={unit} onChange={(e) => setUnit(e.target.value as "pcs" | "g" | "ml")} className="h-12 rounded-[12px] bg-canvas px-3 text-[15px] outline-none">
            <option value="pcs">per pc</option>
            <option value="g">per kg</option>
            <option value="ml">per L</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))} placeholder={`Opening (${unit === "pcs" ? "pcs" : unit === "g" ? "kg" : "L"})`} className="num h-11 rounded-[12px] bg-canvas px-3 text-[14px] outline-none" />
          <input inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^\d.]/g, ""))} placeholder={`Alert below (${unit === "pcs" ? "pcs" : unit === "g" ? "kg" : "L"})`} className="num h-11 rounded-[12px] bg-canvas px-3 text-[14px] outline-none" />
        </div>
        <PrimaryButton className="w-full" busy={busy} disabled={!name.trim() || Number(price) <= 0} onClick={() => void save()}>
          Save to Maal
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

export function ProductSheet({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { state, refresh, toast, openSheet } = useDukaan();
  const p = state?.products.find((x) => x.id === productId);
  const [price, setPrice] = useState(p ? String(p.unit_price_paisa / 100) : "");
  const [alias, setAlias] = useState("");
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
  const per = p.base_unit === "pcs" ? (p.pack_size_base_units === 1 ? "pc" : `${p.pack_size_base_units} pcs`) : p.pack_size_base_units === 1000 ? (p.base_unit === "g" ? "kg" : "L") : formatBaseQty(p.pack_size_base_units, p.base_unit);
  const adjBaseUnits = Math.round(Number(adjQty || 0) * (p.base_unit === "pcs" ? 1 : 1000));

  const submitAdj = async () => {
    if (adjBaseUnits <= 0) return;
    setAdjBusy(true);
    try {
      const res = await api<CommitResponse>("/api/transactions/adjust", {
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
      toast("Stock adjustment darj ho gaya", "ok");
      openSheet({ type: "xray", txId: res.transaction_id });
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
              <div className="section-label">{k}</div>
              <div className="num mt-1 text-[17px] font-bold">{v}</div>
            </div>
          ))}
        </div>
        <div className="rounded-[12px] bg-canvas px-3 py-2 text-[12px] text-ink-2">
          Unit guide:{" "}
          {p.base_unit === "g"
            ? "1 kg = 1,000g · 1 pao = 250g · adha pao = 125g"
            : p.base_unit === "ml"
              ? "1 L = 1,000ml · 1 pao = 250ml"
              : "1 darjan = 12 pcs"}
        </div>
        <div className="section-label pt-1">Sell price (per {per})</div>
        <div className="flex gap-2">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className="num h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
          <button
            onClick={async () => {
              try {
                await api("/api/shop/price", { json: { product_id: p.id, unit_price_paisa: rupeesToPaisa(Number(price)) } });
                await refresh();
                toast("Price updated", "ok");
              } catch (e) {
                toast(friendlyError(e), "err");
              }
            }}
            className="tactile h-11 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white"
          >
            Save
          </button>
        </div>

        <div className="section-label pt-1">Wastage / Personal Use / Stock Adjust</div>
        <div className="surface-card space-y-2 p-3">
          <div className="grid grid-cols-2 gap-1.5">
            <select value={adjDir} onChange={(e) => setAdjDir(Number(e.target.value) as -1 | 1)} className="h-10 rounded-[10px] bg-canvas px-2 text-[13px] font-semibold outline-none">
              <option value={-1}>Kam karein (-)</option>
              <option value={1}>Barhayein (+)</option>
            </select>
            <select value={adjReason} onChange={(e) => setAdjReason(e.target.value as typeof adjReason)} className="h-10 rounded-[10px] bg-canvas px-2 text-[13px] outline-none">
              <option value="wastage">Wastage / Kharab</option>
              <option value="spoilage">Spoilage / Expiry</option>
              <option value="personal_use">Ghar ka istemal</option>
              <option value="stock_count">Stock count</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input
              inputMode="decimal"
              value={adjQty}
              onChange={(e) => setAdjQty(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={`Qty (${p.base_unit === "pcs" ? "pcs" : p.base_unit === "g" ? "kg" : "L"})`}
              className="num h-10 min-w-0 flex-1 rounded-[10px] bg-canvas px-3 text-[14px] outline-none"
            />
            <button
              type="button"
              disabled={adjBusy || adjBaseUnits <= 0}
              onClick={() => void submitAdj()}
              className="tactile h-10 rounded-[10px] bg-udhaar px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {adjBusy ? "Saving…" : "Adjust"}
            </button>
          </div>
        </div>

        {supplierHistory.length > 0 && (
          <div>
            <div className="section-label mb-1.5 pt-1">Supplier purchase history</div>
            <div className="surface-card overflow-hidden">
              {supplierHistory.map((s) => (
                <button key={s.id} type="button" onClick={() => openSheet({ type: "xray", txId: s.id })} className="hairline-b flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[13px] last:border-b-0">
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

        <div className="section-label pt-1">Dialect aliases (PakPhone + pg_trgm)</div>
        <div className="flex flex-wrap gap-1.5">
          {p.aliases.map((a) => (
            <Pill key={a} dir-auto="true">
              <span dir="auto">{a}</span>
            </Pill>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={alias} onChange={(e) => setAlias(e.target.value)} dir="auto" placeholder="e.g. khand, کھنڈ" className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
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
            Add
          </button>
        </div>
        <PrimaryButton tone="maal" className="w-full" onClick={() => openSheet({ type: "parchi" })}>
          Restock via Parchi
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

"use client";

import { AlertCircle, Camera, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StateProduct } from "@/lib/api/contracts";
import { api, friendlyError } from "@/lib/client/api";
import { tr } from "@/lib/client/i18n";
import { useDukaan } from "@/lib/client/store";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { formatAmount, rupeesToPaisa } from "@/lib/domain/money";
import { startContinuousScan, isBarcodeDetectorSupported } from "@/lib/client/barcode";
import { cx, Pill, PrimaryButton, Segmented, Sheet } from "./ui";

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
  const { state, openSheet, lang, toast } = useDukaan();
  const [filter, setFilter] = useState<"all" | "low">("all");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
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
          setQuery(result.barcode);
          toast(`Barcode: ${result.barcode} — no product found, search results shown`, "info");
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

  return (
    <div className="space-y-3">
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
      </div>
      {/* Hidden video for barcode camera feed */}
      {scanning && <video ref={videoRef} muted playsInline className="w-full rounded-[12px] bg-black aspect-video object-cover" />}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search maal / alias (e.g. cheeni, oil)..."
        dir="auto"
        className="h-11 w-full rounded-[12px] bg-surface px-3.5 text-[15px] shadow-[0_0_0_1px_rgba(12,18,16,0.08)] outline-none placeholder:text-ink-3"
      />
      <div className="relative">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product or alias…"
          aria-label="Search products"
          className="h-11 w-full rounded-[12px] border border-black/10 bg-surface pl-10 pr-3 text-[15px] outline-none focus:border-ink"
        />
      </div>
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
    </div>
  );
}

export function ProductSheet({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { state, refresh, toast, openSheet } = useDukaan();
  const p = state?.products.find((x) => x.id === productId);
  const [price, setPrice] = useState(p ? String(p.unit_price_paisa / 100) : "");
  const [alias, setAlias] = useState("");
  if (!p) return null;
  const per = p.base_unit === "pcs" ? (p.pack_size_base_units === 1 ? "pc" : `${p.pack_size_base_units} pcs`) : p.pack_size_base_units === 1000 ? (p.base_unit === "g" ? "kg" : "L") : formatBaseQty(p.pack_size_base_units, p.base_unit);
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

"use client";

import { Check, ImageDown, MessageSquare, Pause, Pencil, Plus, RotateCcw, Search, Trash2, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommitResponse, FeedTx, PromiseProposal, TurnTrace } from "@/lib/api/contracts";
import { api, ClientApiError, friendlyError, newKey } from "@/lib/client/api";
import { renderReceiptPng, shareOrDownload } from "@/lib/client/canvas";
import { holdBill, removeHeldBill } from "@/lib/client/held-bills";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { buildSaleProposal, recalcCatalogLine, recalcNewSkuLine, resettle, setLineQty, summarizeLines } from "@/lib/domain/bill";
import { quickSuggest } from "@/lib/domain/cooccurrence";
import { describeQty, formatBaseQty, formatUnitPrice, parseQuantityPhrase, type BaseUnit } from "@/lib/domain/desi-units";
import { paymentReceiptText, receiptText, smsLink, waLink } from "@/lib/domain/messages";
import { formatRs, rupeesToPaisa } from "@/lib/domain/money";
import { quickWadaOptions, wadaLabel } from "@/lib/domain/wada";
import { dequeue } from "@/lib/client/queue";
import type { CustomerRow, ParsedTurn, PaymentProposal, ProposalLine, SaleProposal } from "@/lib/domain/types";
import { feedSummary } from "./MunshiTab";
import { cx, Money, Pill, PrimaryButton, SecondaryButton, Sheet, Spinner, SW } from "./ui";

const REASON_LABEL: Record<string, string> = {
  UDHAAR: "Udhaar",
  DISCOUNT: "Discount",
  LOW_CONFIDENCE: "Low confidence",
  AMBIGUOUS_CUSTOMER: "3-Ali check",
  NEW_SKU: "New item",
  NO_ITEMS: "No items",
  UDHAAR_REQUIRES_CUSTOMER: "Customer needed",
  OVERPAYMENT_TO_KHATA: "Extra cash → khata",
  NEGATIVE_STOCK: "Stock",
  UNRESOLVED_NUMBER: "Number needs correction",
  UNVERIFIED_EXTRACTION: "Review extraction",
  EXPLICIT_CASH_REQUIRED: "Confirm cash received",
  CREDIT_OVERDUE_30D: "Udhaar 30+ din overdue",
  CREDIT_LIMIT_EXCEEDED: "Credit limit exceeded",
};

/* ───────────────────────────── customer chips ───────────────────────────── */

function InlineAddCustomer({ defaultName = "", onCreated }: { defaultName?: string; onCreated: (id: string) => void }) {
  const { toast, refresh } = useDukaan();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const c = await api<{ id: string }>("/api/shop/customer", { json: { name, phone: phone || undefined } });
      await refresh();
      onCreated(c.id);
      setOpen(false);
      setPhone("");
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="tactile flex h-12 shrink-0 items-center gap-1 rounded-[12px] border border-dashed border-black/25 px-3 text-[14px] font-semibold text-ink-2">
        <Plus size={14} strokeWidth={SW} /> New
      </button>
    );
  }
  return (
    <div className="mt-2 flex w-full gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam" className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx…" inputMode="tel" className="h-11 w-[120px] rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
      <PrimaryButton onClick={() => void add()} busy={busy} disabled={!name.trim()} className="h-11">
        Add
      </PrimaryButton>
    </div>
  );
}

function CustomerRail({ proposalCustomer, customers, selected, onSelect, required }: {
  proposalCustomer: SaleProposal["customer"];
  customers: CustomerRow[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  required: boolean;
}) {
  const chips = proposalCustomer.candidates.length
    ? proposalCustomer.candidates.map((c) => customers.find((x) => x.id === c.id) ?? { ...c, aliases: [] })
    : customers.slice(0, 8);

  return (
    <div className="px-5 pb-3">
      <div className={cx("section-label mb-2", required && !selected && "text-udhaar-ink")}>
        Match customer {proposalCustomer.candidates.length > 1 ? "(3-Ali disambiguation)" : ""}
        {required && !selected && " · required for udhaar"}
      </div>
      <div className="no-scrollbar -mx-5 flex flex-wrap gap-2 px-5">
        {!required && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cx("tactile flex h-12 shrink-0 flex-col justify-center rounded-[12px] border px-3.5 text-left", selected === null ? "border-ink bg-ink text-white" : "border-black/15 bg-surface")}
          >
            <span className="flex items-center gap-1 text-[14.5px] font-semibold leading-5">
              {selected === null && <Check size={14} strokeWidth={SW} />}
              Walk-in
            </span>
            <span className={cx("text-[11.5px] leading-4", selected === null ? "text-white/70" : "text-ink-2")}>Cash · no khata</span>
          </button>
        )}
        {chips.map((c) => {
          const on = selected === c.id;
          return (
            <button
              type="button"
              key={c.id}
              onClick={() => onSelect(on ? null : c.id)}
              className={cx("tactile flex h-12 shrink-0 flex-col justify-center rounded-[12px] border px-3.5 text-left", on ? "border-ink bg-ink text-white" : "border-black/15 bg-surface")}
            >
              <span className="flex items-center gap-1 text-[15px] font-semibold leading-5">
                {on && <Check size={14} strokeWidth={SW} />}
                {c.name}
              </span>
              <span className={cx("text-[12px] leading-4", on ? "text-white/70" : "text-ink-2")}>
                {c.role_tag ? `${c.role_tag} · ` : ""}Khata {formatRs(c.balance_paisa)}
              </span>
            </button>
          );
        })}
        <InlineAddCustomer defaultName={proposalCustomer.mention ?? ""} onCreated={(id) => onSelect(id)} />
      </div>
    </div>
  );
}

/* ───────────────────────────── line rows ───────────────────────────── */

function NewSkuEditor({ line, onSave }: { line: ProposalLine; onSave: (l: ProposalLine) => void }) {
  const [open, setOpen] = useState(Boolean(line.number_unresolved) || (!line.value_first && line.unit_price_paisa <= 0));
  const [price, setPrice] = useState(line.price_known && line.unit_price_paisa ? String(line.unit_price_paisa / 100) : "");
  const [quantity, setQuantity] = useState(line.quantity_phrase ?? "");
  const [unit, setUnit] = useState<BaseUnit>(line.base_unit);
  const unitLabel = unit === "g" ? "per kg" : unit === "ml" ? "per litre" : "per piece";
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="tactile mt-2 rounded-[10px] border border-dashed border-maal/50 bg-maal-bg px-2.5 py-1.5 text-[13px] font-semibold text-maal">
        + QuickAdd “{line.name}” to Maal
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-[10px] border border-dashed border-maal/50 bg-maal-bg p-1.5">
      <input
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder="quantity e.g. 2 packet"
        aria-label={`Quantity for ${line.name}`}
        className="h-9 min-w-28 flex-1 rounded-[8px] bg-surface px-2 text-[13px] outline-none"
      />
      <span className="pl-1 text-[13px] font-semibold text-maal">Rs.</span>
      <input autoFocus inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="price" className="h-9 w-20 rounded-[8px] bg-surface px-2 text-[15px] outline-none num" />
      <select value={unit} onChange={(e) => setUnit(e.target.value as BaseUnit)} className="h-9 rounded-[8px] bg-surface px-1.5 text-[13px]">
        <option value="pcs">per piece</option>
        <option value="g">per kg</option>
        <option value="ml">per litre</option>
      </select>
      <button
        disabled={!price}
        onClick={() => {
          const pack = unit === "pcs" ? 1 : 1000;
          onSave(recalcNewSkuLine({
            ...line,
            quantity_phrase: quantity.trim() || null,
            base_unit: unit,
            pack_size_base_units: pack,
            unit_price_paisa: rupeesToPaisa(Number(price)),
            price_known: true,
            confidence: 1,
          }));
          setOpen(false);
        }}
        className="tactile ml-auto h-9 rounded-[8px] bg-maal px-3 text-[13px] font-semibold text-white disabled:opacity-40"
        title={unitLabel}
      >
        Save SKU
      </button>
    </div>
  );
}

function LineRow({ line, stockBefore, onChange, onRemove }: { line: ProposalLine; stockBefore: number | null; onChange: (l: ProposalLine) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [phrase, setPhrase] = useState(line.quantity_phrase ?? "");
  const sub =
    line.kind === "new_sku"
      ? line.value_first && !line.price_known
        ? "Value-first · Loose"
        : line.price_known
          ? `${formatBaseQty(line.qty_base_units, line.base_unit)} @ ${formatUnitPrice(line)} · new SKU`
          : "New item — set a price"
      : line.value_first
        ? `Value-first${line.is_loose ? " · Loose" : ""} · ${formatBaseQty(line.qty_base_units, line.base_unit)} @ ${formatUnitPrice(line)}`
        : `${describeQty(line.qty_base_units, line.base_unit, parseQuantityPhrase(line.quantity_phrase))} @ ${formatUnitPrice(line)}`;
  return (
    <div className="hairline-b px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <button className="min-w-0 flex-1 text-left" onClick={() => setEditing((e) => !e)}>
          <div className="text-[15px] font-medium leading-5">{line.name}</div>
          <div className="text-[13px] leading-[18px] text-ink-2">{sub}</div>
          {line.number_unresolved && (
            <div className="mt-1 text-[12px] font-semibold text-udhaar">Number unclear — correct the quantity before saving</div>
          )}
          {line.stock_after !== null && line.stock_after < 0 && (
            <div className="mt-1 text-[12px] font-semibold text-udhaar">Stock → {formatBaseQty(line.stock_after, line.base_unit)} (soft warning)</div>
          )}
        </button>
        <Money paisa={line.line_total_paisa} className="text-[17px] font-bold" />
      </div>
      {line.kind === "new_sku" && <NewSkuEditor line={line} onSave={onChange} />}
      {editing && line.kind === "catalog" && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="dedh pao / 2 kilo / 3"
            className="h-9 min-w-0 flex-1 rounded-[8px] bg-canvas px-2 text-[14px] outline-none"
          />
          <button onClick={() => onChange(recalcCatalogLine({ ...line, quantity_phrase: phrase, value_first: false, value_paisa: null }, stockBefore))} className="tactile h-9 rounded-[8px] bg-ink px-3 text-[13px] font-semibold text-white">
            Set
          </button>
          <button onClick={() => onChange(setLineQty(line, line.qty_base_units + (line.base_unit === "pcs" ? 1 : line.pack_size_base_units / 4), stockBefore))} className="tactile h-9 w-9 rounded-[8px] bg-surface-sunken text-[18px]">
            +
          </button>
          <button onClick={() => onChange(setLineQty(line, Math.max(1, line.qty_base_units - (line.base_unit === "pcs" ? 1 : line.pack_size_base_units / 4)), stockBefore))} className="tactile h-9 w-9 rounded-[8px] bg-surface-sunken text-[18px]">
            −
          </button>
          <button onClick={onRemove} className="tactile grid h-9 w-9 place-items-center rounded-[8px] bg-udhaar-bg text-udhaar-ink" aria-label="Remove line">
            <Trash2 size={15} strokeWidth={SW} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Tier-2 sale review (Screen 2) ───────────────────────────── */

export function SaleReviewSheet({ proposal: initial, idemKey, trace, onClose }: { proposal: SaleProposal; idemKey: string; trace: TurnTrace | null; onClose: () => void }) {
  const { state, shopId, confirmSale, openSheet, toast } = useDukaan();
  const customers = state?.customers ?? [];
  const products = state?.products ?? [];
  const [p, setP] = useState<SaleProposal>(initial);
  const [cashText, setCashText] = useState(String(initial.cash_paid_paisa / 100));
  const [discText, setDiscText] = useState(String(initial.discount_paisa / 100));
  const [addingItem, setAddingItem] = useState(initial.lines.length === 0);
  const [itemQuery, setItemQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stockOf = (id: string | null) => (id ? products.find((x) => x.id === id)?.stock_base_units ?? null : null);

  const match = useMemo(() => {
    const scores = p.lines.map((l) => l.match?.score ?? 0).concat(p.customer.candidates.length ? [p.customer.candidates[0].score] : []);
    return Math.round((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)) * 100);
  }, [p]);

  const companions = useMemo(() => {
    if (!state) return [];
    const ids = p.lines.map((l) => l.product_id).filter((id): id is string => Boolean(id));
    return quickSuggest(ids, state.feed, state.products, 3);
  }, [p.lines, state]);

  const addCatalogProduct = (prod: (typeof products)[number]) => {
    const qty = prod.pack_size_base_units;
    const newLine: ProposalLine = {
      key: `add-${prod.id}-${Date.now().toString(36)}`,
      kind: "catalog",
      product_id: prod.id,
      name: prod.name,
      spoken: prod.name,
      quantity_phrase: null,
      base_unit: prod.base_unit,
      pack_size_base_units: prod.pack_size_base_units,
      unit_price_paisa: prod.unit_price_paisa,
      qty_base_units: qty,
      line_total_paisa: prod.unit_price_paisa,
      value_first: false,
      value_paisa: null,
      is_loose: false,
      formula: `manual → ${formatBaseQty(qty, prod.base_unit)} @ ${formatRs(prod.unit_price_paisa)}`,
      match: { score: 1, matched: prod.name, ms: 0, key: prod.name.toLowerCase() },
      confidence: 1,
      stock_after: prod.stock_base_units - qty,
      price_known: prod.unit_price_paisa > 0,
      number_unresolved: false,
    };
    update({ lines: [...p.lines, newLine] });
    setAddingItem(false);
    setItemQuery("");
  };

  const update = (patch: Parameters<typeof resettle>[2]) => {
    const next = resettle(p, customers, patch);
    setP(next);
    setCashText(String(next.cash_paid_paisa / 100));
    setDiscText(String(next.discount_paisa / 100));
    setErr(null);
  };

  const needsCustomer = p.credit_paisa !== 0 && !p.customer.selected_id;
  const priceMissing = p.lines.some((l) => (l.kind === "new_sku" && l.line_total_paisa <= 0) || l.number_unresolved);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await confirmSale(p, idemKey, trace);
      if (shopId) removeHeldBill(shopId, idemKey);
      const phone = customers.find((c) => c.id === p.customer.selected_id)?.phone ?? null;
      openSheet({ type: "receipt", commit: res, proposal: p, customerPhone: phone });
    } catch (e) {
      setErr(e instanceof ClientApiError && e.code === "UDHAAR_REQUIRES_CUSTOMER" ? "Udhaar ke liye customer chunein (UDHAAR_REQUIRES_CUSTOMER)" : friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const holdCurrent = () => {
    if (!shopId || p.lines.length === 0) return;
    const custName = customers.find((c) => c.id === p.customer.selected_id)?.name ?? p.customer.mention ?? null;
    holdBill({
      id: idemKey,
      shop_id: shopId,
      label: summarizeLines(p.lines),
      total_paisa: p.total_paisa,
      customer_name: custName,
      proposal: p,
      trace,
    });
    toast("Bill hold kar diya — jab chahein resume karein", "info");
    onClose();
  };

  const searchResults = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    const list = q
      ? products.filter((x) => x.name.toLowerCase().includes(q) || (x.aliases ?? []).some((a) => a.toLowerCase().includes(q)))
      : products;
    return list.slice(0, 6);
  }, [itemQuery, products]);

  const roundOffDisc = p.subtotal_paisa > 1000 ? p.subtotal_paisa % 1000 : 0;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Review Entry"
      right={
        <Pill tone={trace?.source === "rules" ? "amber" : "cash"} className="h-7 px-3 text-[13px]">
          {trace?.source === "rules" ? "Rule parse" : `${match}% Match`}
        </Pill>
      }
    >
      {trace?.transcript && (
        <div className="mx-5 mb-3 rounded-[12px] bg-canvas px-3.5 py-2.5 text-[15px] leading-[21px]" dir="auto">
          “{trace.transcript}”
        </div>
      )}
      <div className="mx-5 mb-3 flex flex-wrap items-center gap-1.5">
        <Pill tone="dark" mono>Tier 2</Pill>
        {p.tier_reasons.map((r) => (
          <Pill key={r} tone={r.startsWith("UDHAAR") || r === "AMBIGUOUS_CUSTOMER" ? "udhaar" : r === "NEW_SKU" ? "maal" : "neutral"}>
            {REASON_LABEL[r] ?? r}
          </Pill>
        ))}
        <button
          type="button"
          onClick={() => {
            const cust = customers.find((c) => c.id === p.customer.selected_id)?.name;
            const script = `${cust ? `${cust} ka ` : ""}kul bill ${Math.round(p.total_paisa / 100)} rupay hai${p.cash_paid_paisa > 0 ? `, cash ${Math.round(p.cash_paid_paisa / 100)} rupay` : ""}${p.credit_paisa > 0 ? `, udhaar ${Math.round(p.credit_paisa / 100)} rupay` : ""}.`;
            void speak(script);
          }}
          className="tactile ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold text-ink"
        >
          <Volume2 size={13} strokeWidth={SW} /> Suniye
        </button>
      </div>

      {(p.customer.mention || p.credit_paisa !== 0 || customers.length > 0) && (
        <CustomerRail proposalCustomer={p.customer} customers={customers} selected={p.customer.selected_id} onSelect={(id) => update({ selected_customer_id: id })} required={p.credit_paisa !== 0} />
      )}

      <div className="px-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="section-label">Items (deterministic math)</span>
          <button
            type="button"
            onClick={() => setAddingItem((v) => !v)}
            className="tactile inline-flex h-7 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold text-ink"
          >
            <Plus size={12} strokeWidth={SW} /> Add item
          </button>
        </div>
        {addingItem && (
          <div className="mb-2.5 rounded-[14px] border border-black/10 bg-canvas p-2.5">
            <div className="relative">
              <Search size={14} strokeWidth={SW} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                placeholder="Search item to add (cheeni, atta…)"
                className="h-10 w-full rounded-[10px] bg-surface pl-8 pr-3 text-[14px] outline-none"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {searchResults.map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => addCatalogProduct(prod)}
                  className="tactile rounded-[10px] border border-black/10 bg-surface px-2.5 py-1.5 text-left text-[12.5px] font-medium"
                >
                  + {prod.name} <span className="num text-ink-2">({formatRs(prod.unit_price_paisa)})</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="surface-card overflow-hidden">
          {p.lines.map((l, i) => (
            <LineRow
              key={l.key}
              line={l}
              stockBefore={stockOf(l.product_id)}
              onChange={(nl) => update({ lines: p.lines.map((x, j) => (j === i ? nl : x)) })}
              onRemove={() => update({ lines: p.lines.filter((_, j) => j !== i) })}
            />
          ))}
          {p.lines.length === 0 && <div className="px-4 py-4 text-center text-[13.5px] text-ink-2">Upar se item add karein</div>}
          {p.discount_paisa > 0 || discText !== "0" ? (
            <div className="hairline-b flex items-center gap-3 bg-udhaar-bg/50 px-4 py-3">
              <span className="flex-1 text-[15px] font-medium text-udhaar-ink">Discount (Chhor do)</span>
              <span className="text-[15px] font-bold text-udhaar-ink">-Rs.</span>
              <input
                inputMode="numeric"
                value={discText}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  setDiscText(v);
                  update({ discount_paisa: rupeesToPaisa(Number(v || 0)) });
                }}
                className="num w-16 bg-transparent text-right text-[17px] font-bold text-udhaar-ink outline-none"
              />
            </div>
          ) : null}
          <div className="flex items-center px-4 py-3">
            <span className="flex-1 text-[16px] font-bold">Net Bill</span>
            <Money paisa={p.total_paisa} className="text-[19px] font-bold" />
          </div>
        </div>

        {/* Chutti / Round-off quick discount chips + Companion basket suggestions */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {p.subtotal_paisa >= 1000 && (
            <>
              <span className="text-[11.5px] font-semibold text-ink-2">Chutti:</span>
              {roundOffDisc > 0 && p.discount_paisa !== roundOffDisc && (
                <button type="button" onClick={() => update({ discount_paisa: roundOffDisc })} className="tactile h-7 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold">
                  Round -{formatRs(roundOffDisc)}
                </button>
              )}
              {[500, 1000].filter((d) => d < p.subtotal_paisa).map((d) => (
                <button key={d} type="button" onClick={() => update({ discount_paisa: d })} className="tactile h-7 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold">
                  -{formatRs(d)}
                </button>
              ))}
              {p.discount_paisa > 0 && (
                <button type="button" onClick={() => update({ discount_paisa: 0 })} className="tactile h-7 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold text-ink-2">
                  Clear
                </button>
              )}
            </>
          )}
        </div>
        {companions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] font-semibold text-ink-2">Sath bikta hai:</span>
            {companions.map((c) => {
              const prod = products.find((x) => x.id === c.product_id);
              if (!prod) return null;
              return (
                <button
                  key={c.product_id}
                  type="button"
                  onClick={() => addCatalogProduct(prod)}
                  className="tactile h-7 rounded-full border border-maal/30 bg-maal-bg px-2.5 text-[12px] font-semibold text-maal"
                >
                  + {c.name.replace(/\s*\(.*\)/, "")}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 rounded-[16px] bg-canvas p-3.5">
          <div>
            <div className="section-label">Cash received</div>
            <div className="mt-1 flex items-baseline text-cash">
              <span className="rs-prefix text-[22px] font-bold">Rs.</span>
              <input
                inputMode="numeric"
                value={cashText}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  setCashText(v);
                  const next = resettle(p, customers, { cash_paid_paisa: rupeesToPaisa(Number(v || 0)) });
                  setP(next);
                }}
                className="num w-full bg-transparent text-[22px] font-bold outline-none"
              />
            </div>
          </div>
          <div>
            <div className="section-label">{p.credit_paisa > 0 ? "Khata udhaar" : "Khata credit"}</div>
            <Money paisa={p.credit_paisa} sign={p.credit_paisa > 0} className={cx("mt-1 block text-[22px] font-bold", p.credit_paisa > 0 ? "text-udhaar" : "text-cash")} />
            {p.new_balance_paisa !== null && <div className="text-[12.5px] text-ink-2">New bal: {formatRs(p.new_balance_paisa)}</div>}
            {p.change_due_paisa > 0 && <div className="text-[12.5px] text-ink-2">Change: {formatRs(p.change_due_paisa)}</div>}
          </div>
        </div>
        {err && <div className="mt-3 rounded-[12px] bg-udhaar-bg px-3 py-2 text-[14px] font-medium text-udhaar-ink">{err}</div>}
      </div>

      <div className="sticky bottom-0 mt-4 flex gap-2 border-t border-black/5 bg-surface px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <SecondaryButton onClick={onClose} className="px-3.5">
          Cancel
        </SecondaryButton>
        <SecondaryButton onClick={holdCurrent} disabled={p.lines.length === 0} className="flex items-center gap-1 px-3.5">
          <Pause size={14} strokeWidth={SW} /> Hold
        </SecondaryButton>
        <PrimaryButton onClick={save} busy={busy} disabled={needsCustomer || priceMissing || p.lines.length === 0} className="flex-1">
          Confirm &amp; Save
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── Wasooli (payment) ───────────────────────────── */

export function PaymentSheet({ proposal, customerId, idemKey, trace, onClose }: { proposal?: PaymentProposal; customerId?: string; idemKey: string; trace: TurnTrace | null; onClose: () => void }) {
  const { state, confirmPayment, openSheet } = useDukaan();
  const customers = state?.customers ?? [];
  const [selected, setSelected] = useState<string | null>(customerId ?? proposal?.customer.selected_id ?? null);
  const cust = customers.find((c) => c.id === selected) ?? null;
  const [amount, setAmount] = useState(proposal?.amount_paisa ? String(proposal.amount_paisa / 100) : cust ? String(Math.max(0, cust.balance_paisa) / 100) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amt = rupeesToPaisa(Number(amount || 0));
  const withBal = customers.filter((c) => c.balance_paisa > 0 || c.id === selected);
  const chips = proposal?.customer.candidates.length
    ? proposal.customer.candidates.map((c) => customers.find((x) => x.id === c.id)!).filter(Boolean)
    : withBal.length > 0
      ? withBal
      : customers.slice(0, 8);

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await confirmPayment(selected, amt, idemKey, trace);
      openSheet({ type: "receipt", commit: res, proposal: null, customerPhone: cust?.phone ?? null });
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Wasooli · Payment">
      {trace?.transcript && <div className="mx-5 mb-3 rounded-[12px] bg-canvas px-3.5 py-2.5 text-[15px]" dir="auto">“{trace.transcript}”</div>}
      <div className="px-5">
        <div className="section-label mb-2">Customer</div>
        <div className="no-scrollbar -mx-5 flex flex-wrap gap-2 px-5 pb-1">
          {chips.map((c) => (
            <button key={c.id} onClick={() => setSelected(selected === c.id ? null : c.id)} className={cx("tactile flex h-12 shrink-0 flex-col justify-center rounded-[12px] border px-3.5 text-left", selected === c.id ? "border-ink bg-ink text-white" : "border-black/15")}>
              <span className="text-[15px] font-semibold leading-5">{c.name}</span>
              <span className={cx("text-[12px]", selected === c.id ? "text-white/70" : "text-ink-2")}>Khata {formatRs(c.balance_paisa)}</span>
            </button>
          ))}
          <InlineAddCustomer defaultName={proposal?.customer.mention ?? ""} onCreated={(id) => setSelected(id)} />
        </div>
        {chips.length === 0 && !selected && (
          <p className="mt-1.5 text-[12.5px] text-ink-2">Abhi koi customer nahi — Wasooli ke liye “+ New” par tap karke customer add karein.</p>
        )}
        <div className="mt-4 rounded-[16px] bg-canvas p-4">
          <div className="section-label">Amount received</div>
          <div className="mt-1 flex items-baseline text-cash">
            <span className="rs-prefix text-[34px] font-bold">Rs.</span>
            <input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="num w-full bg-transparent text-[34px] font-bold outline-none" placeholder="0" />
          </div>
          {cust && (
            <div className="mt-1 text-[13px] text-ink-2 num">
              {formatRs(cust.balance_paisa)} → New bal: <b className="text-ink">{formatRs(cust.balance_paisa - amt)}</b>
            </div>
          )}
          {cust && cust.balance_paisa > 0 && (
            <div className="mt-3 flex gap-2">
              {[cust.balance_paisa, 50000, 100000].filter((v, i, a) => a.indexOf(v) === i && v > 0).map((v) => (
                <button key={v} onClick={() => setAmount(String(v / 100))} className="tactile h-8 rounded-full bg-surface px-3 text-[13px] font-semibold">
                  {v === cust.balance_paisa ? "Full " : ""}
                  {formatRs(v)}
                </button>
              ))}
            </div>
          )}
        </div>
        {err && <div className="mt-3 rounded-[12px] bg-udhaar-bg px-3 py-2 text-[14px] text-udhaar-ink">{err}</div>}
      </div>
      <div className="sticky bottom-0 mt-4 flex gap-3 bg-surface px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <SecondaryButton onClick={onClose} className="w-[92px]">Cancel</SecondaryButton>
        <PrimaryButton tone="cash" onClick={save} busy={busy} disabled={!selected || amt <= 0} className="flex-1">
          Confirm Wasooli
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── reversal ───────────────────────────── */

export function ReversalSheet({ target, onClose }: { target: FeedTx | null; onClose: () => void }) {
  const { reverse, toast, xrayOn } = useDukaan();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Pichli entry wapas?">
      <div className="px-5 pb-4">
        {target ? (
          <div className="surface-card p-4">
            <div className="text-[15px] font-semibold">{target.customer_name ?? target.supplier_name ?? "Walk-in Cash"}</div>
            <div className="text-[13px] text-ink-2">{feedSummary(target)}</div>
            <Money paisa={target.total_paisa} className="mt-2 block text-[22px] font-bold" />
            {xrayOn && <div className="mt-2 font-mono text-[11px] text-ink-2">#{target.seq} · {target.entry_hash.slice(0, 12)}…</div>}
          </div>
        ) : (
          <div className="text-[15px] text-ink-2">Wapas karne ke liye koi entry nahi.</div>
        )}
        <p className="mt-3 text-[13px] text-ink-2">Stock aur khata balance khud durust ho jayega — purana record bhi mehfooz rahega.</p>
      </div>
      <div className="flex gap-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
        <SecondaryButton onClick={onClose} className="w-[92px]">Cancel</SecondaryButton>
        <PrimaryButton
          busy={busy}
          disabled={!target}
          className="flex-1"
          onClick={async () => {
            setBusy(true);
            try {
              await reverse(target!.id, "voice-wapas");
              toast("Entry wapas ho gayi ✓", "ok");
              onClose();
            } catch (e) {
              toast(friendlyError(e), "err");
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo entry
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── agent answer ───────────────────────────── */

export function AnswerSheet({ answer, proposal, trace, tools, onClose }: { answer: string; proposal: SaleProposal | PaymentProposal | null; trace: TurnTrace; tools: Array<{ name: string; ms: number }>; onClose: () => void }) {
  const { openSheet, xrayOn } = useDukaan();
  return (
    <Sheet open onClose={onClose} title="Munshi ka jawab">
      <div className="px-5 pb-5">
        <div className="mb-3 rounded-[12px] bg-canvas px-3.5 py-2.5 text-[14px] text-ink-2" dir="auto">“{trace.transcript}”</div>
        <p className="text-[18px] font-medium leading-7" dir="auto">{answer || "—"}</p>
        {xrayOn && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill mono>{trace.model}</Pill>
            {tools.map((t, i) => (
              <Pill key={i} tone="maal" mono>
                {t.name} {t.ms}ms
              </Pill>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-3">
          <SecondaryButton onClick={() => void speak(answer)} className="flex items-center gap-2">
            <Volume2 size={16} strokeWidth={SW} /> Suniye
          </SecondaryButton>
          {proposal && (
            <PrimaryButton
              className="flex-1"
              onClick={() =>
                proposal.kind === "sale"
                  ? openSheet({ type: "review", proposal, key: newKey("agent"), trace })
                  : openSheet({ type: "payment", proposal, key: newKey("agent"), trace })
              }
            >
              Review proposal
            </PrimaryButton>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── post-commit receipt (wa.me ping) ───────────────────────────── */

export function ReceiptSheet({ commit, proposal, customerPhone, onClose }: { commit: CommitResponse; proposal: SaleProposal | null; customerPhone: string | null; onClose: () => void }) {
  const { state, toast, openSheet, xrayOn } = useDukaan();
  const shop = state?.shop.name ?? "DukaanOS";
  const lines = (commit.lines ?? []) as Array<{ name: string; qty_base_units: number; base_unit: BaseUnit; line_total_paisa: number }>;
  const t = commit.totals ?? {};
  const isPayment = commit.type === "payment";
  const text = isPayment
    ? paymentReceiptText({ shop, customer: commit.customer?.name ?? "", amount_paisa: t.total_paisa ?? 0, new_balance_paisa: commit.customer?.balance_paisa ?? 0, entry_hash: commit.entry_hash })
    : receiptText({
        shop,
        customer: commit.customer?.name,
        lines,
        discount_paisa: t.discount_paisa ?? 0,
        total_paisa: t.total_paisa ?? 0,
        cash_paid_paisa: t.cash_paid_paisa ?? 0,
        credit_paisa: t.credit_paisa ?? 0,
        new_balance_paisa: commit.customer?.balance_paisa ?? null,
        entry_hash: commit.entry_hash,
      });
  const phone = customerPhone ?? commit.customer?.phone ?? null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-cash text-white">
            <Check size={16} strokeWidth={2.2} />
          </span>
          Saved
        </span>
      }
    >
      <div className="px-5 pb-2">
        <div className="surface-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-semibold">{commit.customer?.name ?? "Walk-in"}</span>
            <Money paisa={t.total_paisa ?? 0} className="text-[22px] font-bold" />
          </div>
          {proposal && <div className="mt-1 text-[13px] text-ink-2">{proposal.lines.map((l) => l.name).join(", ")}</div>}
          {commit.customer && <div className="mt-1 text-[13px] text-ink-2">New khata balance: <b className="text-udhaar">{formatRs(commit.customer.balance_paisa)}</b></div>}
          {xrayOn && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone="cash" mono>Δ = 0 ✓</Pill>
              <Pill mono>#{commit.seq} {commit.entry_hash.slice(0, 10)}…</Pill>
              <Pill mono>{commit.rpc_ms}ms RPC</Pill>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 px-5 pb-2 pt-2">
        <a href={waLink(phone, text)} target="_blank" rel="noreferrer" className="tactile col-span-2 flex h-12 items-center justify-center gap-2 rounded-[14px] bg-cash text-[16px] font-semibold text-white">
          <MessageSquare size={18} strokeWidth={SW} /> WhatsApp Receipt
        </a>
        <a href={smsLink(phone, text)} className="tactile flex h-12 items-center justify-center rounded-[14px] bg-surface-sunken text-[15px] font-semibold">
          SMS (2G)
        </a>
        <button
          className="tactile flex h-12 items-center justify-center gap-2 rounded-[14px] bg-surface-sunken text-[15px] font-semibold"
          onClick={async () => {
            let khataUrl: string | null = null;
            if (commit.customer?.id) {
              try {
                const k = await api<{ url: string }>("/api/khata/link", { json: { customer_id: commit.customer.id } });
                khataUrl = k.url;
              } catch {
                /* offline fallback: omit link */
              }
            }
            const png = await renderReceiptPng({
              shop,
              city: state?.shop.city,
              customer: commit.customer?.name,
              lines: isPayment ? [{ name: "Wasooli / payment", qty_base_units: 1, base_unit: "pcs", line_total_paisa: t.total_paisa ?? 0 }] : lines,
              discount_paisa: t.discount_paisa ?? 0,
              total_paisa: t.total_paisa ?? 0,
              cash_paid_paisa: t.cash_paid_paisa ?? 0,
              credit_paisa: t.credit_paisa ?? 0,
              new_balance_paisa: commit.customer?.balance_paisa ?? null,
              entry_hash: commit.entry_hash,
              seq: commit.seq,
              created_at: commit.created_at,
              khata_url: khataUrl,
            });
            const how = await shareOrDownload(png, `raseed-${commit.seq}.png`, text);
            toast(`Receipt PNG ${how} (${Math.round(png.size / 1024)} KB)`, "ok");
          }}
        >
          <ImageDown size={16} strokeWidth={SW} /> PNG
        </button>
      </div>
      <div className="flex gap-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-1">
        {xrayOn && (
          <SecondaryButton className="flex-1" onClick={() => openSheet({ type: "xray", txId: commit.transaction_id })}>
            {"</>"} X-Ray
          </SecondaryButton>
        )}
        <PrimaryButton className="flex-1" onClick={onClose}>
          Done
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── wada (promise-to-pay) ───────────────────────────── */

/** Shopkeeper confirms a spoken wada: customer chip + date chip → hash-chained promise attestation. */
export function PromiseSheet({ proposal, idemKey, trace, onClose }: { proposal: PromiseProposal; idemKey: string; trace: TurnTrace | null; onClose: () => void }) {
  const { state, toast } = useDukaan();
  const customers = state?.customers ?? [];
  const [selected, setSelected] = useState<string | null>(proposal.customer.selected_id ?? null);
  const [date, setDate] = useState(proposal.promise_date);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const withBal = customers.filter((c) => c.balance_paisa > 0 || c.id === selected);
  const chips = proposal.customer.candidates.length
    ? proposal.customer.candidates.map((c) => customers.find((x) => x.id === c.id)!).filter(Boolean)
    : withBal.length > 0
      ? withBal
      : customers.slice(0, 8);
  const dates = [{ label: "Suna gaya", date: proposal.promise_date }, ...quickWadaOptions()].filter((o, i, all) => all.findIndex((x) => x.date === o.date) === i);
  const cust = customers.find((c) => c.id === selected) ?? null;

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api("/api/khata/promise", { json: { customer_id: selected, promise_date: date, idempotency_key: idemKey } });
      await dequeue(idemKey).catch(() => undefined);
      toast(`Wada mehfooz · ${cust?.name ?? ""} · ${wadaLabel(date)}`, "ok");
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Wada · Promise to pay">
      {trace?.transcript && <div className="mx-5 mb-3 rounded-[12px] bg-canvas px-3.5 py-2.5 text-[15px]" dir="auto">“{trace.transcript}”</div>}
      <div className="px-5">
        <div className="section-label mb-2">Customer</div>
        <div className="no-scrollbar -mx-5 flex flex-wrap gap-2 px-5 pb-1">
          {chips.map((c) => (
            <button key={c.id} onClick={() => setSelected(selected === c.id ? null : c.id)} className={cx("tactile flex h-12 shrink-0 flex-col justify-center rounded-[12px] border px-3.5 text-left", selected === c.id ? "border-ink bg-ink text-white" : "border-black/15")}>
              <span className="text-[15px] font-semibold leading-5">{c.name}</span>
              <span className={cx("text-[12px]", selected === c.id ? "text-white/70" : "text-ink-2")}>Khata {formatRs(c.balance_paisa)}</span>
            </button>
          ))}
          <InlineAddCustomer defaultName={proposal.customer.mention ?? ""} onCreated={(id) => setSelected(id)} />
        </div>
        {chips.length === 0 && !selected && (
          <p className="mt-1.5 text-[12.5px] text-ink-2">Abhi koi customer nahi — Wada save karne ke liye “+ New” par tap karein.</p>
        )}
        <div className="section-label mb-2 mt-4">Kab tak?</div>
        <div className="grid grid-cols-2 gap-2">
          {dates.map((o) => (
            <button key={o.date} onClick={() => setDate(o.date)} className={cx("tactile min-h-12 rounded-[12px] border px-3 py-1.5 text-left", date === o.date ? "border-ink bg-ink text-white" : "border-black/15")}>
              <span className="block text-[14px] font-semibold">{wadaLabel(o.date)}</span>
              <span className={cx("text-[12px]", date === o.date ? "text-white/70" : "text-ink-2")}>{o.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-[18px] text-ink-2">Dukaandar ka darj kiya wada alag dikhta hai — gahak ki apni tasdeeq sirf unke link se hoti hai.</p>
        {err && <div className="mt-3 rounded-[12px] bg-udhaar-bg px-3 py-2 text-[14px] text-udhaar-ink">{err}</div>}
      </div>
      <div className="sticky bottom-0 mt-4 flex gap-3 bg-surface px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <SecondaryButton onClick={onClose} className="w-[92px]">Cancel</SecondaryButton>
        <PrimaryButton onClick={save} busy={busy} disabled={!selected} className="flex-1">
          Wada save karein
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── item return / exchange (wapasi) ───────────────────────────── */

export function ReturnSheet({ customerId, onClose }: { customerId?: string | null; onClose: () => void }) {
  const { state, refresh, toast } = useDukaan();
  const products = state?.products ?? [];
  const customers = state?.customers ?? [];
  const [prodId, setProdId] = useState<string>(products[0]?.id ?? "");
  const [qtyText, setQtyText] = useState("1");
  const [custId, setCustId] = useState<string>(customerId ?? "");
  const [mode, setMode] = useState<"cash" | "khata">(customerId ? "khata" : "cash");
  const [reason, setReason] = useState("item-wapasi");
  const [busy, setBusy] = useState(false);

  const prod = products.find((p) => p.id === prodId) ?? null;
  const qtyParsed = parseQuantityPhrase(prod && !/[a-z]/i.test(qtyText) && prod.base_unit !== "pcs" ? `${qtyText} ${prod.base_unit === "g" ? "kg" : "L"}` : qtyText);
  const qtyBase = useMemo(() => {
    if (!prod) return 0;
    if (!qtyParsed.unresolved && qtyParsed.hundredths) {
      const unit = qtyParsed.unit;
      const perUnit = !unit || unit.family === "pack" ? prod.pack_size_base_units : unit.base;
      return Math.max(1, Math.round((qtyParsed.hundredths * perUnit) / 100));
    }
    const n = Number(qtyText);
    return Number.isFinite(n) && n > 0 ? Math.round(n * prod.pack_size_base_units) : 0;
  }, [prod, qtyParsed, qtyText]);

  const refundPaisa = prod && qtyBase > 0 ? Math.round((qtyBase * prod.unit_price_paisa) / prod.pack_size_base_units) : 0;
  const effectiveMode = custId ? mode : "cash";

  const submit = async () => {
    if (!prod || qtyBase <= 0 || refundPaisa <= 0) return;
    setBusy(true);
    try {
      await api<CommitResponse>("/api/transactions/return", {
        json: {
          idempotency_key: newKey("ret"),
          customer_id: custId || null,
          cash_refund_paisa: effectiveMode === "cash" ? refundPaisa : 0,
          reason: reason.trim() || "item-wapasi",
          lines: [{ product_id: prod.id, qty_base_units: qtyBase, refund_paisa: refundPaisa, spoken: prod.name }],
          audit_meta: { channel: "return-sheet" },
        },
      });
      await refresh();
      toast(`Return darj: ${formatRs(refundPaisa)} ✓`, "ok");
      onClose();
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Maal Wapasi · Item Return">
      <div className="space-y-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div>
          <label className="section-label mb-1.5 block">Item</label>
          <select value={prodId} onChange={(e) => setProdId(e.target.value)} className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none">
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatRs(p.unit_price_paisa)})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="section-label mb-1.5 block">Quantity</label>
            <input value={qtyText} onChange={(e) => setQtyText(e.target.value)} placeholder="1 / 500g / 1 kilo" className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
          </div>
          <div>
            <label className="section-label mb-1.5 block">Refund value</label>
            <div className="flex h-12 items-center rounded-[12px] bg-canvas px-3 text-[16px] font-bold text-udhaar num">
              {formatRs(refundPaisa)}
            </div>
          </div>
        </div>
        <div>
          <label className="section-label mb-1.5 block">Customer (optional)</label>
          <select value={custId} onChange={(e) => setCustId(e.target.value)} className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none">
            <option value="">Walk-in (Cash refund)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (Khata {formatRs(c.balance_paisa)})
              </option>
            ))}
          </select>
        </div>
        {custId && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("khata")} className={cx("tactile h-11 rounded-[12px] border text-[13.5px] font-semibold", mode === "khata" ? "border-ink bg-ink text-white" : "border-black/15")}>
              Khata mein kam karein
            </button>
            <button type="button" onClick={() => setMode("cash")} className={cx("tactile h-11 rounded-[12px] border text-[13.5px] font-semibold", mode === "cash" ? "border-ink bg-ink text-white" : "border-black/15")}>
              Cash wapas dein
            </button>
          </div>
        )}
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wajah (e.g. kharab / tabdeel)" className="h-11 w-full rounded-[12px] bg-canvas px-3 text-[14px] outline-none" />
        <div className="flex gap-3 pt-1">
          <SecondaryButton onClick={onClose} className="w-[92px]">Cancel</SecondaryButton>
          <PrimaryButton tone="ink" busy={busy} disabled={!prod || qtyBase <= 0 || refundPaisa <= 0} onClick={() => void submit()} className="flex-1 bg-udhaar">
            <span className="flex items-center justify-center gap-1.5"><RotateCcw size={15} strokeWidth={SW} /> Record Return</span>
          </PrimaryButton>
        </div>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── human-friendly entry detail sheet ───────────────────────────── */

const ENTRY_TYPE_LABEL: Record<string, string> = {
  sale: "Sale Receipt",
  payment: "Wasooli Receipt",
  purchase: "Wholesale Restock",
  reversal: "Reversed Entry",
  return: "Item Return",
  adjustment: "Stock Adjustment",
  writeoff: "Khata Write-off",
};

interface FetchedTxDoc {
  transaction: {
    id: string;
    seq: number;
    type: string;
    total_paisa: number;
    discount_paisa: number;
    entry_hash: string;
    created_at: string;
  };
  reversed_by: string | null;
}

export function EntryDetailSheet({ tx: initialTx, txId, onClose }: { tx?: FeedTx; txId?: string | null; onClose: () => void }) {
  const { state, xrayOn, reverse, openSheet, toast } = useDukaan();
  const [fetched, setFetched] = useState<FetchedTxDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"undo" | "edit" | null>(null);

  const tx = useMemo(
    () => initialTx ?? state?.feed.find((f) => f.id === txId) ?? null,
    [initialTx, state?.feed, txId],
  );

  useEffect(() => {
    if (tx || !txId) return;
    setLoading(true);
    api<FetchedTxDoc>(`/api/shop/xray?id=${txId}`)
      .then(setFetched)
      .catch(() => setFetched(null))
      .finally(() => setLoading(false));
  }, [tx, txId]);

  const txType = tx?.type ?? fetched?.transaction.type ?? "sale";
  const totalPaisa = tx?.total_paisa ?? fetched?.transaction.total_paisa ?? 0;
  const discountPaisa = tx?.discount_paisa ?? fetched?.transaction.discount_paisa ?? 0;
  const createdAt = tx?.created_at ?? fetched?.transaction.created_at ?? null;
  const isReversed = Boolean(tx?.is_reversed || fetched?.reversed_by);
  const isQueuedOffline = Boolean(tx && tx.seq < 0);
  const title = ENTRY_TYPE_LABEL[txType] ?? "Entry Details";
  const party =
    txType === "purchase"
      ? tx?.supplier_name ?? "Wholesale"
      : tx?.customer_name ?? (txType === "adjustment" ? "Store Stock" : "Walk-in Cash");
  const customer = tx?.customer_id ? state?.customers.find((c) => c.id === tx.customer_id) ?? null : null;
  const shopName = state?.shop.name ?? "DukaanOS";

  const canModify = Boolean(tx && tx.seq > 0 && !isReversed && (tx.type === "sale" || tx.type === "payment") && state);

  const waHref = useMemo(() => {
    if (!tx || (tx.type !== "sale" && tx.type !== "payment")) return null;
    const msg =
      tx.type === "payment"
        ? paymentReceiptText({
            shop: shopName,
            customer: party,
            amount_paisa: tx.total_paisa,
            new_balance_paisa: customer?.balance_paisa ?? 0,
            entry_hash: tx.entry_hash,
          })
        : receiptText({
            shop: shopName,
            customer: tx.customer_name ?? undefined,
            lines: tx.lines.map((l) => ({
              name: l.name,
              qty_base_units: l.qty_base_units,
              base_unit: l.base_unit as BaseUnit,
              line_total_paisa: l.line_total_paisa,
            })),
            discount_paisa: tx.discount_paisa,
            total_paisa: tx.total_paisa,
            cash_paid_paisa: tx.cash_paid_paisa,
            credit_paisa: tx.credit_paisa,
            new_balance_paisa: customer?.balance_paisa ?? null,
            entry_hash: tx.entry_hash,
          });
    return waLink(customer?.phone ?? null, msg);
  }, [tx, shopName, party, customer]);

  const handleEdit = async () => {
    if (!tx || !state) return;
    setBusy("edit");
    try {
      await reverse(tx.id, "compensate-edit");
      toast("Purani entry wapas — ab sahi entry save karein", "info");
      if (tx.type === "payment" && tx.customer_id) {
        openSheet({
          type: "payment",
          key: newKey("editpay"),
          trace: null,
          proposal: {
            kind: "payment",
            amount_paisa: tx.total_paisa,
            customer: {
              mention: customer?.name ?? null,
              candidates: customer ? [{ id: customer.id, name: customer.name, role_tag: customer.role_tag ?? null, balance_paisa: customer.balance_paisa, score: 1 }] : [],
              selected_id: tx.customer_id,
              ambiguous: false,
              match_ms: 0,
            },
            new_balance_paisa: customer ? customer.balance_paisa - tx.total_paisa : null,
            tier: 2,
            tier_reasons: [],
          },
        });
      } else {
        const parsed: ParsedTurn = {
          intent: "sale",
          transcript: `Edit #${tx.seq}`,
          customer_mention: tx.customer_name,
          items: tx.lines.map((l) => ({
            spoken: l.name,
            quantity_phrase: formatBaseQty(l.qty_base_units, l.base_unit as BaseUnit),
            value_rupees: l.value_first ? l.line_total_paisa / 100 : null,
            is_loose: false,
            confidence: 1,
          })),
          discount_rupees: tx.discount_paisa > 0 ? tx.discount_paisa / 100 : null,
          cash_paid_rupees: tx.cash_paid_paisa / 100,
          payment_mode: tx.credit_paisa > 0 && tx.cash_paid_paisa > 0 ? "split" : tx.credit_paisa > 0 ? "udhaar" : "cash",
          payment_amount_rupees: null,
          question: null,
          confidence: 1,
        };
        const prop = buildSaleProposal(parsed, { products: state.products, customers: state.customers });
        openSheet({ type: "review", proposal: { ...prop, tier: 2 }, key: newKey("editsale"), trace: null });
      }
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const handleUndo = async () => {
    if (!tx) return;
    setBusy("undo");
    try {
      await reverse(tx.id, "manual-undo");
      toast("Entry wapas ho gayi ✓", "ok");
      onClose();
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="space-y-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        {loading && !tx ? (
          <div className="flex items-center justify-center py-6 text-ink-2">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="surface-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[17px] font-bold">{party}</div>
                  {createdAt && (
                    <div className="text-[12.5px] text-ink-2">
                      {new Date(createdAt).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </div>
                  )}
                </div>
                <Money paisa={Math.abs(totalPaisa)} className={cx("text-[24px] font-bold", isReversed && "line-through opacity-50")} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {isReversed && <Pill tone="udhaar">Undone</Pill>}
                {isQueuedOffline && <Pill tone="amber">Phone par mehfooz (offline)</Pill>}
                {tx?.type === "sale" && tx.cash_paid_paisa > 0 && <Pill tone="cash">Cash {formatRs(tx.cash_paid_paisa)}</Pill>}
                {tx?.type === "sale" && tx.credit_paisa > 0 && <Pill tone="udhaar">Udhaar {formatRs(tx.credit_paisa)}</Pill>}
                {discountPaisa > 0 && <Pill>Chhoot {formatRs(discountPaisa)}</Pill>}
              </div>
            </div>

            {tx && tx.lines.length > 0 && (
              <div className="surface-card overflow-hidden">
                {tx.lines.map((l, idx) => (
                  <div key={idx} className="hairline-b flex items-center justify-between gap-2 px-4 py-3 text-[14.5px] last:border-b-0">
                    <span className="min-w-0 flex-1 font-medium">
                      {formatBaseQty(l.qty_base_units, l.base_unit as BaseUnit)} · {l.name.replace(/\s*\(.*\)/, "")}
                    </span>
                    <span className="num font-semibold">{formatRs(l.line_total_paisa)}</span>
                  </div>
                ))}
              </div>
            )}

            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noreferrer"
                className="tactile flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-cash text-[15px] font-semibold text-white"
              >
                <MessageSquare size={17} strokeWidth={SW} /> WhatsApp Receipt
              </a>
            )}

            {canModify && (
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleEdit()}
                  className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] bg-surface-sunken text-[14px] font-semibold disabled:opacity-50"
                >
                  {busy === "edit" ? <Spinner /> : <Pencil size={15} strokeWidth={SW} />} Edit
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleUndo()}
                  className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] bg-udhaar-bg text-[14px] font-semibold text-udhaar-ink disabled:opacity-50"
                >
                  {busy === "undo" ? <Spinner /> : <RotateCcw size={15} strokeWidth={SW} />} Undo Entry
                </button>
              </div>
            )}

            {xrayOn && (tx?.id ?? txId) && (
              <button
                type="button"
                onClick={() => openSheet({ type: "xray", txId: tx?.id ?? txId })}
                className="tactile flex h-10 w-full items-center justify-center rounded-[12px] border border-black/15 font-mono text-[12.5px] font-semibold text-ink-2"
              >
                {"</>"} Open X-Ray Proof
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

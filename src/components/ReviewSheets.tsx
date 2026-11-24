"use client";

import { Check, ImageDown, MessageSquare, Plus, Trash2, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CommitResponse, FeedTx, TurnTrace } from "@/lib/api/contracts";
import { api, ClientApiError, friendlyError, newKey } from "@/lib/client/api";
import { renderReceiptPng, shareOrDownload } from "@/lib/client/canvas";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { recalcCatalogLine, recalcNewSkuLine, resettle, setLineQty } from "@/lib/domain/bill";
import { describeQty, formatBaseQty, formatUnitPrice, parseQuantityPhrase, type BaseUnit } from "@/lib/domain/desi-units";
import { paymentReceiptText, receiptText, smsLink, waLink } from "@/lib/domain/messages";
import { formatRs, rupeesToPaisa } from "@/lib/domain/money";
import type { CustomerRow, PaymentProposal, ProposalLine, SaleProposal } from "@/lib/domain/types";
import { feedSummary } from "./MunshiTab";
import { cx, Money, Pill, PrimaryButton, SecondaryButton, Sheet, SW } from "./ui";

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
};

/* ───────────────────────────── customer chips ───────────────────────────── */

function CustomerRail({ proposalCustomer, customers, selected, onSelect, required }: {
  proposalCustomer: SaleProposal["customer"];
  customers: CustomerRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  required: boolean;
}) {
  const { toast, refresh } = useDukaan();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(proposalCustomer.mention ?? "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const chips = proposalCustomer.candidates.length
    ? proposalCustomer.candidates.map((c) => customers.find((x) => x.id === c.id) ?? { ...c, aliases: [] })
    : customers.slice(0, 8);

  const add = async () => {
    setBusy(true);
    try {
      const c = await api<{ id: string }>("/api/shop/customer", { json: { name, phone: phone || undefined } });
      await refresh();
      onSelect(c.id);
      setAdding(false);
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 pb-3">
      <div className={cx("section-label mb-2", required && !selected && "text-udhaar-ink")}>
        Match customer {proposalCustomer.candidates.length > 1 ? "(3-Ali disambiguation)" : ""}
        {required && !selected && " · required for udhaar"}
      </div>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
        {chips.map((c) => {
          const on = selected === c.id;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
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
        <button onClick={() => setAdding((a) => !a)} className="tactile flex h-12 shrink-0 items-center gap-1 rounded-[12px] border border-dashed border-black/25 px-3 text-[14px] font-semibold text-ink-2">
          <Plus size={14} strokeWidth={SW} /> New
        </button>
      </div>
      {adding && (
        <div className="mt-2 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam" className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx…" inputMode="tel" className="h-11 w-[120px] rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
          <PrimaryButton onClick={add} busy={busy} disabled={!name.trim()} className="h-11">
            Add
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── line rows ───────────────────────────── */

function NewSkuEditor({ line, onSave }: { line: ProposalLine; onSave: (l: ProposalLine) => void }) {
  const [open, setOpen] = useState(!line.value_first && line.unit_price_paisa <= 0);
  const [price, setPrice] = useState(line.price_known && line.unit_price_paisa ? String(line.unit_price_paisa / 100) : "");
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
    <div className="mt-2 flex items-center gap-1.5 rounded-[10px] border border-dashed border-maal/50 bg-maal-bg p-1.5">
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
          onSave(recalcNewSkuLine({ ...line, base_unit: unit, pack_size_base_units: pack, unit_price_paisa: rupeesToPaisa(Number(price)), price_known: true, confidence: 1 }));
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
  const { state, confirmSale, openSheet } = useDukaan();
  const customers = state?.customers ?? [];
  const [p, setP] = useState<SaleProposal>(initial);
  const [cashText, setCashText] = useState(String(initial.cash_paid_paisa / 100));
  const [discText, setDiscText] = useState(String(initial.discount_paisa / 100));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stockOf = (id: string | null) => (id ? state?.products.find((x) => x.id === id)?.stock_base_units ?? null : null);

  const match = useMemo(() => {
    const scores = p.lines.map((l) => l.match?.score ?? 0).concat(p.customer.candidates.length ? [p.customer.candidates[0].score] : []);
    return Math.round((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)) * 100);
  }, [p]);

  const update = (patch: Parameters<typeof resettle>[2]) => {
    const next = resettle(p, customers, patch);
    setP(next);
    setCashText(String(next.cash_paid_paisa / 100));
    setErr(null);
  };

  const needsCustomer = p.credit_paisa !== 0 && !p.customer.selected_id;
  const priceMissing = p.lines.some((l) => l.kind === "new_sku" && l.line_total_paisa <= 0);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await confirmSale(p, idemKey, trace);
      const phone = customers.find((c) => c.id === p.customer.selected_id)?.phone ?? null;
      openSheet({ type: "receipt", commit: res, proposal: p, customerPhone: phone });
    } catch (e) {
      setErr(e instanceof ClientApiError && e.code === "UDHAAR_REQUIRES_CUSTOMER" ? "Udhaar ke liye customer chunein (UDHAAR_REQUIRES_CUSTOMER)" : friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

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
      <div className="mx-5 mb-3 flex flex-wrap gap-1.5">
        <Pill tone="dark" mono>Tier 2</Pill>
        {p.tier_reasons.map((r) => (
          <Pill key={r} tone={r.startsWith("UDHAAR") || r === "AMBIGUOUS_CUSTOMER" ? "udhaar" : r === "NEW_SKU" ? "maal" : "neutral"}>
            {REASON_LABEL[r] ?? r}
          </Pill>
        ))}
      </div>

      {(p.customer.mention || p.credit_paisa !== 0) && (
        <CustomerRail proposalCustomer={p.customer} customers={customers} selected={p.customer.selected_id} onSelect={(id) => update({ selected_customer_id: id })} required={p.credit_paisa !== 0} />
      )}

      <div className="px-5">
        <div className="section-label mb-2">Items (deterministic math)</div>
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

      <div className="sticky bottom-0 mt-4 flex gap-3 border-t border-black/5 bg-surface px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <SecondaryButton onClick={onClose} className="w-[92px]">
          Cancel
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
  const chips = proposal?.customer.candidates.length ? proposal.customer.candidates.map((c) => customers.find((x) => x.id === c.id)!).filter(Boolean) : customers.filter((c) => c.balance_paisa > 0 || c.id === selected);

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
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {chips.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)} className={cx("tactile flex h-12 shrink-0 flex-col justify-center rounded-[12px] border px-3.5 text-left", selected === c.id ? "border-ink bg-ink text-white" : "border-black/15")}>
              <span className="text-[15px] font-semibold leading-5">{c.name}</span>
              <span className={cx("text-[12px]", selected === c.id ? "text-white/70" : "text-ink-2")}>Khata {formatRs(c.balance_paisa)}</span>
            </button>
          ))}
        </div>
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
  const { reverse, toast } = useDukaan();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Pichli entry wapas?">
      <div className="px-5 pb-4">
        {target ? (
          <div className="surface-card p-4">
            <div className="text-[15px] font-semibold">{target.customer_name ?? target.supplier_name ?? "Walk-in Cash"}</div>
            <div className="text-[13px] text-ink-2">{feedSummary(target)}</div>
            <Money paisa={target.total_paisa} className="mt-2 block text-[22px] font-bold" />
            <div className="mt-2 font-mono text-[11px] text-ink-2">#{target.seq} · {target.entry_hash.slice(0, 12)}…</div>
          </div>
        ) : (
          <div className="text-[15px] text-ink-2">Wapas karne ke liye koi entry nahi.</div>
        )}
        <p className="mt-3 text-[13px] text-ink-2">reverse_transaction mirrors every ledger row and stock movement and appends a new SHA-256 link — history is never deleted.</p>
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
              toast("Entry reversed — Δ = 0, chain extended", "ok");
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
  const { openSheet } = useDukaan();
  return (
    <Sheet open onClose={onClose} title="Munshi ka jawab">
      <div className="px-5 pb-5">
        <div className="mb-3 rounded-[12px] bg-canvas px-3.5 py-2.5 text-[14px] text-ink-2" dir="auto">“{trace.transcript}”</div>
        <p className="text-[18px] font-medium leading-7" dir="auto">{answer || "—"}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill mono>{trace.model}</Pill>
          {tools.map((t, i) => (
            <Pill key={i} tone="maal" mono>
              {t.name} {t.ms}ms
            </Pill>
          ))}
        </div>
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
  const { state, toast, openSheet } = useDukaan();
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
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill tone="cash" mono>Δ = 0 ✓</Pill>
            <Pill mono>#{commit.seq} {commit.entry_hash.slice(0, 10)}…</Pill>
            <Pill mono>{commit.rpc_ms}ms RPC</Pill>
          </div>
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
            });
            const how = await shareOrDownload(png, `raseed-${commit.seq}.png`, text);
            toast(`Receipt PNG ${how} (${Math.round(png.size / 1024)} KB)`, "ok");
          }}
        >
          <ImageDown size={16} strokeWidth={SW} /> PNG
        </button>
      </div>
      <div className="flex gap-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-1">
        <SecondaryButton className="flex-1" onClick={() => openSheet({ type: "xray", txId: commit.transaction_id })}>
          {"</>"} X-Ray
        </SecondaryButton>
        <PrimaryButton className="flex-1" onClick={onClose}>
          Done
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

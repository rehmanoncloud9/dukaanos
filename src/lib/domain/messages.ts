/**
 * Polite bilingual message templates + zero-cost delivery links
 * (wa.me for WhatsApp, sms: for ~29% 2G feature-phone customers).
 */

import { formatBaseQty, type BaseUnit } from "./desi-units";
import { formatRs } from "./money";

/** 0300-1234567 / +92 300 1234567 / 923001234567 → 923001234567 */
export function normalizePkPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0092")) d = d.slice(2);
  if (d.startsWith("03") && d.length === 11) d = "92" + d.slice(1);
  if (d.startsWith("3") && d.length === 10) d = "92" + d;
  return d.length >= 11 ? d : null;
}

export function waLink(phone: string | null | undefined, text: string): string {
  const p = normalizePkPhone(phone);
  const q = `text=${encodeURIComponent(text)}`;
  return p ? `https://wa.me/${p}?${q}` : `https://wa.me/?${q}`;
}

export function smsLink(phone: string | null | undefined, text: string): string {
  const p = normalizePkPhone(phone);
  return `sms:${p ? "+" + p : ""}?body=${encodeURIComponent(text)}`;
}

export function reminderText(opts: { name: string; shop: string; balance_paisa: number; days_overdue?: number | null }): string {
  const amt = formatRs(opts.balance_paisa);
  const ur = `السلام علیکم ${opts.name} صاحب! ${opts.shop} پر آپ کا بقایا ${amt} ہے۔ مہربانی فرما کر سہولت سے ادا کر دیں۔ شکریہ`;
  const roman = `Assalam-o-Alaikum ${opts.name} sahib! ${opts.shop} par aap ka baqaya ${amt} hai${
    opts.days_overdue && opts.days_overdue > 0 ? ` (${opts.days_overdue} din se)` : ""
  }. Meharbani farma kar suhoolat se ada kar dein. Shukriya.`;
  return `${roman}\n\n${ur}`;
}

export interface ReceiptLine {
  name: string;
  qty_base_units: number;
  base_unit: BaseUnit;
  line_total_paisa: number;
}

export function receiptText(opts: {
  shop: string;
  customer?: string | null;
  lines: ReceiptLine[];
  discount_paisa: number;
  total_paisa: number;
  cash_paid_paisa: number;
  credit_paisa: number;
  new_balance_paisa?: number | null;
  entry_hash?: string | null;
}): string {
  const rows = opts.lines.map((l) => `• ${formatBaseQty(l.qty_base_units, l.base_unit)} ${l.name} — ${formatRs(l.line_total_paisa)}`);
  const parts = [
    `${opts.shop} — Raseed / رسید`,
    opts.customer ? `Customer: ${opts.customer}` : null,
    ...rows,
    opts.discount_paisa > 0 ? `Riayat (discount): -${formatRs(opts.discount_paisa)}` : null,
    `Kul bill: ${formatRs(opts.total_paisa)}`,
    `Cash: ${formatRs(opts.cash_paid_paisa)}`,
    opts.credit_paisa !== 0 ? `Khata: ${opts.credit_paisa > 0 ? "+" : ""}${formatRs(opts.credit_paisa)}` : null,
    opts.new_balance_paisa !== undefined && opts.new_balance_paisa !== null ? `Naya baqaya: ${formatRs(opts.new_balance_paisa)}` : null,
    opts.entry_hash ? `Ref: ${opts.entry_hash.slice(0, 8)} (DukaanOS verified)` : null,
    "Shukriya! شکریہ",
  ];
  return parts.filter(Boolean).join("\n");
}

export function paymentReceiptText(opts: { shop: string; customer: string; amount_paisa: number; new_balance_paisa: number; entry_hash?: string | null }): string {
  return [
    `${opts.shop} — Wasooli / وصولی`,
    `${opts.customer} sahib, aap ki ${formatRs(opts.amount_paisa)} ki adaigi mil gayi. Shukriya!`,
    `Naya baqaya: ${formatRs(opts.new_balance_paisa)}`,
    opts.entry_hash ? `Ref: ${opts.entry_hash.slice(0, 8)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface ReorderItem {
  name: string;
  suggested_base_units: number;
  base_unit: BaseUnit;
  pack_size_base_units: number;
  pack_label?: string;
}

export function wholesaleListText(shop: string, items: ReorderItem[]): string {
  const rows = items.map((it, i) => {
    const packs = Math.max(1, Math.ceil(it.suggested_base_units / it.pack_size_base_units));
    const qty =
      it.base_unit === "pcs" || it.pack_size_base_units !== 1000
        ? `${packs} ${it.pack_label ?? (it.base_unit === "pcs" ? "pcs" : "pack")}`
        : formatBaseQty(packs * it.pack_size_base_units, it.base_unit);
    return `${i + 1}. ${it.name} — ${qty}`;
  });
  return [`Assalam-o-Alaikum! ${shop} ka wholesale order:`, ...rows, "Meharbani farma kar aaj bhijwa dein. Shukriya."].join("\n");
}

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

export function eodSummaryText(opts: {
  shop: string;
  cash_sales_paisa: number;
  udhaar_paisa: number;
  wasooli_paisa: number;
  cash_in_galla_paisa: number;
  sales_count: number;
}): string {
  return [
    `${opts.shop} — Aaj Ka Hisaab (${new Date().toLocaleDateString("en-PK", { day: "numeric", month: "short", timeZone: "Asia/Karachi" })})`,
    `Sales: ${opts.sales_count}`,
    `Cash sales: ${formatRs(opts.cash_sales_paisa)}`,
    `Udhaar diya: ${formatRs(opts.udhaar_paisa)}`,
    `Wasooli mili: ${formatRs(opts.wasooli_paisa)}`,
    `Galla mein cash: ${formatRs(opts.cash_in_galla_paisa)}`,
  ].join("\n");
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

/**
 * Mutual Khata message: SELF-CONTAINED (entry + balance are in the text itself, because many
 * customers are on WhatsApp-only bundles that may not open web links). The signed link is a bonus
 * that lets them tap "Haan, sahi hai" / "Ghalat hai" or give a wada (promise) date.
 */
export function mutualKhataText(opts: {
  name: string;
  shop: string;
  balance_paisa: number;
  url: string;
  entry?: { summary: string | null; credit_paisa: number } | null;
  raast_id?: string | null;
}): string {
  const lines: string[] = [`Assalam-o-Alaikum ${opts.name} sahib!`];
  if (opts.entry && opts.entry.credit_paisa > 0) {
    lines.push(`${opts.shop}: aaj ${opts.entry.summary ? `${opts.entry.summary} — ` : ""}${formatRs(opts.entry.credit_paisa)} udhaar likha gaya.`);
  }
  lines.push(`Aap ka kul baqaya: ${formatRs(opts.balance_paisa)}.`);
  if (opts.raast_id) lines.push(`Raast se ada karein: ${opts.raast_id}`);
  lines.push(`Sahi hai? Yahan tasdeeq karein ya wada ki tareekh dein: ${opts.url}`);
  lines.push(`السلام علیکم! آپ کا بقایا ${formatRs(opts.balance_paisa)} ہے۔ تصدیق کے لیے لنک کھولیں۔`);
  return lines.join("\n");
}

/**
 * Script for the Urdu voice-note reminder (Wasooli without asking). Spoken Roman Urdu — Gemini TTS
 * auto-detects language and has no Urdu-script voice — with rupees as plain digits so the voice
 * reads "pandrah sau bees rupay", not "Rs dot". Dignified: no shaming words, always "suhoolat se".
 */
export function voiceReminderScript(opts: { name: string; shop: string; balance_paisa: number; promise_label?: string | null }): string {
  const rupees = Math.round(opts.balance_paisa / 100);
  const wada = opts.promise_label ? ` Aap ne ${opts.promise_label} ka wada kiya tha.` : "";
  return `Assalam-o-Alaikum ${opts.name} sahib. Yeh ${opts.shop} ki taraf se yaad-dihani hai. Aap ka baqaya ${rupees} rupay hai.${wada} Jab suhoolat ho, ada kar dijiye. Bohat shukriya.`;
}

export interface RemindCandidate {
  id: string;
  name: string;
  balance_paisa: number;
  days_overdue: number | null;
  promise_date: string | null;
  promise_state: "open" | "kept" | "broken" | null;
}

/**
 * "Aaj kisko yaad dilana hai" — deterministic ranking: broken wada first, then wada due today or
 * earlier, then the longest overdue; customers with an open future wada are left alone (respect).
 */
export function rankReminders(list: RemindCandidate[], todayIso: string, limit = 3): Array<RemindCandidate & { reason: "wada_broken" | "wada_due" | "overdue" }> {
  const scored = list
    .filter((c) => c.balance_paisa > 0)
    .map((c) => {
      if (c.promise_state === "broken") return { c, reason: "wada_broken" as const, score: 3_000_000 + (c.days_overdue ?? 0) };
      if (c.promise_state === "open" && c.promise_date && c.promise_date <= todayIso) return { c, reason: "wada_due" as const, score: 2_000_000 + (c.days_overdue ?? 0) };
      if (c.promise_state === "open") return null; // waiting on a future promise — don't nag
      if ((c.days_overdue ?? 0) > 7) return { c, reason: "overdue" as const, score: (c.days_overdue ?? 0) * 1000 + Math.min(999, Math.floor(c.balance_paisa / 10000)) };
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => ({ ...x.c, reason: x.reason }));
}

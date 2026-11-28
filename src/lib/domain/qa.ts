/**
 * Deterministic voice/text Q&A over ShopState (Rs. 0 LLM, <2ms).
 * Used both offline in local-turn.ts and as server fallback when the agent model is unavailable.
 */

import { stateToCatalog, type ShopState } from "@/lib/api/contracts";
import { customerEntries, productEntries } from "./bill";
import { formatBaseQty } from "./desi-units";
import { formatRs } from "./money";
import { matchCatalog } from "./pakphone";

function bestTokenMatch(
  question: string,
  entries: ReturnType<typeof customerEntries> | ReturnType<typeof productEntries>,
  minScore: number,
) {
  const direct = matchCatalog(question, entries, 1).results[0];
  if (direct && direct.score >= minScore) return direct;
  const words = question
    .toLowerCase()
    .replace(/[?؟.,!]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  let best = direct;
  for (let i = 0; i < words.length; i++) {
    for (const phrase of [words[i], i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : ""]) {
      if (!phrase) continue;
      const m = matchCatalog(phrase, entries, 1).results[0];
      if (m && (!best || m.score > best.score)) best = m;
    }
  }
  return best && best.score >= minScore ? best : undefined;
}

export function answerQuestionFromState(question: string, state: ShopState): string {
  const q = question.toLowerCase();
  const catalog = stateToCatalog(state);

  // 1. Weekly / monthly / period report queries ("is haftay kitna becha", "mahinay ka munafa")
  if (/\b(hafta|haftay|week|mahina|mahinay|month|report|munafa|profit|fayda)\b|ہفتہ|ہفتے|مہینہ|مہینے|منافع|فائدہ/.test(q)) {
    const days = /\b(mahina|mahinay|month|30)\b|مہینہ|مہینے/.test(q) ? 30 : 7;
    const cutoff = Date.now() - days * 86_400_000;
    const live = state.feed.filter(
      (t) => !t.is_reversed && t.type !== "reversal" && new Date(t.created_at).getTime() >= cutoff,
    );
    const sales = live.filter((t) => t.type === "sale");
    const returns = live.filter((t) => t.type === "return");
    const gross = sales.reduce((s, t) => s + t.total_paisa, 0) - returns.reduce((s, t) => s + t.total_paisa, 0);
    const cash = sales.reduce((s, t) => s + t.cash_paid_paisa, 0) - returns.reduce((s, t) => s + t.cash_paid_paisa, 0);
    const udhaar = sales.reduce((s, t) => s + Math.max(0, t.credit_paisa), 0);
    const wasooli = live.filter((t) => t.type === "payment").reduce((s, t) => s + t.total_paisa, 0);
    if (sales.length === 0 && days === 7) {
      return `پچھلے سات دن میں کوئی فروخت درج نہیں ہوئی۔ آج کا گلہ ${formatRs(state.today.cash_in_galla_paisa)} ہے۔`;
    }
    const label = days === 30 ? "اس مہینے" : "اس ہفتے";
    return `${label} ${sales.length} بلوں میں کل ${formatRs(gross)} کی فروخت ہوئی (${formatRs(cash)} نقد، ${formatRs(udhaar)} ادھار، ${formatRs(wasooli)} وصولی)۔ آج کا اندازاً منافع ${formatRs(state.today.est_margin_paisa)} ہے۔`;
  }

  // 2. Top customers ("ہمارے سب سے زیادہ خریدنے والے گاہک کون ہیں؟", "top customer", "sab se zyada khareedne wale gahak")
  if ((/\b(gahak|customer|customers|log)\b|گاہک|کھاتے/.test(q)) && (/\b(zyada|top|best|bada|bare|khareed)\b|زیادہ|بڑے|خریدنے/.test(q))) {
    const spendByCustomer = new Map<string, { name: string; spent: number; count: number; balance: number }>();
    for (const c of state.customers) {
      spendByCustomer.set(c.id, { name: c.name, spent: 0, count: 0, balance: c.balance_paisa });
    }
    for (const tx of state.feed) {
      if (tx.type !== "sale" || tx.is_reversed || !tx.customer_id) continue;
      const cur = spendByCustomer.get(tx.customer_id) ?? {
        name: tx.customer_name ?? "گاہک",
        spent: 0,
        count: 0,
        balance: 0,
      };
      cur.spent += tx.total_paisa;
      cur.count += 1;
      spendByCustomer.set(tx.customer_id, cur);
    }
    const ranked = Array.from(spendByCustomer.values())
      .sort((a, b) => b.spent - a.spent || b.count - a.count || b.balance - a.balance)
      .filter((c) => c.spent > 0 || c.balance > 0)
      .slice(0, 3);
    if (ranked.length === 0) return "ابھی گاہکوں کی خریداری کا ریکارڈ موجود نہیں ہے۔";
    const list = ranked
      .map((c) => `${c.name} (${c.spent > 0 ? `خریداری ${formatRs(c.spent)}` : `بقایا ${formatRs(c.balance)}`})`)
      .join("، ");
    return `سب سے زیادہ خریدنے والے گاہک: ${list}۔`;
  }

  // 3. Top-selling or slow-moving products ("sab se zyada", "top item", "kya bik raha", "آج سب سے زیادہ کیا بکا؟")
  if (/\b(zyada|top|best|fast|bikne|bikta|bika|slow|kam\s+bik)\b|زیادہ کیا بکا|سب سے زیادہ|کم فروخت/.test(q)) {
    const slow = /\b(slow|kam\s+bik|ruk)\b|کم فروخت|رکا/.test(q);
    const sorted = state.products
      .slice()
      .sort((a, b) => (slow ? a.sold_7d - b.sold_7d : b.sold_7d - a.sold_7d))
      .slice(0, 3);
    if (sorted.length > 0) {
      const list = sorted.map((p) => `${p.name_ur || p.name} (${formatBaseQty(p.sold_7d, p.base_unit)})`).join("، ");
      return slow ? `سب سے کم بکنے والا سامان (۷ دن): ${list}۔` : `سب سے زیادہ بکنے والا سامان (۷ دن): ${list}۔`;
    }
  }

  // 4. Customer balance + recent verbal history lookup
  const custMatch = bestTokenMatch(question, customerEntries(catalog.customers), 0.65);
  if (custMatch) {
    const c = state.customers.find((x) => x.id === custMatch.id);
    if (c) {
      const overdue = c.days_overdue ? ` (${c.days_overdue} دن پرانا)` : "";
      const recent = state.feed
        .filter((t) => t.customer_id === c.id && !t.is_reversed && t.type !== "reversal")
        .slice(0, 3)
        .map((t) => {
          const dt = new Date(t.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "short" });
          return t.type === "payment" ? `${dt}: ${formatRs(t.total_paisa)} وصولی` : `${dt}: ${formatRs(t.total_paisa)}`;
        });
      const hist = recent.length > 0 ? ` Pichli entries: ${recent.join(", ")}.` : "";
      return c.balance_paisa > 0
        ? `${c.name} کے ذمے ${formatRs(c.balance_paisa)} ادھار ہے${overdue}۔${hist}`
        : `${c.name} کا کھاتہ بالکل صاف ہے (Rs. 0)۔${hist}`;
    }
  }

  // 5. Today's galla / hisaab ("آج کتنی فروخت ہوئی؟", "آج نقد کتنے پیسے آئے؟", "آج ادھار کتنا ہوا؟")
  if (/\b(aaj|today|galla|kamai|hisaa?b|pulse)\b|آج کتنی فروخت|آج نقد|آج کا حساب|گلہ/.test(q) && !/\b(udhaar|baqaya|baqi)\b|آج ادھار کتنا/.test(q)) {
    return `آج کی کل فروخت ${formatRs(state.today.gross_sales_paisa)} ہے (${state.today.sales_count} بل · ${formatRs(state.today.cash_sales_paisa)} نقد، ${formatRs(state.today.udhaar_paisa)} ادھار)۔ گلے میں ${formatRs(state.today.cash_in_galla_paisa)} اور اندازاً منافع ${formatRs(state.today.est_margin_paisa)} ہے۔`;
  }

  if (/\b(udhaar|khata|balance|baqaya|baqi|baki|wasooli|overdue)\b|ادھار|کھاتہ|بقایا/.test(q)) {
    if (/آج ادھار|aaj\s+udhaar/i.test(q)) {
      return `آج ${formatRs(state.today.udhaar_paisa)} کا نیا ادھار ہوا (${state.today.udhaar_accounts} کھاتوں پر)۔`;
    }
    const debtors = state.customers
      .filter((c) => c.balance_paisa > 0)
      .sort((a, b) => b.balance_paisa - a.balance_paisa);
    if (debtors.length === 0) return "ابھی کسی گاہک پر کوئی ادھار باقی نہیں ہے۔";
    const total = debtors.reduce((s, c) => s + c.balance_paisa, 0);
    const top = debtors.slice(0, 4).map((c) => `${c.name} (${formatRs(c.balance_paisa)})`).join("، ");
    return `کل ${formatRs(total)} ادھار ${debtors.length} کھاتوں پر ہے: ${top}۔`;
  }

  // 6. Product stock / price lookup
  const prodMatch = bestTokenMatch(question, productEntries(catalog.products), 0.6);
  if (prodMatch) {
    const p = state.products.find((x) => x.id === prodMatch.id);
    if (p) {
      const days = p.days_left !== null ? ` · تقریباً ${p.days_left} دن چلے گا` : "";
      const unknownNote = p.is_quick_added ? " (اس چیز کا مال ابھی درج نہیں ہے)" : "";
      return `${p.name_ur || p.name} کا اسٹاک ${formatBaseQty(p.stock_base_units, p.base_unit)} ہے (قیمت ${formatRs(p.unit_price_paisa)})${days}${unknownNote}۔`;
    }
  }

  if (/\b(stock|maal|kam|khatam|inventory|kitna|kitni)\b|اسٹاک|مال|گودام/.test(q)) {
    const low = state.products
      .filter((p) => p.stock_base_units <= 0 || (p.days_left !== null && p.days_left <= 2.5))
      .slice(0, 4);
    if (low.length === 0) return "تمام اشیاء کا اسٹاک مکمل ہے۔";
    return `کم اسٹاک والی اشیاء: ${low.map((p) => `${p.name_ur || p.name} (${formatBaseQty(p.stock_base_units, p.base_unit)})`).join("، ")}۔`;
  }

  return `آج کا گلہ ${formatRs(state.today.cash_in_galla_paisa)} (${state.today.sales_count} فروخت)، اور کل ادھار ${formatRs(state.customers.reduce((s, c) => s + Math.max(0, c.balance_paisa), 0))} ہے۔`;
}

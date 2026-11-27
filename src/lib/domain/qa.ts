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
  if (/\b(hafta|haftay|week|mahina|mahinay|month|report|munafa|profit|fayda)\b/.test(q)) {
    const days = /\b(mahina|mahinay|month|30)\b/.test(q) ? 30 : 7;
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
      return `Pichle 7 din mein koi sale record nahi hui. Aaj ka galla ${formatRs(state.today.cash_in_galla_paisa)} hai.`;
    }
    const label = days === 30 ? "Is mahinay" : "Is haftay";
    return `${label} ${sales.length} sales mein kul ${formatRs(gross)} ki bikri hui (${formatRs(cash)} cash, ${formatRs(udhaar)} udhaar, ${formatRs(wasooli)} wasooli). Aaj ka munafa ${formatRs(state.today.est_margin_paisa)} hai.`;
  }

  // 2. Top-selling or slow-moving products ("sab se zyada", "top item", "kya bik raha")
  if (/\b(zyada|top|best|fast|bikne|bikta|slow|kam\s+bik)\b/.test(q)) {
    const slow = /\b(slow|kam\s+bik|ruk)\b/.test(q);
    const sorted = state.products
      .slice()
      .sort((a, b) => (slow ? a.sold_7d - b.sold_7d : b.sold_7d - a.sold_7d))
      .slice(0, 3);
    if (sorted.length > 0) {
      const list = sorted.map((p) => `${p.name} (${formatBaseQty(p.sold_7d, p.base_unit)})`).join(", ");
      return slow ? `Sab se kam bikne wale items (7d): ${list}.` : `Sab se zyada bikne wale items (7d): ${list}.`;
    }
  }

  // 3. Today's galla / hisaab
  if (/\b(aaj|today|galla|kamai|hisaa?b|pulse)\b/.test(q) && !/\b(udhaar|baqaya|baqi)\b/.test(q)) {
    return `Aaj ki kul bikri ${formatRs(state.today.gross_sales_paisa)} hai (${state.today.sales_count} sales · ${formatRs(state.today.cash_sales_paisa)} cash, ${formatRs(state.today.udhaar_paisa)} udhaar). Galla mein ${formatRs(state.today.cash_in_galla_paisa)} aur munafa ${formatRs(state.today.est_margin_paisa)} hai.`;
  }

  // 4. Customer balance lookup
  const custMatch = bestTokenMatch(question, customerEntries(catalog.customers), 0.65);
  if (custMatch) {
    const c = state.customers.find((x) => x.id === custMatch.id);
    if (c) {
      const overdue = c.days_overdue ? ` (${c.days_overdue} din purana)` : "";
      return c.balance_paisa > 0
        ? `${c.name} ke zimme ${formatRs(c.balance_paisa)} udhaar hai${overdue}.`
        : `${c.name} ka khata bilkul saaf hai (Rs. 0).`;
    }
  }

  if (/\b(udhaar|khata|balance|baqaya|baqi|baki|wasooli|overdue)\b/.test(q)) {
    const debtors = state.customers
      .filter((c) => c.balance_paisa > 0)
      .sort((a, b) => b.balance_paisa - a.balance_paisa);
    if (debtors.length === 0) return "Abhi kisi customer par koi udhaar nahi hai.";
    const total = debtors.reduce((s, c) => s + c.balance_paisa, 0);
    const top = debtors.slice(0, 4).map((c) => `${c.name} (${formatRs(c.balance_paisa)})`).join(", ");
    return `Kul ${formatRs(total)} udhaar ${debtors.length} logon par hai: ${top}.`;
  }

  // 5. Product stock / price lookup
  const prodMatch = bestTokenMatch(question, productEntries(catalog.products), 0.6);
  if (prodMatch) {
    const p = state.products.find((x) => x.id === prodMatch.id);
    if (p) {
      const days = p.days_left !== null ? ` · taqreeban ${p.days_left} din chalega` : "";
      return `${p.name} ka stock ${formatBaseQty(p.stock_base_units, p.base_unit)} hai (sell ${formatRs(p.unit_price_paisa)})${days}.`;
    }
  }

  if (/\b(stock|maal|kam|khatam|inventory|kitna|kitni)\b/.test(q)) {
    const low = state.products
      .filter((p) => p.stock_base_units <= 0 || (p.days_left !== null && p.days_left <= 2.5))
      .slice(0, 4);
    if (low.length === 0) return "Tamam items ka stock theek hai.";
    return `Kam stock items: ${low.map((p) => `${p.name} (${formatBaseQty(p.stock_base_units, p.base_unit)})`).join(", ")}.`;
  }

  return `Aaj ka galla ${formatRs(state.today.cash_in_galla_paisa)} (${state.today.sales_count} sales), aur kul udhaar ${formatRs(state.customers.reduce((s, c) => s + Math.max(0, c.balance_paisa), 0))} hai.`;
}

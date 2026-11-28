/**
 * Predictive Mandi & Dead-Stock Radar ("آج کی صلاح" / Aaj Ki Salah).
 * Runs local velocity & capital-tie-up analytics across the catalog to produce
 * a short spoken Urdu morning briefing.
 */

import type { ShopState, StateProduct } from "@/lib/api/contracts";
import { mulDiv } from "./money";

export interface StockoutCandidate {
  product: StateProduct;
  daysLeft: number;
  dailyProfitAtRiskPaisa: number;
  suggestedPacks: number;
}

export interface DeadStockCandidate {
  product: StateProduct;
  daysUnsold: number;
  tiedCapitalPaisa: number;
}

export interface AajKiSalahReport {
  daysUntilFriday: number;
  fridayStockouts: StockoutCandidate[];
  deadStock: DeadStockCandidate[];
  overdueCount: number;
  overdueTotalPaisa: number;
  briefingUrdu: string;
}

export function getDaysUntilFridayPkt(now = new Date()): number {
  const pktDayStr = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Karachi",
  }).format(now);
  const map: Record<string, number> = { Sun: 5, Mon: 4, Tue: 3, Wed: 2, Thu: 1, Fri: 7, Sat: 6 };
  return map[pktDayStr] ?? 3;
}

export function computeAajKiSalah(state: ShopState, now = new Date()): AajKiSalahReport {
  const daysUntilFriday = getDaysUntilFridayPkt(now);
  const thresholdDays = Math.max(2, daysUntilFriday);

  // Map last sale timestamp per product from local feed
  const lastSaleAt = new Map<string, number>();
  for (const tx of state.feed) {
    if (tx.type !== "sale" || tx.is_reversed) continue;
    const ts = Date.parse(tx.created_at);
    if (!Number.isFinite(ts)) continue;
    for (const line of tx.lines) {
      if (!line.product_id) continue;
      const prev = lastSaleAt.get(line.product_id) ?? 0;
      if (ts > prev) lastSaleAt.set(line.product_id, ts);
    }
  }

  const shopStartTs = Date.parse(state.shop.active_since) || now.getTime() - 60 * 86_400_000;
  const nowMs = now.getTime();

  const fridayStockouts: StockoutCandidate[] = [];
  const deadStock: DeadStockCandidate[] = [];

  for (const p of state.products) {
    const pack = Math.max(1, p.pack_size_base_units || 1);
    const cost = p.cost_price_paisa > 0 ? p.cost_price_paisa : mulDiv(p.unit_price_paisa, 70, 100);
    const marginPerPack = Math.max(0, p.unit_price_paisa - cost);

    // 1. High-margin items stocking out before Friday
    if (p.sold_7d > 0) {
      const daysLeft = p.days_left ?? Math.floor(mulDiv(Math.max(0, p.stock_base_units), 7, p.sold_7d));
      if (daysLeft <= thresholdDays) {
        const dailyProfitAtRiskPaisa = mulDiv(marginPerPack, p.sold_7d, 7 * pack);
        fridayStockouts.push({
          product: p,
          daysLeft: Math.max(0, daysLeft),
          dailyProfitAtRiskPaisa,
          suggestedPacks: Math.max(1, Math.ceil(p.sold_7d / pack)),
        });
      }
    } else if (p.stock_base_units > 0) {
      // 2. Dead-stock items sitting unsold for 45+ days
      const storedSaleTs = p.last_sold_at ? Date.parse(p.last_sold_at) : Number.NaN;
      const fallbackSaleTs = lastSaleAt.get(p.id);
      const createdTs = p.created_at ? Date.parse(p.created_at) : Number.NaN;
      const lastTs = Number.isFinite(storedSaleTs)
        ? storedSaleTs
        : fallbackSaleTs ?? (Number.isFinite(createdTs) ? createdTs : state.feed.length < 60 ? shopStartTs : null);
      const daysUnsold = lastTs === null ? 0 : Math.floor((nowMs - lastTs) / 86_400_000);
      if (lastTs !== null && daysUnsold >= 45) {
        const tiedCapitalPaisa = mulDiv(p.stock_base_units, cost, pack);
        if (tiedCapitalPaisa > 0) {
          deadStock.push({ product: p, daysUnsold, tiedCapitalPaisa });
        }
      }
    }
  }

  fridayStockouts.sort((a, b) => b.dailyProfitAtRiskPaisa - a.dailyProfitAtRiskPaisa || a.daysLeft - b.daysLeft);
  deadStock.sort((a, b) => b.tiedCapitalPaisa - a.tiedCapitalPaisa);

  const topStockouts = fridayStockouts.slice(0, 5);
  const topDead = deadStock.slice(0, 5);

  const overdue = state.customers.filter((c) => c.balance_paisa > 0 && (c.days_overdue ?? 0) >= 15);
  const overdueTotalPaisa = overdue.reduce((s, c) => s + c.balance_paisa, 0);

  const parts: string[] = ["السلام علیکم! آج کی صلاح سنیں۔"];
  if (topStockouts.length > 0) {
    const names = topStockouts
      .slice(0, 2)
      .map((s) => (s.product.name_ur || s.product.name).replace(/\s*\(.*\)/, ""))
      .join(" اور ");
    parts.push(`جمعہ سے پہلے ${names} ختم ہو سکتے ہیں، آج منڈی سے منگوا لیں۔`);
  }
  if (topDead.length > 0) {
    const deadName = (topDead[0].product.name_ur || topDead[0].product.name).replace(/\s*\(.*\)/, "");
    parts.push(`${deadName} پینتالیس دن سے رکا ہوا ہے، اس پر رعایت دے کر کیش نکالیں۔`);
  }
  if (overdue.length > 0) {
    parts.push(`${overdue.length} گاہکوں پر ${Math.round(overdueTotalPaisa / 100)} روپے ادھار پرانا ہے، واٹس ایپ پر یاددہانی بھیجیں۔`);
  }
  if (topStockouts.length === 0 && topDead.length === 0 && overdue.length === 0) {
    parts.push("ماشاءاللہ آج گودام اور کھاتہ دونوں مکمل ہیں، کاروبار اچھا چل رہا ہے۔");
  }

  return {
    daysUntilFriday,
    fridayStockouts: topStockouts,
    deadStock: topDead,
    overdueCount: overdue.length,
    overdueTotalPaisa,
    briefingUrdu: parts.join(" "),
  };
}

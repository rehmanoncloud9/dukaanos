"use client";

import { useEffect, useState } from "react";
import { api, friendlyError } from "@/lib/client/api";
import { useDukaan } from "@/lib/client/store";
import { formatBaseQty, type BaseUnit } from "@/lib/domain/desi-units";
import { formatRs } from "@/lib/domain/money";
import { Money, Pill, Segmented, Sheet, Spinner } from "./ui";

interface InsightsDoc {
  period_days: number;
  summary: {
    gross_sales_paisa: number;
    returns_paisa: number;
    discounts_paisa: number;
    net_revenue_paisa: number;
    cogs_paisa: number;
    gross_profit_paisa: number;
    cash_sales_paisa: number;
    credit_sales_paisa: number;
    wasooli_paisa: number;
    purchases_paisa: number;
    wastage_paisa: number;
    writeoff_paisa: number;
    sales_count: number;
  };
  daily: Array<{ day: string; sales_paisa: number; cash_in_paisa: number; sales_count: number }>;
  top_customers: Array<{ id: string; name: string; role_tag: string | null; balance_paisa: number; spent_paisa: number; visits: number }>;
  top_products: Array<{ product_id: string; name: string; base_unit: BaseUnit; qty: number; revenue_paisa: number; profit_paisa: number }>;
  slow_products: Array<{ id: string; name: string; base_unit: BaseUnit; stock_base_units: number; unit_price_paisa: number; sold_qty: number }>;
  sql_ms: number;
}

export function InsightsSheet({ onClose }: { onClose: () => void }) {
  const { xrayOn, lang } = useDukaan();
  const [days, setDays] = useState<"1" | "7" | "30">("7");
  const [doc, setDoc] = useState<InsightsDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    api<InsightsDoc>(`/api/shop/insights?days=${days}`)
      .then(setDoc)
      .catch((e) => setErr(friendlyError(e)));
  }, [days]);

  const s = doc?.summary;
  const marginPct = s && s.net_revenue_paisa > 0 ? Math.round((s.gross_profit_paisa / s.net_revenue_paisa) * 100) : 0;
  const maxDay = doc?.daily.reduce((m, d) => Math.max(m, d.sales_paisa), 1) ?? 1;

  return (
    <Sheet
      open
      onClose={onClose}
      title={lang === "ur" ? "منافع اور حساب" : "Munafa & Hisaab"}
      right={doc && xrayOn ? <Pill tone="cash" mono>SQL {doc.sql_ms}ms · Rs. 0</Pill> : undefined}
    >
      <div className="space-y-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <Segmented<"1" | "7" | "30">
          value={days}
          onChange={setDays}
          options={[
            { value: "1", label: lang === "ur" ? "آج" : "Aaj (1D)" },
            { value: "7", label: lang === "ur" ? "۷ دن" : "Hafta (7D)" },
            { value: "30", label: lang === "ur" ? "۳۰ دن" : "Mahina (30D)" },
          ]}
        />

        {err && <div className="rounded-[12px] bg-udhaar-bg px-3 py-2 text-[13.5px] text-udhaar-ink">{err}</div>}
        {!doc && !err && (
          <div className="flex items-center justify-center py-10 text-ink-2">
            <Spinner />
          </div>
        )}

        {doc && s && (
          <>
            <div className="surface-card p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="section-label" dir="auto">{lang === "ur" ? `کل فروخت (${days} دن)` : `Kul bikri (${days}D)`}</div>
                  <Money paisa={s.net_revenue_paisa} className="mt-1 block text-[28px] font-bold tracking-[-0.02em]" />
                </div>
                <div className="text-right">
                  <div className="section-label" dir="auto">{lang === "ur" ? "منافع" : "Munafa (Profit)"}</div>
                  <Money paisa={s.gross_profit_paisa} className="mt-1 block text-[20px] font-bold text-cash" />
                  <div className="num text-[12px] text-ink-2" dir="auto">{marginPct}% {lang === "ur" ? "منافع" : "margin"}</div>
                </div>
              </div>
              <div className="hairline-t mt-3 grid grid-cols-3 gap-2 pt-3 text-[12.5px]">
                <div>
                  <span className="text-ink-2" dir="auto">{lang === "ur" ? "نقد" : "Cash"}</span>
                  <b className="num block text-[14px] text-cash">{formatRs(s.cash_sales_paisa)}</b>
                </div>
                <div>
                  <span className="text-ink-2" dir="auto">{lang === "ur" ? "ادھار" : "Udhaar"}</span>
                  <b className="num block text-[14px] text-udhaar">{formatRs(s.credit_sales_paisa)}</b>
                </div>
                <div>
                  <span className="text-ink-2" dir="auto">{lang === "ur" ? "وصولی" : "Wasooli"}</span>
                  <b className="num block text-[14px] text-ink">{formatRs(s.wasooli_paisa)}</b>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] text-ink-2 num">
                <div>Laagat: {formatRs(s.cogs_paisa)}</div>
                <div>Wapasi: {formatRs(s.returns_paisa)}</div>
                <div>Khareedari: {formatRs(s.purchases_paisa)}</div>
              </div>
              {(s.wastage_paisa > 0 || s.writeoff_paisa > 0) && (
                <div className="mt-1.5 flex gap-3 text-[12px] text-udhaar-ink num">
                  {s.wastage_paisa > 0 && <span>Adjustments: {formatRs(s.wastage_paisa)}</span>}
                  {s.writeoff_paisa > 0 && <span>Write-offs: {formatRs(s.writeoff_paisa)}</span>}
                </div>
              )}
            </div>

            {doc.daily.length > 0 && (
              <div className="surface-card p-4">
                <div className="section-label mb-2.5">Daily sales trend</div>
                <div className="flex h-20 items-end gap-1.5">
                  {doc.daily.slice(-14).map((d) => {
                    const h = Math.max(6, Math.round((d.sales_paisa / maxDay) * 100));
                    return (
                      <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${formatRs(d.sales_paisa)}`}>
                        <div className="w-full rounded-t-[4px] bg-cash" style={{ height: `${h}%` }} />
                        <span className="font-mono text-[9.5px] text-ink-3">{d.day.slice(8)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="surface-card overflow-hidden">
              <div className="px-4 pb-1 pt-3 text-[14px] font-semibold">Top selling items</div>
              {doc.top_products.length === 0 && <div className="px-4 pb-3 text-[13px] text-ink-2">No sales in period</div>}
              {doc.top_products.map((p) => (
                <div key={p.product_id} className="hairline-t flex items-center justify-between px-4 py-2.5 text-[13.5px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-[12px] text-ink-2">{formatBaseQty(p.qty, p.base_unit)} sold</div>
                  </div>
                  <div className="text-right num">
                    <div className="font-semibold">{formatRs(p.revenue_paisa)}</div>
                    <div className="text-[11.5px] text-cash">+{formatRs(p.profit_paisa)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="surface-card overflow-hidden">
                <div className="px-4 pb-1 pt-3 text-[14px] font-semibold">Top customers</div>
                {doc.top_customers.length === 0 && <div className="px-4 pb-3 text-[13px] text-ink-2">No customer activity</div>}
                {doc.top_customers.map((c) => (
                  <div key={c.id} className="hairline-t flex items-center justify-between px-4 py-2.5 text-[13.5px]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.name}</div>
                      <div className="text-[12px] text-ink-2">{c.visits} orders · bal {formatRs(c.balance_paisa)}</div>
                    </div>
                    <span className="num font-semibold">{formatRs(c.spent_paisa)}</span>
                  </div>
                ))}
              </div>

              <div className="surface-card overflow-hidden">
                <div className="px-4 pb-1 pt-3 text-[14px] font-semibold">Slow-moving stock</div>
                {doc.slow_products.length === 0 && <div className="px-4 pb-3 text-[13px] text-ink-2">All stocked items moving</div>}
                {doc.slow_products.map((p) => (
                  <div key={p.id} className="hairline-t flex items-center justify-between px-4 py-2.5 text-[13.5px]">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="num text-[12.5px] text-ink-2">
                      {formatBaseQty(p.stock_base_units, p.base_unit)} left · {formatBaseQty(p.sold_qty, p.base_unit)} sold
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

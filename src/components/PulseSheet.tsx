"use client";

import { MessageSquare, TrendingDown, Volume2 } from "lucide-react";
import type { Pulse } from "@/lib/api/contracts";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { reminderText, smsLink, waLink, wholesaleListText } from "@/lib/domain/messages";
import { formatRs } from "@/lib/domain/money";
import { computeReorderForecast } from "@/lib/domain/forecast";
import { Money, Pill, Sheet, SW } from "./ui";
import { PriceMemoryCard } from "./PriceMemory";

export function pulseSpeech(p: Pulse): string {
  return [
    `آج گلے میں ${Math.round(p.galla.cash_in_galla_paisa / 100)} روپے ہیں۔`,
    `کل ${p.galla.sales_count} فروخت، اور ادھار ${Math.round(p.galla.udhaar_paisa / 100)} روپے ہے۔`,
    p.overdue.count ? `${p.overdue.count} گاہکوں کا ${Math.round(p.overdue.total_paisa / 100)} روپے پندرہ دن سے زیادہ رکا ہوا ہے۔` : "کوئی پرانا ادھار باقی نہیں۔",
    p.stockout.count ? `${p.stockout.items.map((s) => s.name.replace(/\s*\(.*\)/, "")).join(" اور ")} دو دن میں ختم ہو سکتے ہیں۔` : "",
  ].filter(Boolean).join(" ");
}

export function PulseSheet({ pulse, onClose }: { pulse: Pulse; onClose: () => void }) {
  const { state, xrayOn, helperMode } = useDukaan();
  const shop = state?.shop.name ?? "DukaanOS";
  const list = wholesaleListText(
    shop,
    pulse.stockout.items.map((s) => ({ name: s.name, suggested_base_units: s.suggested_base_units, base_unit: s.base_unit, pack_size_base_units: s.pack_size_base_units, pack_label: s.pack_size_base_units === 5000 ? "tin" : undefined })),
  );

  // Margin-weighted reorder forecast: pure integer math, Rs. 0 LLM
  const forecast = state ? computeReorderForecast(state.products, state.today.cash_in_galla_paisa) : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Munshi Pulse"
      right={
        xrayOn ? (
          <Pill tone="cash" mono className="h-6">
            SQL {pulse.sql_ms}ms · Rs. 0 LLM
          </Pill>
        ) : (
          <Pill tone="cash" className="h-6">
            Live Hisaab
          </Pill>
        )
      }
    >
      <div className="space-y-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="surface-card p-4">
          <div className="section-label">Cash in galla · today</div>
          <Money paisa={pulse.galla.cash_in_galla_paisa} className="mt-1 block text-[30px] font-bold tracking-[-0.02em]" />
          <div className="mt-2 grid grid-cols-3 gap-2 text-[12.5px] text-ink-2">
            <div>
              Sales <b className="block text-[15px] text-ink num">{formatRs(pulse.galla.cash_sales_paisa)}</b>
            </div>
            <div>
              Udhaar <b className="block text-[15px] text-udhaar num">{formatRs(pulse.galla.udhaar_paisa)}</b>
            </div>
            {!helperMode && (
              <div>
                Est. margin <b className="block text-[15px] text-cash num">{formatRs(pulse.galla.est_margin_paisa)}</b>
              </div>
            )}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <span className="text-[15px] font-semibold">Overdue udhaar (15+ days)</span>
            <Pill tone="udhaar">{formatRs(pulse.overdue.total_paisa)}</Pill>
          </div>
          {pulse.overdue.items.length === 0 && <div className="px-4 pb-3 text-[13px] text-ink-2">Sab saaf hai ✓</div>}
          {pulse.overdue.items.map((o) => {
            const msg = reminderText({ name: o.name, shop, balance_paisa: o.balance_paisa, days_overdue: o.days_overdue });
            return (
              <div key={o.id} className="hairline-t flex items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{o.name}</div>
                  <div className="text-[12.5px] text-ink-2">
                    {o.days_overdue}d overdue · {formatRs(o.balance_paisa)}
                  </div>
                </div>
                <a href={waLink(o.phone, msg)} target="_blank" rel="noreferrer" className="tactile flex h-8 items-center gap-1 rounded-full bg-cash-bg px-3 text-[13px] font-semibold text-cash-ink">
                  <MessageSquare size={13} strokeWidth={SW} /> Remind
                </a>
                <a href={smsLink(o.phone, msg)} className="tactile flex h-8 items-center rounded-full bg-surface-sunken px-3 text-[13px] font-semibold">
                  SMS
                </a>
              </div>
            );
          })}
        </div>

        <div className="surface-card overflow-hidden">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <span className="text-[15px] font-semibold">{xrayOn ? "2-day stockout velocity" : "Kam stock alerts"}</span>
            <Pill tone="maal">{pulse.stockout.count} items</Pill>
          </div>
          {pulse.stockout.items.map((s) => (
            <div key={s.id} className="hairline-t flex items-center justify-between px-4 py-2.5">
              <div>
                <div className="text-[15px] font-medium">{s.name}</div>
                <div className="text-[12.5px] text-ink-2">
                  {formatBaseQty(s.stock_base_units, s.base_unit)} left · ~{formatBaseQty(Math.round(s.daily_avg), s.base_unit)}/day
                </div>
              </div>
              <span className="num text-[15px] font-bold text-udhaar">{s.days_left}d</span>
            </div>
          ))}
          {pulse.stockout.items.length > 0 && (
            <div className="p-3">
              <a href={waLink(null, list)} target="_blank" rel="noreferrer" className="tactile flex h-11 items-center justify-center gap-2 rounded-[12px] bg-maal text-[15px] font-semibold text-white">
                <MessageSquare size={16} strokeWidth={SW} /> Wholesale WhatsApp List
              </a>
            </div>
          )}
        </div>

        {/* Margin-weighted reorder optimizer: pure integer math, Rs. 0 LLM */}
        {forecast && forecast.items.length > 0 && (
          <div className="surface-card overflow-hidden">
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <span className="text-[15px] font-semibold">Reorder Priority</span>
              <Pill tone="amber">
                <TrendingDown size={11} strokeWidth={SW} className="inline mr-1" />
                {formatRs(forecast.total_reorder_cost_paisa)} needed
              </Pill>
            </div>
            <div className="px-4 pb-2 text-[12px] text-ink-2">
              Galla mein: {formatRs(forecast.cash_available_paisa)} · {forecast.affordable_count}/{forecast.items.length} afford kiye ja sakte hain
            </div>
            {forecast.items.map((item) => {
              const canAfford = item.reorder_cost_paisa <= forecast.cash_available_paisa;
              return (
                <div key={item.product_id} className="hairline-t flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium">{item.name}</div>
                    <div className="text-[12px] text-ink-2">
                      {item.days_of_stock === 0 ? "Aaj khatam" : `${item.days_of_stock}d mein khatam`} · Daily profit at risk: {formatRs(item.daily_profit_at_risk_paisa)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`num text-[14px] font-bold ${canAfford ? "text-cash" : "text-udhaar"}`}>{formatRs(item.reorder_cost_paisa)}</div>
                    <div className="text-[11px] text-ink-2">{canAfford ? "✓ afford" : "✗ short"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <PriceMemoryCard />

        <button onClick={() => void speak(pulseSpeech(pulse))} className="tactile flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[15px] font-semibold">
          <Volume2 size={16} strokeWidth={SW} /> سنیں (اردو آواز)
        </button>
      </div>
    </Sheet>
  );
}

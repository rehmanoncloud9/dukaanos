"use client";
/**
 * "آج کی صلاح" (Aaj Ki Salah) — Predictive Mandi & Dead-Stock Radar.
 * Delivers a 15-second spoken Urdu morning briefing across 5,000+ SKUs:
 * high-margin items stocking out before Friday + 45-day dead-stock alerts.
 */

import { Sparkles, TrendingDown, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ShopState } from "@/lib/api/contracts";
import { speak } from "@/lib/client/speak";
import { computeAajKiSalah } from "@/lib/domain/aaj-ki-salah";
import { formatRs } from "@/lib/domain/money";
import { goFilter } from "./MunshiTab";
import { SW } from "./ui";

export function AajKiSalahCard({ state }: { state: ShopState }) {
  const report = useMemo(() => computeAajKiSalah(state), [state]);
  const [expanded, setExpanded] = useState(false);

  return (
    <div dir="rtl" className="surface-card overflow-hidden p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[14px] font-bold text-ink urdu-ui">
            <Sparkles size={15} strokeWidth={SW} className="shrink-0 text-maal" />
            <span>آج کی صلاح (صبح کا خلاصہ)</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-2 urdu-ui">
            {report.fridayStockouts.length > 0
              ? `جمعہ سے پہلے ${report.fridayStockouts.length} منافع بخش اشیاء ختم ہو سکتی ہیں`
              : "گودام کا اسٹاک محفوظ ہے"}
            {report.deadStock.length > 0 ? ` · ${report.deadStock.length} رکا ہوا مال` : ""}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void speak(report.briefingUrdu)}
          className="tactile flex h-14 min-w-[56px] shrink-0 items-center gap-1.5 rounded-[14px] bg-maal px-3.5 text-[13.5px] font-bold text-white urdu-ui"
        >
          <Volume2 size={16} strokeWidth={SW} />
          <span>صلاح سنیں</span>
        </button>
      </div>

      {(report.fridayStockouts.length > 0 || report.deadStock.length > 0) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 text-[12px] font-semibold text-maal urdu-ui"
        >
          {expanded ? "کم تفصیل دیکھیں ▲" : "منڈی اور رکا ہوا مال دیکھیں ▼"}
        </button>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-black/5 pt-3">
          {report.fridayStockouts.slice(0, 3).map((item) => (
            <button
              key={item.product.id}
              type="button"
              onClick={() => goFilter("maal", "low")}
              className="tactile flex w-full items-center justify-between rounded-[12px] bg-amber-bg/60 px-3 py-2 text-right"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-ink urdu-ui">
                  {item.product.name_ur || item.product.name}
                </div>
                <div className="text-[11.5px] text-amber-ink urdu-ui">
                  {item.daysLeft === 0 ? "آج ختم" : `${item.daysLeft} دن باقی`} · منافع خطرے میں: {formatRs(item.dailyProfitAtRiskPaisa)}/دن
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-[11.5px] font-bold text-maal urdu-ui">
                {item.suggestedPacks} منگوائیں
              </span>
            </button>
          ))}

          {report.deadStock.slice(0, 2).map((item) => (
            <div
              key={item.product.id}
              className="flex items-center justify-between rounded-[12px] bg-surface-sunken px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-[13.5px] font-bold text-ink urdu-ui">
                  <TrendingDown size={13} strokeWidth={SW} className="shrink-0 text-udhaar" />
                  <span>{item.product.name_ur || item.product.name}</span>
                </div>
                <div className="text-[11.5px] text-ink-2 urdu-ui">
                  {item.daysUnsold}+ دن سے نہیں بکا · {formatRs(item.tiedCapitalPaisa)} پھنسا ہوا
                </div>
              </div>
              <button
                type="button"
                aria-label="رکے ہوئے مال کی صلاح سنیں"
                onClick={() =>
                  void speak(
                    `${item.product.name_ur || item.product.name} پینتالیس دن سے نہیں بکا، اس پر رعایت دے کر کیش نکالیں۔`,
                  )
                }
                className="tactile grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink"
              >
                <Volume2 size={15} strokeWidth={SW} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

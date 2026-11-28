"use client";

import { Check, ShieldAlert, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api, friendlyError } from "@/lib/client/api";
import { tr } from "@/lib/client/i18n";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { analyzeMargins, type MarginAlert } from "@/lib/domain/margin-shield";
import { formatRs } from "@/lib/domain/money";
import { cx, Pill, Sheet, Spinner, SW } from "./ui";

export function MarginShieldSheet({ onClose }: { onClose: () => void }) {
  const { state, refresh, toast, lang } = useDukaan();
  const [busyId, setBusyId] = useState<string | null>(null);
  const alerts = useMemo(() => (state ? analyzeMargins(state.products) : []), [state]);
  const weeklyPotential = alerts.reduce((s, a) => s + a.weekly_gain_paisa, 0);

  const applyPrice = async (a: MarginAlert) => {
    setBusyId(a.product.id);
    try {
      await api("/api/shop/product", {
        json: { id: a.product.id, unit_price_paisa: a.suggested_price_paisa },
      });
      await refresh();
      toast(
        lang === "ur"
          ? `${a.product.name} کی نئی قیمت ${formatRs(a.suggested_price_paisa)} محفوظ ہو گئی`
          : `${a.product.name} updated to ${formatRs(a.suggested_price_paisa)}`,
        "ok",
      );
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusyId(null);
    }
  };

  const marginSpeech = () => {
    if (!alerts.length) {
      return "ماشاءاللہ، آپ کی تمام اشیاء پر منافع محفوظ ہے، کوئی نقصان والی قیمت نہیں۔";
    }
    const top = alerts.slice(0, 3).map((a) => {
      const sug = Math.round(a.suggested_price_paisa / 100);
      return a.is_loss
        ? `${a.product.name} نقصان میں بک رہا ہے، نئی قیمت ${sug} روپے رکھیں`
        : `${a.product.name} پر منافع صرف ${a.margin_pct} فیصد ہے، قیمت ${sug} روپے کر دیں`;
    });
    return `خبردار! ${alerts.length} اشیاء پر منافع کم ہے۔ ${top.join("۔ ")}۔`;
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={tr("marginShield", lang)}
      right={
        <button
          type="button"
          onClick={() => void speak(marginSpeech())}
          className="tactile inline-flex h-8 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold text-ink"
        >
          <Volume2 size={13} strokeWidth={SW} /> {tr("listen", lang)}
        </button>
      }
    >
      <div className="space-y-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        {alerts.length === 0 ? (
          <div className="surface-card flex items-center gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cash-bg text-cash-ink">
              <Check size={18} strokeWidth={2} />
            </span>
            <div>
              <div className="text-[15px] font-semibold" dir="auto">
                {lang === "ur" ? "تمام قیمتیں محفوظ ہیں" : "All margins healthy"}
              </div>
              <div className="text-[13px] text-ink-2" dir="auto">
                {lang === "ur" ? "کوئی سامان نقصان یا کم منافع پر نہیں بک رہا" : "No items selling at a loss or below 5% margin"}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="surface-card flex items-center justify-between p-4">
              <div>
                <div className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">
                  {lang === "ur" ? "خطرے میں اشیاء" : "At-risk items"}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[22px] font-bold text-udhaar">
                  <ShieldAlert size={18} strokeWidth={SW} />
                  <span>{alerts.length}</span>
                </div>
              </div>
              {weeklyPotential > 0 && (
                <div className="text-right">
                  <div className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">
                    {lang === "ur" ? "ہفتہ وار بچت" : "Est. weekly save"}
                  </div>
                  <div className="num mt-1 text-[20px] font-bold text-cash">+{formatRs(weeklyPotential)}</div>
                </div>
              )}
            </div>

            <div className="surface-card overflow-hidden">
              {alerts.map((a) => (
                <div key={a.product.id} className="hairline-b flex items-center gap-3 px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">{a.product.name}</span>
                      <Pill tone={a.is_loss ? "udhaar" : "neutral"}>
                        {a.is_loss ? (lang === "ur" ? "نقصان" : "Loss") : `${a.margin_pct}%`}
                      </Pill>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-ink-2" dir="auto">
                      {lang === "ur"
                        ? `خرید ${formatRs(a.product.cost_price_paisa)} · فروخت ${formatRs(a.product.unit_price_paisa)}`
                        : `Cost ${formatRs(a.product.cost_price_paisa)} · Price ${formatRs(a.product.unit_price_paisa)}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void applyPrice(a)}
                    className="tactile flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-cash px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
                  >
                    {busyId === a.product.id ? <Spinner className="h-3.5 w-3.5" /> : null}
                    {lang === "ur" ? `${formatRs(a.suggested_price_paisa)} کریں` : `Set ${formatRs(a.suggested_price_paisa)}`}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

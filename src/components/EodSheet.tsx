"use client";

import { Check, MessageSquare, Volume2 } from "lucide-react";
import { useState } from "react";
import { tr } from "@/lib/client/i18n";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { eodSummaryText, waLink } from "@/lib/domain/messages";
import { formatRs, rupeesToPaisa } from "@/lib/domain/money";
import { cx, Money, PrimaryButton, Sheet, SW } from "./ui";

export function EodSheet({ onClose }: { onClose: () => void }) {
  const { state, lang } = useDukaan();
  const [actualCash, setActualCash] = useState("");
  if (!state) return null;

  const t = state.today;
  const expected = t.cash_in_galla_paisa;
  const hasCount = actualCash.trim().length > 0;
  const actualPaisa = rupeesToPaisa(Number(actualCash || 0));
  const diff = actualPaisa - expected;

  const eodUrduSpeech = () => {
    const expRs = Math.round(expected / 100);
    const salesRs = Math.round(t.gross_sales_paisa / 100);
    const udhaarRs = Math.round(t.udhaar_paisa / 100);
    const wasooliRs = Math.round(t.wasooli_paisa / 100);
    return `آج دکان کا کل کاروبار ${salesRs} روپے رہا۔ نقد گلے میں ${expRs} روپے ہونے چاہئیں، ادھار ${udhaarRs} روپے اور وصولی ${wasooliRs} روپے ہوئی۔`;
  };

  const baseSummary = eodSummaryText({
    shop: state.shop.name,
    cash_sales_paisa: t.cash_sales_paisa,
    udhaar_paisa: t.udhaar_paisa,
    wasooli_paisa: t.wasooli_paisa,
    cash_in_galla_paisa: expected,
    sales_count: t.sales_count,
  });
  const waUrl = waLink(
    state.shop.phone,
    hasCount
      ? `${baseSummary}\nActual galla: ${formatRs(actualPaisa)} (${diff === 0 ? "Barabar" : `${diff > 0 ? "+" : "-"}${formatRs(Math.abs(diff))}`})`
      : baseSummary,
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={tr("closeDay", lang)}
      right={
        <button
          type="button"
          onClick={() => void speak(eodUrduSpeech())}
          className="tactile inline-flex h-8 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[12px] font-semibold text-ink"
        >
          <Volume2 size={13} strokeWidth={SW} /> {tr("listen", lang)}
        </button>
      }
    >
      <div className="space-y-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="surface-card p-4">
          <div className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">
            {lang === "ur" ? "گلے میں متوقع نقد رقم" : "Expected Cash in Galla"}
          </div>
          <Money paisa={expected} className="mt-1 block text-[30px] font-bold tracking-[-0.02em] text-cash" />
          <div className="hairline-t mt-3 grid grid-cols-2 gap-2.5 pt-3 text-[13px]">
            <div>
              <span className="text-ink-2" dir="auto">{tr("todayCash", lang)}</span>
              <b className="num block text-[14.5px]">{formatRs(t.cash_sales_paisa)}</b>
            </div>
            <div>
              <span className="text-ink-2" dir="auto">{tr("wasooli", lang)}</span>
              <b className="num block text-[14.5px] text-cash">{formatRs(t.wasooli_paisa)}</b>
            </div>
            <div>
              <span className="text-ink-2" dir="auto">{tr("todayUdhaar", lang)}</span>
              <b className="num block text-[14.5px] text-udhaar">{formatRs(t.udhaar_paisa)}</b>
            </div>
            <div>
              <span className="text-ink-2" dir="auto">{lang === "ur" ? "اندازاً منافع" : "Est. Margin"}</span>
              <b className="num block text-[14.5px] text-cash">{formatRs(t.est_margin_paisa)}</b>
            </div>
          </div>
        </div>

        <div className="surface-card p-4">
          <label className={cx("section-label block", lang === "ur" && "urdu-ui")} dir="auto">
            {lang === "ur" ? "گلے کی اصل گنتی (اختیاری)" : "Actual Cash Count (optional)"}
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={actualCash}
            onChange={(e) => setActualCash(e.target.value)}
            placeholder={String(Math.round(expected / 100))}
            className="num mt-2 h-11 w-full rounded-[12px] border border-black/10 bg-canvas px-3 text-[16px] font-semibold outline-none focus:border-ink"
          />
          {hasCount && (
            <div className={cx("mt-2 flex items-center gap-1.5 text-[13.5px] font-semibold", diff === 0 ? "text-cash" : "text-udhaar")}>
              {diff === 0 && <Check size={14} strokeWidth={2} />}
              {diff === 0
                ? (lang === "ur" ? "حساب بالکل برابر ہے" : "Galla matches exactly")
                : `${diff > 0 ? "+" : "-"}${formatRs(Math.abs(diff))} ${lang === "ur" ? (diff > 0 ? "اضافی" : "کم") : (diff > 0 ? "extra" : "short")}`}
            </div>
          )}
        </div>

        <PrimaryButton
          tone="cash"
          onClick={() => window.open(waUrl, "_blank", "noopener,noreferrer")}
          className="flex items-center justify-center gap-2"
        >
          <MessageSquare size={16} strokeWidth={SW} />
          <span dir="auto">{lang === "ur" ? "واٹس ایپ پر آج کا حساب بھیجیں" : "Send Closing Summary on WhatsApp"}</span>
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

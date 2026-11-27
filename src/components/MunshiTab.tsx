"use client";

import { BarChart3, Camera, ChevronDown, ChevronUp, HelpCircle, Keyboard, PauseCircle, Plus, RefreshCw, RotateCcw, SendHorizontal, Volume2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { FeedTx, Pulse, StateProduct } from "@/lib/api/contracts";
import { api, newKey } from "@/lib/client/api";
import { HELD_EVENT, listHeldBills, removeHeldBill, type HeldBill } from "@/lib/client/held-bills";
import { tr } from "@/lib/client/i18n";
import { prefetchSpeak, speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { formatRs } from "@/lib/domain/money";
import type { SaleProposal } from "@/lib/domain/types";
import { MicButton } from "./MicButton";
import { cx, Money, Pill, relTime, Spinner, SW } from "./ui";
export const DEMO_UTTERANCES = [
  "Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein",
  "Ek kilo cheeni aur do sabun cash",
  "2 packet Lays aur adha kilo khand cash",
  "Bilal ne 1500 jama karwaye",
  "Subah ka hisaab batao",
  "Pichli entry wapas kar do",
  "Ali Tailor ka kitna udhaar hai?",
];

export function goFilter(tab: "khata" | "maal", filter: string) {
  window.dispatchEvent(new CustomEvent("dukaan:filter", { detail: { tab, filter } }));
}

export function feedSummary(t: FeedTx, lang: "en" | "ur" = "en"): string {
  if (t.type === "payment") return tr("wasooliReceived", lang);
  if (t.type === "reversal") return lang === "ur" ? `واپسی · ${t.audit_meta?.reversed_type ?? "اندراج"}` : `Undo · ${t.audit_meta?.reversed_type ?? "entry"} reversed`;
  if (t.type === "writeoff") return lang === "ur" ? "معاف / کھاتہ ختم" : "Maaf / Bad-debt write-off";
  if (t.type === "adjustment") {
    const r = String(t.audit_meta?.reason ?? t.supplier_name ?? tr("stockAdjust", lang));
    return `${r} · ${t.lines.map((l) => `${formatBaseQty(l.qty_base_units, l.base_unit)} ${l.name.replace(/\s*\(.*\)/, "")}`).join(", ")}`;
  }
  const items = t.lines.map((l) => (l.value_first ? `${l.name} (Rs. ${l.line_total_paisa / 100})` : `${formatBaseQty(l.qty_base_units, l.base_unit)} ${l.name.replace(/\s*\(.*\)/, "")}`)).join(", ");
  return t.type === "return" ? `${tr("returnItem", lang)} · ${items}` : items;
}

function feedTag(t: FeedTx, lang: "en" | "ur"): string {
  if (t.audit_meta?.pending_sync) return lang === "ur" ? "آف لائن" : "Offline";
  if (t.type === "payment") return tr("wasooli", lang);
  if (t.type === "purchase") return t.credit_paisa > 0 ? `${tr("restockTag", lang)} · ${tr("udhaarTag", lang)}` : tr("restockTag", lang);
  if (t.type === "reversal") return tr("undoneTag", lang);
  if (t.type === "return") return t.credit_paisa > 0 ? `${tr("returnItem", lang)} · ${tr("khata", lang)}` : `${tr("returnItem", lang)} · ${tr("cashTag", lang)}`;
  if (t.type === "adjustment") return tr("stockAdjust", lang);
  if (t.type === "writeoff") return lang === "ur" ? "معاف" : "Maaf";
  if (t.credit_paisa !== 0 && t.cash_paid_paisa > 0) return tr("splitTag", lang);
  if (t.credit_paisa > 0) return tr("udhaarTag", lang);
  return tr("cashTag", lang);
}

export function FeedRow({ t, onOpen, flash }: { t: FeedTx; onOpen: () => void; flash?: boolean }) {
  const { lang } = useDukaan();
  const title = t.type === "purchase" ? t.supplier_name ?? tr("wholesale", lang) : t.type === "reversal" ? tr("reversal", lang) : t.type === "adjustment" ? (t.lines[0]?.name ?? tr("stockAdjust", lang)) : t.customer_name ?? tr("walkInCash", lang);
  const amount = t.type === "sale" ? (t.cash_paid_paisa > 0 ? t.cash_paid_paisa : t.total_paisa) : Math.abs(t.total_paisa);
  const color = t.type === "purchase" ? "text-maal" : t.type === "reversal" || t.type === "adjustment" || t.type === "writeoff" ? "text-ink-3" : t.type === "return" ? "text-udhaar" : t.type === "sale" && t.cash_paid_paisa === 0 ? "text-udhaar" : "text-cash";
  const sign = t.type === "purchase" || t.type === "reversal" || t.type === "return" || t.type === "adjustment" || t.type === "writeoff" ? "-" : "+";
  return (
    <button onClick={onOpen} className={cx("hairline-b flex h-[60px] w-full items-center gap-3 px-4 text-left last:border-b-0", flash && "row-flash", t.is_reversed && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <div className={cx("truncate text-[15px] font-medium leading-5", lang === "ur" && "urdu-ui")} dir="auto">{title}</div>
        <div className="truncate text-[13px] leading-[18px] text-ink-2" dir="auto">
          {relTime(t.created_at)} · {feedSummary(t, lang)}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cx("text-[17px] font-bold leading-5", color, t.is_reversed && "line-through")}>
          {sign}
          <span className="rs-prefix">Rs.</span>
          <span className="num">{(amount / 100).toLocaleString("en-US")}</span>
        </div>
        <div className="text-[12px] leading-4 text-ink-2">{t.is_reversed ? tr("undoneTag", lang) : feedTag(t, lang)}</div>
      </div>
    </button>
  );
}

/**
 * Rush-Hour Quick-Sell Top-4 strip — 1-tap Tier-1 cash sales for the 4 highest-velocity SKUs.
 * <2ms, Rs. 0 LLM, 0 network dependency. Idempotent: each tap fires submitTurn with typed text.
 */
function QuickSellStrip({ products }: { products: StateProduct[] }) {
  const { submitTurn, thinking, lang } = useDukaan();
  // Top 4 by sold_7d descending; skip items with zero stock
  const top4 = [...products]
    .filter((p) => p.stock_base_units > 0 && p.sold_7d > 0)
    .sort((a, b) => b.sold_7d - a.sold_7d)
    .slice(0, 4);

  if (top4.length === 0) return null;

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-2.5">
        <Zap size={12} strokeWidth={SW} className="text-cash" />
        <span className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">{tr("quickSell", lang)}</span>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
        {top4.map((p) => {
          return (
            <button
              key={p.id}
              type="button"
              disabled={thinking}
              onClick={() => void submitTurn({ text: `ek ${p.name} cash` })}
              className="tactile flex shrink-0 flex-col items-start rounded-[12px] border border-black/10 bg-canvas px-3 py-2 text-left disabled:opacity-50"
            >
              <span className="flex items-center gap-1 text-[13.5px] font-semibold leading-5">
                <Plus size={12} strokeWidth={SW + 0.5} />
                {p.name.replace(/\s*\(.*\)/, "").slice(0, 16)}
              </span>
              <span className="num text-[12px] text-ink-2">
                {formatRs(p.unit_price_paisa)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MunshiTab() {
  const { state, shop, shopId, xrayOn, helperMode, openSheet, submitTurn, thinking, toast, highlightTx, refresh, lang } = useDukaan();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [stripOpen, setStripOpen] = useState(false);
  const [moreActions, setMoreActions] = useState(false);
  const [held, setHeld] = useState<HeldBill[]>([]);
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("dukaanos.guide.dismissed") !== "1";
  });
  const [typing, setTypingState] = useState(() =>
    typeof window !== "undefined" && sessionStorage.getItem("dukaanos.typing") === "1",
  );
  const setTyping = (next: boolean | ((prev: boolean) => boolean)) => {
    setTypingState((prev) => {
      const val = typeof next === "function" ? next(prev) : next;
      try {
        sessionStorage.setItem("dukaanos.typing", val ? "1" : "0");
      } catch {
        /* ignore storage quota */
      }
      return val;
    });
  };
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [extraFeed, setExtraFeed] = useState<FeedTx[]>([]);
  const [nextSeq, setNextSeq] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const head = state?.chain_head?.seq;

  useEffect(() => {
    const syncHeld = () => setHeld(listHeldBills(shopId));
    syncHeld();
    window.addEventListener(HELD_EVENT, syncHeld);
    return () => window.removeEventListener(HELD_EVENT, syncHeld);
  }, [shopId]);

  useEffect(() => {
    if (!head) return;
    api<Pulse>("/api/shop/pulse").then(setPulse).catch(() => undefined);
    setExtraFeed([]);
    setNextSeq(null);
  }, [head]);

  const dailySummaryScript = state
    ? (() => {
        const cash = Math.round(state.today.cash_sales_paisa / 100);
        const udhaar = Math.round(state.today.udhaar_paisa / 100);
        const alerts = pulse && (pulse.overdue.count > 0 || pulse.stockout.count > 0)
          ? ` ${pulse.overdue.count} کھاتے پندرہ دن سے پرانے ہیں، اور ${pulse.stockout.count} اشیاء کا اسٹاک کم ہے۔`
          : "";
        return `آج کا حساب: نقد فروخت ${cash} روپے، ادھار ${udhaar} روپے، اور کل ${state.today.sales_count} بل بنے۔${alerts}`;
      })()
    : "";

  useEffect(() => {
    if (dailySummaryScript) prefetchSpeak(dailySummaryScript);
  }, [dailySummaryScript]);

  useEffect(() => {
    if (showGuide) prefetchSpeak("مائیک دبا کر بولیں: ایک کلو چینی نقد، یا علی کو پانچ سو ادھار، یا صبح کا حساب بتاؤ۔");
  }, [showGuide]);

  const openBlankBill = () => {
    const emptyProposal: SaleProposal = {
      kind: "sale",
      lines: [],
      subtotal_paisa: 0,
      discount_paisa: 0,
      total_paisa: 0,
      cash_paid_paisa: 0,
      cash_explicit: false,
      credit_paisa: 0,
      change_due_paisa: 0,
      payment_mode: "cash",
      customer: { mention: null, candidates: [], selected_id: null, ambiguous: false, match_ms: 0 },
      new_balance_paisa: null,
      tier: 2,
      tier_reasons: ["NO_ITEMS"],
      warnings: [],
      confidence: 1,
    };
    openSheet({ type: "review", proposal: emptyProposal, key: newKey("manual"), trace: null });
  };

  if (!state) return <SkeletonMunshi />;
  const today = state.today;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const seenIds = new Set(state.feed.map((t) => t.id));
  const combinedFeed = [...state.feed, ...extraFeed.filter((t) => !seenIds.has(t.id))];
  const todays = combinedFeed.filter((t) => new Date(t.created_at) >= dayStart);
  const list = showAll ? combinedFeed : (todays.length ? todays : combinedFeed).slice(0, 5);

  const loadMoreFeed = async () => {
    const cursor = nextSeq ?? combinedFeed[combinedFeed.length - 1]?.seq;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ items: FeedTx[]; next_before_seq: number | null }>(`/api/shop/feed?before_seq=${cursor}&limit=40`);
      setExtraFeed((prev) => [...prev, ...res.items]);
      setNextSeq(res.next_before_seq);
    } catch {
      /* offline or end */
    } finally {
      setLoadingMore(false);
    }
  };

  const send = async (v: string) => {
    const s = v.trim();
    if (!s) return;
    setText("");
    await submitTurn({ text: s });
  };

  return (
    <div className={cx("space-y-2.5", typing ? "pb-44" : "pb-24")}>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="surface-card p-3.5">
          <div className="flex items-center justify-between gap-1">
            <div className={cx("section-label flex items-center gap-1.5", lang === "ur" && "urdu-ui")} dir="auto">
              <span className="h-1.5 w-1.5 rounded-full bg-cash" /> {tr("todayCash", lang)}
            </div>
            <button
              type="button"
              aria-label={tr("listen", lang)}
              onClick={() => void speak(dailySummaryScript)}
              className="tactile inline-flex h-7 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[11.5px] font-semibold text-ink-2"
            >
              <Volume2 size={12} strokeWidth={SW} /> {tr("listen", lang)}
            </button>
          </div>
          <Money paisa={today.cash_sales_paisa} className="mt-1.5 block text-[22px] font-bold leading-[26px] tracking-[-0.02em]" />
          <div className="mt-1 text-[13px] text-ink-2" dir="auto">{today.sales_count} {tr("sales", lang)}</div>
        </div>
        <div className="surface-card p-3.5">
          <div className={cx("section-label flex items-center gap-1.5", lang === "ur" && "urdu-ui")} dir="auto">
            <span className="h-1.5 w-1.5 rounded-full bg-udhaar" /> {tr("todayUdhaar", lang)}
          </div>
          <Money paisa={today.udhaar_paisa} className="mt-1.5 block text-[22px] font-bold leading-[26px] tracking-[-0.02em] text-udhaar" />
          <div className="mt-1 text-[13px] text-ink-2" dir="auto">{today.udhaar_accounts} {tr("accounts", lang)}</div>
        </div>
      </div>

      {/* Quick-Sell Top-4 strip — rush-hour 1-tap cash sale, Rs. 0 LLM */}
      <QuickSellStrip products={state.products} />

      {/* Primary action + progressive disclosure for secondary tools */}
      <div className="flex flex-wrap items-center gap-2 py-0.5">
        <button type="button" onClick={openBlankBill} className={cx("tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold", lang === "ur" && "urdu-ui")} dir="auto">
          <Plus size={13} strokeWidth={SW} /> {tr("newBill", lang)}
        </button>
        <button
          type="button"
          onClick={() => setMoreActions((m) => !m)}
          className={cx("tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold text-ink-2", lang === "ur" && "urdu-ui")}
          dir="auto"
        >
          {tr("more", lang)} {moreActions ? <ChevronUp size={13} strokeWidth={SW} /> : <ChevronDown size={13} strokeWidth={SW} />}
        </button>
        {moreActions && (
          <>
            {!helperMode && (
              <button type="button" onClick={() => openSheet({ type: "insights" })} className={cx("tactile flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold", lang === "ur" && "urdu-ui")} dir="auto">
                <BarChart3 size={13} strokeWidth={SW} className="text-cash" /> {tr("insights", lang)}
              </button>
            )}
            <button type="button" onClick={() => openSheet({ type: "return" })} className={cx("tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold", lang === "ur" && "urdu-ui")} dir="auto">
              <RotateCcw size={13} strokeWidth={SW} className="text-udhaar" /> {tr("returnItem", lang)}
            </button>
            <button type="button" onClick={() => openSheet({ type: "eod" })} className={cx("tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold", lang === "ur" && "urdu-ui")} dir="auto">
              {tr("closeDay", lang)}
            </button>
            <button
              type="button"
              onClick={() => setShowGuide((g) => !g)}
              className={cx("tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold text-ink-2", lang === "ur" && "urdu-ui")}
              dir="auto"
            >
              <HelpCircle size={13} strokeWidth={SW} /> {tr("guide", lang)}
            </button>
          </>
        )}
      </div>

      {held.length > 0 && (
        <div className="surface-card overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-2.5">
            <PauseCircle size={13} strokeWidth={SW} className="text-udhaar" />
            <span className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">{tr("heldBills", lang)} ({held.length})</span>
          </div>
          {held.map((h) => (
            <div key={h.id} className="hairline-t flex items-center gap-2 px-4 py-2.5">
              <button
                type="button"
                onClick={() => openSheet({ type: "review", proposal: h.proposal, key: h.id, trace: h.trace })}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-[14px] font-semibold">{h.customer_name ?? tr("walkInCash", lang)} · {formatRs(h.total_paisa)}</div>
                <div className="truncate text-[12px] text-ink-2">{h.label}</div>
              </button>
              <button
                type="button"
                aria-label="Discard held bill"
                onClick={() => shopId && removeHeldBill(shopId, h.id)}
                className="grid h-8 w-8 place-items-center text-ink-3"
              >
                <X size={14} strokeWidth={SW} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(showGuide || (list.length === 0 && !thinking)) && (
        <div className="surface-card p-3.5">
          <div className="flex items-center justify-between">
            <span className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">{tr("guideTitle", lang)}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void speak("مائیک دبا کر بولیں: ایک کلو چینی نقد، یا علی کو پانچ سو ادھار، یا صبح کا حساب بتاؤ۔")}
                className="tactile inline-flex h-7 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[11.5px] font-semibold"
              >
                <Volume2 size={12} strokeWidth={SW} /> {tr("listen", lang)}
              </button>
              {showGuide && (
                <button
                  type="button"
                  aria-label="Dismiss guide"
                  onClick={() => {
                    try {
                      localStorage.setItem("dukaanos.guide.dismissed", "1");
                    } catch {
                      /* ignore */
                    }
                    setShowGuide(false);
                  }}
                  className="grid h-7 w-7 place-items-center text-ink-3"
                >
                  <X size={14} strokeWidth={SW} />
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["Ek kilo cheeni cash", "Chhote Ali ko 500 udhaar", "Subah ka hisaab batao"].map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={thinking}
                onClick={() => void submitTurn({ text: ex })}
                className="tactile rounded-full border border-black/10 bg-canvas px-2.5 py-1 text-[12px] font-medium"
              >
                “{ex}”
              </button>
            ))}
          </div>
        </div>
      )}

      {pulse && (pulse.overdue.count > 0 || pulse.stockout.count > 0) && (
        <div className="surface-card overflow-hidden">
          <button onClick={() => setStripOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 px-4 text-[13.5px] font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-udhaar" />
            <span className="num" dir="auto">
              {pulse.overdue.count} {tr("overdueAccounts", lang)} · {formatRs(pulse.overdue.total_paisa)}
            </span>
            <span className="text-ink-3">·</span>
            <span className="h-1.5 w-1.5 rounded-full bg-maal" />
            <span dir="auto">{pulse.stockout.count} {tr("lowStockCount", lang)}</span>
            <span className="ml-auto text-ink-2">{stripOpen ? <ChevronUp size={16} strokeWidth={SW} /> : <ChevronDown size={16} strokeWidth={SW} />}</span>
          </button>
          {stripOpen && (
            <>
              <div className="hairline-t flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className={cx("text-[15px] font-semibold", lang === "ur" && "urdu-ui")} dir="auto">{tr("recoverUdhaar", lang)}</div>
                  <div className="truncate text-[13px] text-ink-2" dir="auto">{lang === "ur" ? "15 دن سے زیادہ پرانا ادھار · واٹس ایپ یا ایس ایم ایس" : "15+ days stuck · 1-tap WhatsApp/SMS"}</div>
                </div>
                <Pill tone="udhaar" onClick={() => goFilter("khata", "overdue")} className="h-7 px-3 text-[13px]">
                  {tr("remind", lang)}
                </Pill>
              </div>
              <div className="hairline-t flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className={cx("text-[15px] font-semibold", lang === "ur" && "urdu-ui")} dir="auto">{tr("stockoutAlert", lang)}</div>
                  <div className="truncate text-[13px] text-ink-2" dir="auto">
                    {pulse.stockout.items.length ? pulse.stockout.items.map((i) => i.name.replace(/\s*\(.*\)/, "").replace(/ 5L$/, "")).join(" & ") : tr("allShelvesHealthy", lang)}
                  </div>
                </div>
                <Pill tone="maal" onClick={() => openSheet({ type: "pulse", pulse })} className="h-7 px-3 text-[13px]">
                  {tr("order", lang)}
                </Pill>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between px-1 pt-3">
        <span className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">{showAll ? tr("allEntries", lang) : `${tr("today", lang)} · ${new Date().toLocaleDateString(lang === "ur" ? "ur-PK" : "en-GB", { day: "numeric", month: "short" }).toUpperCase()}`}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            aria-label="Refresh feed"
            className="tactile grid h-7 w-7 place-items-center rounded-full text-ink-2 hover:bg-surface-sunken"
          >
            <RefreshCw size={13} strokeWidth={SW} />
          </button>
          <button onClick={() => setShowAll((s) => !s)} className="section-label min-h-[28px]" dir="auto">
            {showAll ? tr("showLess", lang) : tr("showAll", lang)}
          </button>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {thinking && (
          <div className="hairline-b flex h-[60px] items-center gap-3 px-4 text-[14px] text-ink-2">
            <Spinner className="text-cash" /> <span dir="auto">{tr("listening", lang)}</span>
          </div>
        )}
        {list.length === 0 && !thinking && <div className={cx("px-4 py-6 text-center text-[14px] text-ink-2", lang === "ur" && "urdu-ui")} dir="auto">{tr("emptyMunshi", lang)}</div>}
        {list.map((t) => (
          <FeedRow
            key={t.id}
            t={t}
            flash={highlightTx === t.id}
            onOpen={() =>
              xrayOn && t.seq >= 0
                ? openSheet({ type: "xray", txId: t.id })
                : openSheet({ type: "entry", tx: t, txId: t.id })
            }
          />
        ))}
        {showAll && (nextSeq !== null || state.feed.length >= 25) && (
          <button
            onClick={() => void loadMoreFeed()}
            disabled={loadingMore}
            className="hairline-t tactile flex h-11 w-full items-center justify-center gap-2 text-[13.5px] font-semibold text-ink-2 disabled:opacity-50"
          >
            {loadingMore ? <Spinner /> : tr("loadOlder", lang)}
          </button>
        )}
      </div>

      {/* Dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[60px] z-30 mx-auto max-w-[430px] bg-gradient-to-t from-canvas via-canvas/95 to-transparent px-4 pb-2 pt-5 pb-safe">
        {typing && (
          <div className="pointer-events-auto mb-3 rounded-[16px] border border-black/10 bg-surface p-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
            {(shop?.is_demo_shop || shop?.is_stage_shop) && (
              <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
                {DEMO_UTTERANCES.map((u) => (
                  <button key={u} onClick={() => setText(u)} className="tactile h-7 shrink-0 rounded-full bg-surface-sunken px-2.5 text-[12px] text-ink-2">
                    {u.length > 34 ? u.slice(0, 32) + "…" : u}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                dir="auto"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={tr("typePlaceholder", lang)}
                className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[15px] outline-none"
              />
              <button type="submit" disabled={!text.trim() || thinking} className="tactile grid h-11 w-11 place-items-center rounded-[12px] bg-ink text-white disabled:opacity-40" aria-label="Send">
                <SendHorizontal size={18} strokeWidth={SW} />
              </button>
            </form>
          </div>
        )}
        <div className="pointer-events-auto relative flex items-center justify-center">
          <button
            onClick={() => setTyping((t) => !t)}
            aria-label={tr("typeInstead", lang)}
            className={cx("tactile absolute left-[calc(50%-112px)] grid h-12 w-12 place-items-center rounded-full border border-black/10 shadow-sm", typing ? "bg-ink text-white" : "bg-surface text-ink")}
          >
            <Keyboard size={18} strokeWidth={SW} />
          </button>
          <MicButton
            busy={thinking}
            onClip={(blob, mime) => void submitTurn({ blob, mime })}
            onOfflineTranscript={(t) => void submitTurn({ text: t })}
            onDenied={(m) => {
              toast(m, "warn");
              setTyping(true);
            }}
          />
          <button
            onClick={() => openSheet({ type: "parchi" })}
            aria-label={tr("scanParchi", lang)}
            className="tactile absolute left-[calc(50%+46px)] flex h-12 items-center gap-1.5 rounded-full border border-black/10 bg-surface px-4 text-[15px] font-semibold shadow-sm"
          >
            <Camera size={16} strokeWidth={SW} className="text-maal" /> <span dir="auto">{tr("parchi", lang)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonMunshi() {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="surface-card h-[104px] animate-pulse" />
        <div className="surface-card h-[104px] animate-pulse" />
      </div>
      <div className="surface-card h-10 animate-pulse" />
      <div className="surface-card h-[300px] animate-pulse" />
    </div>
  );
}

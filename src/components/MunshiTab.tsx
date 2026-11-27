"use client";

import { BarChart3, Camera, ChevronDown, ChevronUp, HelpCircle, Keyboard, PauseCircle, Plus, RefreshCw, RotateCcw, SendHorizontal, Volume2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { FeedTx, Pulse, StateProduct } from "@/lib/api/contracts";
import { api, newKey } from "@/lib/client/api";
import { HELD_EVENT, listHeldBills, removeHeldBill, type HeldBill } from "@/lib/client/held-bills";
import { tr } from "@/lib/client/i18n";
import { speak } from "@/lib/client/speak";
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

export function feedSummary(t: FeedTx): string {
  if (t.type === "payment") return "Wasooli · cash received";
  if (t.type === "reversal") return `Undo · ${t.audit_meta?.reversed_type ?? "entry"} reversed`;
  if (t.type === "writeoff") return "Maaf / Bad-debt write-off";
  if (t.type === "adjustment") {
    const r = String(t.audit_meta?.reason ?? t.supplier_name ?? "stock adjust");
    return `${r} · ${t.lines.map((l) => `${formatBaseQty(l.qty_base_units, l.base_unit)} ${l.name.replace(/\s*\(.*\)/, "")}`).join(", ")}`;
  }
  const items = t.lines.map((l) => (l.value_first ? `${l.name} (Rs. ${l.line_total_paisa / 100})` : `${formatBaseQty(l.qty_base_units, l.base_unit)} ${l.name.replace(/\s*\(.*\)/, "")}`)).join(", ");
  return t.type === "return" ? `Wapasi · ${items}` : items;
}

function feedTag(t: FeedTx): string {
  if (t.audit_meta?.pending_sync) return "Pending Sync";
  if (t.type === "payment") return "Wasooli";
  if (t.type === "purchase") return t.credit_paisa > 0 ? "Restock · A/P" : "Restock";
  if (t.type === "reversal") return "Reversal";
  if (t.type === "return") return t.credit_paisa > 0 ? "Return · Khata" : "Return · Cash";
  if (t.type === "adjustment") return "Adjustment";
  if (t.type === "writeoff") return "Write-off";
  if (t.credit_paisa !== 0 && t.cash_paid_paisa > 0) return "Split · Khata";
  if (t.credit_paisa > 0) return "Udhaar";
  return t.audit_meta?.channel === "tier1-auto" ? "Cash · Tier 1" : "Cash";
}

export function FeedRow({ t, onOpen, flash }: { t: FeedTx; onOpen: () => void; flash?: boolean }) {
  const title = t.type === "purchase" ? t.supplier_name ?? "Wholesale" : t.type === "reversal" ? "Reversal" : t.type === "adjustment" ? (t.lines[0]?.name ?? "Stock Adjustment") : t.customer_name ?? "Walk-in Cash";
  const amount = t.type === "sale" ? (t.cash_paid_paisa > 0 ? t.cash_paid_paisa : t.total_paisa) : Math.abs(t.total_paisa);
  const color = t.type === "purchase" ? "text-maal" : t.type === "reversal" || t.type === "adjustment" || t.type === "writeoff" ? "text-ink-3" : t.type === "return" ? "text-udhaar" : t.type === "sale" && t.cash_paid_paisa === 0 ? "text-udhaar" : "text-cash";
  const sign = t.type === "purchase" || t.type === "reversal" || t.type === "return" || t.type === "adjustment" || t.type === "writeoff" ? "-" : "+";
  return (
    <button onClick={onOpen} className={cx("hairline-b flex h-[60px] w-full items-center gap-3 px-4 text-left last:border-b-0", flash && "row-flash", t.is_reversed && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium leading-5">{title}</div>
        <div className="truncate text-[13px] leading-[18px] text-ink-2">
          {relTime(t.created_at)} · {feedSummary(t)}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cx("text-[17px] font-bold leading-5", color, t.is_reversed && "line-through")}>
          {sign}
          <span className="rs-prefix">Rs.</span>
          <span className="num">{(amount / 100).toLocaleString("en-US")}</span>
        </div>
        <div className="text-[12px] leading-4 text-ink-2">{t.is_reversed ? "Undone" : feedTag(t)}</div>
      </div>
    </button>
  );
}

/**
 * Rush-Hour Quick-Sell Top-4 strip — 1-tap Tier-1 cash sales for the 4 highest-velocity SKUs.
 * <2ms, Rs. 0 LLM, 0 network dependency. Idempotent: each tap fires submitTurn with typed text.
 */
function QuickSellStrip({ products }: { products: StateProduct[] }) {
  const { submitTurn, thinking } = useDukaan();
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
        <span className="section-label">Quick-Sell</span>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
        {top4.map((p) => {
          const soldLabel =
            p.pack_size_base_units > 1 && p.base_unit !== "pcs" && p.pack_size_base_units !== 1000
              ? `${Math.round(p.sold_7d / p.pack_size_base_units)}/wk`
              : `${formatBaseQty(p.sold_7d, p.base_unit)}/wk`;
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
                {formatRs(p.unit_price_paisa)} · {soldLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MunshiTab() {
  const { state, shop, shopId, openSheet, submitTurn, thinking, toast, highlightTx, refresh, lang } = useDukaan();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [stripOpen, setStripOpen] = useState(false);
  const [held, setHeld] = useState<HeldBill[]>([]);
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === "undefined") return false;
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
  const list = showAll ? combinedFeed : (todays.length ? todays : combinedFeed).slice(0, 7);

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
          <div className={cx("section-label flex items-center gap-1.5", lang === "ur" && "urdu-ui")} dir="auto">
            <span className="h-1.5 w-1.5 rounded-full bg-cash" /> {tr("todayCash", lang)}
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

      {/* Compact action bar: P&L Insights, Manual Bill, Return, Guide */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-0.5">
        <button type="button" onClick={() => openSheet({ type: "insights" })} className="tactile flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold">
          <BarChart3 size={13} strokeWidth={SW} className="text-cash" /> Insights · P&amp;L
        </button>
        <button type="button" onClick={openBlankBill} className="tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold">
          <Plus size={13} strokeWidth={SW} /> New Bill
        </button>
        <button type="button" onClick={() => openSheet({ type: "return" })} className="tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold">
          <RotateCcw size={13} strokeWidth={SW} className="text-udhaar" /> Return
        </button>
        {!showGuide && (
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem("dukaanos.guide.dismissed");
              setShowGuide(true);
            }}
            className="tactile flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-surface px-3 text-[12.5px] font-semibold text-ink-2"
          >
            <HelpCircle size={13} strokeWidth={SW} /> Guide
          </button>
        )}
      </div>

      {held.length > 0 && (
        <div className="surface-card overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-2.5">
            <PauseCircle size={13} strokeWidth={SW} className="text-udhaar" />
            <span className="section-label">Held Bills ({held.length})</span>
          </div>
          {held.map((h) => (
            <div key={h.id} className="hairline-t flex items-center gap-2 px-4 py-2.5">
              <button
                type="button"
                onClick={() => openSheet({ type: "review", proposal: h.proposal, key: h.id, trace: h.trace })}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-[14px] font-semibold">{h.customer_name ?? "Walk-in"} · {formatRs(h.total_paisa)}</div>
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

      {showGuide && (
        <div className="surface-card p-3.5">
          <div className="flex items-center justify-between">
            <span className="section-label">Pehli dafa? Bol kar dekhein</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void speak("Mic dabaa kar bolein: Ek kilo cheeni cash, ya Ali ko panch sau udhaar, ya Subah ka hisaab batao.")}
                className="tactile inline-flex h-7 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[11.5px] font-semibold"
              >
                <Volume2 size={12} strokeWidth={SW} /> Suniye
              </button>
              <button
                type="button"
                aria-label="Dismiss guide"
                onClick={() => {
                  localStorage.setItem("dukaanos.guide.dismissed", "1");
                  setShowGuide(false);
                }}
                className="grid h-7 w-7 place-items-center text-ink-3"
              >
                <X size={14} strokeWidth={SW} />
              </button>
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

      {pulse && (
        <div className="surface-card overflow-hidden">
          <button onClick={() => setStripOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 px-4 text-[13.5px] font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-udhaar" />
            <span className="num">
              {pulse.overdue.count} overdue · {formatRs(pulse.overdue.total_paisa)}
            </span>
            <span className="text-ink-3">·</span>
            <span className="h-1.5 w-1.5 rounded-full bg-maal" />
            <span>{pulse.stockout.count} low stock</span>
            <span className="ml-auto text-ink-2">{stripOpen ? <ChevronUp size={16} strokeWidth={SW} /> : <ChevronDown size={16} strokeWidth={SW} />}</span>
          </button>
          {stripOpen && (
            <>
              <div className="hairline-t flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">Recover Overdue Udhaar</div>
                  <div className="truncate text-[13px] text-ink-2">15+ days stuck · 1-tap WhatsApp/SMS</div>
                </div>
                <Pill tone="udhaar" onClick={() => goFilter("khata", "overdue")} className="h-7 px-3 text-[13px]">
                  Remind
                </Pill>
              </div>
              <div className="hairline-t flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">2-Day Stockout Alert</div>
                  <div className="truncate text-[13px] text-ink-2">
                    {pulse.stockout.items.length ? pulse.stockout.items.map((i) => i.name.replace(/\s*\(.*\)/, "").replace(/ 5L$/, "")).join(" & ") : "All shelves healthy"} · Wholesale list ready
                  </div>
                </div>
                <Pill tone="maal" onClick={() => openSheet({ type: "pulse", pulse })} className="h-7 px-3 text-[13px]">
                  Order
                </Pill>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between px-1 pt-3">
        <span className="section-label" dir="auto">{showAll ? tr("allEntries", lang) : `Today · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}`}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            aria-label="Refresh feed"
            className="tactile grid h-7 w-7 place-items-center rounded-full text-ink-2 hover:bg-surface-sunken"
          >
            <RefreshCw size={13} strokeWidth={SW} />
          </button>
          <button onClick={() => setShowAll((s) => !s)} className="section-label min-h-[28px]">
            {showAll ? tr("showLess", lang) : `${list.length} latest`}
          </button>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {thinking && (
          <div className="hairline-b flex h-[60px] items-center gap-3 px-4 text-[14px] text-ink-2">
            <Spinner className="text-cash" /> <span dir="auto">{tr("listening", lang)}</span> <span className="font-mono text-[11px]">audio → JSON</span>
          </div>
        )}
        {list.length === 0 && !thinking && <div className={cx("px-4 py-6 text-center text-[14px] text-ink-2", lang === "ur" && "urdu-ui")} dir="auto">{tr("emptyMunshi", lang)}</div>}
        {list.map((t) => (
          <FeedRow
            key={t.id}
            t={t}
            flash={highlightTx === t.id}
            onOpen={() =>
              t.seq < 0
                ? toast("Pending sync — hash will be assigned when online", "info")
                : openSheet({ type: "xray", txId: t.id })
            }
          />
        ))}
        {showAll && (nextSeq !== null || state.feed.length >= 25) && (
          <button
            onClick={() => void loadMoreFeed()}
            disabled={loadingMore}
            className="hairline-t tactile flex h-11 w-full items-center justify-center gap-2 text-[13.5px] font-semibold text-ink-2 disabled:opacity-50"
          >
            {loadingMore ? <Spinner /> : "Load older entries"}
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

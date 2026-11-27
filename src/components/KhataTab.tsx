"use client";

import { Calendar, Check, ChevronDown, ChevronUp, ExternalLink, Link2, Phone, Printer, QrCode, RotateCcw, Search, ShieldAlert, ShieldCheck, UserPlus, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import type { CommitResponse, StateCustomer } from "@/lib/api/contracts";
import { api, friendlyError, newKey } from "@/lib/client/api";
import { isoDate, pktToday, wadaLabel } from "@/lib/domain/wada";
import { tr } from "@/lib/client/i18n";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { verifyPassport, type PassportPayload, type TradeSummary } from "@/lib/crypto/passport";
import { rankReminders, reminderText, smsLink, voiceReminderScript, waLink } from "@/lib/domain/messages";
import { sendVoiceNote } from "@/lib/client/voice-note";
import { formatRs, formatRsCompact, rupeesToPaisa } from "@/lib/domain/money";
import { FeedRow } from "./MunshiTab";
import { cx, Money, PrimaryButton, SecondaryButton, Segmented, Sheet, shortDate, Spinner } from "./ui";

interface ReminderLogEntry {
  at: number;
  channel: "wa" | "sms" | "voice" | "statement";
}

function logReminder(shopId: string | null | undefined, customerId: string, channel: ReminderLogEntry["channel"]) {
  if (typeof window === "undefined" || !shopId) return;
  const k = `dukaanos.remlog.${shopId}.${customerId}`;
  try {
    const cur = JSON.parse(localStorage.getItem(k) ?? "[]") as ReminderLogEntry[];
    localStorage.setItem(k, JSON.stringify([{ at: Date.now(), channel }, ...cur].slice(0, 10)));
  } catch {
    /* ignore */
  }
}

function readReminderLog(shopId: string | null | undefined, customerId: string): ReminderLogEntry[] {
  if (typeof window === "undefined" || !shopId) return [];
  try {
    const cur = JSON.parse(localStorage.getItem(`dukaanos.remlog.${shopId}.${customerId}`) ?? "[]");
    return Array.isArray(cur) ? (cur as ReminderLogEntry[]) : [];
  } catch {
    return [];
  }
}

type Filter = "all" | "overdue" | "wada" | "settled";

/** Per-customer Mutual Khata status from get_bharosa_overview. */
export interface BharosaItem {
  customer_id: string;
  confirmed: number;
  disputed: number;
  pending: number;
  promise_date: string | null;
  promise_state: "open" | "kept" | "broken" | null;
  paid_claim_paisa: number;
}

/** Polls the customer-attestation overview every 3 s while the Khata tab is visible (live on the projector). */
function useBharosa(): Record<string, BharosaItem> {
  const [map, setMap] = useState<Record<string, BharosaItem>>({});
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const items = await api<BharosaItem[]>("/api/khata/overview");
        if (alive) setMap(Object.fromEntries(items.map((i) => [i.customer_id, i])));
      } catch {
        /* offline or not migrated yet: badges simply stay hidden */
      }
    };
    void pull();
    const t = setInterval(pull, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return map;
}

export function KhataTab() {
  const { state, openSheet, lang, xrayOn, helperMode } = useDukaan();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const bharosa = useBharosa();

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ tab: string; filter: string }>).detail;
      if (d.tab === "khata") setFilter(d.filter as Filter);
    };
    window.addEventListener("dukaan:filter", h);
    return () => window.removeEventListener("dukaan:filter", h);
  }, []);

  const customers = useMemo(() => state?.customers ?? [], [state]);
  const receivable = customers.reduce((s, c) => s + Math.max(0, c.balance_paisa), 0);
  const active = customers.filter((c) => c.balance_paisa > 0);
  const overdue = active.filter((c) => (c.days_overdue ?? 0) > 15);
  const withWada = customers.filter((c) => bharosa[c.id]?.promise_date && bharosa[c.id]?.promise_state !== "kept" && c.balance_paisa > 0);
  const baseList = (filter === "overdue" ? overdue : filter === "wada" ? withWada : filter === "settled" ? customers.filter((c) => c.balance_paisa <= 0) : customers)
    .slice()
    .sort((a, b) => (filter === "wada" ? String(bharosa[a.id]?.promise_date).localeCompare(String(bharosa[b.id]?.promise_date)) : b.balance_paisa - a.balance_paisa));
  const q = query.trim().toLowerCase();
  const list = q ? baseList.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q) || (c.role_tag ?? "").toLowerCase().includes(q)) : baseList;
  const verified = Object.values(bharosa).reduce((s, b) => s + b.confirmed, 0);
  const unverified = Object.values(bharosa).reduce((s, b) => s + b.pending, 0);

  if (!state) return <div className="surface-card h-[400px] animate-pulse" />;

  return (
    <div className="space-y-3 pb-24">
      <div className="surface-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">{tr("totalReceivable", lang)}</div>
          <button
            type="button"
            aria-label={tr("listen", lang)}
            onClick={() => void speak(`کل ادھار ${Math.round(receivable / 100)} روپے لینا ہے، ${active.length} کھاتوں پر۔`)}
            className="tactile inline-flex h-7 items-center gap-1 rounded-full bg-surface-sunken px-2.5 text-[11.5px] font-semibold text-ink-2"
          >
            <Volume2 size={12} strokeWidth={1.75} /> {tr("listen", lang)}
          </button>
        </div>
        <Money paisa={receivable} className="mt-1 block text-[34px] font-bold leading-[38px] tracking-[-0.03em] text-udhaar" />
        <div className="hairline-t mt-3 flex justify-between pt-3 text-[14px]">
          <span className="text-ink-2" dir="auto">{active.length} {tr("activeAccounts", lang)}</span>
          <span className="font-semibold text-udhaar" dir="auto">{overdue.length} {tr("overdue", lang)}</span>
        </div>
      </div>

      <RemindToday customers={customers} bharosa={bharosa} shop={state.shop.name} />

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: tr("all", lang) },
          { value: "overdue", label: tr("overdueFilter", lang) },
          { value: "wada", label: "Wada" },
          { value: "settled", label: tr("settled", lang) },
        ]}
      />

      <div className="relative">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("searchCustomers", lang)}
          aria-label="Search customers"
          dir="auto"
          className="h-11 w-full rounded-[12px] border border-black/10 bg-surface pl-10 pr-3 text-[15px] outline-none focus:border-ink"
        />
      </div>

      <div className="surface-card overflow-hidden">
        {list.length === 0 && <div className="px-4 py-6 text-center text-[14px] text-ink-2">Koi account nahi</div>}
        {list.map((c) => (
          <DebtorRow key={c.id} c={c} b={bharosa[c.id]} shop={state.shop.name} onOpen={() => openSheet({ type: "customer", customerId: c.id })} onWasooli={() => openSheet({ type: "wasooli", customerId: c.id })} />
        ))}
      </div>

      <button onClick={() => setAdding(true)} className="tactile flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-black/20 text-[14px] font-semibold text-ink-2">
        <UserPlus size={16} strokeWidth={1.75} /> New customer
      </button>
      {!xrayOn && !helperMode && (
        <button
          type="button"
          onClick={() => openSheet({ type: "passport" })}
          className="tactile flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-surface text-[13.5px] font-semibold text-ink-2 border border-black/10"
        >
          <QrCode size={15} strokeWidth={1.75} /> Bank / Karobar Summary (QR)
        </button>
      )}
      {adding && <NewCustomerSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Today's PKT date as YYYY-MM-DD. */
function todayPkt(): string {
  return isoDate(pktToday());
}

let cachedTtsAvailable: boolean | null = null;
let ttsCheckPromise: Promise<boolean> | null = null;

function useTtsAvailable(): boolean | null {
  const [avail, setAvail] = useState<boolean | null>(cachedTtsAvailable);
  useEffect(() => {
    if (cachedTtsAvailable !== null) return;
    if (!ttsCheckPromise) {
      ttsCheckPromise = api<{ models_available?: Record<string, boolean> | null }>("/api/system/health", { auth: false, shop: false })
        .then((h) => h.models_available?.tts === true)
        .catch(() => false);
    }
    void ttsCheckPromise.then((v) => {
      cachedTtsAvailable = v;
      setAvail(v);
    });
  }, []);
  return avail;
}

/** Voice-note reminder: TTS audio → share sheet; or explicit WhatsApp Text + Khata Link when TTS is disabled. */
function useVoiceReminder() {
  const { toast, shopId } = useDukaan();
  const [busyId, setBusyId] = useState<string | null>(null);
  const ttsAvailable = useTtsAvailable();
  const run = async (c: StateCustomer, shop: string, b?: BharosaItem) => {
    setBusyId(c.id);
    const fallbackText = reminderText({ name: c.name, shop, balance_paisa: c.balance_paisa, days_overdue: c.days_overdue });
    if (ttsAvailable === false) {
      try {
        const r = await api<{ wa: string }>("/api/khata/link", { json: { customer_id: c.id } });
        logReminder(shopId, c.id, "wa");
        window.open(r.wa, "_blank", "noopener,noreferrer");
      } catch {
        logReminder(shopId, c.id, "wa");
        window.open(waLink(c.phone, fallbackText), "_blank", "noopener,noreferrer");
      } finally {
        setBusyId(null);
      }
      return;
    }
    const script = voiceReminderScript({
      name: c.name, shop, balance_paisa: c.balance_paisa,
      promise_label: b?.promise_date && b.promise_state !== "kept" ? wadaLabel(b.promise_date).split(",")[0] : null,
    });
    try {
      const how = await sendVoiceNote(script, c.name, fallbackText);
      logReminder(shopId, c.id, "voice");
      toast(how === "shared" ? "Awaaz wali yaad-dihani bhej di" : "Voice note download ho gaya — WhatsApp par bhejein", "ok");
    } catch {
      toast("Awaaz abhi nahi bani — text yaad-dihani khul rahi hai", "warn");
      logReminder(shopId, c.id, "wa");
      window.open(waLink(c.phone, fallbackText), "_blank", "noopener,noreferrer");
    } finally {
      setBusyId(null);
    }
  };
  return { busyId, run, ttsAvailable };
}

/** "Aaj kisko yaad dilana hai" — the app does the asking so the shopkeeper doesn't have to. */
function RemindToday({ customers, bharosa, shop }: { customers: StateCustomer[]; bharosa: Record<string, BharosaItem>; shop: string }) {
  const { busyId, run, ttsAvailable } = useVoiceReminder();
  const ranked = rankReminders(
    customers.map((c) => ({
      id: c.id, name: c.name, balance_paisa: c.balance_paisa, days_overdue: c.days_overdue ?? null,
      promise_date: bharosa[c.id]?.promise_date ?? null, promise_state: bharosa[c.id]?.promise_state ?? null,
    })),
    todayPkt(),
  );
  if (ranked.length === 0) return null;
  const why = { wada_broken: "Wada toota", wada_due: "Aaj wada hai", overdue: "din se baqaya" } as const;
  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <div className="section-label">Aaj kisko yaad dilana hai</div>
        <span className="text-[12px] text-ink-2">Munshi poochega, aap nahi</span>
      </div>
      {ranked.map((r) => {
        const c = customers.find((x) => x.id === r.id)!;
        return (
          <div key={r.id} className="hairline-b flex items-center gap-3 px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{r.name}</div>
              <div className={cx("text-[13px]", r.reason === "overdue" ? "text-ink-2" : "font-semibold text-udhaar")}>
                {r.reason === "overdue" ? `${r.days_overdue} ${why.overdue}` : why[r.reason]} · {formatRs(r.balance_paisa)}
              </div>
            </div>
            <button onClick={() => void run(c, shop, bharosa[c.id])} disabled={busyId !== null}
              className="tactile flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-ink px-3.5 text-[13.5px] font-semibold text-white disabled:opacity-60">
              {busyId === c.id ? <Spinner className="h-4 w-4" /> : ttsAvailable === false ? <Link2 size={15} strokeWidth={1.75} /> : <Volume2 size={15} strokeWidth={1.75} />}
              {ttsAvailable === false ? "WhatsApp" : "Awaaz bhejein"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Badges: what the CUSTOMER said (confirmed / disputed / wada / payment claimed). */
function BharosaBadges({ b }: { b?: BharosaItem }) {
  if (!b) return null;
  return (
    <>
      {b.confirmed > 0 && b.disputed === 0 && (
        <span className="inline-flex items-center gap-1 rounded-[6px] bg-cash-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-cash-ink">
          <Check size={11} strokeWidth={1.75} /> Tasdeeq shuda
        </span>
      )}
      {b.disputed > 0 && <span className="rounded-[6px] bg-udhaar-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-udhaar-ink">Ikhtilaf ({b.disputed})</span>}
      {b.promise_date && b.promise_state === "open" && (
        <span className="rounded-[6px] bg-[#FEF3C7] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#92400E]">Wada · {wadaLabel(b.promise_date)}</span>
      )}
      {b.promise_state === "broken" && <span className="rounded-[6px] bg-udhaar-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-udhaar-ink">Wada toota</span>}
    </>
  );
}

function DebtorRow({ c, b, shop, onOpen, onWasooli }: { c: StateCustomer; b?: BharosaItem; shop: string; onOpen: () => void; onWasooli: () => void }) {
  const { toast, confirmPayment, shopId } = useDukaan();
  const [sending, setSending] = useState<"wa" | "sms" | null>(null);
  const voice = useVoiceReminder();
  const msg = reminderText({ name: c.name, shop, balance_paisa: c.balance_paisa, days_overdue: c.days_overdue });
  const od = (c.days_overdue ?? 0) > 15;
  const latestRem = useMemo(() => readReminderLog(shopId, c.id)[0] ?? null, [shopId, c.id]);
  const paidAfterRem = Boolean(latestRem && c.last_paid_at && new Date(c.last_paid_at).getTime() > latestRem.at);
  const remindedRecently = Boolean(latestRem && !paidAfterRem && Date.now() - latestRem.at < 86_400_000);

  /** Mutual Khata: signed link + self-contained text; falls back to the plain reminder when offline. */
  const send = async (via: "wa" | "sms") => {
    setSending(via);
    logReminder(shopId, c.id, via);
    try {
      const r = await api<{ wa: string; sms: string }>("/api/khata/link", { json: { customer_id: c.id } });
      if (via === "wa") window.open(r.wa, "_blank", "noopener,noreferrer");
      else window.location.href = r.sms;
    } catch {
      if (via === "wa") window.open(waLink(c.phone, msg), "_blank", "noopener,noreferrer");
      else window.location.href = smsLink(c.phone, msg);
    } finally {
      setSending(null);
    }
  };

  const acceptClaim = async () => {
    if (!b?.paid_claim_paisa) return;
    try {
      await confirmPayment(c.id, b.paid_claim_paisa, newKey("claim"));
      toast(`Wasooli ${formatRs(b.paid_claim_paisa)} — gahak ki khabar tasdeeq`, "ok");
    } catch (e) {
      toast(friendlyError(e), "err");
    }
  };
  return (
    <div className="hairline-b px-4 py-3.5 last:border-b-0">
      <button onClick={onOpen} className="flex w-full items-start gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold">{c.name}</span>
            {od && <span className="rounded-[6px] bg-udhaar-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-udhaar-ink">{c.days_overdue}d overdue</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
            <BharosaBadges b={b} />
            {paidAfterRem && <span className="rounded-[6px] bg-cash-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-cash-ink">Wasooli aa gayi ✓</span>}
            {remindedRecently && <span className="rounded-[6px] bg-surface-sunken px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-2">Aaj yaad dilaya ✓</span>}
          </div>
          <div className="text-[13px] text-ink-2">
            {c.role_tag ?? "Customer"} · Last paid {shortDate(c.last_paid_at)}
            {!c.phone && c.balance_paisa > 0 ? " · Phone add karein" : ""}
          </div>
        </div>
        <Money paisa={c.balance_paisa} className={cx("text-[18px] font-bold", c.balance_paisa > 0 ? "text-udhaar" : "text-cash")} />
      </button>
      {b && b.paid_claim_paisa > 0 && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[12px] bg-cash-bg px-3 py-2">
          <span className="text-[13px] font-semibold text-cash-ink">Gahak: &quot;{formatRs(b.paid_claim_paisa)} Raast se bhej diya&quot;</span>
          <button onClick={() => void acceptClaim()} className="tactile h-9 shrink-0 rounded-full bg-cash px-3 text-[13px] font-semibold text-white">Mil gaya</button>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button onClick={onWasooli} className="tactile h-9 rounded-full border border-cash/30 bg-cash-bg px-3.5 text-[13.5px] font-semibold text-cash-ink">
          Wasooli
        </button>
        {c.balance_paisa > 0 && voice.ttsAvailable !== false ? (
          <button onClick={() => void voice.run(c, shop, b)} disabled={voice.busyId !== null} className="tactile flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-surface-sunken px-3.5 text-[13.5px] font-semibold">
            {voice.busyId === c.id ? <Spinner className="h-3.5 w-3.5" /> : <Volume2 size={14} strokeWidth={1.75} />}
            Awaaz / WhatsApp
          </button>
        ) : (
          <button onClick={() => void send("wa")} disabled={sending !== null} className="tactile flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-surface-sunken px-3.5 text-[13.5px] font-semibold">
            {sending === "wa" ? <Spinner className="h-3.5 w-3.5" /> : <Link2 size={14} strokeWidth={1.75} />} WhatsApp
          </button>
        )}
        <button onClick={() => void send("sms")} disabled={sending !== null} className="tactile flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-surface-sunken px-3.5 text-[13.5px] font-semibold">
          {sending === "sms" ? <Spinner className="h-3.5 w-3.5" /> : null} SMS (2G)
        </button>
      </div>
    </div>
  );
}

function NewCustomerSheet({ onClose }: { onClose: () => void }) {
  const { refresh, toast } = useDukaan();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="New customer">
      <div className="space-y-2.5 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam (e.g. Ali Tailor)" dir="auto" className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone 03xx-xxxxxxx" inputMode="tel" className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Tag (Electrician, Gali 4…)" className="h-12 w-full rounded-[12px] bg-canvas px-3 text-[16px] outline-none" />
        <PrimaryButton
          className="w-full"
          busy={busy}
          disabled={!name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/api/shop/customer", { json: { name, phone: phone || undefined, role_tag: role || undefined } });
              await refresh();
              toast("Customer added", "ok");
              onClose();
            } catch (e) {
              toast(friendlyError(e), "err");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save customer
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

export function CustomerSheet({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { state, shopId, openSheet, xrayOn, helperMode, refresh, toast, lang } = useDukaan();
  const c = state?.customers.find((x) => x.id === customerId);
  const [phone, setPhone] = useState(c?.phone ?? "");
  const [roleTag, setRoleTag] = useState(c?.role_tag ?? "");
  const [limitRs, setLimitRs] = useState(c?.credit_limit_paisa ? String(c.credit_limit_paisa / 100) : "");
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffRs, setWriteOffRs] = useState("");
  const [writeOffBusy, setWriteOffBusy] = useState(false);
  const [items, setItems] = useState<import("@/lib/api/contracts").FeedTx[] | null>(null);
  const [nextSeq, setNextSeq] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [linkBusy, setLinkBusy] = useState<"open" | "copy" | "wa" | null>(null);
  const [remLog, setRemLog] = useState<ReminderLogEntry[]>(() => readReminderLog(shopId, customerId));
  const [showMore, setShowMore] = useState(false);

  const handleKhataLink = async (mode: "open" | "copy" | "wa") => {
    setLinkBusy(mode);
    try {
      const r = await api<{ url: string; token: string; wa: string }>("/api/khata/link", { json: { customer_id: c!.id } });
      if (mode === "open") {
        window.open(`/k/${r.token}`, "_blank", "noopener,noreferrer");
      } else if (mode === "wa") {
        logReminder(shopId, c!.id, "statement");
        setRemLog(readReminderLog(shopId, c!.id));
        window.open(r.wa, "_blank", "noopener,noreferrer");
      } else {
        await navigator.clipboard?.writeText(r.url);
        toast("Mutual Khata link copied", "ok");
      }
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setLinkBusy(null);
    }
  };

  useEffect(() => {
    setItems(null);
    setNextSeq(null);
    api<{ items: import("@/lib/api/contracts").FeedTx[]; next_before_seq: number | null }>(`/api/shop/customer-ledger?customer_id=${customerId}&limit=50`)
      .then((r) => {
        setItems(r.items);
        setNextSeq(r.next_before_seq);
      })
      .catch(() => {
        setItems(state?.feed.filter((t) => t.customer_id === customerId) ?? []);
      });
  }, [customerId, state?.feed]);

  if (!c || !state) return null;
  const history = items ?? state.feed.filter((t) => t.customer_id === c.id);

  const loadMore = async () => {
    if (!nextSeq || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api<{ items: import("@/lib/api/contracts").FeedTx[]; next_before_seq: number | null }>(`/api/shop/customer-ledger?customer_id=${c.id}&before_seq=${nextSeq}&limit=50`);
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setNextSeq(r.next_before_seq);
    } finally {
      setLoadingMore(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={c.name}>
      <div className="space-y-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="surface-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="section-label">Balance</div>
              <Money paisa={c.balance_paisa} className={cx("mt-1 block text-[30px] font-bold", c.balance_paisa > 0 ? "text-udhaar" : "text-cash")} />
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void speak(`${c.name} کا بقایا ${Math.round(c.balance_paisa / 100)} روپے ہے${c.days_overdue ? `، ${c.days_overdue} دن سے باقی` : ""}۔`)}
                className="tactile inline-flex h-9 items-center gap-1 rounded-full bg-surface-sunken px-3 text-[12.5px] font-semibold"
              >
                <Volume2 size={13} strokeWidth={1.75} /> {tr("listen", lang)}
              </button>
              {c.phone && (
                <a href={`tel:${c.phone}`} className="tactile inline-flex h-9 items-center gap-1 rounded-full bg-cash-bg px-3 text-[12.5px] font-semibold text-cash-ink">
                  <Phone size={13} strokeWidth={1.75} /> Call
                </a>
              )}
            </div>
          </div>
          <div className="text-[13px] text-ink-2">
            {c.role_tag ?? "Customer"} · Last paid {shortDate(c.last_paid_at)}
            {c.days_overdue ? ` · oldest unpaid ${c.days_overdue}d` : ""}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PrimaryButton tone="cash" onClick={() => openSheet({ type: "wasooli", customerId: c.id })}>
            Wasooli
          </PrimaryButton>
          <SecondaryButton
            onClick={() =>
              openSheet({
                type: "promise",
                key: newKey("wada"),
                trace: null,
                proposal: {
                  customer: {
                    mention: c.name,
                    candidates: [{ id: c.id, name: c.name, role_tag: c.role_tag ?? null, balance_paisa: c.balance_paisa, score: 1 }],
                    selected_id: c.id,
                    ambiguous: false,
                    match_ms: 0,
                  },
                  promise_date: isoDate(pktToday()),
                },
              })
            }
            className="flex items-center justify-center gap-1.5"
          >
            <Calendar size={14} strokeWidth={1.75} /> Set Wada Date
          </SecondaryButton>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void handleKhataLink("wa")}
            disabled={linkBusy !== null}
            className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] border border-cash/30 bg-cash-bg px-3 text-[13px] font-semibold text-cash-ink"
          >
            {linkBusy === "wa" ? <Spinner className="h-3.5 w-3.5" /> : <Link2 size={14} strokeWidth={1.75} />}
            WhatsApp Statement
          </button>
          <button
            onClick={() => openSheet({ type: "return", customerId: c.id })}
            className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] border border-black/15 bg-surface-sunken px-3 text-[13px] font-semibold"
          >
            <RotateCcw size={14} strokeWidth={1.75} /> Item Return
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="tactile flex h-10 w-full items-center justify-between rounded-[12px] px-2 text-[13px] font-semibold text-ink-2"
        >
          <span>More options (Phone, Udhaar limit, Link, Maaf)</span>
          {showMore ? <ChevronUp size={15} strokeWidth={1.75} /> : <ChevronDown size={15} strokeWidth={1.75} />}
        </button>

        {showMore && (
          <div className="space-y-2.5 border-t border-black/10 pt-2.5">
            <div className="flex gap-2">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (03xx…)" inputMode="tel" className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
              <input value={roleTag} onChange={(e) => setRoleTag(e.target.value)} placeholder="Tag / Family" className="h-11 w-[130px] rounded-[12px] bg-canvas px-3 text-[14px] outline-none" />
              <button
                onClick={async () => {
                  try {
                    await api("/api/shop/customer-update", { json: { customer_id: c.id, phone, role_tag: roleTag } });
                    await refresh();
                    toast("Customer details saved", "ok");
                  } catch (e) {
                    toast(friendlyError(e), "err");
                  }
                }}
                className="tactile h-11 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white"
              >
                Save
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={limitRs}
                onChange={(e) => setLimitRs(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Udhaar limit (Rs. — blank = none)"
                className="num h-10 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[14px] outline-none"
              />
              <button
                onClick={async () => {
                  try {
                    const val = limitRs.trim() ? rupeesToPaisa(Number(limitRs)) : null;
                    await api("/api/shop/customer-credit-limit", { json: { customer_id: c.id, credit_limit_paisa: val } });
                    await refresh();
                    toast(val !== null ? `Credit limit ${formatRs(val)} set` : "Credit limit cleared", "ok");
                  } catch (e) {
                    toast(friendlyError(e), "err");
                  }
                }}
                className="tactile h-10 rounded-[12px] bg-surface-sunken px-3 text-[13px] font-semibold"
              >
                Set Limit
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void handleKhataLink("open")}
                disabled={linkBusy !== null}
                className="tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] border border-black/15 bg-surface-sunken px-3 text-[13px] font-semibold"
              >
                {linkBusy === "open" ? <Spinner className="h-3.5 w-3.5" /> : <ExternalLink size={14} strokeWidth={1.75} />}
                Preview Khata Link
              </button>
              <button
                onClick={() => void handleKhataLink("copy")}
                disabled={linkBusy !== null}
                className="tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] border border-black/15 bg-surface-sunken px-3 text-[13px] font-semibold"
              >
                {linkBusy === "copy" ? <Spinner className="h-3.5 w-3.5" /> : <Link2 size={14} strokeWidth={1.75} />}
                Copy Link
              </button>
            </div>
            <a
              href={`/report?customer_id=${c.id}`}
              target="_blank"
              rel="noreferrer"
              className="tactile flex h-10 w-full items-center justify-center gap-1.5 rounded-[12px] border border-black/15 bg-surface text-[13px] font-semibold text-ink"
            >
              <Printer size={14} strokeWidth={1.75} /> Print / PDF Dispute Statement
            </a>
            {remLog.length > 0 && (
              <div className="rounded-[12px] bg-canvas px-3 py-2 text-[12px] text-ink-2">
                <span className="font-semibold text-ink">Reminder history:</span>{" "}
                {remLog.slice(0, 3).map((r) => `${r.channel.toUpperCase()} (${new Date(r.at).toLocaleDateString("en-PK", { day: "numeric", month: "short" })})`).join(" · ")}
              </div>
            )}
            {c.balance_paisa > 0 && !helperMode && (
              <div className="surface-card p-3">
                {!writeOffOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      setWriteOffRs(String(c.balance_paisa / 100));
                      setWriteOffOpen(true);
                    }}
                    className="flex w-full items-center justify-between text-[13px] font-semibold text-udhaar-ink"
                  >
                    <span>Maaf / Write-off Bad Debt</span>
                    <span className="text-[12px] text-ink-2">Balanced A/R adjustment</span>
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="text-[12.5px] font-semibold text-udhaar-ink">Write-off amount (max {formatRs(c.balance_paisa)})</div>
                    <div className="flex gap-2">
                      <input
                        inputMode="numeric"
                        value={writeOffRs}
                        onChange={(e) => setWriteOffRs(e.target.value.replace(/[^\d]/g, ""))}
                        className="num h-10 min-w-0 flex-1 rounded-[10px] bg-canvas px-3 text-[15px] font-semibold outline-none"
                      />
                      <button
                        type="button"
                        disabled={writeOffBusy || Number(writeOffRs) <= 0}
                        onClick={async () => {
                          setWriteOffBusy(true);
                          try {
                            await api<CommitResponse>("/api/transactions/write-off", {
                              json: {
                                idempotency_key: newKey("wo"),
                                customer_id: c.id,
                                amount_paisa: rupeesToPaisa(Number(writeOffRs)),
                                reason: "bad-debt-maaf",
                                audit_meta: { channel: "khata-writeoff" },
                              },
                            });
                            await refresh();
                            setWriteOffOpen(false);
                            toast("Write-off darj ho gaya ✓", "ok");
                          } catch (e) {
                            toast(friendlyError(e), "err");
                          } finally {
                            setWriteOffBusy(false);
                          }
                        }}
                        className="tactile h-10 rounded-[10px] bg-udhaar px-3 text-[13px] font-semibold text-white disabled:opacity-50"
                      >
                        {writeOffBusy ? <Spinner /> : "Confirm Write-off"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="section-label pt-1">Khata history</div>
        <div className="surface-card overflow-hidden">
          {items === null && <div className="flex items-center justify-center p-4 text-[13px] text-ink-2"><Spinner /></div>}
          {items !== null && history.length === 0 && <div className="px-4 py-4 text-[13px] text-ink-2">Koi entry nahi</div>}
          {history.map((t) => (
            <FeedRow key={t.id} t={t} onOpen={() => openSheet(xrayOn && t.seq >= 0 ? { type: "xray", txId: t.id } : { type: "entry", tx: t, txId: t.id })} />
          ))}
          {nextSeq !== null && (
            <button onClick={() => void loadMore()} disabled={loadingMore} className="hairline-t tactile flex h-11 w-full items-center justify-center text-[13px] font-semibold text-ink-2">
              {loadingMore ? <Spinner /> : "Load older khata"}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── Screen 6 · Ed25519 SMEConnect Trade Passport ───────────────────────────── */

interface PassportResponse {
  summary: TradeSummary;
  payload: PassportPayload;
  token: string;
  verify_url: string;
  public_key_hex: string;
  disclaimer: string;
  chain: { ok: boolean; checked: number };
}

export function PassportSheet({ onClose }: { onClose: () => void }) {
  const { toast, xrayOn } = useDukaan();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [p, setP] = useState<PassportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sigOk, setSigOk] = useState<boolean | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadPassport = (d: "7" | "30" | "90") => {
    setP(null);
    setErr(null);
    setSigOk(null);
    api<PassportResponse>(`/api/reports/trade-summary?days=${d}`)
      .then(async (r) => {
        setP(r);
        const pinned = process.env.NEXT_PUBLIC_ED25519_PUBLIC_KEY || r.public_key_hex;
        const v = await verifyPassport(r.token, pinned);
        setSigOk(v.valid);
      })
      .catch((e) => {
        setErr(friendlyError(e));
        toast(friendlyError(e), "err");
      });
  };

  useEffect(() => {
    loadPassport(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const s = p?.summary;
  const pl = p?.payload;
  return (
    <Sheet open onClose={onClose} title={xrayOn ? "SMEConnect Trade Passport" : "Karobar Summary (QR)"} right={<button onClick={onClose} className="text-[16px] font-semibold">Done</button>}>
      <div className="space-y-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <Segmented<"7" | "30" | "90">
          value={days}
          onChange={setDays}
          options={[
            { value: "7", label: "7 Days" },
            { value: "30", label: "30 Days" },
            { value: "90", label: "90 Days" },
          ]}
        />
        <div className="overflow-hidden rounded-[20px] border border-pass-emerald/30 bg-pass-bg text-pass-ink">
          <div className="h-[3px] bg-pass-emerald" />
          {!p ? (
            <div className="flex h-[420px] items-center justify-center gap-2 text-pass-muted">{err ? err : <><Spinner /> {xrayOn ? "Signing with Ed25519…" : "Summary tayyar ho rahi hai…"}</>}</div>
          ) : (
            <>
              <div className="px-5 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[15px]">
                    <b>DukaanOS</b> <span className="text-pass-muted">{xrayOn ? "SMEConnect" : "Karobar"}</span>
                  </span>
                  <span className="rounded-full border border-pass-emerald/50 px-2 py-0.5 font-mono text-[10.5px] tracking-wide text-pass-emerald">
                    {sigOk === false ? "SIG INVALID" : xrayOn ? "Ed25519 VERIFIED" : "VERIFIED ✓"}
                  </span>
                </div>
                <div className="mt-3 text-[24px] font-bold tracking-[-0.02em]">{s!.shop_name}</div>
                <div className="text-[13.5px] text-pass-muted">
                  {s!.city} · Active {s!.active_days} days
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-pass-muted">{xrayOn ? `${pl!.pd}D GMV` : `${pl!.pd}D Bikri`}</div>
                    <div className="num mt-0.5 text-[17px] font-bold">{formatRsCompact(s!.gmv_paisa)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-pass-muted">Cash/Credit</div>
                    <div className="num mt-0.5 text-[17px] font-bold">
                      {Math.round(pl!.cash_bp / 100)}% / {100 - Math.round(pl!.cash_bp / 100)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-pass-muted">Recovery</div>
                    <div className="num mt-0.5 text-[17px] font-bold text-pass-emerald">{(pl!.rec_bp / 100).toFixed(1)}%</div>
                  </div>
                </div>
                {pl!.v === 2 && (
                  <div className="mt-3 flex items-center justify-between rounded-[12px] border border-pass-emerald/30 bg-pass-elevated px-3 py-2.5">
                    <div>
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-pass-muted">Gahak-tasdeeq udhaar</div>
                      <div className="text-[12px] text-pass-muted">{pl!.att ?? 0} confirmations · {((pl!.dr_bp ?? 0) / 100).toFixed(1)}% disputed</div>
                    </div>
                    <div className="num text-[22px] font-bold text-pass-emerald">{((pl!.vr_bp ?? 0) / 100).toFixed(0)}%</div>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-white/10 py-3 font-mono text-[11.5px]">
                  <span className="text-pass-muted">
                    {xrayOn ? `SHA-256 ${pl!.h.slice(0, 4)}…${pl!.h.slice(-4)} · ${pl!.txn} links` : `Verified Record · ${pl!.txn} entries`}
                  </span>
                  <span className={sigOk ? "text-pass-emerald" : "text-udhaar"}>{sigOk === null ? "VERIFYING…" : sigOk ? (xrayOn ? "SIG VALID ✓" : "VALID ✓") : "INVALID ✗"}</span>
                </div>
              </div>
              <div className="flex flex-col items-center bg-pass-elevated px-5 py-5">
                <div className="rounded-[16px] bg-white p-3">
                  <QRCode value={p.verify_url} size={168} level="M" fgColor="#0F172A" bgColor="#FFFFFF" />
                </div>
                <a href={xrayOn ? `/verify?xray=1#${p.token}` : `/verify#${p.token}`} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1.5 rounded-[10px] border border-pass-emerald/50 bg-pass-emerald/10 px-3 py-2 font-mono text-[12px] text-pass-emerald">
                  {xrayOn ? "Simulate Judge Phone Scan (/verify)" : "Verify link kholein"} <ExternalLink size={12} strokeWidth={1.75} />
                </a>
              </div>
              <div className="px-5 py-3 text-center text-[11.5px] leading-[16px] text-pass-muted">
                {xrayOn ? p.disclaimer : "Sirf dukaandar ki marzi se share ki gayi karobari summary — loan ya tax faisla nahi."}
              </div>
            </>
          )}
        </div>
        {p && (
          <div className="space-y-2.5">
            <div className="surface-card p-3.5 text-[12.5px] leading-[18px] text-ink-2">
              <div className="font-semibold text-ink">Kya share hota hai (Owner-consented)</div>
              <div className="mt-1">Share hota hai: {days}-din ki kul bikri, cash/udhaar hissa, wasooli %, active din, gahak-tasdeeq %.</div>
              <div className="mt-1 text-cash-ink">Kabhi share nahi hota: CNIC, tax/FBR data, gahak ke naam/phone, ya bills ki tafseel.</div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <a href="/report" target="_blank" rel="noreferrer" className="tactile flex h-11 items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[14px] font-semibold">
                <Printer size={15} strokeWidth={1.75} /> Full report / PDF
              </a>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(p.verify_url);
                  toast("Verify link copied", "ok");
                }}
                className="tactile h-11 rounded-[12px] bg-surface-sunken text-[14px] font-semibold"
              >
                Copy verify link
              </button>
            </div>
            <button
              type="button"
              disabled={revoking}
              onClick={async () => {
                setRevoking(true);
                try {
                  await api("/api/shop/passport-revoke", { json: {} });
                  toast("Purane sab QR links band ho gaye — naya QR tayyar ho raha hai", "ok");
                  loadPassport(days);
                } catch (e) {
                  toast(friendlyError(e), "err");
                } finally {
                  setRevoking(false);
                }
              }}
              className="tactile flex h-10 w-full items-center justify-center gap-1.5 rounded-[12px] bg-udhaar-bg text-[13px] font-semibold text-udhaar-ink disabled:opacity-50"
            >
              <ShieldAlert size={14} strokeWidth={1.75} /> {revoking ? "Band ho raha hai…" : xrayOn ? "Revoke previously shared Passports" : "Purane shared QR links band karein"}
            </button>
          </div>
        )}
        {p && <div className="mt-2 text-center text-[12px] text-ink-2">Receivable today {formatRs(s!.receivable_paisa)} · {p.chain.checked} entries verified</div>}
      </div>
    </Sheet>
  );
}

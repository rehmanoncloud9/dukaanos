"use client";

import { ExternalLink, Printer, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import type { StateCustomer } from "@/lib/api/contracts";
import { api, friendlyError } from "@/lib/client/api";
import { tr } from "@/lib/client/i18n";
import { useDukaan } from "@/lib/client/store";
import { verifyPassport, type PassportPayload, type TradeSummary } from "@/lib/crypto/passport";
import { reminderText, smsLink, waLink } from "@/lib/domain/messages";
import { formatRs, formatRsCompact } from "@/lib/domain/money";
import { FeedRow } from "./MunshiTab";
import { cx, Money, PrimaryButton, Segmented, Sheet, shortDate, Spinner } from "./ui";

type Filter = "all" | "overdue" | "settled";

export function KhataTab() {
  const { state, openSheet, lang } = useDukaan();
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);

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
  const list = (filter === "overdue" ? overdue : filter === "settled" ? customers.filter((c) => c.balance_paisa <= 0) : customers).slice().sort((a, b) => b.balance_paisa - a.balance_paisa);

  if (!state) return <div className="surface-card h-[400px] animate-pulse" />;

  return (
    <div className="space-y-3">
      <div className="surface-card p-4">
        <div className={cx("section-label", lang === "ur" && "urdu-ui")} dir="auto">{tr("totalReceivable", lang)}</div>
        <Money paisa={receivable} className="mt-1 block text-[34px] font-bold leading-[38px] tracking-[-0.03em] text-udhaar" />
        <div className="hairline-t mt-3 flex justify-between pt-3 text-[14px]">
          <span className="text-ink-2" dir="auto">{active.length} {tr("activeAccounts", lang)}</span>
          <span className="font-semibold text-udhaar" dir="auto">{overdue.length} {tr("overdue", lang)}</span>
        </div>
      </div>

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: tr("all", lang) },
          { value: "overdue", label: tr("overdueFilter", lang) },
          { value: "settled", label: tr("settled", lang) },
        ]}
      />

      <div className="surface-card overflow-hidden">
        {list.length === 0 && <div className="px-4 py-6 text-center text-[14px] text-ink-2">Koi account nahi</div>}
        {list.map((c) => (
          <DebtorRow key={c.id} c={c} shop={state.shop.name} onOpen={() => openSheet({ type: "customer", customerId: c.id })} onWasooli={() => openSheet({ type: "wasooli", customerId: c.id })} />
        ))}
      </div>

      <button onClick={() => setAdding(true)} className="tactile flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-black/20 text-[14px] font-semibold text-ink-2">
        <UserPlus size={16} strokeWidth={1.75} /> New customer
      </button>
      {adding && <NewCustomerSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

function DebtorRow({ c, shop, onOpen, onWasooli }: { c: StateCustomer; shop: string; onOpen: () => void; onWasooli: () => void }) {
  const msg = reminderText({ name: c.name, shop, balance_paisa: c.balance_paisa, days_overdue: c.days_overdue });
  const od = (c.days_overdue ?? 0) > 15;
  return (
    <div className="hairline-b px-4 py-3.5 last:border-b-0">
      <button onClick={onOpen} className="flex w-full items-start gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold">{c.name}</span>
            {od && <span className="rounded-[6px] bg-udhaar-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-udhaar-ink">{c.days_overdue}d overdue</span>}
          </div>
          <div className="text-[13px] text-ink-2">
            {c.role_tag ?? "Customer"} · Last paid {shortDate(c.last_paid_at)}
          </div>
        </div>
        <Money paisa={c.balance_paisa} className={cx("text-[18px] font-bold", c.balance_paisa > 0 ? "text-udhaar" : "text-cash")} />
      </button>
      <div className="mt-2.5 flex gap-2">
        <button onClick={onWasooli} className="tactile h-9 rounded-full border border-cash/30 bg-cash-bg px-3.5 text-[13.5px] font-semibold text-cash-ink">
          Wasooli
        </button>
        <a href={waLink(c.phone, msg)} target="_blank" rel="noreferrer" className="tactile flex h-9 items-center rounded-full border border-black/10 bg-surface-sunken px-3.5 text-[13.5px] font-semibold">
          WhatsApp
        </a>
        <a href={smsLink(c.phone, msg)} className="tactile flex h-9 items-center rounded-full border border-black/10 bg-surface-sunken px-3.5 text-[13.5px] font-semibold">
          SMS (2G)
        </a>
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
  const { state, openSheet, refresh, toast } = useDukaan();
  const c = state?.customers.find((x) => x.id === customerId);
  const [phone, setPhone] = useState(c?.phone ?? "");
  const [items, setItems] = useState<import("@/lib/api/contracts").FeedTx[] | null>(null);
  const [nextSeq, setNextSeq] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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
          <div className="section-label">Balance</div>
          <Money paisa={c.balance_paisa} className={cx("mt-1 block text-[30px] font-bold", c.balance_paisa > 0 ? "text-udhaar" : "text-cash")} />
          <div className="text-[13px] text-ink-2">
            {c.role_tag ?? "Customer"} · Last paid {shortDate(c.last_paid_at)}
            {c.days_overdue ? ` · oldest unpaid ${c.days_overdue}d` : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
          <button
            onClick={async () => {
              try {
                await api("/api/shop/customer-update", { json: { customer_id: c.id, phone } });
                await refresh();
                toast("Phone saved", "ok");
              } catch (e) {
                toast(friendlyError(e), "err");
              }
            }}
            className="tactile h-11 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white"
          >
            Save
          </button>
        </div>
        <PrimaryButton tone="cash" className="w-full" onClick={() => openSheet({ type: "wasooli", customerId: c.id })}>
          Wasooli
        </PrimaryButton>
        <div className="section-label pt-1">Khata history (SHA-256 chained)</div>
        <div className="surface-card overflow-hidden">
          {items === null && <div className="flex items-center justify-center p-4 text-[13px] text-ink-2"><Spinner /></div>}
          {items !== null && history.length === 0 && <div className="px-4 py-4 text-[13px] text-ink-2">Koi entry nahi</div>}
          {history.map((t) => (
            <FeedRow key={t.id} t={t} onOpen={() => openSheet({ type: "xray", txId: t.id })} />
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
  const { toast } = useDukaan();
  const [p, setP] = useState<PassportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sigOk, setSigOk] = useState<boolean | null>(null);

  useEffect(() => {
    api<PassportResponse>("/api/reports/trade-summary?days=30")
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
  }, [toast]);

  const s = p?.summary;
  const pl = p?.payload;
  return (
    <Sheet open onClose={onClose} title="SMEConnect Trade Passport" right={<button onClick={onClose} className="text-[16px] font-semibold">Done</button>}>
      <div className="px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="overflow-hidden rounded-[20px] border border-pass-emerald/30 bg-pass-bg text-pass-ink">
          <div className="h-[3px] bg-pass-emerald" />
          {!p ? (
            <div className="flex h-[420px] items-center justify-center gap-2 text-pass-muted">{err ? err : <><Spinner /> Signing with Ed25519…</>}</div>
          ) : (
            <>
              <div className="px-5 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[15px]">
                    <b>DukaanOS</b> <span className="text-pass-muted">SMEConnect</span>
                  </span>
                  <span className="rounded-full border border-pass-emerald/50 px-2 py-0.5 font-mono text-[10.5px] tracking-wide text-pass-emerald">
                    {sigOk === false ? "SIG INVALID" : "Ed25519 VERIFIED"}
                  </span>
                </div>
                <div className="mt-3 text-[24px] font-bold tracking-[-0.02em]">{s!.shop_name}</div>
                <div className="text-[13.5px] text-pass-muted">
                  {s!.city} · Active {s!.active_days} days
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-pass-muted">{pl!.pd}D GMV</div>
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
                <div className="mt-3 flex items-center justify-between border-t border-white/10 py-3 font-mono text-[11.5px]">
                  <span className="text-pass-muted">
                    SHA-256 {pl!.h.slice(0, 4)}…{pl!.h.slice(-4)} · {pl!.txn} links
                  </span>
                  <span className={sigOk ? "text-pass-emerald" : "text-udhaar"}>{sigOk === null ? "VERIFYING…" : sigOk ? "SIG VALID ✓" : "SIG INVALID ✗"}</span>
                </div>
              </div>
              <div className="flex flex-col items-center bg-pass-elevated px-5 py-5">
                <div className="rounded-[16px] bg-white p-3">
                  <QRCode value={p.verify_url} size={168} level="M" fgColor="#0F172A" bgColor="#FFFFFF" />
                </div>
                <a href={p.verify_url} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1.5 rounded-[10px] border border-pass-emerald/50 bg-pass-emerald/10 px-3 py-2 font-mono text-[12px] text-pass-emerald">
                  Simulate Judge Phone Scan (/verify) <ExternalLink size={12} strokeWidth={1.75} />
                </a>
              </div>
              <div className="px-5 py-3 text-center text-[11.5px] leading-[16px] text-pass-muted">{p.disclaimer}</div>
            </>
          )}
        </div>
        {p && (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
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
        )}
        {p && <div className="mt-2 text-center text-[12px] text-ink-2">Receivable today {formatRs(s!.receivable_paisa)} · chain {p.chain.checked} links verified before signing</div>}
      </div>
    </Sheet>
  );
}

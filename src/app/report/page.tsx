"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import type { FeedTx, ShopState } from "@/lib/api/contracts";
import { api, friendlyError, setApiShop } from "@/lib/client/api";
import { computeBharosaIndex, type PassportPayload, type TradeSummary } from "@/lib/crypto/passport";
import { formatBaseQty, type BaseUnit } from "@/lib/domain/desi-units";
import { formatRs } from "@/lib/domain/money";

interface Passport {
  summary: TradeSummary;
  payload: PassportPayload;
  verify_url: string;
  signature_hex: string;
  public_key_hex: string;
  disclaimer: string;
  chain: { ok: boolean; checked: number };
}

/** Printable Trade Summary or Customer Khata Dispute Statement — print / Save as PDF. */
export default function ReportPage() {
  const [p, setP] = useState<Passport | null>(null);
  const [s, setS] = useState<ShopState | null>(null);
  const [custLedger, setCustLedger] = useState<FeedTx[] | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [xray, setXray] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const shop = localStorage.getItem("dukaanos.shop");
    if (!shop) {
      setErr("Open the app and sign in first.");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("customer_id");
    setCustomerId(cid);
    setXray(params.get("xray") === "1");
    setApiShop(shop);

    if (cid) {
      Promise.all([
        api<ShopState>("/api/shop/state"),
        api<{ items: FeedTx[] }>(`/api/shop/customer-ledger?customer_id=${encodeURIComponent(cid)}&limit=100`),
      ])
        .then(([shopState, led]) => {
          setS(shopState);
          setCustLedger(led.items);
        })
        .catch((e) => setErr(friendlyError(e)));
    } else {
      Promise.all([api<Passport>("/api/reports/trade-summary?days=30"), api<ShopState>("/api/shop/state")])
        .then(([a, b]) => {
          setP(a);
          setS(b);
        })
        .catch((e) => setErr(friendlyError(e)));
    }
  }, []);

  if (err) return <main className="mx-auto max-w-[800px] p-8 text-[15px]">{err}</main>;

  if (customerId) {
    if (!s || !custLedger) return <main className="mx-auto max-w-[800px] p-8 text-[15px] text-ink-2">Khata statement tayyar ho raha hai…</main>;
    const cust = s.customers.find((c) => c.id === customerId);
    if (!cust) return <main className="mx-auto max-w-[800px] p-8 text-[15px]">Customer nahi mila.</main>;
    return (
      <main className="mx-auto max-w-[800px] bg-white p-8 text-ink print:p-0">
        <div className="no-print mb-6 flex justify-end">
          <button onClick={() => window.print()} className="tactile flex h-10 items-center gap-2 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white">
            <Printer size={15} strokeWidth={1.75} /> Print / Save PDF
          </button>
        </div>
        <header className="border-b border-black/10 pb-4">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">{s.shop.name} · Customer Khata Statement</div>
          <h1 className="mt-1 text-[28px] font-bold tracking-[-0.02em]">{cust.name}</h1>
          <div className="mt-1 flex flex-wrap gap-4 text-[14px] text-ink-2">
            <span>{cust.phone || "Phone not recorded"}</span>
            {cust.role_tag && <span>Tag: {cust.role_tag}</span>}
            <span>Date: {new Date().toLocaleDateString("en-PK", { dateStyle: "medium" })}</span>
          </div>
          <div className="mt-3 text-[20px] font-bold text-udhaar">
            Kul Baqaya: {formatRs(cust.balance_paisa)}
          </div>
        </header>

        <section className="mt-6">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-black/15 text-[11px] uppercase tracking-[0.06em] text-ink-2">
                <th className="py-2">#</th>
                <th className="py-2">Date</th>
                <th className="py-2">Type &amp; Details</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Cash</th>
                <th className="py-2 text-right">Udhaar</th>
              </tr>
            </thead>
            <tbody>
              {custLedger.map((t) => (
                <tr key={t.id} className={`border-b border-black/5 ${t.is_reversed ? "line-through opacity-50" : ""}`}>
                  <td className="py-2 font-mono text-[11.5px]">{t.seq}</td>
                  <td className="py-2">{new Date(t.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "2-digit" })}</td>
                  <td className="py-2">
                    <span className="font-semibold capitalize">{t.type}</span>
                    {t.lines.length > 0 && (
                      <div className="text-[11.5px] text-ink-2">
                        {t.lines.map((l) => `${formatBaseQty(l.qty_base_units, l.base_unit as BaseUnit)} ${l.name}`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="num py-2 text-right font-semibold">{formatRs(Math.abs(t.total_paisa))}</td>
                  <td className="num py-2 text-right">{formatRs(t.cash_paid_paisa)}</td>
                  <td className="num py-2 text-right font-semibold text-udhaar">{t.credit_paisa !== 0 ? formatRs(t.credit_paisa) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-10 grid grid-cols-2 gap-8 border-t border-black/10 pt-6 text-[13px]">
          <div>
            <div className="h-10 border-b border-black/30" />
            <div className="mt-1 font-semibold">Shopkeeper ({s.shop.name})</div>
          </div>
          <div>
            <div className="h-10 border-b border-black/30" />
            <div className="mt-1 font-semibold">Customer ({cust.name})</div>
          </div>
        </section>
      </main>
    );
  }

  if (!p || !s) return <main className="mx-auto max-w-[800px] p-8 text-[15px] text-ink-2">Report tayyar ho raha hai…</main>;
  const sum = p.summary;
  const bharosa = computeBharosaIndex(sum);
  const debtors = s.customers.filter((c) => c.balance_paisa > 0);
  return (
    <main className="mx-auto max-w-[800px] bg-white p-8 text-ink print:p-0">
      <div className="no-print mb-6 flex justify-end">
        <button onClick={() => window.print()} className="tactile flex h-10 items-center gap-2 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white">
          <Printer size={15} strokeWidth={1.75} /> Print / Save PDF
        </button>
      </div>
      <header className="flex items-start justify-between border-b border-black/10 pb-5">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">{xray ? "DukaanOS · SBP SMEConnect Trade Summary" : "DukaanOS · Karobar Summary"}</div>
          <h1 className="mt-1 text-[30px] font-bold tracking-[-0.02em]">{sum.shop_name}</h1>
          <div className="text-[14px] text-ink-2">
            {sum.city} · active {sum.active_days} days · period {p.payload.f} → {p.payload.t}
          </div>
        </div>
        <div className="rounded-[12px] border border-black/10 p-2">
          <QRCode value={p.verify_url} size={120} level="M" fgColor="#0F172A" />
        </div>
      </header>

      <section className="mt-6 grid grid-cols-4 gap-3">
        {[
          ["Bharosa Index", `${bharosa.score}/100`],
          ["Customer Verified", `${bharosa.verified_trust}/60`],
          ["Activity", `${bharosa.self_reported}/40`],
          [xray ? "30-day GMV" : "30-day Bikri", formatRs(sum.gmv_paisa)],
          ["Sales", String(sum.sales_count)],
          ["Cash share", `${(p.payload.cash_bp / 100).toFixed(1)}%`],
          ["Recovery rate", `${(p.payload.rec_bp / 100).toFixed(1)}%`],
          ["Cash sales", formatRs(sum.cash_sales_paisa)],
          ["Credit sales", formatRs(sum.credit_sales_paisa)],
          ["Recovered", formatRs(sum.recovered_paisa)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[12px] border border-black/10 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">{k}</div>
            <div className="num mt-1 text-[17px] font-bold">{v}</div>
          </div>
        ))}
      </section>

      {xray && (
        <section className="mt-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Integrity</h2>
          <table className="mt-2 w-full font-mono text-[11.5px]">
            <tbody>
              <tr><td className="py-1 pr-3 text-ink-2">Ledger balanced (ΣDr = ΣCr)</td><td>{sum.ledger_balanced ? "YES" : "NO"}</td></tr>
              <tr><td className="py-1 pr-3 text-ink-2">SHA-256 chain</td><td>{p.chain.ok ? `CHAIN_OK · ${p.chain.checked} links recomputed` : "BROKEN"}</td></tr>
              <tr><td className="py-1 pr-3 text-ink-2">Head entry_hash</td><td className="break-all">{sum.head_entry_hash}</td></tr>
              <tr><td className="py-1 pr-3 text-ink-2">Ed25519 public key</td><td className="break-all">{p.public_key_hex}</td></tr>
              <tr><td className="py-1 pr-3 text-ink-2">Signature</td><td className="break-all">{p.signature_hex}</td></tr>
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Receivables ({formatRs(sum.receivable_paisa)})</h2>
          <table className="mt-2 w-full text-[13px]">
            <tbody>
              {debtors.map((c) => (
                <tr key={c.id} className="border-b border-black/5">
                  <td className="py-1.5">{c.name}</td>
                  <td className="py-1.5 text-ink-2">{c.days_overdue ? `${c.days_overdue}d` : ""}</td>
                  <td className="num py-1.5 text-right">{formatRs(c.balance_paisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Inventory snapshot</h2>
          <table className="mt-2 w-full text-[13px]">
            <tbody>
              {s.products.slice(0, 14).map((x) => (
                <tr key={x.id} className="border-b border-black/5">
                  <td className="py-1.5">{x.name}</td>
                  <td className="num py-1.5 text-right">{formatBaseQty(x.stock_base_units, x.base_unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-8 border-t border-black/10 pt-4 text-[11.5px] leading-[16px] text-ink-2">
        {xray ? p.disclaimer : "Sirf dukaandar ki marzi se tayyar ki gayi karobari summary — loan ya tax faisla nahi."}
      </footer>
    </main>
  );
}

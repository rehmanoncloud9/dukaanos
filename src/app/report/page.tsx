"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import type { ShopState } from "@/lib/api/contracts";
import { api, friendlyError, setApiShop } from "@/lib/client/api";
import type { PassportPayload, TradeSummary } from "@/lib/crypto/passport";
import { formatBaseQty } from "@/lib/domain/desi-units";
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

/** F-12: full SMEConnect trade report — print / Save as PDF from the browser (A4 print stylesheet). */
export default function ReportPage() {
  const [p, setP] = useState<Passport | null>(null);
  const [s, setS] = useState<ShopState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const shop = localStorage.getItem("dukaanos.shop");
    if (!shop) {
      setErr("Open the app and sign in first.");
      return;
    }
    setApiShop(shop);
    Promise.all([api<Passport>("/api/reports/trade-summary?days=30"), api<ShopState>("/api/shop/state")])
      .then(([a, b]) => {
        setP(a);
        setS(b);
      })
      .catch((e) => setErr(friendlyError(e)));
  }, []);

  if (err) return <main className="mx-auto max-w-[800px] p-8 text-[15px]">{err}</main>;
  if (!p || !s) return <main className="mx-auto max-w-[800px] p-8 text-[15px] text-ink-2">Preparing signed report…</main>;
  const sum = p.summary;
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
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">DukaanOS · SBP SMEConnect Trade Summary</div>
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
          ["30-day GMV", formatRs(sum.gmv_paisa)],
          ["Sales", String(sum.sales_count)],
          ["Cash share", `${(p.payload.cash_bp / 100).toFixed(1)}%`],
          ["Recovery rate", `${(p.payload.rec_bp / 100).toFixed(1)}%`],
          ["Cash sales", formatRs(sum.cash_sales_paisa)],
          ["Credit sales", formatRs(sum.credit_sales_paisa)],
          ["Recovered", formatRs(sum.recovered_paisa)],
          ["Wholesale purchases", formatRs(sum.purchases_paisa)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[12px] border border-black/10 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">{k}</div>
            <div className="num mt-1 text-[17px] font-bold">{v}</div>
          </div>
        ))}
      </section>

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
        {p.disclaimer} Verify at {p.verify_url.split("#")[0]} by scanning the QR. Owner-consented export; zero FBR linkage; zero CNIC collected.
      </footer>
    </main>
  );
}

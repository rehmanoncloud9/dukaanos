"use client";

import { Check, Copy, ShieldCheck, Volume2, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRs } from "@/lib/domain/money";
import { quickWadaOptions, wadaLabel } from "@/lib/domain/wada";

/**
 * Mutual Khata — the CUSTOMER's page (no login, no app install). Opened from the WhatsApp/SMS
 * the shopkeeper sends. One tap confirms or disputes each udhaar entry, gives a wada (promise)
 * date, or says "maine Raast se bhej diya". Every answer is SHA-256 chained on the server.
 */

interface View {
  shop: { name: string; city: string | null; raast_id: string | null };
  customer: { name: string; balance_paisa: number; last_paid_at: string | null };
  entries: Array<{ transaction_id: string; type: string; created_at: string; total_paisa: number; credit_paisa: number; cash_paid_paisa: number; summary: string | null; status: string; hash: string }>;
  promise: { promise_date: string; state: "open" | "kept" | "broken"; source: string } | null;
  paid_claims: Array<{ amount_paisa: number; created_at: string }>;
}

const SW = 1.75;

function key(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", timeZone: "Asia/Karachi" });
}

const ERRORS: Record<string, string> = {
  LINK_EXPIRED: "Yeh link purana ho gaya hai — dukaan se naya link mangwa lein.",
  LINK_REVOKED: "Is link ki jagah naya link bheja gaya hai.",
  LINK_INVALID: "Link sahi nahi hai.",
  RATE_LIMITED: "Thori der baad dobara koshish karein.",
};

export function MutualKhataClient() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(String(params?.token ?? ""));
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [claim, setClaim] = useState("");
  const [copied, setCopied] = useState(false);
  const wadaOptions = useMemo(() => quickWadaOptions(), []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/khata/statement?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(ERRORS[j?.error?.code] ?? j?.error?.message ?? "Kuch ghalat ho gaya");
      setView(j as View);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kuch ghalat ho gaya");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const attest = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError(null);
    try {
      const r = await fetch("/api/khata/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token, idempotency_key: key(), ...body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(ERRORS[j?.error?.code] ?? j?.error?.message ?? "Save nahi ho saka");
      setView(j.statement as View);
      setDone(label);
      navigator.vibrate?.(12);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save nahi ho saka");
    } finally {
      setBusy(null);
    }
  };

  const speak = () => {
    if (!view || typeof speechSynthesis === "undefined") return;
    const u = new SpeechSynthesisUtterance(`${view.customer.name} sahib, ${view.shop.name} par aap ka baqaya ${Math.round(view.customer.balance_paisa / 100)} rupay hai.`);
    const voice = speechSynthesis.getVoices().find((v) => /^(ur|hi)/i.test(v.lang)) ?? null;
    u.voice = voice;
    u.lang = voice?.lang ?? "ur-PK";
    u.rate = 0.92;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  if (error && !view) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center px-6 text-center">
        <X size={28} strokeWidth={SW} className="text-udhaar" aria-hidden />
        <p className="mt-3 text-[17px] font-semibold">{error}</p>
      </main>
    );
  }
  if (!view) {
    return <main className="mx-auto min-h-dvh max-w-[430px] px-5 pt-16 text-[15px] text-ink-2">Khata khul raha hai…</main>;
  }

  const credit = view.entries.filter((e) => e.type === "sale" && e.credit_paisa > 0);
  const pending = credit.filter((e) => e.status === "pending").length;
  const uniqueWada = wadaOptions.filter((o, i, all) => all.findIndex((x) => x.date === o.date) === i);

  return (
    <main className="mx-auto min-h-dvh max-w-[430px] px-4 pb-12 pt-8">
      <div className="section-label">Mutual Khata · {view.shop.name}{view.shop.city ? ` · ${view.shop.city}` : ""}</div>
      <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em]">{view.customer.name} sahib ka hisaab</h1>

      <section className="surface-card mt-4 p-4">
        <div className="section-label">Kul baqaya · Total due</div>
        <div className="num mt-1 text-[34px] font-bold leading-[38px] tracking-[-0.03em] text-udhaar">{formatRs(view.customer.balance_paisa)}</div>
        <p className="urdu-read mt-1 text-right text-ink" dir="rtl">آپ کا بقایا {formatRs(view.customer.balance_paisa)} ہے</p>
        <button type="button" onClick={speak} className="tactile mt-3 inline-flex h-12 items-center gap-2 rounded-[14px] border border-black/10 bg-canvas px-4 text-[15px] font-semibold">
          <Volume2 size={18} strokeWidth={SW} aria-hidden /> Sunain (listen)
        </button>
      </section>

      {done && (
        <div role="status" className="mt-3 flex items-center gap-2 rounded-xl bg-cash-bg px-4 py-3 text-[15px] font-semibold text-cash-ink">
          <Check size={16} strokeWidth={SW} aria-hidden /> Shukriya — {done} mehfooz ho gaya
        </div>
      )}
      {error && <div role="alert" className="mt-3 rounded-xl bg-udhaar-bg px-4 py-3 text-[14px] font-semibold text-udhaar-ink">{error}</div>}

      <section className="mt-5">
        <div className="section-label px-1">Udhaar entries{pending > 0 ? ` · ${pending} tasdeeq baqi` : ""}</div>
        <div className="surface-card mt-2 overflow-hidden">
          {credit.length === 0 && <p className="p-4 text-[15px] text-ink-2">Koi udhaar entry nahi.</p>}
          {credit.map((e) => (
            <div key={e.transaction_id} className="hairline-b p-4 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium">{e.summary ?? "Saman"}</div>
                  <div className="text-[13px] text-ink-2">{when(e.created_at)} · kul {formatRs(e.total_paisa)}{e.cash_paid_paisa > 0 ? ` · naqd ${formatRs(e.cash_paid_paisa)}` : ""}</div>
                </div>
                <div className="num shrink-0 text-[17px] font-bold text-udhaar">{formatRs(e.credit_paisa)}</div>
              </div>
              {e.status === "pending" ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={!!busy} onClick={() => void attest({ kind: "confirm", transaction_id: e.transaction_id }, "tasdeeq")}
                    className="tactile h-12 rounded-[14px] bg-ink text-[15px] font-semibold text-white disabled:opacity-50">
                    Haan, sahi hai
                  </button>
                  <button type="button" disabled={!!busy} onClick={() => void attest({ kind: "dispute", transaction_id: e.transaction_id }, "ikhtilaf")}
                    className="tactile h-12 rounded-[14px] border border-black/15 bg-white text-[15px] font-semibold disabled:opacity-50">
                    Ghalat hai
                  </button>
                </div>
              ) : (
                <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${e.status === "confirm" ? "bg-cash-bg text-cash-ink" : "bg-udhaar-bg text-udhaar-ink"}`}>
                  {e.status === "confirm" ? <Check size={14} strokeWidth={SW} aria-hidden /> : <X size={14} strokeWidth={SW} aria-hidden />}
                  {e.status === "confirm" ? "Aap ne tasdeeq ki" : "Aap ne ikhtilaf kiya — dukaandar se baat karein"}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {view.customer.balance_paisa > 0 && (
        <section className="mt-5">
          <div className="section-label px-1">Wada · Kab tak ada karein ge?</div>
          {view.promise && view.promise.state === "open" ? (
            <p className="surface-card mt-2 p-4 text-[15px]">Aap ka wada: <b>{wadaLabel(view.promise.promise_date)}</b></p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {uniqueWada.map((o) => (
                <button key={o.label} type="button" disabled={!!busy} onClick={() => void attest({ kind: "promise", promise_date: o.date }, "wada")}
                  className="tactile min-h-12 rounded-[14px] border border-black/10 bg-white px-3 py-2 text-[15px] font-semibold disabled:opacity-50">
                  {o.label} <span className="block text-[12.5px] font-normal text-ink-2">{wadaLabel(o.date)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {view.customer.balance_paisa > 0 && view.shop.raast_id && (
        <section className="mt-5">
          <div className="section-label px-1">Raast se ada karein</div>
          <div className="surface-card mt-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="num font-mono text-[15px] font-semibold">{view.shop.raast_id}</div>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(view.shop.raast_id ?? "").then(() => setCopied(true))}
                className="tactile inline-flex h-12 items-center gap-1.5 rounded-[14px] bg-canvas px-3 text-[14px] font-semibold">
                <Copy size={16} strokeWidth={SW} aria-hidden /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {view.paid_claims.length > 0 ? (
              <p className="mt-3 text-[14px] text-ink-2">Aap ne {formatRs(view.paid_claims[0].amount_paisa)} bhejne ka bataya — dukaandar tasdeeq karega.</p>
            ) : (
              <form className="mt-3 flex gap-2" onSubmit={(ev) => {
                ev.preventDefault();
                const rs = Number(claim.replace(/[^\d]/g, ""));
                if (rs > 0) void attest({ kind: "paid_claim", amount_paisa: rs * 100 }, "payment ki khabar");
              }}>
                <input inputMode="numeric" value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="Rs. kitne bheje?" aria-label="Amount sent in rupees"
                  className="h-12 min-w-0 flex-1 rounded-[14px] border border-black/15 px-3 text-[15px]" />
                <button type="submit" disabled={!!busy} className="tactile h-12 shrink-0 rounded-[14px] bg-cash px-4 text-[15px] font-semibold text-white disabled:opacity-50">
                  Maine bhej diya
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      <footer className="mt-8 flex items-start gap-2 px-1 text-[12.5px] leading-[18px] text-ink-2">
        <ShieldCheck size={16} strokeWidth={SW} className="mt-0.5 shrink-0 text-cash" aria-hidden />
        <span>Har entry aur aap ka har jawab SHA-256 hash-chain mein mehfooz hai — koi baad mein badal nahi sakta. Yeh link sirf aap ke liye hai. · DukaanOS</span>
      </footer>
    </main>
  );
}

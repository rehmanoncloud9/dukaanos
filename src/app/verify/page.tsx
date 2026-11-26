"use client";

import { ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { b64urlDecode, b64urlEncode, canonicalJson, verifyPassport, type PassportPayload, type VerifyResult } from "@/lib/crypto/passport";
import { formatRsCompact } from "@/lib/domain/money";

/**
 * Public /verify — any judge's phone camera opens this from the projector QR. The Ed25519 signature
 * is checked HERE, in the browser, against the pinned DukaanOS public key. No bank APIs, no server.
 */
export default function VerifyPage() {
  const [token, setToken] = useState("");
  const [res, setRes] = useState<VerifyResult | null>(null);
  const pub = process.env.NEXT_PUBLIC_ED25519_PUBLIC_KEY ?? "";

  const run = async (t: string) => {
    if (!t) return;
    setRes(await verifyPassport(t, pub));
  };

  useEffect(() => {
    const t = window.location.hash.replace(/^#/, "");
    if (t) {
      setToken(t);
      void verifyPassport(t, pub).then(setRes);
    }
  }, [pub]);

  /** Judge demo: change one number inside the signed payload → the signature must fail. */
  const tamper = () => {
    try {
      const [p, s] = token.split(".");
      const obj = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as PassportPayload;
      obj.gmv = obj.gmv * 2;
      const forged = `${b64urlEncode(new TextEncoder().encode(canonicalJson(obj)))}.${s}`;
      setToken(forged);
      void run(forged);
    } catch {
      /* ignore malformed */
    }
  };

  const p = res?.payload;
  return (
    <main className="mx-auto min-h-dvh max-w-[430px] px-5 pb-10 pt-10">
      <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">DukaanOS · SMEConnect</div>
      <h1 className="mt-1 text-[28px] font-bold tracking-[-0.02em]">Trade Passport verification</h1>
      <p className="mt-1 text-[14px] text-ink-2">Ed25519 signature checked on this device against the pinned DukaanOS key.</p>

      {res && (
        <div className={`mt-5 overflow-hidden rounded-[20px] border ${res.valid ? "border-pass-emerald/40 bg-pass-bg text-pass-ink" : "border-udhaar/40 bg-udhaar-bg text-udhaar-ink"}`}>
          <div className={`h-[3px] ${res.valid ? "bg-pass-emerald" : "bg-udhaar"}`} />
          <div className="p-5">
            <div className="flex items-center gap-2 text-[18px] font-bold">
              {res.valid ? <ShieldCheck size={22} strokeWidth={1.75} className="text-pass-emerald" /> : <ShieldX size={22} strokeWidth={1.75} />}
              {res.valid ? "Signature valid ✓" : `Invalid — ${res.reason}`}
            </div>
            <div className={`mt-1 font-mono text-[11.5px] ${res.valid ? "text-pass-muted" : ""}`}>
              verified in {res.verify_ms}ms · key {pub.slice(0, 8)}…{pub.slice(-6)}
            </div>
            {p && (
              <div className="mt-4 space-y-2 text-[14px]">
                <div className="text-[22px] font-bold">{p.n}</div>
                <div className={res.valid ? "text-pass-muted" : ""}>
                  {p.c} · active {p.ad} days
                </div>
                <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
                  <Metric label={`${p.pd}D GMV`} value={formatRsCompact(p.gmv)} />
                  <Metric label="Cash share" value={`${(p.cash_bp / 100).toFixed(0)}%`} />
                  <Metric label="Recovery" value={`${(p.rec_bp / 100).toFixed(1)}%`} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Sales" value={String(p.sc)} />
                  <Metric label="Trading days" value={String(p.td)} />
                  <Metric label="Ledger" value={p.lb ? "Balanced" : "Unbalanced"} />
                </div>
                {p.v === 2 && (
                  <div className="rounded-[12px] border border-pass-emerald/30 bg-pass-elevated p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-pass-emerald">Bharosa · customer-attested</div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Metric label="Verified udhaar" value={`${((p.vr_bp ?? 0) / 100).toFixed(0)}%`} />
                      <Metric label="Disputed" value={`${((p.dr_bp ?? 0) / 100).toFixed(1)}%`} />
                      <Metric label="Wada kept" value={p.pk_bp === undefined ? "—" : `${(p.pk_bp / 100).toFixed(0)}%`} />
                    </div>
                    <p className={`mt-2 text-[12px] leading-[17px] ${res.valid ? "text-pass-muted" : ""}`}>
                      Share of credit sales the borrowers themselves confirmed via a signed link · {p.att ?? 0} attestations · chain {p.ah}…
                    </p>
                  </div>
                )}
                <div className="break-all rounded-[10px] bg-black/20 p-2.5 font-mono text-[11px]">
                  SHA-256 head (#{p.txn}): {p.h}
                </div>
                <div className={`text-[12px] ${res.valid ? "text-pass-muted" : ""}`}>
                  Period {p.f} → {p.t} · issued {new Date(p.iat * 1000).toLocaleString("en-PK")}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <label className="mt-6 block text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-2">Passport token</label>
      <textarea value={token} onChange={(e) => setToken(e.target.value.trim())} rows={4} className="mt-1 w-full rounded-[12px] bg-surface p-3 font-mono text-[11px] outline-none" placeholder="Scan the QR or paste the token" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={() => void run(token)} className="tactile h-11 rounded-[12px] bg-ink text-[15px] font-semibold text-white">
          Verify
        </button>
        <button onClick={tamper} disabled={!token} className="tactile h-11 rounded-[12px] bg-surface-sunken text-[15px] font-semibold disabled:opacity-40">
          Tamper test (2× GMV)
        </button>
      </div>
      <p className="mt-6 text-[12px] leading-[17px] text-ink-2">
        Owner-consented 30-day trade summary aligned with SBP SMEConnect (Nov 1, 2026). Informational only — not a credit score, underwriting decision, tax filing or Shariah certification. Zero FBR linkage.
      </p>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] opacity-70">{label}</div>
      <div className="num text-[16px] font-bold">{value}</div>
    </div>
  );
}

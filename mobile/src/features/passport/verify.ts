import {
  b64urlDecode,
  b64urlEncode,
  canonicalJson,
  verifyPassport,
  type PassportPayload,
  type VerifyResult,
} from "@passport";
import { formatBaseQty } from "@domain/desi-units";
import { formatRs } from "@domain/money";
import type { ShopState, TradeSummaryResponse } from "@/core/api/types";

export async function verifyPassportOnDevice(
  token: string,
  pinnedPublicKeyHex: string,
): Promise<VerifyResult> {
  if (!pinnedPublicKeyHex || !/^[0-9a-fA-F]{64}$/.test(pinnedPublicKeyHex.trim())) {
    return {
      valid: false,
      payload: null,
      reason: "MISSING_PINNED_KEY",
      verify_ms: 0,
    };
  }
  return verifyPassport(token, pinnedPublicKeyHex.trim());
}

/** Tamper test for /verify demos: flips 2x GMV without re-signing so Ed25519 verification fails. */
export function tamperPassportTokenForDemo(token: string): string | null {
  try {
    const [p, s] = token.trim().replace(/^#/, "").split(".");
    if (!p || !s) return null;
    const obj = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as PassportPayload;
    obj.gmv = obj.gmv * 2 + 100;
    return `${b64urlEncode(new TextEncoder().encode(canonicalJson(obj)))}.${s}`;
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPassportPdfHtml(opts: {
  passport: TradeSummaryResponse;
  shopState?: ShopState | null;
  qrDataUrl?: string | null;
}): string {
  const { passport, shopState, qrDataUrl } = opts;
  const s = passport.summary;
  const pl = passport.payload as unknown as PassportPayload;
  const debtors = (shopState?.customers ?? []).filter((c) => c.balance_paisa > 0);
  const products = (shopState?.products ?? []).slice(0, 14);
  const cashSharePct = (pl.cash_bp / 100).toFixed(1);
  const recoveryPct = (pl.rec_bp / 100).toFixed(1);

  const metricCards = [
    ["30-day GMV", formatRs(s.gmv_paisa)],
    ["Sales", String(s.sales_count)],
    ["Cash share", `${cashSharePct}%`],
    ["Recovery rate", `${recoveryPct}%`],
    ["Cash sales", formatRs(s.cash_sales_paisa)],
    ["Credit sales", formatRs(s.credit_sales_paisa)],
    ["Recovered", formatRs(s.recovered_paisa)],
    ["Wholesale purchases", formatRs(s.purchases_paisa)],
  ]
    .map(
      ([k, v]) =>
        `<div class="metric"><div class="label">${escapeHtml(k)}</div><div class="val">${escapeHtml(v)}</div></div>`,
    )
    .join("");

  const debtorRows = debtors.length
    ? debtors
        .map(
          (c) =>
            `<tr><td>${escapeHtml(c.name)}</td><td class="muted">${c.days_overdue ? `${c.days_overdue}d` : ""}</td><td class="num">${escapeHtml(formatRs(c.balance_paisa))}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">No active receivables</td></tr>`;

  const stockRows = products.length
    ? products
        .map(
          (x) =>
            `<tr><td>${escapeHtml(x.name)}</td><td class="num">${escapeHtml(formatBaseQty(x.stock_base_units, x.base_unit))}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="2" class="muted">No catalog snapshot loaded</td></tr>`;

  const qrBlock = qrDataUrl
    ? `<img src="${qrDataUrl}" width="110" height="110" alt="Verify QR" />`
    : `<div class="mono qr-fallback">${escapeHtml(passport.verify_url.split("#")[0])}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DukaanOS SMEConnect Report — ${escapeHtml(s.shop_name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Inter", Arial, sans-serif; color: #0A0A0A; margin: 28px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #E5E7EB; padding-bottom: 16px; }
  .eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #52525B; }
  h1 { margin: 4px 0; font-size: 26px; }
  .sub { font-size: 13px; color: #52525B; }
  .qr-box { border: 1px solid #E5E7EB; border-radius: 10px; padding: 8px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
  .metric { border: 1px solid #E5E7EB; border-radius: 10px; padding: 10px; }
  .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #52525B; }
  .val { font-size: 15px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
  h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #52525B; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 6px 4px; border-bottom: 1px solid #F3F4F6; vertical-align: top; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; word-break: break-all; }
  .muted { color: #52525B; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 18px; }
  footer { margin-top: 24px; border-top: 1px solid #E5E7EB; padding-top: 12px; font-size: 11px; color: #52525B; line-height: 1.45; }
  .qr-fallback { width: 110px; font-size: 9px; text-align: center; padding: 8px 0; }
</style>
</head>
<body>
  <header>
    <div>
      <div class="eyebrow">DukaanOS · SBP SMEConnect Trade Summary</div>
      <h1>${escapeHtml(s.shop_name)}</h1>
      <div class="sub">${escapeHtml(s.city ?? "Pakistan")} · active ${s.active_days} days · period ${escapeHtml(pl.f)} → ${escapeHtml(pl.t)}</div>
    </div>
    <div class="qr-box">${qrBlock}</div>
  </header>

  <section class="grid">${metricCards}</section>

  <h2>Integrity</h2>
  <table>
    <tbody>
      <tr><td class="muted">Ledger balanced (ΣDr = ΣCr)</td><td>${s.ledger_balanced ? "YES" : "NO"}</td></tr>
      <tr><td class="muted">SHA-256 chain</td><td>${passport.chain.ok ? `CHAIN_OK · ${passport.chain.checked} links recomputed` : "BROKEN"}</td></tr>
      <tr><td class="muted">Head entry_hash</td><td class="mono">${escapeHtml(s.head_entry_hash)}</td></tr>
      <tr><td class="muted">Ed25519 public key</td><td class="mono">${escapeHtml(passport.public_key_hex)}</td></tr>
      <tr><td class="muted">Signature</td><td class="mono">${escapeHtml(passport.signature_hex)}</td></tr>
    </tbody>
  </table>

  <section class="cols">
    <div>
      <h2>Receivables (${escapeHtml(formatRs(s.receivable_paisa))})</h2>
      <table><tbody>${debtorRows}</tbody></table>
    </div>
    <div>
      <h2>Inventory Snapshot</h2>
      <table><tbody>${stockRows}</tbody></table>
    </div>
  </section>

  <footer>
    ${escapeHtml(passport.disclaimer)} Verify at ${escapeHtml(passport.verify_url.split("#")[0])} by scanning the QR. Owner-consented export; zero FBR linkage; zero CNIC collected.
  </footer>
</body>
</html>`;
}

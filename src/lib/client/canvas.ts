"use client";
/** F-11 Canvas bilingual Urdu receipt PNG + the 1-tap staged field-sample parchi image. */

import { formatBaseQty, type BaseUnit } from "@/lib/domain/desi-units";
import { formatAmount } from "@/lib/domain/money";

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export interface ReceiptData {
  shop: string;
  city?: string | null;
  customer?: string | null;
  lines: Array<{ name: string; qty_base_units: number; base_unit: BaseUnit; line_total_paisa: number }>;
  discount_paisa: number;
  total_paisa: number;
  cash_paid_paisa: number;
  credit_paisa: number;
  new_balance_paisa?: number | null;
  entry_hash: string;
  seq: number;
  created_at: string;
}

export async function renderReceiptPng(d: ReceiptData): Promise<Blob> {
  const W = 800, H = 1100;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const sans = cssVar("--font-inter", "Inter") + ", -apple-system, sans-serif";
  const urdu = cssVar("--font-noto-arabic", "Noto Sans Arabic") + ", sans-serif";
  const mono = cssVar("--font-jetbrains", "JetBrains Mono") + ", monospace";
  try {
    await Promise.all([document.fonts.load(`600 30px ${urdu}`, "رسید"), document.fonts.load(`700 30px ${sans}`)]);
  } catch {
    /* fall back to system fonts */
  }

  x.fillStyle = "#FFFFFF";
  x.fillRect(0, 0, W, H);
  x.fillStyle = "#0A0A0A";
  x.fillRect(0, 0, W, 150);
  x.fillStyle = "#FFFFFF";
  x.font = `700 40px ${sans}`;
  x.fillText(d.shop, 48, 72);
  x.font = `400 22px ${sans}`;
  x.fillStyle = "#D4D4D8";
  x.fillText(`${d.city ?? ""}  ·  ${new Date(d.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}`, 48, 112);
  x.textAlign = "right";
  x.direction = "rtl";
  x.fillStyle = "#FFFFFF";
  x.font = `600 38px ${urdu}`;
  x.fillText("رسید", W - 48, 82);
  x.direction = "ltr";
  x.textAlign = "left";

  let y = 210;
  x.fillStyle = "#52525B";
  x.font = `600 18px ${sans}`;
  x.fillText(d.customer ? `CUSTOMER · ${d.customer.toUpperCase()}` : "WALK-IN · CASH", 48, y);
  y += 30;
  x.strokeStyle = "rgba(0,0,0,0.12)";
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(48, y);
  x.lineTo(W - 48, y);
  x.stroke();
  y += 50;

  for (const l of d.lines.slice(0, 9)) {
    x.fillStyle = "#0A0A0A";
    x.font = `500 28px ${sans}`;
    x.fillText(l.name, 48, y);
    x.fillStyle = "#52525B";
    x.font = `400 20px ${sans}`;
    x.fillText(formatBaseQty(l.qty_base_units, l.base_unit), 48, y + 28);
    x.textAlign = "right";
    x.fillStyle = "#0A0A0A";
    x.font = `600 28px ${sans}`;
    x.fillText(`Rs. ${formatAmount(l.line_total_paisa)}`, W - 48, y);
    x.textAlign = "left";
    y += 72;
  }

  const row = (label: string, value: string, color = "#0A0A0A", bold = false) => {
    x.fillStyle = "#52525B";
    x.font = `500 24px ${sans}`;
    x.fillText(label, 48, y);
    x.textAlign = "right";
    x.fillStyle = color;
    x.font = `${bold ? 700 : 600} ${bold ? 32 : 26}px ${sans}`;
    x.fillText(value, W - 48, y);
    x.textAlign = "left";
    y += bold ? 52 : 42;
  };
  x.beginPath();
  x.moveTo(48, y - 30);
  x.lineTo(W - 48, y - 30);
  x.stroke();
  y += 10;
  if (d.discount_paisa > 0) row("Riayat (discount)", `-Rs. ${formatAmount(d.discount_paisa)}`, "#991B1B");
  row("Kul Bill · Net", `Rs. ${formatAmount(d.total_paisa)}`, "#0A0A0A", true);
  row("Cash", `Rs. ${formatAmount(d.cash_paid_paisa)}`, "#047857");
  if (d.credit_paisa !== 0) row(d.credit_paisa > 0 ? "Khata (udhaar)" : "Khata adjustment", `${d.credit_paisa < 0 ? "-" : "+"}Rs. ${formatAmount(Math.abs(d.credit_paisa))}`, "#C2410C");
  if (d.new_balance_paisa !== undefined && d.new_balance_paisa !== null) row("Naya baqaya", `Rs. ${formatAmount(d.new_balance_paisa)}`, "#C2410C");

  x.fillStyle = "#F2F2F7";
  x.fillRect(0, H - 170, W, 170);
  x.fillStyle = "#52525B";
  x.font = `500 18px ${mono}`;
  x.fillText(`SHA-256 #${d.seq}  ${d.entry_hash.slice(0, 16)}…${d.entry_hash.slice(-8)}`, 48, H - 110);
  x.font = `600 20px ${sans}`;
  x.fillStyle = "#047857";
  x.fillText("Verified by DukaanOS · Sirf Aap Ka Record — Zero FBR Linkage", 48, H - 72);
  x.textAlign = "right";
  x.direction = "rtl";
  x.fillStyle = "#0A0A0A";
  x.font = `600 26px ${urdu}`;
  x.fillText("شکریہ", W - 48, H - 108);
  x.direction = "ltr";
  x.textAlign = "left";

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("png encode failed"))), "image/png"));
}

export async function shareOrDownload(blob: Blob, filename: string, text?: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch {
      /* user cancelled → fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}

/** A crinkled handwritten wholesale parchi (staged field sample) — sent through the REAL OCR path. */
export async function renderStagedParchi(): Promise<Blob> {
  const W = 960, H = 1280;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // paper + crumple shading
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#F4EFE3");
  g.addColorStop(0.5, "#EDE6D3");
  g.addColorStop(1, "#F1EADB");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = `rgba(90,70,40,${0.05 + rnd() * 0.08})`;
    x.lineWidth = 1 + rnd() * 2;
    x.beginPath();
    let px = rnd() * W, py = rnd() * H;
    x.moveTo(px, py);
    for (let k = 0; k < 4; k++) {
      px += (rnd() - 0.5) * 420;
      py += (rnd() - 0.5) * 420;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  x.fillStyle = "rgba(150,110,60,0.10)";
  x.beginPath();
  x.arc(760, 1060, 90, 0, Math.PI * 2);
  x.fill();
  // ruled lines
  for (let yy = 300; yy < H - 120; yy += 92) {
    x.strokeStyle = "rgba(60,90,160,0.18)";
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(40, yy + 22);
    x.lineTo(W - 40, yy + 22);
    x.stroke();
  }

  const hand = `"Segoe Print", "Bradley Hand", "Comic Sans MS", "Marker Felt", cursive`;
  const urdu = cssVar("--font-nastaliq", "Noto Nastaliq Urdu") + ", serif";
  const write = (t: string, px: number, py: number, size = 44, rot = 0, color = "#1F2A5A") => {
    x.save();
    x.translate(px, py);
    x.rotate(rot + (rnd() - 0.5) * 0.02);
    x.fillStyle = color;
    x.font = `${size}px ${hand}`;
    x.fillText(t, 0, 0);
    x.restore();
  };
  try {
    await document.fonts.load(`40px ${urdu}`, "المدینہ");
  } catch {
    /* ok */
  }
  x.save();
  x.direction = "rtl";
  x.textAlign = "right";
  x.fillStyle = "#1F2A5A";
  x.font = `52px ${urdu}`;
  x.fillText("المدینہ ہول سیل", W - 60, 120);
  x.restore();
  write("Al-Madina Wholesale", 60, 120, 46, -0.01);
  write("Date 24/11   Bismillah Kiryana", 60, 205, 34, 0.005, "#2B2B2B");

  const rows: Array<[string, string]> = [
    ["Surf Excel 1kg", "10 x 480 = 4800"],
    ["Dalda Oil 5L", "3 x 2450 = 7650"],
    ["Tapal Danedar 900g", "1 x 1520 = 1520"],
  ];
  let y = 315;
  for (const [n, m] of rows) {
    write(n, 60, y, 44, -0.012);
    write(m, 520, y + 4, 44, 0.01);
    y += 92;
  }
  write("Total = 13970", 520, y + 40, 52, -0.015, "#7A1F1F");
  x.strokeStyle = "#7A1F1F";
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(510, y + 60);
  x.lineTo(880, y + 52);
  x.stroke();
  write("cash 10000  baqi udhaar", 60, y + 150, 36, 0.01, "#2B2B2B");

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("jpeg encode failed"))), "image/jpeg", 0.82));
}

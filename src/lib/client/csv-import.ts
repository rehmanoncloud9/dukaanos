"use client";
/**
 * Pure RFC-4180 CSV parser for migrating customer balances from Udhaar Book / Excel.
 */
import { rupeesToPaisa } from "@/lib/domain/money";

export interface ImportedCustomer {
  name: string;
  phone: string | null;
  balance_paisa: number;
}

export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

export function parseCustomerCsv(text: string): ImportedCustomer[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const first = rows[0].map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => /name|naam|customer/.test(c));
  const data = hasHeader ? rows.slice(1) : rows;

  const out: ImportedCustomer[] = [];
  for (const r of data) {
    const name = (r[0] ?? "").trim();
    if (!name) continue;
    const phone = (r[1] ?? "").trim() || null;
    const rawBal = Number(String(r[2] ?? "0").replace(/[^\d.-]/g, ""));
    const balance_paisa = Number.isFinite(rawBal) && rawBal > 0 ? rupeesToPaisa(rawBal) : 0;
    out.push({ name, phone, balance_paisa });
  }
  return out;
}

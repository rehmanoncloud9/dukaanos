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

export interface ImportedProduct {
  name: string;
  base_unit: "g" | "ml" | "pcs";
  pack_size_base_units: number;
  unit_price_paisa: number;
  cost_price_paisa: number;
  opening_stock_base_units: number;
}

export function parseProductCsv(text: string): ImportedProduct[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const first = rows[0].map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => /name|item|product|naam/.test(c));
  const data = hasHeader ? rows.slice(1) : rows;

  const out: ImportedProduct[] = [];
  for (const r of data) {
    const name = (r[0] ?? "").trim();
    if (!name) continue;
    const rawUnit = (r[1] ?? "pcs").trim().toLowerCase();
    const base_unit: "g" | "ml" | "pcs" = rawUnit === "kg" || rawUnit === "g" ? "g" : rawUnit === "l" || rawUnit === "litre" || rawUnit === "ml" ? "ml" : "pcs";
    const pack_size_base_units = base_unit === "pcs" ? 1 : 1000;
    const sellRs = Number(String(r[2] ?? "0").replace(/[^\d.-]/g, ""));
    const costRs = Number(String(r[3] ?? "").replace(/[^\d.-]/g, ""));
    const openQty = Number(String(r[4] ?? "0").replace(/[^\d.-]/g, ""));
    const unit_price_paisa = Number.isFinite(sellRs) && sellRs > 0 ? rupeesToPaisa(sellRs) : 0;
    const cost_price_paisa = Number.isFinite(costRs) && costRs > 0 ? rupeesToPaisa(costRs) : Math.round(unit_price_paisa * 0.85);
    const opening_stock_base_units = Number.isFinite(openQty) && openQty > 0
      ? Math.round(openQty * (rawUnit === "kg" || rawUnit === "l" || rawUnit === "litre" ? 1000 : 1))
      : 0;
    out.push({ name, base_unit, pack_size_base_units, unit_price_paisa, cost_price_paisa, opening_stock_base_units });
  }
  return out;
}

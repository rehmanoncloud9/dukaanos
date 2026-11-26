"use client";
/**
 * Pure client-side RFC-4180 CSV exporter with UTF-8 BOM (\uFEFF) so Excel/Sheets
 * render Urdu/Roman names cleanly without garbled characters.
 */
import type { FeedTx, StateCustomer, StateProduct } from "@/lib/api/contracts";
import { formatBaseQty } from "@/lib/domain/desi-units";

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function exportKhataCsv(customers: StateCustomer[]): string {
  return toCsv(
    ["Name", "Role", "Phone", "Balance (PKR)", "Days Overdue", "Last Paid"],
    customers.map((c) => [
      c.name,
      c.role_tag ?? "",
      c.phone ?? "",
      (c.balance_paisa / 100).toFixed(2),
      c.days_overdue ?? 0,
      c.last_paid_at ?? "",
    ]),
  );
}

export function exportMaalCsv(products: StateProduct[]): string {
  return toCsv(
    ["SKU", "Name", "Urdu Name", "Price (PKR)", "Stock", "Unit"],
    products.map((p) => [
      p.sku_code,
      p.name,
      p.name_ur ?? "",
      (p.unit_price_paisa / 100).toFixed(2),
      formatBaseQty(p.stock_base_units, p.base_unit),
      p.base_unit,
    ]),
  );
}

export function exportFeedCsv(feed: FeedTx[]): string {
  return toCsv(
    ["Seq", "Date", "Type", "Customer", "Total (PKR)", "Cash (PKR)", "Udhaar (PKR)", "Hash"],
    feed.map((t) => [
      t.seq,
      t.created_at,
      t.type,
      t.customer_name ?? t.supplier_name ?? "Walk-in",
      (t.total_paisa / 100).toFixed(2),
      (t.cash_paid_paisa / 100).toFixed(2),
      (t.credit_paisa / 100).toFixed(2),
      t.entry_hash,
    ]),
  );
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

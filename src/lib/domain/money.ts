/**
 * Integer-paisa money helpers. 1 PKR = 100 paisa.
 * Floating point is forbidden for stored money: every value that leaves this
 * module is an integer number of paisa.
 */

export type Paisa = number;

export function assertPaisa(value: number, label = "amount"): Paisa {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of paisa, got ${value}`);
  }
  return value;
}

/** Convert a spoken/typed rupee figure (e.g. 250, 1500, 12.5) to integer paisa. */
export function rupeesToPaisa(rupees: number): Paisa {
  if (!Number.isFinite(rupees)) throw new Error(`invalid rupee amount: ${rupees}`);
  return Math.round(rupees * 100);
}

const grouping = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const grouping2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1,400" or "12.50" — no currency prefix. Sign preserved. */
export function formatAmount(paisa: Paisa): string {
  const abs = Math.abs(paisa);
  const body = abs % 100 === 0 ? grouping.format(abs / 100) : grouping2.format(abs / 100);
  return paisa < 0 ? `-${body}` : body;
}

/** "Rs. 1,400" / "-Rs. 120" */
export function formatRs(paisa: Paisa): string {
  const body = formatAmount(Math.abs(paisa));
  return paisa < 0 ? `-Rs. ${body}` : `Rs. ${body}`;
}

/** "Rs. 1.24M" / "Rs. 84.5K" for dense metric tiles. */
export function formatRsCompact(paisa: Paisa): string {
  const rupees = paisa / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}Rs. ${(abs / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 10_000) return `${sign}Rs. ${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}Rs. ${grouping.format(abs)}`;
}

/** Journal display "400.00" used in the X-Ray mono block. */
export function formatJournal(paisa: Paisa): string {
  return grouping2.format(Math.abs(paisa) / 100);
}

/** Deterministic integer rounding of (a * b) / c, half away from zero. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new Error("division by zero");
  const q = (a * b) / c;
  return q < 0 ? -Math.round(-q) : Math.round(q);
}

import { parseRupeeAmount } from "./urdu-numbers";

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
  const negative = rupees < 0;
  const parsed = parseRupeeAmount(String(Math.abs(rupees)));
  if (!parsed) throw new Error(`rupee amount must have at most two decimal places and be within the safe integer range: ${rupees}`);
  return assertPaisa(negative ? -parsed.paisa : parsed.paisa);
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

/** "Rs. 1,400" / "-Rs. 120" — used in messages, receipts, and test assertions. */
export function formatRs(paisa: Paisa): string {
  const body = formatAmount(Math.abs(paisa));
  return paisa < 0 ? `-Rs. ${body}` : `Rs. ${body}`;
}

/** Urdu shop display: "1,400 روپے" / "-120 روپے" — for Urdu-only UI surfaces. */
export function formatRsUrdu(paisa: Paisa): string {
  const body = formatAmount(Math.abs(paisa));
  return paisa < 0 ? `-${body} روپے` : `${body} روپے`;
}

/** Keeps full values so dense totals remain clear in Urdu. */
export function formatRsCompact(paisa: Paisa): string {
  const rupees = Math.abs(paisa) / 100;
  const sign = paisa < 0 ? "-" : "";
  const short = (value: number) => value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, "");
  if (rupees >= 10_000_000) return `${sign}${short(rupees / 10_000_000)} کروڑ روپے`;
  if (rupees >= 100_000) return `${sign}${short(rupees / 100_000)} لاکھ روپے`;
  if (rupees >= 1_000) return `${sign}${short(rupees / 1_000)} ہزار روپے`;
  return `${sign}${grouping.format(rupees)} روپے`;
}

/** Journal display "400.00" used in the X-Ray mono block. */
export function formatJournal(paisa: Paisa): string {
  return grouping2.format(Math.abs(paisa) / 100);
}

/** Deterministic integer rounding of (a * b) / c, half away from zero. */
export function mulDiv(a: number, b: number, c: number): number {
  if (![a, b, c].every(Number.isSafeInteger)) throw new Error("mulDiv expects safe integer operands");
  if (c === 0) throw new Error("division by zero");
  const gcd = (left: number, right: number): number => {
    let x = Math.abs(left);
    let y = Math.abs(right);
    while (y !== 0) [x, y] = [y, x % y];
    return x;
  };
  let left = a;
  let right = b;
  let denominator = c;
  const cancelLeft = gcd(left, denominator);
  left /= cancelLeft;
  denominator /= cancelLeft;
  const cancelRight = gcd(right, denominator);
  right /= cancelRight;
  denominator /= cancelRight;

  const numerator = left * right;
  if (!Number.isSafeInteger(numerator)) throw new Error("mulDiv intermediate exceeds safe integer range");
  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator % denominator;
  const roundUp = Math.abs(remainder) >= Math.ceil(Math.abs(denominator) / 2);
  const sign = (numerator < 0) !== (denominator < 0) ? -1 : 1;
  const result = quotient + (roundUp ? sign : 0);
  if (!Number.isSafeInteger(result)) throw new Error("mulDiv result exceeds safe integer range");
  return result;
}

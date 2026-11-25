import { parseRupeeAmount } from "@domain/urdu-numbers";
import type { StateCustomer } from "@contracts";

export type KhataFilter = "all" | "overdue" | "settled";

export function normalizeKhataFilter(raw?: string | string[] | null): KhataFilter {
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === "overdue" || val === "settled") return val;
  return "all";
}

export function isCustomerOverdue(
  c: Pick<StateCustomer, "balance_paisa" | "days_overdue">,
): boolean {
  return c.balance_paisa > 0 && (c.days_overdue ?? 0) > 15;
}

export interface KhataSummary {
  receivablePaisa: number;
  activeCount: number;
  overdueCount: number;
}

export function computeKhataSummary(customers: StateCustomer[]): KhataSummary {
  let receivablePaisa = 0;
  let activeCount = 0;
  let overdueCount = 0;
  for (const c of customers) {
    if (c.balance_paisa > 0) {
      receivablePaisa += c.balance_paisa;
      activeCount += 1;
      if ((c.days_overdue ?? 0) > 15) overdueCount += 1;
    }
  }
  return { receivablePaisa, activeCount, overdueCount };
}

export function filterAndSortCustomers(
  customers: StateCustomer[],
  filter: KhataFilter,
): StateCustomer[] {
  const filtered =
    filter === "overdue"
      ? customers.filter(isCustomerOverdue)
      : filter === "settled"
        ? customers.filter((c) => c.balance_paisa <= 0)
        : customers;
  return filtered
    .slice()
    .sort((a, b) => b.balance_paisa - a.balance_paisa || a.name.localeCompare(b.name));
}

export interface WasooliValidation {
  valid: boolean;
  amountPaisa: number;
  newBalancePaisa: number | null;
  error: string | null;
}

export function validateWasooliAmount(
  rawRupees: string,
  customerBalancePaisa?: number | null,
): WasooliValidation {
  const cleaned = rawRupees.replace(/,/g, "").trim();
  if (!cleaned) {
    return {
      valid: false,
      amountPaisa: 0,
      newBalancePaisa: customerBalancePaisa ?? null,
      error: null,
    };
  }
  const parsed = parseRupeeAmount(cleaned);
  if (!parsed || !Number.isSafeInteger(parsed.paisa) || parsed.paisa <= 0) {
    return {
      valid: false,
      amountPaisa: 0,
      newBalancePaisa: customerBalancePaisa ?? null,
      error: "Sahi raqam darj karein (Rs. 1 ya zyada)",
    };
  }
  if (parsed.paisa > 1_000_000_000) {
    return {
      valid: false,
      amountPaisa: 0,
      newBalancePaisa: customerBalancePaisa ?? null,
      error: "Raqam had se zyada hai",
    };
  }
  return {
    valid: true,
    amountPaisa: parsed.paisa,
    newBalancePaisa:
      typeof customerBalancePaisa === "number" ? customerBalancePaisa - parsed.paisa : null,
    error: null,
  };
}

export function buildQuickWasooliAmounts(balancePaisa: number): number[] {
  if (balancePaisa <= 0) return [];
  return [balancePaisa, 50_000, 100_000].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
}

export interface CreditLimitInfo {
  hasLimit: boolean;
  limitPaisa: number | null;
  exceeded: boolean;
  nearLimit: boolean;
}

export function creditLimitStatus(
  balancePaisa: number,
  creditLimitPaisa?: number | null,
): CreditLimitInfo {
  if (typeof creditLimitPaisa !== "number" || !Number.isFinite(creditLimitPaisa) || creditLimitPaisa <= 0) {
    return { hasLimit: false, limitPaisa: null, exceeded: false, nearLimit: false };
  }
  const exceeded = balancePaisa > creditLimitPaisa;
  const nearLimit = !exceeded && balancePaisa >= Math.round(creditLimitPaisa * 0.85);
  return { hasLimit: true, limitPaisa: creditLimitPaisa, exceeded, nearLimit };
}

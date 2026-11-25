import type { StateCustomer } from "@contracts";
import { Linking } from "react-native";
import {
  buildQuickWasooliAmounts,
  computeKhataSummary,
  creditLimitStatus,
  filterAndSortCustomers,
  isCustomerOverdue,
  normalizeKhataFilter,
  validateWasooliAmount,
} from "@/features/khata/logic";
import { openSmsReminder, openWhatsAppReminder } from "@/features/khata/reminders";

function makeCustomer(overrides: Partial<StateCustomer>): StateCustomer {
  return {
    id: "c-1",
    name: "Chhote Ali",
    role_tag: "Tailor",
    phone: "03001234567",
    balance_paisa: 140_000,
    aliases: [],
    code: null,
    days_overdue: 18,
    last_paid_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

describe("Khata filtering, sorting, and Wasooli validation", () => {
  const customers: StateCustomer[] = [
    makeCustomer({ id: "1", name: "Ali Driver", balance_paisa: 0, days_overdue: 0 }),
    makeCustomer({ id: "2", name: "Chhote Ali", balance_paisa: 140_000, days_overdue: 18 }),
    makeCustomer({ id: "3", name: "Bilal", balance_paisa: 320_000, days_overdue: 6 }),
    makeCustomer({ id: "4", name: "Tariq", balance_paisa: 95_000, days_overdue: 22 }),
  ];

  test("normalizes filter params safely", () => {
    expect(normalizeKhataFilter("overdue")).toBe("overdue");
    expect(normalizeKhataFilter(["settled"])).toBe("settled");
    expect(normalizeKhataFilter("unknown")).toBe("all");
    expect(normalizeKhataFilter(undefined)).toBe("all");
  });

  test("computes summary receivable, active, and >15d overdue counts", () => {
    expect(computeKhataSummary(customers)).toEqual({
      receivablePaisa: 555_000,
      activeCount: 3,
      overdueCount: 2,
    });
    expect(isCustomerOverdue(customers[1])).toBe(true);
    expect(isCustomerOverdue(customers[2])).toBe(false);
  });

  test("filters and sorts descending by balance", () => {
    expect(filterAndSortCustomers(customers, "all").map((c) => c.id)).toEqual([
      "3",
      "2",
      "4",
      "1",
    ]);
    expect(filterAndSortCustomers(customers, "overdue").map((c) => c.id)).toEqual([
      "2",
      "4",
    ]);
    expect(filterAndSortCustomers(customers, "settled").map((c) => c.id)).toEqual(["1"]);
  });

  test("validates Wasooli amounts in integer paisa and previews new balance", () => {
    expect(validateWasooliAmount("", 140_000)).toEqual({
      valid: false,
      amountPaisa: 0,
      newBalancePaisa: 140_000,
      error: null,
    });
    expect(validateWasooliAmount("0", 140_000).valid).toBe(false);
    expect(validateWasooliAmount("500", 140_000)).toEqual({
      valid: true,
      amountPaisa: 50_000,
      newBalancePaisa: 90_000,
      error: null,
    });
    expect(validateWasooliAmount("1,400.50", 140_050)).toEqual({
      valid: true,
      amountPaisa: 140_050,
      newBalancePaisa: 0,
      error: null,
    });
  });

  test("builds deduped quick amounts with full balance first", () => {
    expect(buildQuickWasooliAmounts(50_000)).toEqual([50_000, 100_000]);
    expect(buildQuickWasooliAmounts(140_000)).toEqual([140_000, 50_000, 100_000]);
    expect(buildQuickWasooliAmounts(0)).toEqual([]);
  });

  test("evaluates credit limit status", () => {
    expect(creditLimitStatus(150_000, null).hasLimit).toBe(false);
    expect(creditLimitStatus(90_000, 100_000)).toMatchObject({
      hasLimit: true,
      exceeded: false,
      nearLimit: true,
    });
    expect(creditLimitStatus(120_000, 100_000)).toMatchObject({
      hasLimit: true,
      exceeded: true,
      nearLimit: false,
    });
  });

  test("opens WhatsApp with wa.me fallback and 2G SMS links", async () => {
    const canSpy = jest.spyOn(Linking, "canOpenURL").mockResolvedValue(false);
    const openSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);

    const okWa = await openWhatsAppReminder({ customer: customers[1], shopName: "Bismillah Kiryana" });
    expect(okWa).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("https://wa.me/923001234567"));

    const okSms = await openSmsReminder({ customer: customers[1], shopName: "Bismillah Kiryana" });
    expect(okSms).toBe(true);
    expect(openSpy).toHaveBeenLastCalledWith(expect.stringContaining("sms:+923001234567?body="));

    canSpy.mockRestore();
    openSpy.mockRestore();
  });
});

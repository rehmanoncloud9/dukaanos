import type { MyShop } from "@/core/api/types";

export const DELETE_CONFIRM_WORD = "DELETE";
export const DELETE_CONFIRM_WORD_UR = "حذف";

export function isDeleteConfirmationValid(raw: string): boolean {
  const clean = raw.trim();
  return clean.toUpperCase() === DELETE_CONFIRM_WORD || clean === DELETE_CONFIRM_WORD_UR;
}

export function resolveWebAppUrl(
  apiUrl: string | undefined | null,
  path: "/privacy" | "/terms" | "/delete-account" | "/verify" | "/report",
): string | null {
  if (!apiUrl) return null;
  const clean = apiUrl.trim().replace(/\/$/, "");
  if (!clean) return null;
  return `${clean}${path}`;
}

export function describeShopSubtitle(shop: MyShop): string {
  const base = shop.is_stage_shop
    ? "Stage shop (protected)"
    : shop.is_demo_shop
      ? "Isolated judge sandbox"
      : shop.city ?? "Live shop";
  return `${base} · ${shop.role}`;
}

export interface HealthPayload {
  ok: boolean;
  missing_env?: string[];
  pinned_models?: Record<string, string | null>;
  models_available?: Record<string, boolean> | null;
  model_check_error?: string | null;
  cutover_audit?: { gemini_2_5_references: number; ok: boolean };
}

export function isHealthPayload(v: unknown): v is HealthPayload {
  return Boolean(v && typeof v === "object" && typeof (v as HealthPayload).ok === "boolean");
}

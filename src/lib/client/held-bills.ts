"use client";
/**
 * Parked / held sales bills per shop (localStorage). Lets a shopkeeper pause a multi-item
 * order when another customer interrupts and resume it in one tap.
 */

import type { TurnTrace } from "@/lib/api/contracts";
import type { SaleProposal } from "@/lib/domain/types";

export interface HeldBill {
  id: string;
  shop_id: string;
  label: string;
  total_paisa: number;
  customer_name: string | null;
  proposal: SaleProposal;
  trace: TurnTrace | null;
  held_at: number;
}

const KEY_PREFIX = "dukaanos.held.";
export const HELD_EVENT = "dukaan:held-changed";

function storageKey(shopId: string): string {
  return `${KEY_PREFIX}${shopId}`;
}

export function listHeldBills(shopId: string | null | undefined): HeldBill[] {
  if (typeof window === "undefined" || !shopId) return [];
  try {
    const raw = localStorage.getItem(storageKey(shopId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HeldBill[]) : [];
  } catch {
    return [];
  }
}

function saveList(shopId: string, list: HeldBill[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(shopId), JSON.stringify(list.slice(0, 10)));
    window.dispatchEvent(new CustomEvent(HELD_EVENT));
  } catch {
    /* ignore quota */
  }
}

export function holdBill(bill: Omit<HeldBill, "held_at">): void {
  const cur = listHeldBills(bill.shop_id).filter((b) => b.id !== bill.id);
  saveList(bill.shop_id, [{ ...bill, held_at: Date.now() }, ...cur]);
}

export function removeHeldBill(shopId: string, id: string): void {
  const cur = listHeldBills(shopId).filter((b) => b.id !== id);
  saveList(shopId, cur);
}

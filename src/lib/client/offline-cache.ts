"use client";
/**
 * Last-known-good snapshot of the shop list and shop state in IndexedDB, so the PWA renders a
 * truthful (timestamped) khata on a cold boot during load-shedding instead of spinning forever.
 * Read-only: writes made offline still go through the idempotent queue in ./queue.
 */
import { createStore, get, set } from "idb-keyval";
import type { ShopState } from "@/lib/api/contracts";
import { syncShopStateToIndexedDB } from "./local-db";

const store = typeof indexedDB !== "undefined" ? createStore("dukaanos-cache", "snapshots") : undefined;

export interface Snapshot<T> {
  saved_at: number;
  data: T;
}

export async function saveSnapshot<T>(key: string, data: T): Promise<void> {
  if (!store) return;
  await set(key, { saved_at: Date.now(), data } satisfies Snapshot<T>, store).catch(() => undefined);
  if (key.startsWith("state:") && data && typeof data === "object" && "products" in data) {
    const shopId = key.slice("state:".length);
    void syncShopStateToIndexedDB(shopId, data as ShopState).catch(() => undefined);
  }
}

export async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  if (!store) return null;
  return ((await get<Snapshot<T>>(key, store).catch(() => undefined)) ?? null);
}

export const SHOPS_SNAPSHOT = "my_shops";
export const stateSnapshotKey = (shopId: string) => `state:${shopId}`;

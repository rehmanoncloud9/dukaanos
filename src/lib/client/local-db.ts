"use client";
/**
 * Scalable IndexedDB Engine for 5,000+ SKUs and 10,000+ Ledger Entries.
 * Uses compound indexes on shop_id, category, normalized names, aliases,
 * stock status, and ledger sequence for indexed local queries and offline hydration.
 */

import type { FeedTx, ShopState, StateCustomer, StateProduct } from "@/lib/api/contracts";
import { normalizeText } from "@/lib/domain/pakphone";

export type ProductCategory = "grains" | "liquids" | "dairy" | "cosmetics" | "household" | "packaged";
export type InventoryStatus = "fully_managed" | "quantity_unknown" | "provisional" | "stock_discrepancy" | "archived";

export interface IndexedProductRecord extends StateProduct {
  shop_id: string;
  category: ProductCategory;
  name_norm: string;
  name_ur_norm: string;
  sku_norm: string;
  aliases_norm: string[];
  stock_bucket: "negative" | "low" | "healthy";
  inventory_status: InventoryStatus;
}

export interface IndexedCustomerRecord extends StateCustomer {
  shop_id: string;
  name_norm: string;
  overdue_days: number;
}

export interface IndexedLedgerRecord extends FeedTx {
  shop_id: string;
  created_ms: number;
  supplier_norm: string;
}

export interface IndexedAliasRecord {
  shop_id: string;
  alias_norm: string;
  product_id: string;
}

const DB_NAME = "dukaanos-indexed-v1";
const DB_VERSION = 3;

const CATEGORY_RULES: Array<[ProductCategory, RegExp]> = [
  ["grains", /(daal|dal|chana|masoor|moong|mash|chawal|basmati|atta|aata|maida|suji|besan|cheeni|chini|sugar|gur|namak|mirch|haldi|masala|zeera|دال|چاول|آٹا|چینی|نمک|مرچ|مصالحہ)/i],
  ["liquids", /(oil|ghee|sarson|tail|tel|sharbat|juice|pani|water|pepsi|coke|sprite|7up|dew|chai|patti|syrup|تیل|گھی|شربت|پانی|بوتل)/i],
  ["dairy", /(doodh|milk|dahi|makhan|butter|cheese|paneer|bread|roti|anda|anday|egg|rusk|cake|biscuit|دودھ|دہی|مکھن|انڈے|بریڈ)/i],
  ["cosmetics", /(sabun|soap|shampoo|surf|detergent|cream|lotion|powder|paste|toothpaste|brush|perfume|attar|صابن|شیمپو|سرف|کریم)/i],
  ["household", /(jharoo|bartan|matchis|machis|lighter|candle|mombatti|battery|cell|bulb|tissue|pampers|diaper|foil|ماچس|جھاڑو|ٹشو|بلب)/i],
];

export function inferProductCategory(name: string, aliases: string[] = []): ProductCategory {
  const hay = `${name} ${aliases.join(" ")}`;
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(hay)) return cat;
  }
  return "packaged";
}

function stockBucket(p: StateProduct): "negative" | "low" | "healthy" {
  if (p.stock_base_units < 0) return "negative";
  const isLow =
    p.stock_base_units <= 0 ||
    ((p.reorder_level_base_units ?? 0) > 0 && p.stock_base_units <= (p.reorder_level_base_units ?? 0) * 0.25) ||
    (p.days_left !== null && p.days_left <= 2.5);
  return isLow ? "low" : "healthy";
}

export function deriveInventoryStatus(p: Pick<StateProduct, "stock_base_units" | "is_quick_added">): InventoryStatus {
  if (p.stock_base_units < 0) return "stock_discrepancy";
  if (p.is_quick_added) return p.stock_base_units === 0 ? "provisional" : "quantity_unknown";
  return "fully_managed";
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[], options?: IDBIndexParameters) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function openLocalDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction!;
        const ps = db.objectStoreNames.contains("products")
          ? tx.objectStore("products")
          : db.createObjectStore("products", { keyPath: "id" });
        ensureIndex(ps, "by_shop", "shop_id", { unique: false });
        ensureIndex(ps, "by_shop_sku", ["shop_id", "sku_norm"], { unique: false });
        ensureIndex(ps, "by_shop_category", ["shop_id", "category"], { unique: false });
        ensureIndex(ps, "by_shop_name", ["shop_id", "name_norm"], { unique: false });
        ensureIndex(ps, "by_shop_name_ur", ["shop_id", "name_ur_norm"], { unique: false });
        ensureIndex(ps, "by_shop_stock", ["shop_id", "stock_bucket"], { unique: false });
        ensureIndex(ps, "by_shop_inventory_status", ["shop_id", "inventory_status"], { unique: false });
        ensureIndex(ps, "by_aliases", "aliases_norm", { unique: false, multiEntry: true });

        const cs = db.objectStoreNames.contains("customers")
          ? tx.objectStore("customers")
          : db.createObjectStore("customers", { keyPath: "id" });
        ensureIndex(cs, "by_shop", "shop_id", { unique: false });
        ensureIndex(cs, "by_shop_name", ["shop_id", "name_norm"], { unique: false });
        ensureIndex(cs, "by_shop_overdue", ["shop_id", "overdue_days"], { unique: false });

        const ls = db.objectStoreNames.contains("ledger")
          ? tx.objectStore("ledger")
          : db.createObjectStore("ledger", { keyPath: "id" });
        ensureIndex(ls, "by_shop", "shop_id", { unique: false });
        ensureIndex(ls, "by_shop_seq", ["shop_id", "seq"], { unique: false });
        ensureIndex(ls, "by_shop_customer", ["shop_id", "customer_id"], { unique: false });
        ensureIndex(ls, "by_shop_type", ["shop_id", "type"], { unique: false });
        ensureIndex(ls, "by_shop_time", ["shop_id", "created_ms"], { unique: false });
        ensureIndex(ls, "by_shop_supplier", ["shop_id", "supplier_norm"], { unique: false });

        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        const as = db.objectStoreNames.contains("product_aliases")
          ? tx.objectStore("product_aliases")
          : db.createObjectStore("product_aliases", { keyPath: ["shop_id", "alias_norm", "product_id"] });
        ensureIndex(as, "by_shop", "shop_id", { unique: false });
        ensureIndex(as, "by_shop_alias", ["shop_id", "alias_norm"], { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function clearShopIndex(store: IDBObjectStore, shopId: string): Promise<void> {
  return new Promise((resolve) => {
    const idx = store.index("by_shop");
    const req = idx.openKeyCursor(IDBKeyRange.only(shopId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    req.onerror = () => resolve();
  });
}

/** Persist normalized products, customers, and ledger into compound-indexed stores. */
export async function syncShopStateToIndexedDB(shopId: string, state: ShopState): Promise<void> {
  const db = await openLocalDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(["products", "product_aliases", "customers", "ledger", "meta"], "readwrite");
    const pStore = tx.objectStore("products");
    const aliasStore = tx.objectStore("product_aliases");
    const cStore = tx.objectStore("customers");
    const lStore = tx.objectStore("ledger");
    const mStore = tx.objectStore("meta");

    void Promise.all([clearShopIndex(pStore, shopId), clearShopIndex(aliasStore, shopId)]).then(() => {
      for (const p of state.products) {
        const aliasNorms = Array.from(
          new Set([p.name, p.name_ur ?? "", ...(p.aliases ?? [])].flatMap((alias) => {
            const full = normalizeText(alias);
            return full ? [full, ...full.split(" ")] : [];
          }).filter(Boolean)),
        );
        const aliasesNorm = Array.from(
          new Set(aliasNorms.flatMap((alias) => alias.split(" ")).filter(Boolean)),
        );
        const rec: IndexedProductRecord = {
          ...p,
          shop_id: shopId,
          category: inferProductCategory(p.name, [p.name_ur ?? "", ...(p.aliases ?? [])]),
          name_norm: normalizeText(p.name),
          name_ur_norm: (p.name_ur ?? "").trim(),
          sku_norm: (p.sku_code ?? "").trim().toLowerCase(),
          aliases_norm: aliasesNorm,
          stock_bucket: stockBucket(p),
          inventory_status: deriveInventoryStatus(p),
        };
        pStore.put(rec);
        for (const alias_norm of aliasNorms) aliasStore.put({ shop_id: shopId, alias_norm, product_id: p.id } satisfies IndexedAliasRecord);
      }
    });

    void clearShopIndex(cStore, shopId).then(() => {
      for (const c of state.customers) {
        const rec: IndexedCustomerRecord = {
          ...c,
          shop_id: shopId,
          name_norm: normalizeText(c.name),
          overdue_days: c.days_overdue ?? 0,
        };
        cStore.put(rec);
      }
    });

    void clearShopIndex(lStore, shopId).then(() => {
      for (const f of state.feed) {
        const createdMs = Number.isFinite(Date.parse(f.created_at)) ? Date.parse(f.created_at) : 0;
        const rec: IndexedLedgerRecord = {
          ...f,
          shop_id: shopId,
          created_ms: createdMs,
          supplier_norm: normalizeText(f.supplier_name ?? ""),
        };
        lStore.put(rec);
      }
    });

    mStore.put({
      key: `meta:${shopId}`,
      shop: state.shop,
      today: state.today,
      chain_head: state.chain_head,
      saved_at: Date.now(),
      counts: {
        products: state.products.length,
        customers: state.customers.length,
        ledger: state.feed.length,
      },
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function queryProductsByCategory(
  shopId: string,
  category: ProductCategory,
): Promise<IndexedProductRecord[]> {
  const db = await openLocalDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction("products", "readonly");
    const idx = tx.objectStore("products").index("by_shop_category");
    const req = idx.getAll(IDBKeyRange.only([shopId, category]));
    req.onsuccess = () => resolve((req.result as IndexedProductRecord[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

/** Indexed exact phrase/token lookup for offline name and Urdu alias searches. */
export async function queryProductsByAlias(shopId: string, alias: string): Promise<IndexedProductRecord[]> {
  const db = await openLocalDb();
  const terms = Array.from(new Set(normalizeText(alias).split(" ").filter(Boolean)));
  if (!db || terms.length === 0) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(["products", "product_aliases"], "readonly");
    const products = tx.objectStore("products");
    const aliases = tx.objectStore("product_aliases").index("by_shop_alias");
    const matches = new Map<string, Set<string>>();
    let remaining = terms.length;
    for (const term of terms) {
      const request = aliases.getAll(IDBKeyRange.only([shopId, term]));
      request.onsuccess = () => {
        for (const row of request.result as IndexedAliasRecord[]) {
          let set = matches.get(row.product_id);
          if (!set) matches.set(row.product_id, (set = new Set()));
          set.add(term);
        }
        remaining--;
        if (remaining === 0) {
          const out: IndexedProductRecord[] = [];
          for (const [productId, foundTerms] of matches) {
            if (terms.every((t) => foundTerms.has(t))) {
              const getProduct = products.get(productId);
              getProduct.onsuccess = () => {
                if (getProduct.result) out.push(getProduct.result as IndexedProductRecord);
              };
            }
          }
          tx.oncomplete = () => resolve(out);
        }
      };
      request.onerror = () => {
        remaining--;
        if (remaining === 0) resolve([]);
      };
    }
    tx.onerror = () => resolve([]);
  });
}

export async function queryLowStockProducts(shopId: string): Promise<IndexedProductRecord[]> {
  const db = await openLocalDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction("products", "readonly");
    const idx = tx.objectStore("products").index("by_shop_stock");
    const reqLow = idx.getAll(IDBKeyRange.only([shopId, "low"]));
    const reqNeg = idx.getAll(IDBKeyRange.only([shopId, "negative"]));
    const out: IndexedProductRecord[] = [];
    reqNeg.onsuccess = () => out.push(...((reqNeg.result as IndexedProductRecord[]) ?? []));
    reqLow.onsuccess = () => out.push(...((reqLow.result as IndexedProductRecord[]) ?? []));
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => resolve([]);
  });
}

export async function queryProductsByInventoryStatus(
  shopId: string,
  status: InventoryStatus,
): Promise<IndexedProductRecord[]> {
  const db = await openLocalDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction("products", "readonly");
    const idx = tx.objectStore("products").index("by_shop_inventory_status");
    const req = idx.getAll(IDBKeyRange.only([shopId, status]));
    req.onsuccess = () => resolve((req.result as IndexedProductRecord[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

export async function queryCustomersByName(shopId: string, nameQuery: string): Promise<IndexedCustomerRecord[]> {
  const db = await openLocalDb();
  const norm = normalizeText(nameQuery);
  if (!db || !norm) return [];
  return new Promise((resolve) => {
    const tx = db.transaction("customers", "readonly");
    const idx = tx.objectStore("customers").index("by_shop_name");
    const req = idx.getAll(IDBKeyRange.bound([shopId, norm], [shopId, `${norm}\uffff`]));
    req.onsuccess = () => resolve((req.result as IndexedCustomerRecord[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

export async function queryLedgerByType(
  shopId: string,
  type: FeedTx["type"],
): Promise<IndexedLedgerRecord[]> {
  const db = await openLocalDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction("ledger", "readonly");
    const idx = tx.objectStore("ledger").index("by_shop_type");
    const req = idx.getAll(IDBKeyRange.only([shopId, type]));
    req.onsuccess = () => resolve((req.result as IndexedLedgerRecord[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

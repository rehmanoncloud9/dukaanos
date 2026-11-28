"use client";
/**
 * Scalable IndexedDB Engine for 5,000+ SKUs and 10,000+ Ledger Entries.
 * Uses compound indexes on shop_id, category, normalized names, aliases,
 * stock status, and ledger sequence for indexed local queries and offline hydration.
 */

import type { FeedTx, ShopState, StateCustomer, StateProduct } from "@/lib/api/contracts";
import { normalizeText } from "@/lib/domain/pakphone";

export type ProductCategory = "grains" | "liquids" | "dairy" | "cosmetics" | "household" | "packaged";

export interface IndexedProductRecord extends StateProduct {
  shop_id: string;
  category: ProductCategory;
  name_norm: string;
  aliases_norm: string[];
  stock_bucket: "negative" | "low" | "healthy";
}

export interface IndexedCustomerRecord extends StateCustomer {
  shop_id: string;
  name_norm: string;
  overdue_days: number;
}

export interface IndexedLedgerRecord extends FeedTx {
  shop_id: string;
}

export interface IndexedAliasRecord {
  shop_id: string;
  alias_norm: string;
  product_id: string;
}

const DB_NAME = "dukaanos-indexed-v1";
const DB_VERSION = 2;

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

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openLocalDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("products")) {
          const ps = db.createObjectStore("products", { keyPath: "id" });
          ps.createIndex("by_shop", "shop_id", { unique: false });
          ps.createIndex("by_shop_category", ["shop_id", "category"], { unique: false });
          ps.createIndex("by_shop_name", ["shop_id", "name_norm"], { unique: false });
          ps.createIndex("by_shop_stock", ["shop_id", "stock_bucket"], { unique: false });
          ps.createIndex("by_aliases", "aliases_norm", { unique: false, multiEntry: true });
        }
        if (!db.objectStoreNames.contains("customers")) {
          const cs = db.createObjectStore("customers", { keyPath: "id" });
          cs.createIndex("by_shop", "shop_id", { unique: false });
          cs.createIndex("by_shop_name", ["shop_id", "name_norm"], { unique: false });
          cs.createIndex("by_shop_overdue", ["shop_id", "overdue_days"], { unique: false });
        }
        if (!db.objectStoreNames.contains("ledger")) {
          const ls = db.createObjectStore("ledger", { keyPath: "id" });
          ls.createIndex("by_shop", "shop_id", { unique: false });
          ls.createIndex("by_shop_seq", ["shop_id", "seq"], { unique: false });
          ls.createIndex("by_shop_customer", ["shop_id", "customer_id"], { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("product_aliases")) {
          const as = db.createObjectStore("product_aliases", { keyPath: ["shop_id", "alias_norm", "product_id"] });
          as.createIndex("by_shop", "shop_id", { unique: false });
          as.createIndex("by_shop_alias", ["shop_id", "alias_norm"], { unique: false });
        }
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
          aliases_norm: aliasesNorm,
          stock_bucket: stockBucket(p),
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
        const rec: IndexedLedgerRecord = { ...f, shop_id: shopId };
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

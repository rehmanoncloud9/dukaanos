import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient, registerApiAuthHandlers, setApiShopId } from "@/core/api/client";
import type { CommitResponse, MyShop, SaleProposal, ShopState, TurnTrace } from "@/core/api/types";
import { useSession } from "@/core/auth/SessionProvider";
import { getKv, readCachedShopState, saveCachedShopState, setKv } from "@/core/offline/db";
import { useOffline } from "@/core/offline/OfflineProvider";

export interface LastCommit {
  response: CommitResponse;
  endpoint: string;
  payload: Record<string, unknown>;
  trace: TurnTrace | null;
  proposal: SaleProposal | null;
  label: string;
  replay: CommitResponse | null;
  committedAt: number;
}

export interface UndoState {
  id: string;
  message: string;
  txId: string;
  until: number;
}

interface ShopContextValue {
  shops: MyShop[] | null;
  shopsLoading: boolean;
  shopId: string | null;
  shop: MyShop | null;
  setShopId: (id: string) => void;
  reloadShops: () => Promise<MyShop[]>;
  createShop: (body: { name: string; owner_name?: string; phone?: string; city?: string }) => Promise<void>;
  xrayOn: boolean;
  setXrayOn: (v: boolean) => void;
  lastCommit: LastCommit | null;
  recordCommit: (commit: LastCommit) => void;
  setReplayResult: (replay: CommitResponse) => void;
  undo: UndoState | null;
  setUndo: (u: UndoState | null) => void;
  highlightTx: string | null;
  invalidateShop: () => Promise<void>;
}

const ShopContext = createContext<ShopContextValue | null>(null);

export const shopKeys = {
  shops: (userId: string) => ["shops", userId] as const,
  state: (shopId: string) => ["shopState", shopId] as const,
  pulse: (shopId: string) => ["pulse", shopId] as const,
  feed: (shopId: string) => ["feed", shopId] as const,
  customerLedger: (shopId: string, customerId: string) => ["customerLedger", shopId, customerId] as const,
};

const SHOP_KV_KEY = "dukaanos.shop";

export function ShopProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { online, refreshQueue } = useOffline();
  const qc = useQueryClient();

  const [shopIdState, setShopIdState] = useState<string | null>(() => getKv(SHOP_KV_KEY));
  const [xrayOn, setXrayOn] = useState(false);
  const [lastCommit, setLastCommit] = useState<LastCommit | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [highlightTx, setHighlightTx] = useState<string | null>(null);

  const shopsQuery = useQuery({
    queryKey: user ? shopKeys.shops(user.id) : ["shops", "anon"],
    queryFn: () => apiClient.shops(),
    enabled: Boolean(user) && online,
    staleTime: 60_000,
  });

  const shops = user ? (shopsQuery.data ?? null) : null;

  const shop = useMemo(() => {
    if (!user || !shops || shops.length === 0) return null;
    const targetId = shopIdState ?? getKv(SHOP_KV_KEY);
    return shops.find((s) => s.id === targetId) ?? shops[0] ?? null;
  }, [shopIdState, shops, user]);

  const shopId = user ? (shop?.id ?? shopIdState) : null;
  const activeLastCommit = user ? lastCommit : null;
  const activeUndo = user ? undo : null;

  useEffect(() => {
    if (!user) {
      setApiShopId(null);
      return;
    }
    if (shop) {
      setKv(SHOP_KV_KEY, shop.id);
      setApiShopId(shop.id);
      void refreshQueue(shop.id);
    } else if (shops && shops.length === 0) {
      setApiShopId(null);
    }
  }, [refreshQueue, shop, shops, user]);

  useEffect(() => {
    registerApiAuthHandlers({
      onShopForbidden: () => {
        setKv(SHOP_KV_KEY, null);
        setApiShopId(null);
        setShopIdState(null);
        void shopsQuery.refetch();
      },
    });
  }, [shopsQuery]);

  const setShopId = useCallback(
    (id: string) => {
      setKv(SHOP_KV_KEY, id);
      setApiShopId(id);
      setShopIdState(id);
      setLastCommit(null);
      setUndo(null);
      void refreshQueue(id);
    },
    [refreshQueue],
  );

  const reloadShops = useCallback(async () => {
    const list = await apiClient.shops();
    if (user) qc.setQueryData(shopKeys.shops(user.id), list);
    return list;
  }, [qc, user]);

  const createShop = useCallback(
    async (body: { name: string; owner_name?: string; phone?: string; city?: string }) => {
      const { shop_id } = await apiClient.createShop(body);
      setKv(SHOP_KV_KEY, shop_id);
      await reloadShops();
      setApiShopId(shop_id);
      setShopIdState(shop_id);
    },
    [reloadShops],
  );

  const recordCommit = useCallback((c: LastCommit) => {
    setLastCommit(c);
    setHighlightTx(c.response.transaction_id);
    setTimeout(() => setHighlightTx((cur) => (cur === c.response.transaction_id ? null : cur)), 1800);
  }, []);

  const setReplayResult = useCallback((replay: CommitResponse) => {
    setLastCommit((prev) => (prev ? { ...prev, replay } : prev));
  }, []);

  const invalidateShop = useCallback(async () => {
    if (!shopId) return;
    await Promise.all([
      qc.invalidateQueries({ queryKey: shopKeys.state(shopId) }),
      qc.invalidateQueries({ queryKey: shopKeys.pulse(shopId) }),
      qc.invalidateQueries({ queryKey: shopKeys.feed(shopId) }),
    ]);
  }, [qc, shopId]);

  useEffect(() => {
    if (!undo) return;
    const ms = Math.max(0, undo.until - Date.now());
    const timer = setTimeout(() => {
      setUndo((cur) => (cur?.id === undo.id ? null : cur));
    }, ms);
    return () => clearTimeout(timer);
  }, [undo]);

  const value = useMemo<ShopContextValue>(
    () => ({
      shops,
      shopsLoading: Boolean(user) && shopsQuery.isLoading,
      shopId,
      shop,
      setShopId,
      reloadShops,
      createShop,
      xrayOn,
      setXrayOn,
      lastCommit: activeLastCommit,
      recordCommit,
      setReplayResult,
      undo: activeUndo,
      setUndo,
      highlightTx,
      invalidateShop,
    }),
    [
      shops,
      user,
      shopsQuery.isLoading,
      shopId,
      shop,
      setShopId,
      reloadShops,
      createShop,
      xrayOn,
      activeLastCommit,
      recordCommit,
      setReplayResult,
      activeUndo,
      highlightTx,
      invalidateShop,
    ],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used inside ShopProvider");
  return ctx;
}

export function useShopState() {
  const { shopId } = useShop();
  const { online } = useOffline();
  const cached = useMemo(() => (shopId ? readCachedShopState(shopId) : null), [shopId]);

  const query = useQuery<ShopState>({
    queryKey: shopId ? shopKeys.state(shopId) : ["shopState", "none"],
    queryFn: async () => {
      const fresh = await apiClient.shopState(shopId!);
      saveCachedShopState(shopId!, fresh);
      return fresh;
    },
    enabled: Boolean(shopId) && online,
    placeholderData: () => cached?.state,
  });

  const data = query.data ?? cached?.state ?? null;
  const isStaleCache = Boolean(data) && (!online || query.isPlaceholderData);

  return {
    ...query,
    data,
    isStaleCache,
    cachedAt: cached?.updatedAt ?? null,
  };
}

export function usePulse() {
  const { shopId } = useShop();
  const { online } = useOffline();
  return useQuery({
    queryKey: shopId ? shopKeys.pulse(shopId) : ["pulse", "none"],
    queryFn: () => apiClient.pulse(shopId!),
    enabled: Boolean(shopId) && online,
  });
}

export function useFeed(limit = 40) {
  const { shopId } = useShop();
  const { online } = useOffline();
  return useInfiniteQuery({
    queryKey: shopId ? shopKeys.feed(shopId) : ["feed", "none"],
    queryFn: ({ pageParam }) => apiClient.feed(pageParam as number | undefined, limit, shopId!),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before_seq ?? undefined,
    enabled: Boolean(shopId) && online,
  });
}

export function useCustomerLedger(customerId: string | null | undefined, limit = 50) {
  const { shopId } = useShop();
  const { online } = useOffline();
  return useInfiniteQuery({
    queryKey: shopId && customerId ? shopKeys.customerLedger(shopId, customerId) : ["customerLedger", "none"],
    queryFn: ({ pageParam }) => apiClient.customerLedger(customerId!, pageParam as number | undefined, limit, shopId!),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before_seq ?? undefined,
    enabled: Boolean(shopId && customerId) && online,
  });
}

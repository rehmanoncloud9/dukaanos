import NetInfo from "@react-native-community/netinfo";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { setApiOfflineDetector } from "@/core/api/client";
import { copyToQueueDirectory } from "./db";
import { queueService, type FlushOutcome, type QueuedTurn } from "./queue";

export interface OfflineContextValue {
  online: boolean;
  networkConnected: boolean;
  simulatedOffline: boolean;
  setSimulatedOffline: (v: boolean) => void;
  pending: number;
  queue: QueuedTurn[];
  reviewInbox: QueuedTurn[];
  enqueueTurn: (item: {
    key: string;
    shopId: string;
    kind: "audio" | "text";
    sourceUri?: string;
    mime?: string;
    text?: string;
  }) => Promise<QueuedTurn>;
  dequeueTurn: (key: string) => Promise<void>;
  retryTurn: (key: string) => Promise<void>;
  refreshQueue: (shopId?: string) => Promise<QueuedTurn[]>;
  flush: (shopId: string, processor: (q: QueuedTurn) => Promise<FlushOutcome>) => Promise<{ done: number; review: number; failed: number }>;
  registerFlushRunner: (runner: (() => Promise<void>) | null) => void;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [networkConnected, setNetworkConnected] = useState(true);
  const [simulatedOffline, setSimulatedOfflineState] = useState(false);
  const [queue, setQueue] = useState<QueuedTurn[]>([]);
  const flushingRef = useRef(false);
  const flushRunnerRef = useRef<(() => Promise<void>) | null>(null);
  const simulatedRef = useRef(false);
  const connectedRef = useRef(true);

  const online = networkConnected && !simulatedOffline;

  useEffect(() => {
    simulatedRef.current = simulatedOffline;
    connectedRef.current = networkConnected;
    setApiOfflineDetector(() => simulatedRef.current || !connectedRef.current);
  }, [networkConnected, simulatedOffline]);

  const setSimulatedOffline = useCallback((v: boolean) => {
    simulatedRef.current = v;
    setSimulatedOfflineState(v);
    if (!v && connectedRef.current) {
      void flushRunnerRef.current?.();
    }
  }, []);

  const refreshQueue = useCallback(async (shopId?: string) => {
    const items = await queueService.list(shopId);
    setQueue(items);
    return items;
  }, []);

  const enqueueTurn = useCallback(
    async (input: {
      key: string;
      shopId: string;
      kind: "audio" | "text";
      sourceUri?: string;
      mime?: string;
      text?: string;
    }) => {
      const persistedUri =
        input.kind === "audio" && input.sourceUri
          ? await copyToQueueDirectory(input.sourceUri, input.key, input.mime)
          : undefined;
      const saved = await queueService.enqueue({
        key: input.key,
        shop_id: input.shopId,
        kind: input.kind,
        file_uri: persistedUri ?? null,
        mime: input.mime ?? null,
        text: input.text ?? null,
      });
      await refreshQueue(input.shopId);
      return saved;
    },
    [refreshQueue],
  );

  const dequeueTurn = useCallback(
    async (key: string) => {
      const existing = queue.find((q) => q.key === key);
      await queueService.dequeue(key);
      await refreshQueue(existing?.shop_id);
    },
    [queue, refreshQueue],
  );

  const retryTurn = useCallback(
    async (key: string) => {
      const existing = queue.find((q) => q.key === key);
      await queueService.retryFailed(key);
      await refreshQueue(existing?.shop_id);
      if (!simulatedRef.current && connectedRef.current) {
        void flushRunnerRef.current?.();
      }
    },
    [queue, refreshQueue],
  );

  const flush = useCallback(
    async (shopId: string, processor: (q: QueuedTurn) => Promise<FlushOutcome>) => {
      if (flushingRef.current || simulatedRef.current || !connectedRef.current) {
        return { done: 0, review: 0, failed: 0 };
      }
      flushingRef.current = true;
      try {
        const result = await queueService.flush(shopId, processor);
        await refreshQueue(shopId);
        return result;
      } finally {
        flushingRef.current = false;
      }
    },
    [refreshQueue],
  );

  const registerFlushRunner = useCallback((runner: (() => Promise<void>) | null) => {
    flushRunnerRef.current = runner;
  }, []);

  useEffect(() => {
    void NetInfo.fetch().then((s) => {
      const ok = s.isConnected !== false && s.isInternetReachable !== false;
      connectedRef.current = ok;
      setNetworkConnected(ok);
    });
    const unsubNet = NetInfo.addEventListener((s) => {
      const ok = s.isConnected !== false && s.isInternetReachable !== false;
      const prev = connectedRef.current;
      connectedRef.current = ok;
      setNetworkConnected(ok);
      if (ok && !prev && !simulatedRef.current) {
        void flushRunnerRef.current?.();
      }
    });
    const subApp = AppState.addEventListener("change", (next) => {
      if (next === "active" && connectedRef.current && !simulatedRef.current) {
        void flushRunnerRef.current?.();
      }
    });
    return () => {
      unsubNet();
      subApp.remove();
    };
  }, []);

  const pending = useMemo(() => queue.filter((q) => q.status !== "failed").length, [queue]);
  const reviewInbox = useMemo(() => queue.filter((q) => q.status === "review"), [queue]);

  const value = useMemo<OfflineContextValue>(
    () => ({
      online,
      networkConnected,
      simulatedOffline,
      setSimulatedOffline,
      pending,
      queue,
      reviewInbox,
      enqueueTurn,
      dequeueTurn,
      retryTurn,
      refreshQueue,
      flush,
      registerFlushRunner,
    }),
    [
      online,
      networkConnected,
      simulatedOffline,
      setSimulatedOffline,
      pending,
      queue,
      reviewInbox,
      enqueueTurn,
      dequeueTurn,
      retryTurn,
      refreshQueue,
      flush,
      registerFlushRunner,
    ],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used inside OfflineProvider");
  return ctx;
}

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw, ShieldCheck, WifiOff } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { formatJournal } from "@domain/money";
import type { CommitResponse, JournalRow, PakPhoneTrace, TurnTrace } from "@contracts";
import { apiClient, friendlyApiError } from "@/core/api/client";
import type { ChainVerifyResponse } from "@/core/api/types";
import { useOffline } from "@/core/offline/OfflineProvider";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import { Card, Header, IconButton, Pill, PrimaryButton, Screen, SecondaryButton, useToast } from "@/core/ui";
import { useMunshi } from "@/features/munshi/MunshiProvider";

const ENDPOINT: Record<string, string> = {
  sale: "/api/transactions/commit",
  payment: "/api/transactions/payment",
  reversal: "/api/transactions/reverse",
  purchase: "/api/transactions/purchase",
};

function RowCard({
  num,
  title,
  badge,
  children,
}: {
  num: string;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card style={styles.rowCard}>
      <View style={styles.rowHeader}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowNum}>{num}</Text>
          <Text style={styles.rowTitle}>{title}</Text>
        </View>
        {badge}
      </View>
      <View style={styles.monoBox}>{children}</View>
    </Card>
  );
}

export function XRayView({ txId }: { txId?: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const { shopId, lastCommit } = useShop();
  const { data: state } = useShopState();
  const { online, simulatedOffline, setSimulatedOffline } = useOffline();
  const { replayTest } = useMunshi();

  const target = txId ?? lastCommit?.response.transaction_id ?? state?.feed[0]?.id ?? null;
  const live = lastCommit && lastCommit.response.transaction_id === target ? lastCommit : null;

  const xrayQuery = useQuery({
    queryKey: ["xray", shopId ?? "none", target ?? "none"],
    queryFn: () => apiClient.xray(target!, shopId ?? undefined),
    enabled: Boolean(target && online),
    retry: false,
  });

  const doc = xrayQuery.data ?? null;
  const loading = xrayQuery.isLoading;
  const [manualReplay, setManualReplay] = useState<{ target: string | null; res: CommitResponse } | null>(null);
  const replay = (manualReplay?.target === target ? manualReplay.res : null) ?? live?.replay ?? null;
  const [replaying, setReplaying] = useState(false);
  const [chain, setChain] = useState<ChainVerifyResponse | null>(null);
  const [verifyingChain, setVerifyingChain] = useState(false);

  const meta = doc?.transaction.audit_meta ?? {};
  const trace: Partial<TurnTrace> = useMemo(
    () =>
      live?.trace ?? {
        transcript: meta.transcript as string | undefined,
        model: meta.model as string | undefined,
        latency_ms: meta.latency_ms as number | undefined,
        pakphone: meta.pakphone as PakPhoneTrace | undefined,
        source: meta.source as TurnTrace["source"] | undefined,
      },
    [live?.trace, meta.latency_ms, meta.model, meta.pakphone, meta.source, meta.transcript],
  );

  const journal: JournalRow[] = live?.response.journal ?? doc?.journal ?? [];
  const hash = live?.response.entry_hash ?? doc?.transaction.entry_hash ?? "";
  const prev = live?.response.prev_hash ?? doc?.transaction.prev_hash ?? "";
  const delta = doc?.delta ?? live?.response.delta ?? 0;
  const pak = trace.pakphone;
  const discount = doc?.transaction.discount_paisa ?? live?.response.totals?.discount_paisa ?? 0;

  const replayTarget = useMemo(() => {
    if (live) return { endpoint: live.endpoint, payload: live.payload };
    const rp = doc?.transaction.audit_meta?.replay_payload;
    if (doc && rp) {
      const endpoint = ENDPOINT[doc.transaction.type];
      if (endpoint) return { endpoint, payload: rp };
    }
    return null;
  }, [doc, live]);

  const doReplay = async () => {
    if (!replayTarget) return;
    setReplaying(true);
    try {
      const res = live ? await replayTest() : await replayTest(replayTarget);
      if (res) setManualReplay({ target, res });
    } catch (err) {
      toast(friendlyApiError(err), "err");
    } finally {
      setReplaying(false);
    }
  };

  const doVerifyChain = async () => {
    setVerifyingChain(true);
    try {
      const res = await apiClient.chain(shopId ?? undefined);
      setChain(res);
    } catch (err) {
      toast(friendlyApiError(err), "err");
    } finally {
      setVerifyingChain(false);
    }
  };

  const modelBadge = trace.model
    ? ` (${trace.model.replace(/^gemini-/, "")})`
    : trace.source === "regex"
      ? " (regex fast-path)"
      : "";

  return (
    <Screen
      scroll
      edges={["top", "bottom"]}
      header={
        <Header
          title="</> X-Ray Inspector"
          leftExtra={
            <IconButton
              accessibilityLabel="Back"
              onPress={() => router.back()}
              icon={<ArrowLeft size={20} color={colors.ink} strokeWidth={ICON_STROKE} />}
            />
          }
          right={
            <Pill tone="cash" mono>
              LIVE
            </Pill>
          }
        />
      }
    >
      <View style={styles.stack}>
        {loading && !live ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.ink2} />
            <Text style={styles.loadingText}>Loading proof…</Text>
          </View>
        ) : null}

        {!target ? (
          <Card>
            <Text style={styles.emptyText}>No transaction selected yet. Record a sale or tap an entry from Munshi.</Text>
          </Card>
        ) : (
          <>
            <RowCard
              num="01"
              title={`Transcript${modelBadge}`}
              badge={
                trace.latency_ms ? (
                  <Text style={styles.latencyText}>{trace.latency_ms}ms</Text>
                ) : undefined
              }
            >
              <Text style={styles.transcriptText} selectable>
                {trace.transcript
                  ? `“${trace.transcript}”`
                  : doc?.transaction.type === "purchase"
                    ? "Parchi OCR import (0 write tools)"
                    : "Seeded / manual entry — no voice turn"}
              </Text>
            </RowCard>

            <RowCard
              num="02"
              title="PakPhone + Desi Math"
              badge={
                pak ? (
                  <Pill tone="cash" mono>
                    {pak.ms_total}ms
                  </Pill>
                ) : undefined
              }
            >
              {pak?.customer ? (
                <Text style={styles.monoLine} selectable>
                  phonetic(“{pak.customer.mention.toLowerCase()}”) → {pak.customer.candidates[0]?.name ?? "?"} (
                  {pak.customer.candidates[0]?.score.toFixed(2) ?? "–"})
                </Text>
              ) : null}
              {pak?.items.map((item, idx) => (
                <Text key={idx} style={styles.monoLine} selectable>
                  {item.formula || `match(“${item.spoken}”) → ${item.product ?? "QuickAdd"} (${item.score.toFixed(2)})`}
                </Text>
              ))}
              {discount > 0 ? <Text style={styles.monoLine}>modifier(“chhor do”) → -{discount / 100} PKR</Text> : null}
              {!pak ? <Text style={styles.monoMuted}>No PakPhone trace for this entry</Text> : null}
            </RowCard>

            <RowCard
              num="03"
              title="Balanced Journal"
              badge={
                <Pill tone={delta === 0 ? "cash" : "udhaar"} mono>
                  Δ = {delta} {delta === 0 ? "✓" : "✗"}
                </Pill>
              }
            >
              {journal.length === 0 ? (
                <Text style={styles.monoMuted}>{online ? "No journal rows returned" : "Offline — cached header only"}</Text>
              ) : (
                journal.map((j, idx) => (
                  <View key={idx} style={styles.journalRow}>
                    <Text style={styles.journalSide} numberOfLines={1}>
                      {j.side} {j.account_code} {j.account_name}
                    </Text>
                    <Text style={styles.journalAmt}>{formatJournal(j.amount_paisa)}</Text>
                  </View>
                ))
              )}
            </RowCard>

            <RowCard
              num="04"
              title="SHA-256 Chain + RLS"
              badge={<Pill mono>RLS ON</Pill>}
            >
              <Text style={styles.monoLine} selectable>
                hash: {hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : "—"}
              </Text>
              <Text style={styles.monoMuted} selectable>
                prev: {prev ? `${prev.slice(0, 10)}…${prev.slice(-8)}` : "—"}
              </Text>
              <Text style={styles.monoLine} selectable>
                shop_id: {(doc?.rls_shop_id ?? shopId ?? "").slice(0, 18)}…
              </Text>
              {doc ? (
                <Text style={[styles.monoLine, { color: doc.hash_valid ? colors.cash : colors.udhaar }]}>
                  recompute: {doc.hash_valid ? "match ✓" : "MISMATCH ✗"} · rows for key: {doc.rows_for_key}
                </Text>
              ) : null}
              {doc?.reversed_by ? (
                <Text style={[styles.monoLine, { color: colors.udhaar }]}>
                  reversed by {doc.reversed_by.slice(0, 8)}…
                </Text>
              ) : null}
            </RowCard>

            <View style={styles.controls}>
              <PrimaryButton
                disabled={!replayTarget || replaying || !online}
                busy={replaying}
                onPress={() => void doReplay()}
                style={styles.replayBtn}
              >
                <View style={styles.btnInner}>
                  <RotateCcw size={16} color={colors.surface} strokeWidth={ICON_STROKE} />
                  <Text style={styles.replayText}>Replay Test</Text>
                  {replay ? (
                    <Pill tone={replay.deduplicated ? "cash" : "udhaar"} mono>
                      {replay.deduplicated ? `${replay.http} OK · ${replay.duplicate_rows} Dupes` : "NEW ROW?!"}
                    </Pill>
                  ) : null}
                </View>
              </PrimaryButton>

              {!replayTarget ? (
                <Text style={styles.hintText}>
                  Replay is available for entries made in-app (seeded history has no client payload).
                </Text>
              ) : null}

              <View style={styles.splitRow}>
                <SecondaryButton
                  busy={verifyingChain}
                  disabled={!online}
                  onPress={() => void doVerifyChain()}
                  style={styles.halfBtn}
                >
                  <View style={styles.btnInner}>
                    <ShieldCheck size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
                    <Text style={styles.secBtnText}>Verify chain</Text>
                  </View>
                </SecondaryButton>

                <Pressable
                  onPress={() => setSimulatedOffline(!simulatedOffline)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: simulatedOffline }}
                  accessibilityLabel="Simulate Offline"
                  style={[styles.offlineToggle, simulatedOffline && styles.offlineToggleOn]}
                >
                  <WifiOff size={16} color={simulatedOffline ? colors.amberInk : colors.ink} strokeWidth={ICON_STROKE} />
                  <Text style={[styles.secBtnText, simulatedOffline && { color: colors.amberInk }]}>
                    {simulatedOffline ? "Offline ON" : "Simulate Offline"}
                  </Text>
                </Pressable>
              </View>

              {chain ? (
                <View style={[styles.chainBanner, chain.ok ? styles.chainOk : styles.chainBad]}>
                  <Text style={[styles.chainText, { color: chain.ok ? colors.cashInk : colors.udhaarInk }]} selectable>
                    {chain.ok
                      ? `CHAIN_OK · ${chain.checked} links recomputed · ${chain.ms}ms`
                      : `CHAIN_BROKEN at #${chain.first_broken_seq ?? "?"} · ${chain.code}`}
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.ink2,
  },
  emptyText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.ink2,
    lineHeight: 20,
  },
  rowCard: {
    padding: spacing.lg,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
    minWidth: 0,
  },
  rowNum: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 12,
    color: colors.ink3,
  },
  rowTitle: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
    flexShrink: 1,
  },
  latencyText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    color: colors.ink2,
  },
  monoBox: {
    backgroundColor: colors.canvas,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: 4,
  },
  transcriptText: {
    fontFamily: fontFamilies.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.ink,
  },
  monoLine: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.ink,
  },
  monoMuted: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.ink2,
  },
  journalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  journalSide: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.ink,
    flex: 1,
  },
  journalAmt: {
    fontFamily: fontFamilies.monoSemi,
    fontSize: 11.5,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  replayBtn: {
    width: "100%",
  },
  btnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  replayText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.surface,
  },
  hintText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.ink2,
    textAlign: "center",
    lineHeight: 17,
  },
  splitRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  halfBtn: {
    flex: 1,
  },
  secBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13.5,
    color: colors.ink,
  },
  offlineToggle: {
    flex: 1,
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.cta,
    backgroundColor: colors.surfaceSunken,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  offlineToggleOn: {
    backgroundColor: colors.amberBg,
  },
  chainBanner: {
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  chainOk: {
    backgroundColor: colors.cashBg,
  },
  chainBad: {
    backgroundColor: colors.udhaarBg,
  },
  chainText: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 12,
    lineHeight: 17,
  },
});

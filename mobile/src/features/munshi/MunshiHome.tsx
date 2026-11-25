import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Camera, ChevronDown, ChevronUp, Keyboard, Lock, RefreshCw, SendHorizontal, WifiOff } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatBaseQty } from "@domain/desi-units";
import { formatRs } from "@domain/money";
import type { FeedTx } from "@/core/api/types";
import { useT } from "@/core/i18n/I18nProvider";
import { useOffline } from "@/core/offline/OfflineProvider";
import { useFeed, usePulse, useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, radii, spacing } from "@/core/theme/tokens";
import { Card, EmptyState, Header, IconButton, Money, Pill, relTime, Skeleton, useToast } from "@/core/ui";
import { MicButton } from "./MicButton";
import { useMunshi } from "./MunshiProvider";

export const DEMO_UTTERANCES = [
  "Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein",
  "Ek kilo cheeni aur do sabun cash",
  "2 packet Lays aur adha kilo khand cash",
  "Bilal ne 1500 jama karwaye",
  "Subah ka hisaab batao",
  "Pichli entry wapas kar do",
  "Ali Tailor ka kitna udhaar hai?",
];

export function feedSummary(t: FeedTx): string {
  if (t.type === "payment") return "Wasooli · cash received";
  if (t.type === "reversal") return `Undo · ${String(t.audit_meta?.reversed_type ?? "entry")} reversed`;
  return t.lines
    .map((l) =>
      l.value_first
        ? `${l.name} (Rs. ${l.line_total_paisa / 100})`
        : `${formatBaseQty(l.qty_base_units, l.base_unit)} ${l.name.replace(/\s*\(.*\)/, "")}`,
    )
    .join(", ");
}

function feedTag(t: FeedTx): string {
  if (t.type === "payment") return "Wasooli";
  if (t.type === "purchase") return t.credit_paisa > 0 ? "Restock · A/P" : "Restock";
  if (t.type === "reversal") return "Reversal";
  if (t.credit_paisa !== 0 && t.cash_paid_paisa > 0) return "Split · Khata";
  if (t.credit_paisa > 0) return "Udhaar";
  return t.audit_meta?.channel === "tier1-auto" ? "Cash · Tier 1" : "Cash";
}

function FeedRow({ tx, flash, onPress }: { tx: FeedTx; flash: boolean; onPress: () => void }) {
  const title =
    tx.type === "purchase"
      ? tx.supplier_name ?? "Wholesale"
      : tx.type === "reversal"
        ? "Reversal"
        : tx.customer_name ?? "Walk-in Cash";
  const amount = tx.type === "sale" ? (tx.cash_paid_paisa > 0 ? tx.cash_paid_paisa : tx.total_paisa) : Math.abs(tx.total_paisa);
  const amtColor =
    tx.type === "purchase"
      ? colors.maal
      : tx.type === "reversal"
        ? colors.ink3
        : tx.type === "sale" && tx.cash_paid_paisa === 0
          ? colors.udhaar
          : colors.cash;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatRs(amount)}`}
      style={[styles.feedRow, flash && styles.feedFlash, tx.is_reversed && styles.feedReversed]}
    >
      <View style={styles.feedLeft}>
        <Text numberOfLines={1} style={styles.feedTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.feedSub}>
          {relTime(tx.created_at)} · {feedSummary(tx)}
        </Text>
      </View>
      <View style={styles.feedRight}>
        <Text style={[styles.feedAmt, { color: amtColor }, tx.is_reversed && styles.strike]}>
          {tx.type === "purchase" || tx.type === "reversal" ? "-" : "+"}
          <Text style={styles.feedRs}>Rs. </Text>
          {(amount / 100).toLocaleString("en-US")}
        </Text>
        <Text style={styles.feedTag}>{tx.is_reversed ? "Undone" : feedTag(tx)}</Text>
      </View>
    </Pressable>
  );
}

function UndoCountdownBar({ undoKey, until, message, label, onUndo }: {
  undoKey: string;
  until: number;
  message: string;
  label: string;
  onUndo: () => void;
}) {
  const [progress] = useState(() => new Animated.Value(1));

  useEffect(() => {
    progress.setValue(1);
    const remaining = Math.max(0, until - Date.now());
    const anim = Animated.timing(progress, {
      toValue: 0,
      duration: remaining,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, undoKey, until]);

  return (
    <View style={styles.undoWrap} accessibilityLiveRegion="polite">
      <View style={styles.undoBar}>
        <View style={styles.undoRow}>
          <Text numberOfLines={1} style={styles.undoMsg}>
            {message}
          </Text>
          <Pressable onPress={onUndo} style={styles.undoBtn} accessibilityRole="button" accessibilityLabel={label}>
            <Text style={styles.undoBtnText}>{label}</Text>
          </Pressable>
        </View>
        <View style={styles.undoTrack}>
          <Animated.View
            style={[
              styles.undoFill,
              {
                width: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

export function MunshiHome() {
  const router = useRouter();
  const { t } = useT();
  const { toast } = useToast();
  const { shop, xrayOn, setXrayOn, undo, highlightTx } = useShop();
  const { data: state, isStaleCache, refetch } = useShopState();
  const { data: pulse } = usePulse();
  const feedQuery = useFeed(40);
  const { online, pending, reviewInbox, simulatedOffline, setSimulatedOffline } = useOffline();
  const {
    thinking,
    submitTurn,
    openPulseSheet,
    openReplaysSheet,
    flushNow,
    openQueuedReview,
    doUndo,
  } = useMunshi();

  const [stripOpen, setStripOpen] = useState(true);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);

  const shopName = state?.shop.name ?? shop?.name ?? "DukaanOS";

  const combinedFeed = useMemo(() => {
    const base = state?.feed ?? [];
    const seen = new Set(base.map((item) => item.id));
    const paged = feedQuery.data?.pages.flatMap((pg) => pg.items) ?? [];
    return [...base, ...paged.filter((item) => !seen.has(item.id))];
  }, [feedQuery.data?.pages, state?.feed]);

  const list = useMemo(() => {
    if (showAll) return combinedFeed;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todays = combinedFeed.filter((item) => new Date(item.created_at) >= dayStart);
    return (todays.length ? todays : combinedFeed).slice(0, 7);
  }, [combinedFeed, showAll]);

  const sendTyped = async (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    setText("");
    await submitTurn({ text: clean });
  };

  const listHeader = (
    <View style={styles.headerBlock}>
      {xrayOn ? (
        <View style={styles.judgeBanner}>
          <Text style={styles.judgeBannerText}>Judge Mode ON — every commit opens {"</>"} X-Ray</Text>
          <Pressable onPress={() => setXrayOn(false)} style={styles.judgeOffBtn}>
            <Text style={styles.judgeOffText}>OFF</Text>
          </Pressable>
        </View>
      ) : null}

      {!online || pending > 0 || isStaleCache ? (
        <View style={styles.offlineBanner}>
          <WifiOff size={15} color={colors.amberInk} strokeWidth={ICON_STROKE} />
          <Text style={styles.offlineText} numberOfLines={2}>
            {online ? "Online" : t("offlineCachedBanner")} · {pending} {t("pendingSync")}
          </Text>
          <Pressable
            onPress={() => (simulatedOffline ? setSimulatedOffline(false) : void flushNow())}
            style={styles.offlineActionBtn}
          >
            <Text style={styles.offlineActionText}>{online ? t("syncNow") : t("reconnect")}</Text>
          </Pressable>
        </View>
      ) : null}

      {!state ? (
        <View style={styles.kpiRow}>
          <Skeleton height={104} style={styles.kpiCard} />
          <Skeleton height={104} style={styles.kpiCard} />
        </View>
      ) : (
        <View style={styles.kpiRow}>
          <Card style={styles.kpiCard}>
            <View style={styles.kpiLabelRow}>
              <View style={[styles.dot, { backgroundColor: colors.cash }]} />
              <Text style={styles.eyebrow}>{t("todayCash").toUpperCase()}</Text>
            </View>
            <Money paisa={state.today.cash_sales_paisa} size={22} lineHeight={26} style={styles.kpiVal} />
            <Text style={styles.kpiSub}>
              {state.today.sales_count} {t("sales")}
            </Text>
          </Card>
          <Card style={styles.kpiCard}>
            <View style={styles.kpiLabelRow}>
              <View style={[styles.dot, { backgroundColor: colors.udhaar }]} />
              <Text style={styles.eyebrow}>{t("todayUdhaar").toUpperCase()}</Text>
            </View>
            <Money
              paisa={state.today.udhaar_paisa}
              size={22}
              lineHeight={26}
              color={colors.udhaar}
              style={styles.kpiVal}
            />
            <Text style={styles.kpiSub}>
              {state.today.udhaar_accounts} {t("accounts")}
            </Text>
          </Card>
        </View>
      )}

      {pulse ? (
        <Card padded={false}>
          <Pressable onPress={() => setStripOpen((o) => !o)} style={styles.pulseHeader}>
            <View style={[styles.dot, { backgroundColor: colors.udhaar }]} />
            <Text style={styles.pulseSummary} numberOfLines={1}>
              {pulse.overdue.count} overdue · {formatRs(pulse.overdue.total_paisa)} · {pulse.stockout.count} low stock
            </Text>
            {stripOpen ? (
              <ChevronUp size={16} color={colors.ink2} strokeWidth={ICON_STROKE} />
            ) : (
              <ChevronDown size={16} color={colors.ink2} strokeWidth={ICON_STROKE} />
            )}
          </Pressable>

          {stripOpen ? (
            <>
              <View style={styles.pulseActionRow}>
                <View style={styles.pulseActionLeft}>
                  <Text style={styles.pulseActionTitle}>{t("recoverUdhaar")}</Text>
                  <Text style={styles.pulseActionSub}>15+ days stuck · 1-tap WhatsApp/SMS</Text>
                </View>
                <Pill
                  tone="udhaar"
                  onPress={() => router.push("/(tabs)/khata?filter=overdue")}
                  accessibilityLabel={t("remind")}
                >
                  {t("remind")}
                </Pill>
              </View>
              <View style={styles.pulseActionRow}>
                <View style={styles.pulseActionLeft}>
                  <Text style={styles.pulseActionTitle}>{t("stockoutAlert")}</Text>
                  <Text style={styles.pulseActionSub} numberOfLines={1}>
                    {pulse.stockout.items.length
                      ? pulse.stockout.items.map((i) => i.name.replace(/\s*\(.*\)/, "")).join(" & ")
                      : "All shelves healthy"}{" "}
                    · Wholesale list ready
                  </Text>
                </View>
                <Pill tone="maal" onPress={() => openPulseSheet(pulse)} accessibilityLabel={t("order")}>
                  {t("order")}
                </Pill>
              </View>
            </>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.feedTop}>
        <Text style={styles.eyebrow}>
          {showAll
            ? t("allEntries").toUpperCase()
            : `TODAY · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}`}
        </Text>
        <View style={styles.feedControls}>
          <IconButton
            accessibilityLabel="Refresh feed"
            onPress={() => void refetch()}
            icon={<RefreshCw size={14} color={colors.ink2} strokeWidth={ICON_STROKE} />}
            style={styles.smallRefresh}
          />
          <Pressable onPress={() => setShowAll((s) => !s)} style={styles.toggleAllBtn}>
            <Text style={styles.eyebrow}>{showAll ? t("showLess").toUpperCase() : `${list.length} LATEST`}</Text>
          </Pressable>
        </View>
      </View>

      {thinking ? (
        <Card style={styles.thinkingCard}>
          <Text style={styles.thinkingText}>{t("listening")} (audio → JSON)</Text>
        </Card>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Header
        title={shopName}
        onPressTitle={() => router.push("/settings")}
        onLongPressTitle={openReplaysSheet}
        titleAccessibilityLabel={`${shopName} settings`}
        leftExtra={
          <Pill tone="neutral">
            <Lock size={11} color={colors.ink2} strokeWidth={ICON_STROKE} />
            <Text style={styles.zeroFbrText}>{t("zeroFbr")}</Text>
          </Pill>
        }
        right={
          <View style={styles.headerRight}>
            {reviewInbox.length > 0 ? (
              <Pill
                tone="amber"
                onPress={() => void openQueuedReview()}
                accessibilityLabel={`Open ${reviewInbox.length} queued reviews`}
              >
                Review {reviewInbox.length}
              </Pill>
            ) : null}
            <Pill
              tone={xrayOn ? "dark" : "outline"}
              mono
              onPress={() => {
                const next = !xrayOn;
                setXrayOn(next);
                if (next) router.push("/xray");
              }}
              accessibilityLabel="Toggle X-Ray Judge Mode"
            >
              {"</>"} {t("xray")}
            </Pill>
          </View>
        }
      />

      <FlashList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.feedCardRow}>
            <FeedRow
              tx={item}
              flash={highlightTx === item.id}
              onPress={() => router.push(`/xray?txId=${item.id}`)}
            />
          </View>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !thinking ? (
            <View style={styles.emptyCardWrap}>
              <Card>
                <EmptyState title={t("emptyMunshi")} />
              </Card>
            </View>
          ) : null
        }
        ListFooterComponent={
          showAll && feedQuery.hasNextPage ? (
            <View style={styles.loadMoreWrap}>
              <Pressable onPress={() => void feedQuery.fetchNextPage()} style={styles.loadMoreBtn}>
                <Text style={styles.loadMoreText}>{t("loadOlder")}</Text>
              </Pressable>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listPad}
        onEndReached={() => {
          if (showAll && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
            void feedQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
      />

      {undo ? (
        <UndoCountdownBar
          undoKey={undo.id}
          until={undo.until}
          message={undo.message}
          label={t("undo")}
          onUndo={() => void doUndo()}
        />
      ) : null}

      <View pointerEvents="box-none" style={styles.dockWrap}>
        {typing ? (
          <Card style={styles.typedCard}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.demoChipsRow}>
              {DEMO_UTTERANCES.map((u) => (
                <Pressable key={u} onPress={() => setText(u)} style={styles.demoChip}>
                  <Text style={styles.demoChipText}>{u.length > 34 ? `${u.slice(0, 32)}…` : u}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.inputBar}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t("typePlaceholder")}
                placeholderTextColor={colors.ink3}
                returnKeyType="send"
                onSubmitEditing={() => void sendTyped(text)}
                style={styles.textInput}
              />
              <IconButton
                accessibilityLabel="Send typed entry"
                tone="dark"
                disabled={!text.trim() || thinking}
                onPress={() => void sendTyped(text)}
                icon={<SendHorizontal size={18} color={colors.surface} strokeWidth={ICON_STROKE} />}
              />
            </View>
          </Card>
        ) : null}

        <View style={styles.dockControls}>
          <IconButton
            accessibilityLabel={t("typeInstead")}
            tone={typing ? "dark" : "surface"}
            onPress={() => setTyping((v) => !v)}
            icon={<Keyboard size={18} color={typing ? colors.surface : colors.ink} strokeWidth={ICON_STROKE} />}
          />
          <MicButton
            busy={thinking}
            onClip={(uri, mime) => void submitTurn({ audioUri: uri, mimeType: mime })}
            onDenied={(msg) => {
              toast(msg, "warn");
              setTyping(true);
            }}
          />
          <Pressable
            onPress={() => router.push("/parchi")}
            accessibilityRole="button"
            accessibilityLabel={t("scanParchi")}
            style={styles.parchiPill}
          >
            <Camera size={16} color={colors.maal} strokeWidth={ICON_STROKE} />
            <Text style={styles.parchiPillText}>{t("parchi")}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  zeroFbrText: { fontFamily: fontFamilies.sansSemi, fontSize: 11.5, color: colors.ink2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  listPad: { paddingBottom: 170 },
  headerBlock: { paddingHorizontal: spacing.lg, gap: spacing.sm + 2, marginBottom: spacing.sm },
  judgeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  judgeBannerText: { fontFamily: fontFamilies.mono, fontSize: 11.5, color: colors.surface, flex: 1 },
  judgeOffBtn: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  judgeOffText: { fontFamily: fontFamilies.sansSemi, fontSize: 11, color: colors.surface },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.amberBg,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  offlineText: { flex: 1, fontFamily: fontFamilies.sansMedium, fontSize: 13, color: colors.amberInk },
  offlineActionBtn: {
    minHeight: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  offlineActionText: { fontFamily: fontFamilies.sansSemi, fontSize: 12.5, color: colors.ink },
  kpiRow: { flexDirection: "row", gap: spacing.sm + 2 },
  kpiCard: { flex: 1 },
  kpiLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  eyebrow: { fontFamily: fontFamilies.sansSemi, fontSize: 11, letterSpacing: 0.6, color: colors.ink2 },
  kpiVal: { marginTop: 6 },
  kpiSub: { marginTop: 4, fontFamily: fontFamilies.sans, fontSize: 13, color: colors.ink2 },
  pulseHeader: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pulseSummary: { flex: 1, fontFamily: fontFamilies.sansMedium, fontSize: 13.5, color: colors.ink },
  pulseActionRow: {
    borderTopWidth: 1,
    borderTopColor: colors.borderHairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  pulseActionLeft: { flex: 1, minWidth: 0 },
  pulseActionTitle: { fontFamily: fontFamilies.sansSemi, fontSize: 15, color: colors.ink },
  pulseActionSub: { fontFamily: fontFamilies.sans, fontSize: 13, color: colors.ink2 },
  feedTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.xs },
  feedControls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  smallRefresh: { width: 36, height: 36 },
  toggleAllBtn: { minHeight: 36, justifyContent: "center", paddingHorizontal: 4 },
  thinkingCard: { paddingVertical: spacing.md },
  thinkingText: { fontFamily: fontFamilies.sansMedium, fontSize: 14, color: colors.cash },
  feedCardRow: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderHairline,
  },
  feedRow: {
    minHeight: 62,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  feedFlash: { backgroundColor: colors.cashBg },
  feedReversed: { opacity: 0.5 },
  feedLeft: { flex: 1, minWidth: 0 },
  feedTitle: { fontFamily: fontFamilies.sansMedium, fontSize: 15, color: colors.ink },
  feedSub: { marginTop: 2, fontFamily: fontFamilies.sans, fontSize: 13, color: colors.ink2 },
  feedRight: { alignItems: "flex-end" },
  feedAmt: { fontFamily: fontFamilies.sansBold, fontSize: 16.5, fontVariant: ["tabular-nums"] },
  feedRs: { fontFamily: fontFamilies.sansMedium, fontSize: 11, opacity: 0.6 },
  strike: { textDecorationLine: "line-through" },
  feedTag: { marginTop: 2, fontFamily: fontFamilies.sans, fontSize: 12, color: colors.ink2 },
  emptyCardWrap: { paddingHorizontal: spacing.lg },
  loadMoreWrap: { padding: spacing.lg },
  loadMoreBtn: {
    minHeight: 48,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreText: { fontFamily: fontFamilies.sansSemi, fontSize: 14, color: colors.ink2 },
  undoWrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: 92,
    zIndex: 30,
  },
  undoBar: {
    minHeight: 50,
    borderRadius: radii.chip,
    backgroundColor: colors.ink,
    overflow: "hidden",
  },
  undoRow: {
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  undoTrack: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  undoFill: {
    height: 3,
    backgroundColor: colors.cashBright,
  },
  undoMsg: { flex: 1, fontFamily: fontFamilies.sansMedium, fontSize: 13.5, color: colors.surface },
  undoBtn: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: "center" },
  undoBtnText: { fontFamily: fontFamilies.sansBold, fontSize: 14, color: colors.cashBright },
  dockWrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: 14,
    gap: spacing.sm,
  },
  typedCard: { padding: spacing.sm + 2, gap: spacing.sm },
  demoChipsRow: { gap: 6 },
  demoChip: {
    minHeight: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  demoChipText: { fontFamily: fontFamilies.sans, fontSize: 12, color: colors.ink2 },
  inputBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  textInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.ink,
  },
  dockControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
  },
  parchiPill: {
    minHeight: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  parchiPillText: { fontFamily: fontFamilies.sansSemi, fontSize: 15, color: colors.ink },
});

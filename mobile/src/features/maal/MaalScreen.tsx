import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { AlertCircle, Camera } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { StateProduct } from "@contracts";
import { formatBaseQty } from "@domain/desi-units";
import { formatAmount } from "@domain/money";
import { useT } from "@/core/i18n/I18nProvider";
import { useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import { Card, EmptyState, Header, Pill, Segmented, Skeleton } from "@/core/ui";
import {
  isLowStock,
  normalizeMaalFilter,
  sortAndFilterProducts,
  stockLabel,
  stockProgressPct,
  type MaalFilter,
} from "./logic";

function ProductRow({
  product,
  onPress,
}: {
  product: StateProduct;
  onPress: () => void;
}) {
  const { t } = useT();
  const low = isLowStock(product);
  const pct = stockProgressPct(product);
  const statusText =
    product.stock_base_units < 0
      ? t("negative")
      : low
        ? t("lowStock")
        : t("healthy");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, stock ${stockLabel(product)}`}
      style={({ pressed }) => [styles.rowPress, pressed && styles.pressed]}
    >
      <View style={styles.rowTop}>
        <View style={styles.rowLeft}>
          <View style={styles.titleLine}>
            <Text numberOfLines={1} style={styles.productName}>
              {product.name}
            </Text>
            {product.is_quick_added ? <Pill tone="maal">QuickAdd</Pill> : null}
          </View>
          <Text numberOfLines={1} style={styles.priceLine}>
            Cost Rs. {formatAmount(product.cost_price_paisa)} · Sell Rs.{" "}
            {formatAmount(product.unit_price_paisa)}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.stockVal, low && styles.stockValLow]}>
            {stockLabel(product)}
          </Text>
          <Text style={[styles.statusVal, low && styles.statusValLow]}>
            {statusText}
          </Text>
        </View>
      </View>

      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            {
              width: `${Math.max(2, Math.round(pct * 100))}%`,
              backgroundColor: pct <= 0.25 ? colors.udhaar : colors.maal,
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

export function MaalScreen({ initialFilter }: { initialFilter?: string }) {
  const router = useRouter();
  const { t } = useT();
  const { data: state, refetch, isRefetching } = useShopState();

  const paramKey = initialFilter ?? "";
  const [filterOverride, setFilterOverride] = useState<{
    forParam: string;
    value: MaalFilter;
  } | null>(null);
  const filter: MaalFilter =
    filterOverride?.forParam === paramKey
      ? filterOverride.value
      : normalizeMaalFilter(initialFilter);

  const products = useMemo(() => state?.products ?? [], [state?.products]);
  const negative = useMemo(
    () => products.filter((p) => p.stock_base_units < 0),
    [products],
  );
  const lowCount = useMemo(() => products.filter(isLowStock).length, [products]);
  const list = useMemo(
    () => sortAndFilterProducts(products, filter),
    [products, filter],
  );

  const headerBlock = (
    <View style={styles.headerBlock}>
      {negative.map((p) => (
        <View key={p.id} style={styles.negBanner}>
          <AlertCircle size={16} color={colors.udhaarInk} strokeWidth={ICON_STROKE} />
          <Text style={styles.negText} numberOfLines={2}>
            {p.name} stock is now {formatBaseQty(p.stock_base_units, p.base_unit)} — Log Restock?
          </Text>
          <Pill
            tone="outline"
            onPress={() => router.push("/parchi")}
            accessibilityLabel={`Fix negative stock for ${p.name}`}
          >
            <Text style={styles.fixText}>Fix</Text>
          </Pill>
        </View>
      ))}

      <Segmented<MaalFilter>
        value={filter}
        onChange={(next) => setFilterOverride({ forParam: paramKey, value: next })}
        options={[
          { value: "all", label: `${t("all")} (${products.length})` },
          { value: "low", label: `${t("lowStock")} (${lowCount})` },
        ]}
      />
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Header
        title={t("maal")}
        right={
          <Pill
            tone="maal"
            onPress={() => router.push("/parchi")}
            accessibilityLabel={t("scanParchi")}
          >
            <Camera size={14} color={colors.maal} strokeWidth={ICON_STROKE} />
            <Text style={styles.scanPillText}>{t("scanParchi")}</Text>
          </Pill>
        }
      />

      <FlashList
        data={state ? list : []}
        keyExtractor={(item) => item.id}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        ListHeaderComponent={headerBlock}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.rowCardItem,
              index === 0 && styles.rowCardFirst,
              index === list.length - 1 && styles.rowCardLast,
            ]}
          >
            <ProductRow
              product={item}
              onPress={() => router.push(`/product/${item.id}`)}
            />
          </View>
        )}
        ListEmptyComponent={
          state ? (
            <Card>
              <EmptyState title="Koi item nahi" />
            </Card>
          ) : (
            <Skeleton height={240} />
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  scanPillText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12.5,
    color: colors.maal,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
  },
  headerBlock: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  negBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.card - 2,
    backgroundColor: colors.udhaarBg,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
  },
  negText: {
    flex: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    lineHeight: 18,
    color: colors.udhaarInk,
  },
  fixText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.udhaarInk,
  },
  rowCardItem: {
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderCard,
  },
  rowCardFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
  },
  rowCardLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radii.card,
    borderBottomRightRadius: radii.card,
  },
  rowPress: {
    minHeight: MIN_TARGET_DP,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  productName: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 16,
    color: colors.ink,
    flexShrink: 1,
  },
  priceLine: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    color: colors.ink2,
  },
  rowRight: {
    alignItems: "flex-end",
  },
  stockVal: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  stockValLow: {
    color: colors.udhaar,
  },
  statusVal: {
    marginTop: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
  },
  statusValLow: {
    fontFamily: fontFamilies.sansSemi,
    color: colors.udhaar,
  },
  barTrack: {
    marginTop: spacing.sm + 2,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: "hidden",
  },
  barFill: {
    height: 4,
    borderRadius: radii.pill,
  },
  pressed: {
    opacity: 0.78,
  },
});

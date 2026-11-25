import { useRouter } from "expo-router";
import { ArrowLeft, Camera } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { formatBaseQty } from "@domain/desi-units";
import { parseRupeeAmount } from "@domain/urdu-numbers";
import { apiClient, friendlyApiError } from "@/core/api/client";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import {
  Card,
  EmptyState,
  Header,
  IconButton,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  useToast,
} from "@/core/ui";
import { unitPriceBasisLabel } from "./logic";

export function ProductDetailScreen({ productId }: { productId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { shopId, invalidateShop } = useShop();
  const { data: state, refetch } = useShopState();

  const product = state?.products.find((p) => p.id === productId) ?? null;

  const [priceEdit, setPriceEdit] = useState<{ forId: string; value: string } | null>(null);
  const [aliasText, setAliasText] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [savingAlias, setSavingAlias] = useState(false);

  const priceValue =
    priceEdit?.forId === productId
      ? priceEdit.value
      : product
        ? String(product.unit_price_paisa / 100)
        : "";

  const handleSavePrice = async () => {
    if (!product || !shopId) return;
    const parsed = parseRupeeAmount(priceValue.trim());
    if (!parsed || !Number.isSafeInteger(parsed.paisa) || parsed.paisa <= 0) {
      toast("Sahi sell price darj karein", "warn");
      return;
    }
    setSavingPrice(true);
    try {
      await apiClient.updatePrice(
        { product_id: product.id, unit_price_paisa: parsed.paisa },
        shopId,
      );
      await invalidateShop();
      await refetch();
      toast("Price updated", "ok");
    } catch (e) {
      toast(friendlyApiError(e), "err");
    } finally {
      setSavingPrice(false);
    }
  };

  const handleAddAlias = async () => {
    const clean = aliasText.trim();
    if (!product || !shopId || !clean) return;
    setSavingAlias(true);
    try {
      await apiClient.addAlias({ product_id: product.id, alias: clean }, shopId);
      setAliasText("");
      await invalidateShop();
      await refetch();
      toast("Dialect alias added", "ok");
    } catch (e) {
      toast(friendlyApiError(e), "err");
    } finally {
      setSavingAlias(false);
    }
  };

  return (
    <Screen
      scroll
      header={
        <Header
          title={product?.name ?? "Item"}
          leftExtra={
            <IconButton
              accessibilityLabel="Back"
              onPress={() => router.back()}
              icon={<ArrowLeft size={18} color={colors.ink} strokeWidth={ICON_STROKE} />}
            />
          }
        />
      }
    >
      {!product ? (
        <Card>
          <EmptyState title="Item nahi mila" />
        </Card>
      ) : (
        <View style={styles.container}>
          <View style={styles.kpiGrid}>
            <Card style={styles.kpiCard}>
              <Text style={styles.eyebrow}>STOCK</Text>
              <Text style={styles.kpiVal}>
                {formatBaseQty(product.stock_base_units, product.base_unit)}
              </Text>
            </Card>
            <Card style={styles.kpiCard}>
              <Text style={styles.eyebrow}>SOLD 7D</Text>
              <Text style={styles.kpiVal}>
                {formatBaseQty(product.sold_7d, product.base_unit)}
              </Text>
            </Card>
            <Card style={styles.kpiCard}>
              <Text style={styles.eyebrow}>DAYS LEFT</Text>
              <Text style={styles.kpiVal}>
                {product.days_left === null ? "—" : `${product.days_left}d`}
              </Text>
            </Card>
          </View>

          <Text style={styles.eyebrow}>
            SELL PRICE (PER {unitPriceBasisLabel(product).toUpperCase()})
          </Text>
          <View style={styles.editRow}>
            <TextInput
              value={priceValue}
              onChangeText={(v) =>
                setPriceEdit({ forId: product.id, value: v.replace(/[^\d.]/g, "") })
              }
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.ink3}
              style={styles.input}
              accessibilityLabel="Sell price in rupees"
            />
            <PrimaryButton
              busy={savingPrice}
              onPress={() => void handleSavePrice()}
              style={styles.saveBtn}
            >
              Save
            </PrimaryButton>
          </View>

          <Text style={styles.eyebrow}>DIALECT ALIASES (PAKPHONE + PG_TRGM)</Text>
          <View style={styles.aliasWrap}>
            {product.aliases.length === 0 ? (
              <Text style={styles.muted}>No custom aliases yet</Text>
            ) : (
              product.aliases.map((alias) => (
                <Pill key={alias} tone="neutral">
                  {alias}
                </Pill>
              ))
            )}
          </View>

          <View style={styles.editRow}>
            <TextInput
              value={aliasText}
              onChangeText={setAliasText}
              placeholder="e.g. khand, کھنڈ"
              placeholderTextColor={colors.ink3}
              style={styles.input}
              accessibilityLabel="New dialect alias"
            />
            <SecondaryButton
              busy={savingAlias}
              disabled={!aliasText.trim()}
              onPress={() => void handleAddAlias()}
              style={styles.saveBtn}
            >
              Add
            </SecondaryButton>
          </View>

          <PrimaryButton tone="maal" onPress={() => router.push("/parchi")} style={styles.cta}>
            <View style={styles.ctaRow}>
              <Camera size={17} color={colors.surface} strokeWidth={ICON_STROKE} />
              <Text style={styles.ctaText}>Restock via Parchi</Text>
            </View>
          </PrimaryButton>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  kpiGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCard: {
    flex: 1,
    padding: spacing.md,
  },
  eyebrow: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink2,
  },
  kpiVal: {
    marginTop: 4,
    fontFamily: fontFamilies.sansBold,
    fontSize: 17,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  editRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    paddingHorizontal: spacing.md + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  saveBtn: {
    paddingHorizontal: spacing.xl,
  },
  aliasWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
  },
  muted: {
    fontFamily: fontFamilies.sans,
    fontSize: 13.5,
    color: colors.ink3,
  },
  cta: {
    marginTop: spacing.sm,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  ctaText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 16,
    color: colors.surface,
  },
});

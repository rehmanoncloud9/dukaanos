import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { formatRs } from "@domain/money";
import type { CommitResponse } from "@/core/api/types";
import { friendlyApiError, newIdempotencyKey } from "@/core/api/client";
import { useT } from "@/core/i18n/I18nProvider";
import { useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import { PrimaryButton, SecondaryButton, Sheet } from "@/core/ui";
import { useMunshi } from "@/features/munshi/MunshiProvider";
import { buildQuickWasooliAmounts, validateWasooliAmount } from "./logic";

export interface WasooliSheetProps {
  initialCustomerId: string | null;
  onClose: () => void;
  onSaved: (commit: CommitResponse, customerPhone: string | null) => void;
}

export function WasooliSheet({ initialCustomerId, onClose, onSaved }: WasooliSheetProps) {
  const { t } = useT();
  const { data: state } = useShopState();
  const { confirmPayment } = useMunshi();

  const customers = useMemo(() => state?.customers ?? [], [state?.customers]);
  const [selected, setSelected] = useState<string | null>(initialCustomerId);
  const cust = customers.find((c) => c.id === selected) ?? null;

  const [idemKey] = useState(() => newIdempotencyKey("wasooli"));
  const [amountText, setAmountText] = useState<string>(() => {
    const initialCust = customers.find((c) => c.id === initialCustomerId);
    return initialCust && initialCust.balance_paisa > 0
      ? String(Math.round(initialCust.balance_paisa / 100))
      : "";
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chips = useMemo(
    () =>
      customers
        .filter((c) => c.balance_paisa > 0 || c.id === selected)
        .slice()
        .sort((a, b) => b.balance_paisa - a.balance_paisa),
    [customers, selected],
  );

  const validation = useMemo(
    () => validateWasooliAmount(amountText, cust?.balance_paisa),
    [amountText, cust?.balance_paisa],
  );

  const quickAmounts = useMemo(
    () => (cust ? buildQuickWasooliAmounts(cust.balance_paisa) : []),
    [cust],
  );

  const handleSave = async () => {
    if (!selected || !validation.valid) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await confirmPayment(selected, validation.amountPaisa, idemKey, null);
      onSaved(res, cust?.phone ?? null);
    } catch (e) {
      setErr(friendlyApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`${t("wasooli")} · Payment`}>
      <View style={styles.body}>
        <Text style={styles.sectionLabel}>CUSTOMER</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((c) => {
            const active = selected === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  setSelected(c.id);
                  setErr(null);
                  if (c.balance_paisa > 0) {
                    setAmountText(String(Math.round(c.balance_paisa / 100)));
                  }
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipName, active && styles.chipNameActive]}>{c.name}</Text>
                <Text style={[styles.chipBal, active && styles.chipBalActive]}>
                  Khata {formatRs(c.balance_paisa)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.amountCard}>
          <Text style={styles.sectionLabel}>AMOUNT RECEIVED</Text>
          <View style={styles.amountRow}>
            <Text style={styles.rsPrefix}>Rs.</Text>
            <TextInput
              value={amountText}
              onChangeText={(v) => {
                setAmountText(v.replace(/[^\d.]/g, ""));
                setErr(null);
              }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.ink3}
              autoFocus
              style={styles.amountInput}
              accessibilityLabel="Wasooli amount in rupees"
            />
          </View>
          {cust ? (
            <Text style={styles.balPreview}>
              {formatRs(cust.balance_paisa)} → New bal:{" "}
              <Text style={styles.balPreviewStrong}>
                {formatRs(validation.newBalancePaisa ?? cust.balance_paisa)}
              </Text>
            </Text>
          ) : null}
          {quickAmounts.length > 0 ? (
            <View style={styles.quickRow}>
              {quickAmounts.map((v) => (
                <Pressable
                  key={v}
                  onPress={() => {
                    setAmountText(String(v / 100));
                    setErr(null);
                  }}
                  accessibilityRole="button"
                  style={styles.quickChip}
                >
                  <Text style={styles.quickText}>
                    {v === cust?.balance_paisa ? "Full " : ""}
                    {formatRs(v)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {validation.error || err ? (
          <View style={styles.errBanner}>
            <Text style={styles.errText}>{err ?? validation.error}</Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <SecondaryButton onPress={onClose} style={styles.cancelBtn}>
            {t("cancel")}
          </SecondaryButton>
          <PrimaryButton
            tone="cash"
            busy={busy}
            disabled={!selected || !validation.valid}
            onPress={() => void handleSave()}
            style={styles.confirmBtn}
          >
            {t("confirmWasooli")}
          </PrimaryButton>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  sectionLabel: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink3,
  },
  chipRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  chip: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 2,
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  chipName: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  chipNameActive: {
    color: colors.surface,
  },
  chipBal: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.ink2,
  },
  chipBalActive: {
    color: "rgba(255,255,255,0.72)",
  },
  amountCard: {
    backgroundColor: colors.canvas,
    borderRadius: radii.card,
    padding: spacing.lg,
  },
  amountRow: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "baseline",
  },
  rsPrefix: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 28,
    color: colors.cash,
    opacity: 0.65,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamilies.sansBold,
    fontSize: 34,
    color: colors.cash,
    paddingVertical: 2,
  },
  balPreview: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  balPreviewStrong: {
    fontFamily: fontFamilies.sansBold,
    color: colors.ink,
  },
  quickRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quickChip: {
    minHeight: MIN_TARGET_DP,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    justifyContent: "center",
  },
  quickText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13.5,
    color: colors.ink,
  },
  errBanner: {
    backgroundColor: colors.udhaarBg,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  errText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.udhaarInk,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  cancelBtn: {
    width: 100,
  },
  confirmBtn: {
    flex: 1,
  },
});

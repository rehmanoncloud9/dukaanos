import { useRouter } from "expo-router";
import { AlertTriangle, ArrowLeft, MessageSquare, Smartphone } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatRs } from "@domain/money";
import type { CommitResponse } from "@/core/api/types";
import { apiClient, friendlyApiError } from "@/core/api/client";
import { useT } from "@/core/i18n/I18nProvider";
import { useCustomerLedger, useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import {
  Card,
  EmptyState,
  Header,
  IconButton,
  Money,
  PrimaryButton,
  relTime,
  Screen,
  SecondaryButton,
  shortDate,
  Skeleton,
  useToast,
} from "@/core/ui";
import { feedSummary } from "@/features/munshi/MunshiHome";
import { ReceiptSheet } from "@/features/receipt/ReceiptSheet";
import { WasooliSheet } from "./WasooliSheet";
import { creditLimitStatus } from "./logic";
import { openSmsReminder, openWhatsAppReminder } from "./reminders";

export function CustomerDetailScreen({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { toast } = useToast();
  const { shopId, invalidateShop } = useShop();
  const { data: state, refetch: refetchState } = useShopState();
  const ledger = useCustomerLedger(customerId, 50);

  const customer = state?.customers.find((c) => c.id === customerId) ?? null;
  const ledgerCustomer = ledger.data?.pages[0]?.customer;
  const shopName = state?.shop.name ?? "DukaanOS";

  const [phoneEdit, setPhoneEdit] = useState<{ forId: string; value: string } | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [wasooliOpen, setWasooliOpen] = useState(false);
  const [receiptState, setReceiptState] = useState<{
    commit: CommitResponse;
    customerPhone: string | null;
  } | null>(null);

  const phoneValue =
    phoneEdit?.forId === customerId ? phoneEdit.value : (customer?.phone ?? "");

  const creditLimitPaisa =
    customer?.credit_limit_paisa ?? ledgerCustomer?.credit_limit_paisa ?? null;
  const balancePaisa = customer?.balance_paisa ?? ledgerCustomer?.balance_paisa ?? 0;
  const limit = creditLimitStatus(balancePaisa, creditLimitPaisa);

  const history = useMemo(() => {
    const pages = ledger.data?.pages.flatMap((pg) => pg.items) ?? [];
    if (pages.length > 0) return pages;
    return state?.feed.filter((tx) => tx.customer_id === customerId) ?? [];
  }, [customerId, ledger.data?.pages, state?.feed]);

  const handleSavePhone = async () => {
    if (!customer || !shopId) return;
    setSavingPhone(true);
    try {
      await apiClient.updateCustomer(
        {
          customer_id: customer.id,
          phone: phoneValue.trim() || undefined,
          role_tag: customer.role_tag ?? undefined,
        },
        shopId,
      );
      await invalidateShop();
      await refetchState();
      toast("Phone saved", "ok");
    } catch (e) {
      toast(friendlyApiError(e), "err");
    } finally {
      setSavingPhone(false);
    }
  };

  return (
    <Screen
      scroll
      header={
        <Header
          title={customer?.name ?? "Customer"}
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
      {!customer ? (
        <Card>
          <EmptyState
            title="Customer nahi mila"
            subtitle="Ho sakta hai yeh account delete ya switch ho gaya ho."
          />
        </Card>
      ) : (
        <View style={styles.container}>
          <Card>
            <Text style={styles.eyebrow}>BALANCE</Text>
            <View style={styles.balanceWrap}>
              <Money
                paisa={balancePaisa}
                size={30}
                lineHeight={36}
                color={balancePaisa > 0 ? colors.udhaar : colors.cash}
              />
            </View>
            <Text style={styles.meta}>
              {customer.role_tag ?? "Customer"} · Last paid {shortDate(customer.last_paid_at)}
              {customer.days_overdue ? ` · oldest unpaid ${customer.days_overdue}d` : ""}
            </Text>
          </Card>

          {limit.hasLimit && limit.limitPaisa !== null ? (
            <View
              style={[
                styles.limitBanner,
                limit.exceeded ? styles.limitExceeded : styles.limitNormal,
              ]}
            >
              <AlertTriangle
                size={16}
                color={limit.exceeded ? colors.udhaarInk : colors.amberInk}
                strokeWidth={ICON_STROKE}
              />
              <Text
                style={[
                  styles.limitText,
                  limit.exceeded ? styles.limitExceededText : styles.limitNormalText,
                ]}
              >
                {limit.exceeded
                  ? `Credit limit exceeded (${formatRs(balancePaisa)} / ${formatRs(limit.limitPaisa)}) — wasooli ya limit barhaein`
                  : limit.nearLimit
                    ? `Credit limit ke qareeb: ${formatRs(balancePaisa)} / ${formatRs(limit.limitPaisa)}`
                    : `Credit limit: ${formatRs(limit.limitPaisa)}`}
              </Text>
            </View>
          ) : null}

          <View style={styles.phoneRow}>
            <TextInput
              value={phoneValue}
              onChangeText={(v) => setPhoneEdit({ forId: customer.id, value: v })}
              keyboardType="phone-pad"
              placeholder="Phone 03xx-xxxxxxx"
              placeholderTextColor={colors.ink3}
              style={styles.phoneInput}
              accessibilityLabel="Customer phone number"
            />
            <PrimaryButton
              busy={savingPhone}
              onPress={() => void handleSavePhone()}
              style={styles.savePhoneBtn}
            >
              Save
            </PrimaryButton>
          </View>

          <PrimaryButton tone="cash" onPress={() => setWasooliOpen(true)}>
            {t("wasooli")}
          </PrimaryButton>

          <View style={styles.reminderPair}>
            <SecondaryButton
              style={styles.halfBtn}
              onPress={() =>
                void openWhatsAppReminder({
                  customer,
                  shopName,
                  onError: (msg) => toast(msg, "err"),
                })
              }
            >
              <View style={styles.btnContent}>
                <MessageSquare size={15} color={colors.ink} strokeWidth={ICON_STROKE} />
                <Text style={styles.secBtnLabel}>WhatsApp</Text>
              </View>
            </SecondaryButton>
            <SecondaryButton
              style={styles.halfBtn}
              onPress={() =>
                void openSmsReminder({
                  customer,
                  shopName,
                  onError: (msg) => toast(msg, "err"),
                })
              }
            >
              <View style={styles.btnContent}>
                <Smartphone size={15} color={colors.ink} strokeWidth={ICON_STROKE} />
                <Text style={styles.secBtnLabel}>{t("smsFallback")}</Text>
              </View>
            </SecondaryButton>
          </View>

          <Text style={styles.sectionHeader}>KHATA HISTORY (SHA-256 CHAINED)</Text>

          <Card padded={false}>
            {ledger.isLoading && history.length === 0 ? (
              <Skeleton height={120} />
            ) : history.length === 0 ? (
              <EmptyState title="Koi entry nahi" />
            ) : (
              history.map((tx, idx) => (
                <Pressable
                  key={tx.id}
                  onPress={() => router.push(`/xray?txId=${encodeURIComponent(tx.id)}`)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.historyRow,
                    idx < history.length - 1 && styles.hairlineBottom,
                    tx.is_reversed && styles.reversedRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.historyLeft}>
                    <Text numberOfLines={1} style={styles.historyTitle}>
                      {tx.type === "payment" ? t("wasooli") : feedSummary(tx)}
                    </Text>
                    <Text numberOfLines={1} style={styles.historyMeta}>
                      {relTime(tx.created_at)} · #{tx.seq}
                    </Text>
                  </View>
                  <Money
                    paisa={tx.total_paisa}
                    size={16}
                    color={
                      tx.type === "payment"
                        ? colors.cash
                        : tx.credit_paisa > 0
                          ? colors.udhaar
                          : colors.ink
                    }
                  />
                </Pressable>
              ))
            )}

            {ledger.hasNextPage ? (
              <Pressable
                onPress={() => void ledger.fetchNextPage()}
                disabled={ledger.isFetchingNextPage}
                style={({ pressed }) => [styles.loadMoreBtn, pressed && styles.pressed]}
              >
                <Text style={styles.loadMoreText}>
                  {ledger.isFetchingNextPage ? "Loading…" : "Load older khata"}
                </Text>
              </Pressable>
            ) : null}
          </Card>
        </View>
      )}

      {wasooliOpen && customer ? (
        <WasooliSheet
          initialCustomerId={customer.id}
          onClose={() => setWasooliOpen(false)}
          onSaved={(commit, customerPhone) => {
            setWasooliOpen(false);
            setReceiptState({ commit, customerPhone });
            void ledger.refetch();
          }}
        />
      ) : null}

      {receiptState ? (
        <ReceiptSheet
          open
          commit={receiptState.commit}
          proposal={null}
          customerPhone={receiptState.customerPhone}
          onOpenXRay={(txId) => {
            setReceiptState(null);
            router.push(`/xray?txId=${encodeURIComponent(txId)}`);
          }}
          onClose={() => setReceiptState(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  eyebrow: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink2,
  },
  balanceWrap: {
    marginTop: 4,
  },
  meta: {
    marginTop: 4,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  limitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  limitExceeded: {
    backgroundColor: colors.udhaarBg,
  },
  limitNormal: {
    backgroundColor: colors.amberBg,
  },
  limitText: {
    flex: 1,
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    lineHeight: 18,
  },
  limitExceededText: {
    color: colors.udhaarInk,
  },
  limitNormalText: {
    color: colors.amberInk,
  },
  phoneRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    paddingHorizontal: spacing.md + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.ink,
  },
  savePhoneBtn: {
    paddingHorizontal: spacing.xl,
  },
  reminderPair: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  halfBtn: {
    flex: 1,
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secBtnLabel: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14.5,
    color: colors.ink,
  },
  sectionHeader: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink2,
  },
  historyRow: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  hairlineBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderHairline,
  },
  reversedRow: {
    opacity: 0.52,
  },
  historyLeft: {
    flex: 1,
    minWidth: 0,
  },
  historyTitle: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.ink,
  },
  historyMeta: {
    marginTop: 2,
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    color: colors.ink3,
  },
  loadMoreBtn: {
    minHeight: MIN_TARGET_DP,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderHairline,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13.5,
    color: colors.ink2,
  },
  pressed: {
    opacity: 0.78,
  },
});

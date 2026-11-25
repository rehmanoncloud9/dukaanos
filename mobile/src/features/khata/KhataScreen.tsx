import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { MessageSquare, QrCode, Smartphone, UserPlus, Wallet } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { StateCustomer } from "@contracts";
import type { CommitResponse } from "@/core/api/types";
import { useT } from "@/core/i18n/I18nProvider";
import { useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import {
  Card,
  EmptyState,
  Header,
  Money,
  Pill,
  Segmented,
  shortDate,
  Skeleton,
  useToast,
} from "@/core/ui";
import { ReceiptSheet } from "@/features/receipt/ReceiptSheet";
import { NewCustomerSheet } from "./NewCustomerSheet";
import { WasooliSheet } from "./WasooliSheet";
import {
  computeKhataSummary,
  creditLimitStatus,
  filterAndSortCustomers,
  isCustomerOverdue,
  normalizeKhataFilter,
  type KhataFilter,
} from "./logic";
import { openSmsReminder, openWhatsAppReminder } from "./reminders";

function DebtorRow({
  customer,
  shopName,
  onOpenDetail,
  onWasooli,
  onReminderError,
}: {
  customer: StateCustomer;
  shopName: string;
  onOpenDetail: () => void;
  onWasooli: () => void;
  onReminderError: (msg: string) => void;
}) {
  const { t } = useT();
  const overdue = isCustomerOverdue(customer);
  const limit = creditLimitStatus(customer.balance_paisa, customer.credit_limit_paisa);

  return (
    <View style={styles.rowWrap}>
      <Pressable
        onPress={onOpenDetail}
        accessibilityRole="button"
        accessibilityLabel={`${customer.name}, balance ${customer.balance_paisa / 100} rupees`}
        style={({ pressed }) => [styles.rowTop, pressed && styles.pressed]}
      >
        <View style={styles.rowLeft}>
          <View style={styles.nameLine}>
            <Text numberOfLines={1} style={styles.customerName}>
              {customer.name}
            </Text>
            {overdue ? (
              <Pill tone="udhaar">{customer.days_overdue}d overdue</Pill>
            ) : null}
            {limit.exceeded ? <Pill tone="amber">Over limit</Pill> : null}
          </View>
          <Text numberOfLines={1} style={styles.customerMeta}>
            {customer.role_tag ?? "Customer"} · Last paid {shortDate(customer.last_paid_at)}
          </Text>
        </View>
        <Money
          paisa={customer.balance_paisa}
          size={18}
          color={customer.balance_paisa > 0 ? colors.udhaar : colors.cash}
        />
      </Pressable>

      <View style={styles.actionsRow}>
        <Pressable
          onPress={onWasooli}
          accessibilityRole="button"
          accessibilityLabel={`Wasooli from ${customer.name}`}
          style={({ pressed }) => [styles.actionPill, styles.wasooliPill, pressed && styles.pressed]}
        >
          <Wallet size={14} color={colors.cashInk} strokeWidth={ICON_STROKE} />
          <Text style={styles.wasooliText}>{t("wasooli")}</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            void openWhatsAppReminder({ customer, shopName, onError: onReminderError })
          }
          accessibilityRole="button"
          accessibilityLabel={`WhatsApp reminder for ${customer.name}`}
          style={({ pressed }) => [styles.actionPill, styles.neutralPill, pressed && styles.pressed]}
        >
          <MessageSquare size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
          <Text style={styles.neutralPillText}>WhatsApp</Text>
        </Pressable>

        <Pressable
          onPress={() => void openSmsReminder({ customer, shopName, onError: onReminderError })}
          accessibilityRole="button"
          accessibilityLabel={`SMS 2G reminder for ${customer.name}`}
          style={({ pressed }) => [styles.actionPill, styles.neutralPill, pressed && styles.pressed]}
        >
          <Smartphone size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
          <Text style={styles.neutralPillText}>{t("smsFallback")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function KhataScreen({ initialFilter }: { initialFilter?: string }) {
  const router = useRouter();
  const { t } = useT();
  const { toast } = useToast();
  const { data: state, refetch, isRefetching } = useShopState();

  const paramKey = initialFilter ?? "";
  const [filterOverride, setFilterOverride] = useState<{
    forParam: string;
    value: KhataFilter;
  } | null>(null);
  const filter: KhataFilter =
    filterOverride?.forParam === paramKey
      ? filterOverride.value
      : normalizeKhataFilter(initialFilter);

  const [addingCustomer, setAddingCustomer] = useState(false);
  const [wasooliCustomerId, setWasooliCustomerId] = useState<string | null>(null);
  const [receiptState, setReceiptState] = useState<{
    commit: CommitResponse;
    customerPhone: string | null;
  } | null>(null);

  const customers = useMemo(() => state?.customers ?? [], [state?.customers]);
  const summary = useMemo(() => computeKhataSummary(customers), [customers]);
  const list = useMemo(() => filterAndSortCustomers(customers, filter), [customers, filter]);
  const shopName = state?.shop.name ?? "DukaanOS";

  const headerBlock = (
    <View style={styles.headerBlock}>
      {!state ? (
        <Skeleton height={128} />
      ) : (
        <Card>
          <Text style={styles.eyebrow}>{t("totalReceivable").toUpperCase()}</Text>
          <View style={styles.heroAmountWrap}>
            <Money
              paisa={summary.receivablePaisa}
              size={34}
              lineHeight={38}
              color={colors.udhaar}
            />
          </View>
          <View style={styles.heroStats}>
            <Text style={styles.heroStatMuted}>
              {summary.activeCount} {t("activeAccounts")}
            </Text>
            <Text style={styles.heroStatAlert}>
              {summary.overdueCount} {t("overdue")}
            </Text>
          </View>
        </Card>
      )}

      <Segmented<KhataFilter>
        value={filter}
        onChange={(next) => setFilterOverride({ forParam: paramKey, value: next })}
        options={[
          { value: "all", label: t("all") },
          { value: "overdue", label: t("overdueFilter") },
          { value: "settled", label: t("settled") },
        ]}
      />
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Header
        title={t("khata")}
        right={
          <Pill
            tone="dark"
            onPress={() => router.push("/passport")}
            accessibilityLabel="Open SMEConnect Passport"
          >
            <QrCode size={14} color={colors.surface} strokeWidth={ICON_STROKE} />
            <Text style={styles.smePillText}>SMEConnect</Text>
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
            <DebtorRow
              customer={item}
              shopName={shopName}
              onOpenDetail={() => router.push(`/customer/${item.id}`)}
              onWasooli={() => setWasooliCustomerId(item.id)}
              onReminderError={(msg) => toast(msg, "err")}
            />
          </View>
        )}
        ListEmptyComponent={
          state ? (
            <Card style={styles.emptyCard}>
              <EmptyState
                title="Koi account nahi"
                subtitle={
                  filter === "overdue"
                    ? "15 din se zyada baqaya wala koi customer nahi"
                    : undefined
                }
              />
            </Card>
          ) : (
            <Skeleton height={240} />
          )
        }
        ListFooterComponent={
          <Pressable
            onPress={() => setAddingCustomer(true)}
            accessibilityRole="button"
            accessibilityLabel={t("newCustomer")}
            style={({ pressed }) => [styles.newCustomerBtn, pressed && styles.pressed]}
          >
            <UserPlus size={16} color={colors.ink2} strokeWidth={ICON_STROKE} />
            <Text style={styles.newCustomerText}>{t("newCustomer")}</Text>
          </Pressable>
        }
        contentContainerStyle={styles.listContent}
      />

      {wasooliCustomerId !== null ? (
        <WasooliSheet
          initialCustomerId={wasooliCustomerId}
          onClose={() => setWasooliCustomerId(null)}
          onSaved={(commit, customerPhone) => {
            setWasooliCustomerId(null);
            setReceiptState({ commit, customerPhone });
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

      <NewCustomerSheet open={addingCustomer} onClose={() => setAddingCustomer(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  smePillText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12.5,
    color: colors.surface,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
  },
  headerBlock: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  eyebrow: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink2,
  },
  heroAmountWrap: {
    marginTop: 4,
  },
  heroStats: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderHairline,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroStatMuted: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.ink2,
  },
  heroStatAlert: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.udhaar,
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
  rowWrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  rowTop: {
    minHeight: MIN_TARGET_DP,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
  },
  customerName: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 16,
    color: colors.ink,
    flexShrink: 1,
  },
  customerMeta: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  actionsRow: {
    marginTop: spacing.sm + 2,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionPill: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  wasooliPill: {
    backgroundColor: colors.cashBg,
    borderColor: "rgba(4, 120, 87, 0.25)",
  },
  wasooliText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13.5,
    color: colors.cashInk,
  },
  neutralPill: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.borderHairline,
  },
  neutralPillText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13.5,
    color: colors.ink,
  },
  emptyCard: {
    marginBottom: spacing.md,
  },
  newCustomerBtn: {
    marginTop: spacing.md,
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  newCustomerText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14.5,
    color: colors.ink2,
  },
  pressed: {
    opacity: 0.78,
  },
});

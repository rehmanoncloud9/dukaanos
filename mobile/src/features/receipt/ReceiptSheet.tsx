import * as Sharing from "expo-sharing";
import { Check, ImageDown, MessageSquare } from "lucide-react-native";
import { useRef, useState, type ComponentRef } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import type { BaseUnit } from "@domain/desi-units";
import { normalizePkPhone, paymentReceiptText, receiptText, smsLink, waLink } from "@domain/messages";
import { formatRs } from "@domain/money";
import type { CommitResponse, SaleProposal } from "@/core/api/types";
import { useT } from "@/core/i18n/I18nProvider";
import { useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, spacing } from "@/core/theme/tokens";
import { Card, Money, Pill, PrimaryButton, SecondaryButton, Sheet, useToast } from "@/core/ui";
import { ReceiptCardView } from "./ReceiptCardView";

export interface ReceiptSheetProps {
  open: boolean;
  commit: CommitResponse;
  proposal: SaleProposal | null;
  customerPhone: string | null;
  onOpenXRay: (txId: string) => void;
  onClose: () => void;
}

export function ReceiptSheet({
  open,
  commit,
  proposal,
  customerPhone,
  onOpenXRay,
  onClose,
}: ReceiptSheetProps) {
  const { data: state } = useShopState();
  const { t } = useT();
  const { toast } = useToast();
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const [sharingPng, setSharingPng] = useState(false);

  const shop = state?.shop.name ?? "DukaanOS";
  const lines = (commit.lines ?? []) as {
    name: string;
    qty_base_units: number;
    base_unit: BaseUnit;
    line_total_paisa: number;
  }[];
  const totals = commit.totals ?? {};
  const isPayment = commit.type === "payment";
  const phone = customerPhone ?? commit.customer?.phone ?? null;

  const text = isPayment
    ? paymentReceiptText({
        shop,
        customer: commit.customer?.name ?? "",
        amount_paisa: totals.total_paisa ?? 0,
        new_balance_paisa: commit.customer?.balance_paisa ?? 0,
        entry_hash: commit.entry_hash,
      })
    : receiptText({
        shop,
        customer: commit.customer?.name,
        lines,
        discount_paisa: totals.discount_paisa ?? 0,
        total_paisa: totals.total_paisa ?? 0,
        cash_paid_paisa: totals.cash_paid_paisa ?? 0,
        credit_paisa: totals.credit_paisa ?? 0,
        new_balance_paisa: commit.customer?.balance_paisa ?? null,
        entry_hash: commit.entry_hash,
      });

  const openWhatsApp = async () => {
    const pkPhone = normalizePkPhone(phone);
    const nativeUrl = pkPhone
      ? `whatsapp://send?phone=${pkPhone}&text=${encodeURIComponent(text)}`
      : `whatsapp://send?text=${encodeURIComponent(text)}`;
    const fallbackUrl = waLink(phone, text);
    try {
      const supported = await Linking.canOpenURL(nativeUrl);
      await Linking.openURL(supported ? nativeUrl : fallbackUrl);
    } catch {
      await Linking.openURL(fallbackUrl).catch(() => toast("Could not open WhatsApp", "err"));
    }
  };

  const openSms = async () => {
    const url = smsLink(phone, text);
    try {
      await Linking.openURL(url);
    } catch {
      toast("Could not open SMS app", "err");
    }
  };

  const sharePng = async () => {
    if (!cardRef.current) return;
    setSharingPng(true);
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        toast("Sharing is unavailable on this device", "warn");
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: `Raseed #${commit.seq}`,
      });
    } catch {
      toast("Could not export receipt PNG", "err");
    } finally {
      setSharingPng(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      titleNode={
        <View style={styles.titleRow}>
          <View style={styles.checkBadge}>
            <Check size={16} color={colors.surface} strokeWidth={2.2} />
          </View>
          <Text style={styles.titleText}>{t("saved")}</Text>
        </View>
      }
    >
      <View style={styles.body}>
        <Card>
          <View style={styles.summaryTop}>
            <Text style={styles.customer}>{commit.customer?.name ?? "Walk-in"}</Text>
            <Money paisa={totals.total_paisa ?? 0} size={22} />
          </View>
          {proposal ? (
            <Text style={styles.lineSummary} numberOfLines={2}>
              {proposal.lines.map((l) => l.name).join(", ")}
            </Text>
          ) : null}
          {commit.customer ? (
            <Text style={styles.balLine}>
              New khata balance: <Text style={styles.balValue}>{formatRs(commit.customer.balance_paisa)}</Text>
            </Text>
          ) : null}
          <View style={styles.pills}>
            <Pill tone="cash" mono>
              Δ = 0 ✓
            </Pill>
            <Pill mono>
              #{commit.seq} {commit.entry_hash.slice(0, 10)}…
            </Pill>
            <Pill mono>{commit.rpc_ms}ms RPC</Pill>
          </View>
        </Card>

        <View style={styles.actions}>
          <PrimaryButton tone="cash" onPress={() => void openWhatsApp()} accessibilityLabel={t("whatsappReceipt")}>
            <MessageSquare size={18} color={colors.surface} strokeWidth={ICON_STROKE} />
            <Text style={styles.waText}>{t("whatsappReceipt")}</Text>
          </PrimaryButton>
          <View style={styles.splitRow}>
            <SecondaryButton onPress={() => void openSms()} style={styles.halfBtn}>
              {t("smsFallback")}
            </SecondaryButton>
            <SecondaryButton
              onPress={() => void sharePng()}
              busy={sharingPng}
              style={styles.halfBtn}
              accessibilityLabel={t("pngReceipt")}
            >
              <ImageDown size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
              <Text style={styles.secLabel}>{t("pngReceipt")}</Text>
            </SecondaryButton>
          </View>
          <View style={styles.splitRow}>
            <SecondaryButton
              onPress={() => {
                onClose();
                onOpenXRay(commit.transaction_id);
              }}
              style={styles.halfBtn}
            >
              {"</>"} {t("xray")}
            </SecondaryButton>
            <PrimaryButton onPress={onClose} style={styles.halfBtn}>
              {t("done")}
            </PrimaryButton>
          </View>
        </View>

        <View ref={cardRef} collapsable={false} style={styles.capturePreviewWrap}>
          <ReceiptCardView
            shopName={shop}
            city={state?.shop.city}
            customerName={commit.customer?.name}
            isPayment={isPayment}
            lines={lines}
            discountPaisa={totals.discount_paisa ?? 0}
            totalPaisa={totals.total_paisa ?? 0}
            cashPaidPaisa={totals.cash_paid_paisa ?? 0}
            creditPaisa={totals.credit_paisa ?? 0}
            newBalancePaisa={commit.customer?.balance_paisa ?? null}
            entryHash={commit.entry_hash}
            seq={commit.seq}
            createdAt={commit.created_at}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.cash,
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 18,
    color: colors.ink,
  },
  body: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  customer: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  lineSummary: {
    marginTop: 4,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  balLine: {
    marginTop: 6,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  balValue: {
    fontFamily: fontFamilies.sansBold,
    color: colors.udhaar,
  },
  pills: {
    marginTop: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  actions: {
    gap: spacing.sm,
  },
  waText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 16,
    color: colors.surface,
  },
  splitRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  halfBtn: {
    flex: 1,
  },
  secLabel: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14.5,
    color: colors.ink,
  },
  capturePreviewWrap: {
    marginTop: spacing.xs,
  },
});

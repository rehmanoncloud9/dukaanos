import { StyleSheet, Text, View } from "react-native";
import { formatBaseQty, type BaseUnit } from "@domain/desi-units";
import { formatRs } from "@domain/money";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, radii, spacing } from "@/core/theme/tokens";

export interface ReceiptCardProps {
  shopName: string;
  city?: string | null;
  customerName?: string | null;
  isPayment: boolean;
  lines: { name: string; qty_base_units: number; base_unit: BaseUnit; line_total_paisa: number }[];
  discountPaisa: number;
  totalPaisa: number;
  cashPaidPaisa: number;
  creditPaisa: number;
  newBalancePaisa?: number | null;
  entryHash: string;
  seq: number;
  createdAt: string;
}

export function ReceiptCardView({
  shopName,
  city,
  customerName,
  isPayment,
  lines,
  discountPaisa,
  totalPaisa,
  cashPaidPaisa,
  creditPaisa,
  newBalancePaisa,
  entryHash,
  seq,
  createdAt,
}: ReceiptCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.topBand}>
        <Text style={styles.brand}>DUKAANOS · RASEED / رسید</Text>
        <Text style={styles.shop}>{shopName}</Text>
        {city ? <Text style={styles.city}>{city}</Text> : null}
        <Text style={styles.meta}>
          #{seq} · {new Date(createdAt).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>

      {customerName ? (
        <View style={styles.customerRow}>
          <Text style={styles.label}>Customer / گاہک</Text>
          <Text style={styles.customerName}>{customerName}</Text>
        </View>
      ) : null}

      <View style={styles.itemsBox}>
        {isPayment ? (
          <View style={styles.lineRow}>
            <Text style={styles.lineName}>Wasooli / وصولی</Text>
            <Text style={styles.lineAmt}>{formatRs(totalPaisa)}</Text>
          </View>
        ) : (
          lines.map((l, idx) => (
            <View key={`${l.name}-${idx}`} style={styles.lineRow}>
              <View style={styles.lineLeft}>
                <Text style={styles.lineName}>{l.name}</Text>
                <Text style={styles.lineQty}>{formatBaseQty(l.qty_base_units, l.base_unit)}</Text>
              </View>
              <Text style={styles.lineAmt}>{formatRs(l.line_total_paisa)}</Text>
            </View>
          ))
        )}

        {discountPaisa > 0 ? (
          <View style={styles.lineRow}>
            <Text style={styles.discountLabel}>Riayat / رعایت</Text>
            <Text style={styles.discountAmt}>-{formatRs(discountPaisa)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.totalsBox}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Kul Bill / کل رقم</Text>
          <Text style={styles.totalAmt}>{formatRs(totalPaisa)}</Text>
        </View>
        <View style={styles.subRow}>
          <Text style={styles.label}>Cash Paid</Text>
          <Text style={styles.cashAmt}>{formatRs(cashPaidPaisa)}</Text>
        </View>
        {creditPaisa !== 0 ? (
          <View style={styles.subRow}>
            <Text style={styles.label}>Khata</Text>
            <Text style={styles.udhaarAmt}>
              {creditPaisa > 0 ? "+" : ""}
              {formatRs(creditPaisa)}
            </Text>
          </View>
        ) : null}
        {newBalancePaisa !== undefined && newBalancePaisa !== null ? (
          <View style={styles.subRow}>
            <Text style={styles.label}>Naya Baqaya</Text>
            <Text style={styles.balAmt}>{formatRs(newBalancePaisa)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text style={styles.hash}>SHA-256: {entryHash.slice(0, 14)}…{entryHash.slice(-6)}</Text>
        <Text style={styles.thanks}>Sirf Aap Ka Record · Shukriya! شکریہ</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.lg,
  },
  topBand: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHairline,
    paddingBottom: spacing.md,
  },
  brand: {
    fontFamily: fontFamilies.monoSemi,
    fontSize: 10.5,
    color: colors.cash,
    letterSpacing: 0.7,
  },
  shop: {
    marginTop: 4,
    fontFamily: fontFamilies.sansBold,
    fontSize: 20,
    color: colors.ink,
  },
  city: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
  },
  meta: {
    marginTop: 4,
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  customerRow: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHairline,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  customerName: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  itemsBox: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHairline,
    gap: spacing.sm,
  },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  lineLeft: {
    flex: 1,
  },
  lineName: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14.5,
    color: colors.ink,
  },
  lineQty: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
  },
  lineAmt: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  discountLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.udhaarInk,
  },
  discountAmt: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.udhaarInk,
  },
  totalsBox: {
    paddingVertical: spacing.md,
    gap: 6,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 16,
    color: colors.ink,
  },
  totalAmt: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 20,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cashAmt: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.cash,
  },
  udhaarAmt: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.udhaar,
  },
  balAmt: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    color: colors.ink,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderHairline,
    paddingTop: spacing.sm + 2,
    gap: 4,
  },
  hash: {
    fontFamily: fontFamilies.mono,
    fontSize: 10.5,
    color: colors.ink3,
  },
  thanks: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.cash,
  },
});

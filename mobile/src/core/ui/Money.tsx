import { StyleSheet, Text, type TextStyle } from "react-native";
import { formatAmount } from "@domain/money";
import { fontFamilies } from "@/core/theme/fonts";
import { colors } from "@/core/theme/tokens";

export interface MoneyProps {
  paisa: number;
  sign?: boolean;
  color?: string;
  size?: number;
  lineHeight?: number;
  style?: TextStyle;
}

export function Money({ paisa, sign = false, color = colors.ink, size = 17, lineHeight, style }: MoneyProps) {
  const neg = paisa < 0;
  const prefix = neg ? "-" : sign ? "+" : "";
  const formatted = formatAmount(Math.abs(paisa));
  return (
    <Text
      numberOfLines={1}
      style={[
        styles.base,
        {
          color,
          fontSize: size,
          lineHeight: lineHeight ?? Math.round(size * 1.24),
        },
        style,
      ]}
    >
      {prefix}
      <Text style={[styles.rs, { fontSize: Math.max(10, Math.round(size * 0.62)) }]}>Rs. </Text>
      {formatted}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: fontFamilies.sansBold,
    fontVariant: ["tabular-nums"],
  },
  rs: {
    fontFamily: fontFamilies.sansMedium,
    opacity: 0.58,
  },
});

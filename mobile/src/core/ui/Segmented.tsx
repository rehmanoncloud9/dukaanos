import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, spacing } from "@/core/theme/tokens";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.activeSegment]}
          >
            <Text numberOfLines={1} style={[styles.label, active && styles.activeLabel]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.surfaceSunken,
    padding: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: 42,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  activeSegment: {
    backgroundColor: colors.surface,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  label: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13.5,
    color: colors.ink2,
  },
  activeLabel: {
    color: colors.ink,
  },
});

import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, radii, spacing, typography } from "@/core/theme/tokens";
import { IconButton } from "./Buttons";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  titleNode?: ReactNode;
  right?: ReactNode;
  snapPoints?: (string | number)[];
  scrollable?: boolean;
  children: ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  titleNode,
  right,
  snapPoints: customSnaps,
  scrollable = true,
  children,
}: SheetProps) {
  const ref = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => customSnaps ?? ["88%"], [customSnaps]);

  useEffect(() => {
    if (open) {
      ref.current?.snapToIndex(0);
    } else {
      ref.current?.close();
    }
  }, [open]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" opacity={0.35} />
    ),
    [],
  );

  if (!open) return null;

  return (
    <BottomSheet
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.background}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          {titleNode ?? (title ? <Text style={styles.title}>{title}</Text> : null)}
        </View>
        {right ?? (
          <IconButton
            accessibilityLabel="Close sheet"
            onPress={onClose}
            icon={<X size={18} color={colors.ink} strokeWidth={ICON_STROKE} />}
          />
        )}
      </View>
      {scrollable ? (
        <BottomSheetScrollView
          contentContainerStyle={{ paddingBottom: Math.max(24, insets.bottom + 16) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </BottomSheetScrollView>
      ) : (
        <View style={[styles.flex, { paddingBottom: Math.max(16, insets.bottom) }]}>{children}</View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typography.sheetTitle.fontSize,
    lineHeight: typography.sheetTitle.lineHeight,
    letterSpacing: typography.sheetTitle.letterSpacing,
    color: colors.ink,
  },
  flex: {
    flex: 1,
  },
});

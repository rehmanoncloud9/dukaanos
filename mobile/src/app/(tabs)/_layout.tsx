import { Tabs } from "expo-router";
import { BookOpen, Mic, Package } from "lucide-react-native";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/core/i18n/I18nProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE } from "@/core/theme/tokens";

export default function TabLayout() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "android" ? 8 : 6);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.borderCard,
          height: 58 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.sansSemi,
          fontSize: 11.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("munshi"),
          tabBarIcon: ({ color, size }) => <Mic size={size ?? 22} color={color} strokeWidth={ICON_STROKE} />,
        }}
      />
      <Tabs.Screen
        name="khata"
        options={{
          title: t("khata"),
          tabBarIcon: ({ color, size }) => <BookOpen size={size ?? 22} color={color} strokeWidth={ICON_STROKE} />,
        }}
      />
      <Tabs.Screen
        name="maal"
        options={{
          title: t("maal"),
          tabBarIcon: ({ color, size }) => <Package size={size ?? 22} color={color} strokeWidth={ICON_STROKE} />,
        }}
      />
    </Tabs>
  );
}

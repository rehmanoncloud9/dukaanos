import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useT } from "@/core/i18n/I18nProvider";
import { colors, ICON_STROKE } from "@/core/theme/tokens";
import { Card, EmptyState, Header, IconButton, Screen } from "@/core/ui";

export default function SettingsPlaceholderScreen() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Screen
      header={
        <Header
          title={t("settings")}
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
      <Card>
        <EmptyState
          title="Settings & Data Rights (P5 Feature Screen)"
          subtitle="Shop switcher, EN/UR toggle, app lock, data export, and account deletion live here."
        />
      </Card>
    </Screen>
  );
}

import { useRouter } from "expo-router";
import { QrCode } from "lucide-react-native";
import { Text } from "react-native";
import { useT } from "@/core/i18n/I18nProvider";
import { colors, ICON_STROKE } from "@/core/theme/tokens";
import { Card, EmptyState, Header, Pill, Screen } from "@/core/ui";

export default function KhataPlaceholderScreen() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Screen
      header={
        <Header
          title={t("khata")}
          right={
            <Pill tone="dark" onPress={() => router.push("/passport")} accessibilityLabel="Open SMEConnect Passport">
              <QrCode size={14} color={colors.surface} strokeWidth={ICON_STROKE} />
              <Text style={{ color: colors.surface, fontSize: 12.5, fontWeight: "600" }}>SMEConnect</Text>
            </Pill>
          }
        />
      }
    >
      <Card>
        <EmptyState
          title="Khata (P5 Feature Screen)"
          subtitle="Debtor balances, Wasooli, WhatsApp & SMS (2G) reminders will render here."
        />
      </Card>
    </Screen>
  );
}

import { useRouter } from "expo-router";
import { Camera } from "lucide-react-native";
import { Text } from "react-native";
import { useT } from "@/core/i18n/I18nProvider";
import { colors, ICON_STROKE } from "@/core/theme/tokens";
import { Card, EmptyState, Header, Pill, Screen } from "@/core/ui";

export default function MaalPlaceholderScreen() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Screen
      header={
        <Header
          title={t("maal")}
          right={
            <Pill tone="maal" onPress={() => router.push("/parchi")} accessibilityLabel={t("scanParchi")}>
              <Camera size={14} color={colors.maal} strokeWidth={ICON_STROKE} />
              <Text style={{ color: colors.maal, fontSize: 12.5, fontWeight: "600" }}>{t("scanParchi")}</Text>
            </Pill>
          }
        />
      }
    >
      <Card>
        <EmptyState
          title="Maal & Stock (P5 Feature Screen)"
          subtitle="Inventory bars, low-stock filters, and Parchi OCR restock launch from here."
        />
      </Card>
    </Screen>
  );
}

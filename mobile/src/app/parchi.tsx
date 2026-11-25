import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useT } from "@/core/i18n/I18nProvider";
import { colors, ICON_STROKE } from "@/core/theme/tokens";
import { Card, EmptyState, Header, IconButton, Screen } from "@/core/ui";

export default function ParchiPlaceholderScreen() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Screen
      header={
        <Header
          title={t("scanParchi")}
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
          title="Parchi OCR Scanner (P5 Feature Screen)"
          subtitle="Camera capture, 1280px downscale, MATH_MISMATCH review, and restock commit live here."
        />
      </Card>
    </Screen>
  );
}

import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { colors, ICON_STROKE } from "@/core/theme/tokens";
import { Card, EmptyState, Header, IconButton, Screen } from "@/core/ui";

export default function PassportPlaceholderScreen() {
  const router = useRouter();
  return (
    <Screen
      header={
        <Header
          title="SMEConnect Passport"
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
          title="SMEConnect Trade Passport (P5 Feature Screen)"
          subtitle="On-device Ed25519 QR verification and PDF report export live here."
        />
      </Card>
    </Screen>
  );
}

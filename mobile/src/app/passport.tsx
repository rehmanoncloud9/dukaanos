import { useLocalSearchParams } from "expo-router";
import { PassportScreen } from "@/features/passport/PassportScreen";

export default function PassportRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return <PassportScreen tokenParam={typeof token === "string" ? token : undefined} />;
}

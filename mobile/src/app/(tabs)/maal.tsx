import { useLocalSearchParams } from "expo-router";
import { MaalScreen } from "@/features/maal/MaalScreen";

export default function MaalTabRoute() {
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  return <MaalScreen initialFilter={typeof filter === "string" ? filter : undefined} />;
}

import { useLocalSearchParams } from "expo-router";
import { KhataScreen } from "@/features/khata/KhataScreen";

export default function KhataTabRoute() {
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  return <KhataScreen initialFilter={typeof filter === "string" ? filter : undefined} />;
}

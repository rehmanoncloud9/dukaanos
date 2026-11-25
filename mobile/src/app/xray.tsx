import { useLocalSearchParams } from "expo-router";
import { XRayView } from "@/features/xray/XRayView";

export default function XRayScreen() {
  const { txId } = useLocalSearchParams<{ txId?: string }>();
  return <XRayView txId={typeof txId === "string" ? txId : null} />;
}

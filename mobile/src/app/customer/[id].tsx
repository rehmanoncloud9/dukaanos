import { useLocalSearchParams } from "expo-router";
import { CustomerDetailScreen } from "@/features/khata/CustomerDetailScreen";

export default function CustomerDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <CustomerDetailScreen customerId={typeof id === "string" ? id : ""} />;
}

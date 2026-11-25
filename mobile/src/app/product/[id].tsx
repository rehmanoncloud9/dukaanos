import { useLocalSearchParams } from "expo-router";
import { ProductDetailScreen } from "@/features/maal/ProductDetailScreen";

export default function ProductDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ProductDetailScreen productId={typeof id === "string" ? id : ""} />;
}

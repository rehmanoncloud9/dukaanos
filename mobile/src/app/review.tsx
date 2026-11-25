import { useRouter } from "expo-router";
import { EmptyState, Header, Screen } from "@/core/ui";
import { useMunshi } from "@/features/munshi/MunshiProvider";
import { SaleReviewView } from "@/features/munshi/SaleReviewView";

export default function ReviewScreen() {
  const router = useRouter();
  const { activeReview } = useMunshi();

  if (!activeReview) {
    return (
      <Screen header={<Header title="Review Entry" onPressTitle={() => router.back()} />}>
        <EmptyState title="No active draft to review" subtitle="Speak or type an entry on Munshi first." />
      </Screen>
    );
  }

  return <SaleReviewView initial={activeReview.proposal} idemKey={activeReview.key} trace={activeReview.trace} />;
}

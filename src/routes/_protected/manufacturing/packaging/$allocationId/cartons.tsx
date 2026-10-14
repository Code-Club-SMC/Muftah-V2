import { createFileRoute } from "@tanstack/react-router";
import { BatchDetailContainer } from "@/features/manufacturing/cartons/components/batch-detail-container";

export const Route = createFileRoute("/_protected/manufacturing/packaging/$allocationId/cartons")({
  component: AllocationCartons,
});

function AllocationCartons() {
  const { allocationId } = Route.useParams();
  return <BatchDetailContainer allocationId={allocationId} />;
}

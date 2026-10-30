import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProductionLossReport } from "@/components/reports/production-loss/production-loss-report";
import type { LossRowLink } from "@/lib/production/loss-report";

export const Route = createFileRoute("/_protected/reports/production-loss/")({
  component: ProductionLossPage,
});

function ProductionLossPage() {
  const navigate = useNavigate();
  const open = (link: LossRowLink) =>
    link.kind === "run"
      ? navigate({ to: "/manufacturing/mixing/$runId", params: { runId: link.runId } })
      : navigate({ to: "/inventory/item/$itemType/$itemId", params: { itemType: link.itemType, itemId: link.itemId }, search: { page: 1 } });
  return <ProductionLossReport onOpenRow={open} />;
}

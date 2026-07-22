import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { BatchDetailContainer } from "@/features/manufacturing/cartons/components/batch-detail-container";

export const Route = createFileRoute(
  "/_protected/manufacturing/productions/$runId/cartons/",
)({
  component: CartonsPage,
});

function CartonsPage() {
  return (
    <main className="flex-1 overflow-y-auto">
      <Suspense
        fallback={<GenericLoader title="Loading cartons" description="Please wait…" />}
      >
        <BatchDetailContainer />
      </Suspense>
    </main>
  );
}
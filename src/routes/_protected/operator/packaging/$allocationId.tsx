import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
// Assuming we create this function, if not I will just use getPackagingAllocationsFn or similar
// For now, I'll pass allocationId directly to the console component and fetch inside.
import { PackagingConsole } from "@/components/operator/packaging-console";

export const Route = createFileRoute("/_protected/operator/packaging/$allocationId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { allocationId } = Route.useParams();

  return (
    <Suspense
      fallback={
        <GenericLoader
          className="min-h-svh my-auto"
          title="Loading packing job..."
          description="Connecting to packaging line controls..."
        />
      }
    >
      <PackagingConsole allocationId={allocationId} />
    </Suspense>
  );
}

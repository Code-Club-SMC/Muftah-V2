import { createFileRoute } from "@tanstack/react-router";
import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";
import { Suspense } from "react";
import { Separator } from "@/components/ui/separator";
import { SupplierContainer } from "@/components/suppliers/suppliers-container";
import { GenericLoader } from "@/components/custom/generic-loader";

export const Route = createFileRoute("/_protected/suppliers/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["suppliers"],
      queryFn: getSuppliersFn,
    });
  },
  pendingComponent: () => (
    <GenericLoader title="Loading Suppliers" description="Please wait..." />
  ),
  component: SuppliersPage,
});

function SuppliersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Suppliers</h2>
        <p className="text-muted-foreground">
          Manage your raw material suppliers and view transaction history.
        </p>
      </div>

      <Separator />
      <Suspense
        fallback={
          <GenericLoader title="Loading Sppliers" description="wait..." />
        }
      >
        <SupplierContainer />
      </Suspense>
    </div>
  );
}

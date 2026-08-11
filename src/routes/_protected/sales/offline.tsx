import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GenericLoader } from "@/components/custom/generic-loader";
import { OfflineSalesPage } from "@/components/sales/offline/offline-sales-page";
import { offlineSalesQueries } from "@/hooks/sales/use-offline-sales";
import { hasPermission } from "@/lib/rbac";

export const Route = createFileRoute("/_protected/sales/offline")({
  loader: async ({ context }) => {
    const permissions = context.viewerAccess.permissions;

    void context.queryClient.prefetchQuery(offlineSalesQueries.history());

    if (hasPermission(permissions, "sales.offline.workbooks.manage")) {
      void context.queryClient.prefetchQuery(offlineSalesQueries.workbooks());
      void context.queryClient.prefetchQuery(offlineSalesQueries.operators());
    }

    if (hasPermission(permissions, "sales.offline.review")) {
      void context.queryClient.prefetchQuery(offlineSalesQueries.wallets());
    }

    if (hasPermission(permissions, "inventory.stock-reconciliation.manage")) {
      void context.queryClient.prefetchQuery(
        offlineSalesQueries.stockIssues("open"),
      );
    }
  },
  component: OfflineSalesRoute,
});

function OfflineSalesRoute() {
  return (
    <Suspense
      fallback={
        <GenericLoader
          title="Loading offline invoices"
          description="Fetching workbook and import records..."
        />
      }
    >
      <OfflineSalesPage />
    </Suspense>
  );
}

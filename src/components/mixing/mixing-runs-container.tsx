import { useSuspenseQuery } from "@tanstack/react-query";
import { getMixingRunsFn } from "@/server-functions/manufacturing/mixing/get-mixing-runs-fn";
import { MixingRunsTable } from "./mixing-runs-table";
import { CreateMixingRunDialog } from "./create-mixing-run-dialog";
import { useState } from "react";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { ProductionListFilters } from "@/components/production/production-list-filters";
import {
  ProductionListKpis,
  productionPercentage,
} from "@/components/production/production-list-kpis";
import type { ProductionListFilters as Filters } from "@/lib/production/list-filters";

export const MixingRunsContainer = ({
  initialSearch = "",
}: {
  initialSearch?: string;
}) => {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [search, setSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<
    Filters<"scheduled" | "in_progress" | "completed" | "cancelled" | "failed">
  >({});
  const { data: viewerAccess } = useViewerAccess();
  const canManage =
    !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "manufacturing.run.manage");
  const { data } = useSuspenseQuery({
    queryKey: ["mixing-runs", { ...pagination, search, ...filters }],
    queryFn: () =>
      getMixingRunsFn({
        data: {
          page: pagination.pageIndex + 1,
          limit: pagination.pageSize,
          search,
          ...filters,
        },
      }),
  });

  const mixingRunsList = data?.runs || [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        {canManage && <CreateMixingRunDialog />}
      </div>
      <ProductionListFilters
        value={filters}
        onChange={(value) => {
          setFilters(value);
          setPagination((current) => ({ ...current, pageIndex: 0 }));
        }}
        statuses={[
          { value: "scheduled", label: "Scheduled" },
          { value: "in_progress", label: "In progress" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
          { value: "failed", label: "Failed" },
        ]}
      />
      <ProductionListKpis
        items={[
          {
            label: "Mixing batches",
            value: data.kpis.total,
            description: "All matching batches",
          },
          {
            label: "Active batches",
            value: data.kpis.active,
            description: "Scheduled or in progress",
          },
          {
            label: "Completion rate",
            value: productionPercentage(data.kpis.completionPercentage),
            description: `${data.kpis.completed} completed batches`,
          },
          {
            label: "Average yield",
            value: productionPercentage(data.kpis.averageYieldPercentage),
            description: "Average output / target per completed batch",
          },
        ]}
      />
      <MixingRunsTable
        data={mixingRunsList}
        pagination={pagination}
        onPaginationChange={setPagination}
        totalCount={data.pagination.total}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPagination((current) => ({ ...current, pageIndex: 0 }));
        }}
      />
    </div>
  );
};

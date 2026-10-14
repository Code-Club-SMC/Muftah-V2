import { useSuspenseQuery } from "@tanstack/react-query";
import { getPaginatedPackagingAllocationsFn } from "@/server-functions/manufacturing/packaging/get-paginated-packaging-allocations-fn";
import { PackagingAllocationsTable } from "./packaging-allocations-table";
import { useState } from "react";
import { ProductionListFilters } from "@/components/production/production-list-filters";
import {
  ProductionListKpis,
  productionPercentage,
} from "@/components/production/production-list-kpis";
import type { ProductionListFilters as Filters } from "@/lib/production/list-filters";

export const PackagingAllocationsContainer = ({
  initialSearch = "",
}: {
  initialSearch?: string;
}) => {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [search, setSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<
    Filters<"allocated" | "in_progress" | "completed" | "cancelled">
  >({});
  const { data } = useSuspenseQuery({
    queryKey: [
      "packaging-allocations",
      "list",
      { ...pagination, search, ...filters },
    ],
    queryFn: () =>
      getPaginatedPackagingAllocationsFn({
        data: { ...pagination, search, ...filters },
      }),
  });

  const allocationsList = data?.allocations || [];

  return (
    <div className="flex flex-col gap-6">
      <ProductionListFilters
        value={filters}
        onChange={(value) => {
          setFilters(value);
          setPagination((current) => ({ ...current, pageIndex: 0 }));
        }}
        statuses={[
          { value: "allocated", label: "Scheduled" },
          { value: "in_progress", label: "In progress" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
      <ProductionListKpis
        items={[
          {
            label: "Scheduled jobs",
            value: data.kpis.scheduled,
            description: "Waiting to start packing",
          },
          {
            label: "Active jobs",
            value: data.kpis.active,
            description: "Packing in progress",
          },
          {
            label: "Packed containers",
            value: data.kpis.completedContainers.toLocaleString(),
            description: "Output across matching jobs, excluding cancelled",
          },
          {
            label: "Packing progress",
            value: productionPercentage(data.kpis.packingPercentage),
            description: `Of ${data.kpis.targetContainers.toLocaleString()} target containers, excluding cancelled`,
          },
        ]}
      />
      <PackagingAllocationsTable
        data={allocationsList}
        pagination={pagination}
        onPaginationChange={setPagination}
        totalCount={data.totalCount}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPagination((current) => ({ ...current, pageIndex: 0 }));
        }}
      />
    </div>
  );
};

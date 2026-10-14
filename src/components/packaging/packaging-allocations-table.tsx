import { DataTable } from "@/components/custom/data-table";
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { formatProductionCreatedDate } from "@/lib/production/list-filters";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { useCancelPackagingAllocation } from "@/hooks/manufacturing/packaging/use-packaging-mutations";

import type { getPackagingAllocationsFn } from "@/server-functions/manufacturing/packaging/get-packaging-allocations-fn";
type PackagingAllocation = Awaited<
  ReturnType<typeof getPackagingAllocationsFn>
>["allocations"][number];

function AllocationActions({
  allocation,
}: {
  allocation: PackagingAllocation;
}) {
  const { data: viewerAccess } = useViewerAccess();
  const cancelAllocation = useCancelPackagingAllocation();
  const canManage =
    !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "manufacturing.run.manage");
  const canViewCartons =
    !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "manufacturing.view");
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" asChild>
        <Link
          to="/operator/packaging/$allocationId"
          params={{ allocationId: allocation.id }}
        >
          Open Job
        </Link>
      </Button>
      {canViewCartons && allocation.status === "completed" && (
        <Button variant="ghost" size="sm" asChild>
          <Link
            to="/manufacturing/packaging/$allocationId/cartons"
            params={{ allocationId: allocation.id }}
          >
            View stock and cartons
          </Link>
        </Button>
      )}
      {canManage && allocation.status === "allocated" && (
        <Button
          variant="destructive"
          size="sm"
          disabled={cancelAllocation.isPending}
          onClick={() =>
            cancelAllocation.mutate({ data: { allocationId: allocation.id } })
          }
        >
          Cancel Packing Job
        </Button>
      )}
    </div>
  );
}

export const packagingAllocationColumns: ColumnDef<PackagingAllocation>[] = [
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => (
      <span className="font-medium text-xs">{row.original.id.slice(0, 8)}</span>
    ),
  },
  {
    accessorKey: "mixingRun.batchId",
    header: "Mixing Batch",
    cell: ({ row }) => (
      <span className="font-bold">{row.original.mixingRun?.batchId}</span>
    ),
  },
  {
    accessorKey: "recipe.name",
    header: "Packaging Format",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <Badge
          variant={
            status === "completed"
              ? "default"
              : status === "cancelled"
                ? "destructive"
                : "secondary"
          }
        >
          {status === "allocated"
            ? "SCHEDULED"
            : status.replace("_", " ").toUpperCase()}
        </Badge>
      );
    },
  },
  {
    accessorKey: "allocatedBulkQuantity",
    header: "Quantity to Pack",
    cell: ({ row }) =>
      `${row.original.allocatedBulkQuantity} ${row.original.allocatedBulkUnit}`,
  },
  {
    accessorKey: "completedContainers",
    header: "Packed",
    cell: ({ row }) =>
      `${row.original.completedContainers} / ${row.original.targetContainers}`,
  },
  {
    accessorKey: "createdAt",
    header: "Created (PKT)",
    cell: ({ row }) => formatProductionCreatedDate(row.original.createdAt),
  },
  {
    id: "actions",
    cell: ({ row }) => <AllocationActions allocation={row.original} />,
  },
];

export function PackagingAllocationsTable({
  data,
  isLoading,
  pagination,
  onPaginationChange,
  totalCount,
  search,
  onSearchChange,
}: {
  data: PackagingAllocation[];
  isLoading?: boolean;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  totalCount?: number;
  search?: string;
  onSearchChange?: (value: string) => void;
}) {
  return (
    <DataTable
      columns={packagingAllocationColumns}
      data={data}
      isLoading={isLoading}
      searchKey="id"
      searchPlaceholder={
        pagination ? "Search job, batch, or format..." : "Filter..."
      }
      manualPagination={!!pagination}
      autoResetPageIndex={!pagination}
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      pageCount={
        pagination
          ? Math.ceil((totalCount ?? 0) / pagination.pageSize)
          : undefined
      }
      totalRecords={totalCount}
      searchValue={search}
      onSearchChange={onSearchChange}
      emptyState={<p>No packing jobs match your filters</p>}
    />
  );
}

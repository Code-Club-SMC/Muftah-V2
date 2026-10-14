import { DataTable } from "@/components/custom/data-table";
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatProductionCreatedDate } from "@/lib/production/list-filters";

import type { getMixingRunsFn } from "@/server-functions/manufacturing/mixing/get-mixing-runs-fn";
type MixingRun = Awaited<ReturnType<typeof getMixingRunsFn>>["runs"][number];

export const mixingRunColumns: ColumnDef<MixingRun>[] = [
  {
    accessorKey: "batchId",
    header: "Batch ID",
    cell: ({ row }) => (
      <span className="font-bold">{row.original.batchId}</span>
    ),
  },
  {
    accessorKey: "formulaName",
    header: "Mixing Formula",
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
              : status === "failed" || status === "cancelled"
                ? "destructive"
                : "secondary"
          }
        >
          {status.replace("_", " ").toUpperCase()}
        </Badge>
      );
    },
  },
  {
    accessorKey: "actualBulkProduced",
    header: "Yield",
    cell: ({ row }) =>
      `${row.original.actualBulkProduced} / ${row.original.targetBulkQuantity} ${row.original.bulkUnit}`,
  },
  {
    accessorKey: "createdAt",
    header: "Created (PKT)",
    cell: ({ row }) => formatProductionCreatedDate(row.original.createdAt),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="icon"
        aria-label="View mixing batch"
        asChild
      >
        <Link
          to="/manufacturing/mixing/$runId"
          params={{ runId: row.original.id }}
        >
          <EyeIcon className="h-4 w-4" />
        </Link>
      </Button>
    ),
  },
];

export function MixingRunsTable({
  data,
  isLoading,
  pagination,
  onPaginationChange,
  totalCount,
  search,
  onSearchChange,
}: {
  data: MixingRun[];
  isLoading?: boolean;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  totalCount: number;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <DataTable
      columns={mixingRunColumns}
      data={data}
      isLoading={isLoading}
      searchKey="batchId"
      manualPagination
      autoResetPageIndex={false}
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      pageCount={Math.ceil(totalCount / pagination.pageSize)}
      totalRecords={totalCount}
      searchValue={search}
      onSearchChange={onSearchChange}
      emptyState={<p>No mixing batches match your search</p>}
    />
  );
}

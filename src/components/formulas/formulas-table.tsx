import { DataTable } from "@/components/custom/data-table";
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatNum } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatProductionCreatedDate } from "@/lib/production/list-filters";

// Generic formula type
type Formula = any;

export const formulaColumns: ColumnDef<Formula>[] = [
  {
    accessorKey: "name",
    header: "Mixing Formula Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "product.name",
    header: "Product",
  },
  {
    accessorKey: "batchSize",
    header: "Batch Size",
    cell: ({ row }) => `${row.original.batchSize} ${row.original.batchUnit}`,
  },
  {
    accessorKey: "estimatedIngredientsCost",
    header: "Est. Cost",
    cell: ({ row }) =>
      `PKR ${formatNum(Number(row.original.estimatedIngredientsCost))}`,
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? "default" : "secondary"}>
        {row.original.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
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
        aria-label="View mixing formula"
        asChild
      >
        <Link
          to="/manufacturing/formulas/$formulaId"
          params={{ formulaId: row.original.id }}
        >
          <EyeIcon className="h-4 w-4" />
        </Link>
      </Button>
    ),
  },
];

export function FormulasTable({
  data,
  isLoading,
  pagination,
  onPaginationChange,
  totalCount,
  search,
  onSearchChange,
}: {
  data: Formula[];
  isLoading?: boolean;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  totalCount: number;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <DataTable
      columns={formulaColumns}
      data={data}
      isLoading={isLoading}
      searchKey="name"
      manualPagination
      autoResetPageIndex={false}
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      pageCount={Math.ceil(totalCount / pagination.pageSize)}
      totalRecords={totalCount}
      searchValue={search}
      onSearchChange={onSearchChange}
      emptyState={<p>No mixing formulas match your search</p>}
    />
  );
}

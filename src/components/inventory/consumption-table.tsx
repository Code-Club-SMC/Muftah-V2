import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

import { DataTable } from "../custom/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";

type MaterialUsage = {
  id: string;
  productionRunId: string;
  materialType: "chemical" | "packaging";
  materialId: string;
  quantityUsed: string;
  costPerUnit: string;
  totalCost: string;
  createdAt: Date;
  chemical?: { name: string; unit: string };
  packagingMaterial?: { name: string };
  productionRun?: { batchId: string; recipe: { name: string } };
};

export const ConsumptionTable = ({ 
  data,
  totalCount,
  searchQuery,
  onSearchChange,
  pagination,
  onPaginationChange,
  isPending
}: { 
  data: MaterialUsage[];
  totalCount?: number;
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  pagination?: { pageIndex: number; pageSize: number };
  onPaginationChange?: (updater: any) => void;
  isPending?: boolean;
}) => {
  const [localSearch, setLocalSearch] = useState(searchQuery || "");

  const columns = useMemo<ColumnDef<MaterialUsage>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
              className="-ml-4"
            >
              Date
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          );
        },
        cell: ({ row }) => (
          <div className="font-medium">
            {format(new Date(row.getValue("createdAt")), "PP p")}
          </div>
        ),
      },
      {
        id: "batchId",
        accessorFn: (row) => row.productionRun?.batchId,
        header: "Batch",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-bold">
              {row.original.productionRun?.batchId}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.productionRun?.recipe?.name}
            </span>
          </div>
        ),
      },
      {
        id: "material",
        header: "Material",
        cell: ({ row }) => (
          <span>
            {row.original.materialType === "chemical"
              ? row.original.chemical?.name
              : row.original.packagingMaterial?.name}
          </span>
        ),
      },
      {
        accessorKey: "materialType",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.getValue("materialType")}
          </Badge>
        ),
      },
      {
        accessorKey: "quantityUsed",
        header: () => <div className="text-right">Quantity</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono">
            {parseFloat(row.getValue("quantityUsed")).toFixed(2)}
            <span className="text-xs text-muted-foreground ml-1">
              {row.original.materialType === "chemical"
                ? row.original.chemical?.unit
                : "units"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "totalCost",
        header: () => <div className="text-right">Cost (PKR)</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-emerald-600 font-medium">
            {parseFloat(row.getValue("totalCost")).toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 className="text-xl font-bold tracking-tight">
            Consumption History
          </h3>
          <p className="text-sm text-muted-foreground">
            Track material usage across production runs. Search by Batch ID.
          </p>
        </div>

        {onSearchChange && (
          <div className="flex items-center gap-2">
            <Input 
              placeholder="Search by Batch ID..." 
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="w-full sm:w-64 bg-background h-9 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSearchChange(localSearch);
                }
              }}
            />
            <Button 
              size="sm"
              onClick={() => onSearchChange(localSearch)} 
              disabled={isPending}
            >
              <Search className="size-4 mr-2" />
              Search
            </Button>
          </div>
        )}
      </div>

      <div className={cn("transition-opacity duration-200", isPending ? "opacity-50 pointer-events-none" : "opacity-100")}>
        <DataTable
          pageSize={pagination?.pageSize || 5}
          manualPagination={true}
          pageCount={totalCount !== undefined && pagination ? Math.ceil(Number(totalCount) / pagination.pageSize) : -1}
          pagination={pagination}
          onPaginationChange={onPaginationChange}
          totalRecords={totalCount}
          columns={columns}
          data={data || []}
          autoResetPageIndex={false}
        />
      </div>
    </div>
  );
};

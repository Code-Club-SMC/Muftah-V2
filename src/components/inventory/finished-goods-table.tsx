import {
  Eye,
  Warehouse,
  ArrowUpDown,
  ArrowRightLeft,
  Box,
} from "lucide-react";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { GenericEmpty } from "../custom/empty";
import { InventoryEmptyIllustration } from "@/components/illustrations/InventoryEmptyIllustration";
import { DataTable } from "../custom/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import { TransferStockDialog } from "./transfer-stock-dialog";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type FinishedGood = {
  id: string;
  quantityCartons: number;
  quantityContainers: number;
  cartonStats: {
    total: number;
    complete: number;
    partial: number;
    totalPacks: number;
  };
  createdAt: string | Date;
  updatedAt: string | Date;
  warehouse: {
    id: string; // Ensure ID is available
    name: string;
    isActive: boolean;
  };
  recipe: {
    id: string;
    name: string;
    containersPerCarton: number | null;
    estimatedCostPerContainer: string | null;
    batchUnit: string;
    minimumStockLevel: number | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    product: {
      id: string;
      name: string;
    };
  };
  weightedAverageCostPerPack: string | null;
  weightedAverageCostPerCarton: string | null;
  totalInventoryValue: string | null;
};

interface FinishedGoodsTableProps {
  data: FinishedGood[];
  warehouses: Awaited<ReturnType<typeof getInventoryFn>>;
  preselectedWarehouse: string | undefined;
  canTransfer?: boolean;
  canManageCartons?: boolean;
  canViewDetails?: boolean;
}

export const FinishedGoodsTable = ({
  data,
  warehouses,
  preselectedWarehouse,
  canTransfer = true,
  canManageCartons = true,
  canViewDetails = true,
}: FinishedGoodsTableProps) => {
  const navigate = useNavigate();
  const [transferOpen, setTransferOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<FinishedGood | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("all");

  const columns = useMemo<ColumnDef<FinishedGood>[]>(
    () => [
      {
        id: "product",
        accessorFn: (row) => `${row.recipe.product.name} ${row.recipe.name}`,
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
              className="-ml-4"
            >
              Product & Variant
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          );
        },
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">
              {row.original.recipe.product.name}
            </span>
            <span className="text-sm text-foreground/75">
              {row.original.recipe.name}
            </span>
          </div>
        ),
      },
      {
        id: "warehouse",
        accessorFn: (row) => row.warehouse.name,
        header: "Warehouse",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Warehouse className="size-3 text-muted-foreground" />
            <span className="text-sm font-medium">
              {row.original.warehouse.name}
            </span>
            {!row.original.warehouse.isActive && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1 text-muted-foreground whitespace-nowrap"
              >
                Inactive
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "cartons",
        accessorKey: "quantityCartons",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
              className="-ml-4"
            >
              Carton Inventory
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          );
        },
        cell: ({ row }) => {
          const stats = row.original.cartonStats || {
            total: 0,
            complete: 0,
            partial: 0,
            totalPacks: 0,
          };
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono font-black text-base leading-none">
                  {stats.total}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  Total
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-bold text-emerald-600 tabular-nums">
                    {stats.complete}
                  </span>
                  <span className="text-[9px] uppercase tracking-tighter text-muted-foreground/50">
                    Full
                  </span>
                </div>
                <div className="w-px h-2 bg-border" />
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-bold text-amber-600 tabular-nums">
                    {stats.partial}
                  </span>
                  <span className="text-[9px] uppercase tracking-tighter text-muted-foreground/50">
                    Partial
                  </span>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "totalUnits",
        header: "Total & Loose Units",
          cell: ({ row }) => {
            const fg = row.original;
            const stats = fg.cartonStats || { total: 0, complete: 0, partial: 0, totalPacks: 0 };
            const totalPacks = stats.totalPacks;
            const loose = fg.quantityContainers;
            const totalUnits = totalPacks + loose;
            return (
              <div className="flex flex-col gap-0.5">
                <span className="font-mono font-bold text-foreground">
                  {totalUnits}
                </span>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase font-bold text-muted-foreground">
                  {stats.partial > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="text-amber-600">{stats.partial}</span>
                      <span>Partial</span>
                    </span>
                  )}
                  {loose > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="text-primary">{loose}</span>
                      <span>Loose</span>
                    </span>
                  )}
                  {stats.partial === 0 && loose === 0 && (
                    <span>—</span>
                  )}
                </div>
              </div>
            );
          },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const fg = row.original;
          const totalUnits =
            (fg.cartonStats?.totalPacks ?? 0) + fg.quantityContainers;

          if (totalUnits <= 0) {
            return <Badge variant="destructive">Out of Stock</Badge>;
          }

          if (
            fg.recipe.minimumStockLevel !== null &&
            fg.recipe.minimumStockLevel > 0 &&
            totalUnits <= fg.recipe.minimumStockLevel
          ) {
            return (
              <Badge
                variant="destructive"
                className="bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-200"
              >
                Low Stock
              </Badge>
            );
          }

          return (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-600">
              Healthy
            </Badge>
          );
        },
      },
      {
        id: "wac",
        header: "Actual WAC",
        cell: ({ row }) => {
          const fg = row.original;
          const wac = parseFloat(fg.weightedAverageCostPerPack?.toString() || "0");
          if (!wac || wac === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-col gap-0.5 text-[11px]">
              <span className="font-semibold text-foreground">
                Pack: Rs. {wac.toFixed(2)}
              </span>
              {fg.recipe.containersPerCarton && fg.recipe.containersPerCarton > 0 && (
                <span className="text-foreground/70">
                  Carton: Rs. {parseFloat(fg.weightedAverageCostPerCarton?.toString() || "0").toFixed(2)}
                </span>
              )}
              <span className="text-muted-foreground">
                Value: Rs. {parseFloat(fg.totalInventoryValue?.toString() || "0").toFixed(2)}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "updatedAt",
        header: "Last Updated",
        cell: ({ row }) => (
          <div className="flex flex-col text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">
              {format(new Date(row.getValue("updatedAt")), "MMM d, yyyy")}
            </span>
            <span>{format(new Date(row.getValue("updatedAt")), "p")}</span>
          </div>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {canTransfer ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-primary hover:bg-primary/5"
                title="Transfer Stock"
                onClick={() => {
                  setSelectedItem(row.original);
                  setTransferOpen(true);
                }}
              >
                <ArrowRightLeft className="size-3.5" />
              </Button>
            ) : null}
            {canManageCartons ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
                title="Manage Cartons"
                onClick={() => navigate({ to: "/inventory/factory-floor/cartons/$recipeId", params: { recipeId: row.original.recipe.id }, search: { page: 1 } })}
              >
                <Box className="size-3.5" />
              </Button>
            ) : null}
            {canViewDetails ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-primary hover:bg-primary/5 hover:text-primary"
                title="View Details"
                onClick={() => navigate({ to: "/inventory/item/$itemType/$itemId", params: { itemType: "finished", itemId: row.original.recipe.id }, search: { page: 1 } })}
              >
                <Eye className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [navigate, canManageCartons, canTransfer, canViewDetails],
  );

  const productOptions = useMemo(
    () =>
      Array.from(
        new Map(
          data.map((item) => [item.recipe.product.id, item.recipe.product.name]),
        ).entries(),
      )
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [data],
  );

  const filteredData = data
    .filter((item) =>
      selectedProductId === "all"
        ? true
        : item.recipe.product.id === selectedProductId,
    )
    .filter(
      (item) => item.quantityCartons > 0 || item.quantityContainers > 0,
    );

  if (filteredData.length === 0 && data.length === 0) {
    const selectedWarehouseName = warehouses.find(
      (w) => w.id === preselectedWarehouse,
    )?.name;
    const description = selectedWarehouseName
      ? `${selectedWarehouseName} warehouse has no finished goods in stock.`
      : "No finished goods available in inventory.";

    return (
      <GenericEmpty
        icon={InventoryEmptyIllustration}
        title="No Finished Goods"
        description={description}
      />
    );
  }

  if (filteredData.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold tracking-tight">Finished Goods</h3>
            <p className="text-sm text-muted-foreground">
              Actual WAC by recipe, ready for transfer or carton handling.
            </p>
          </div>
          <div className="w-full max-w-xs">
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Filter by product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {productOptions.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <GenericEmpty
          icon={InventoryEmptyIllustration}
          title="No Matching Recipes"
          description="No finished-good recipes match the selected product filter."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-bold tracking-tight">Finished Goods</h3>
          <p className="text-sm text-muted-foreground">
            Actual WAC by recipe, ready for transfer or carton handling.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <Select value={selectedProductId} onValueChange={setSelectedProductId}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Filter by product" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {productOptions.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        pageSize={5}
        columns={columns}
        data={filteredData}
        searchKey="product"
        searchPlaceholder="Filter recipe names..."
      />

      {/* Transfer Dialog */}
      {selectedItem && transferOpen && (
        <TransferStockDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          warehouses={warehouses}
          cartonStats={selectedItem.cartonStats}
          defaultValues={{
            fromWarehouseId: selectedItem.warehouse.id || preselectedWarehouse,
            materialType: "finished",
            materialId: selectedItem.recipe.id,
            quantity:
              selectedItem.cartonStats.complete > 0
                ? selectedItem.cartonStats.complete.toString()
                : "",
          }}
        />
      )}
    </div>
  );
};

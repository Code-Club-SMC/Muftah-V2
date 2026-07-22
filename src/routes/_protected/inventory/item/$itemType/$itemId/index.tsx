import {
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { z } from "zod";
import { format } from "date-fns";
import {
  ArrowLeft,
  Warehouse,
  ArrowRight,
  Truck,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DataTable } from "@/components/custom/data-table";
import { LabReportsList } from "@/components/inventory/lab-reports/lab-reports-list";
import { getItemDetailPaginatedFn } from "@/server-functions/inventory/stock/get-item-detail-paginated-fn";
import { GenericLoader } from "@/components/custom/generic-loader";
import type { ColumnDef } from "@tanstack/react-table";

// ── Search schema ────────────────────────────────────────────────────────────

const searchSchema = z.object({
  page: z.number().int().positive().catch(1),
});

// ── Route definition ─────────────────────────────────────────────────────────

export const Route = createFileRoute(
  "/_protected/inventory/item/$itemType/$itemId/",
)({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { page } }) => ({ page }),
  loader: async ({ context, params, deps }) => {
    void context.queryClient.prefetchQuery({
      queryKey: [
        "item-detail",
        params.itemType,
        params.itemId,
        deps.page,
      ],
      queryFn: () =>
        getItemDetailPaginatedFn({
          data: {
            itemType: params.itemType as "chemical" | "packaging" | "finished",
            itemId: params.itemId,
            page: deps.page,
            limit: 20,
          },
        }),
    });
  },
  pendingComponent: () => (
    <GenericLoader title="Loading item details" description="Please wait..." />
  ),
  component: ItemDetailPage,
});

// ── Transfer row type ─────────────────────────────────────────────────────────

type TransferRow = {
  id: string;
  createdAt: string | Date;
  fromWarehouse: { id: string; name: string } | null;
  toWarehouse: { id: string; name: string } | null;
  quantity: string;
  notes: string | null;
  performedBy: { id: string; name: string } | null;
};

// ── Column definitions ────────────────────────────────────────────────────────

function buildColumns(
  isFinished: boolean,
  unit: string,
): ColumnDef<TransferRow>[] {
  return [
    {
      accessorKey: "createdAt",
      header: "Date",
      cell: ({ row }) =>
        format(new Date(row.original.createdAt), "MMM d, h:mm a"),
    },
    {
      id: "route",
      header: "Route",
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {row.original.fromWarehouse?.name ?? "—"}
          </span>
          <ArrowRight className="size-3 text-muted-foreground/50" />
          <span className="text-muted-foreground">
            {row.original.toWarehouse?.name ?? "—"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
      cell: ({ row }) => (
        <span className="font-mono font-medium">
          {parseFloat(row.original.quantity).toFixed(isFinished ? 0 : 2)}
          <span className="text-[10px] text-muted-foreground ml-1">
            {isFinished ? "ctn" : unit}
          </span>
          {row.original.notes?.includes("loose units") && (
            <div className="text-[10px] text-amber-600 font-bold tracking-tight">
              + Loose Units
            </div>
          )}
        </span>
      ),
    },
    {
      id: "performedBy",
      header: "By",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.performedBy?.name ?? "—"}
        </span>
      ),
    },
  ];
}

type ItemDetailResult = {
  item: Record<string, unknown>;
  transferHistory: {
    data: any[];
    total: number;
    pageCount: number;
    page: number;
  };
};

// ── Page component ────────────────────────────────────────────────────────────

function ItemDetailPage() {
  const { itemType, itemId } = Route.useParams();
  const { page } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();

  const isFinished = itemType === "finished";
  const isChemical = itemType === "chemical";

  const { data, isLoading } = useQuery({
    queryKey: ["item-detail", itemType, itemId, page],
    queryFn: () =>
      getItemDetailPaginatedFn({
        data: {
          itemType: itemType as "chemical" | "packaging" | "finished",
          itemId,
          page,
          limit: 20,
        },
      }) as Promise<ItemDetailResult>,
    placeholderData: keepPreviousData,
  });

  const item = data?.item as Record<string, any> | undefined;
  const transferHistory = data?.transferHistory;

  const setPage = (newPage: number) => {
    navigate({
      search: (prev) => ({ ...prev, page: newPage }),
    });
  };

  const paginationProps = {
    manualPagination: true,
    pageCount: transferHistory?.pageCount ?? 1,
    totalRecords: transferHistory?.total ?? 0,
    pagination: {
      pageIndex: (transferHistory?.page ?? 1) - 1,
      pageSize: 20,
    },
    onPaginationChange: (updater: any) => {
      const newIndex =
        typeof updater === "function"
          ? updater({
              pageIndex: (transferHistory?.page ?? 1) - 1,
              pageSize: 20,
            }).pageIndex
          : updater.pageIndex;
      setPage(newIndex + 1);
    },
  };

  // Derive display values from item metadata
  const itemName = isFinished
    ? (item?.productName as string | undefined) ?? (item?.name as string)
    : (item?.name as string | undefined) ?? "";

  const recipeName = isFinished ? (item?.name as string | undefined) : undefined;

  const unit = isFinished
    ? "ctn"
    : (item?.unit as string | undefined) ??
      (itemType === "packaging" ? "pcs" : "kg");

  const costPerUnit = isFinished
    ? item?.estimatedCostPerContainer
    : item?.costPerUnit;

  const minLevel = isFinished
    ? null
    : parseFloat(String(item?.minimumStockLevel ?? 0));

  const totalStock = isFinished
    ? null
    : parseFloat(String(item?.totalStock ?? 0));

  const isLow =
    !isFinished && minLevel !== null && totalStock !== null && totalStock < minLevel;

  const warehouses = (
    item?.stockByWarehouse as Array<{
      warehouseId: string;
      warehouseName: string;
      quantity?: string;
      quantityCartons?: number;
      quantityContainers?: number;
    }>
  ) ?? [];

  const columns = buildColumns(isFinished, unit);

  if (isLoading && !data) {
    return (
      <GenericLoader title="Loading item details" description="Please wait..." />
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
        <AlertCircle className="size-12 text-muted-foreground/50" />
        <h2 className="text-xl font-bold text-muted-foreground">
          Item Not Found
        </h2>
        <Button variant="outline" onClick={() => router.history.back()}>
          <ArrowLeft className="size-4 mr-2" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-primary/5 border-b border-primary/10 px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 text-muted-foreground hover:text-foreground"
                onClick={() => router.history.back()}
              >
                <ArrowLeft className="size-4 mr-1.5" />
                Back
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-primary/10 text-primary border-primary/20 uppercase text-[10px] font-bold "
              >
                {itemType.replace("_", " ")} Details
              </Badge>
              {isLow && (
                <Badge
                  variant="destructive"
                  className="animate-pulse text-[10px] font-bold uppercase "
                >
                  Low Stock Warning
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-3">
              {itemName}
              {recipeName && (
                <span className="text-sm font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {recipeName}
                </span>
              )}
            </h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {warehouses.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Warehouse className="size-3.5" />
                  <span className="font-semibold text-foreground">
                    {warehouses.map((w) => w.warehouseName).join(", ")}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 p-8 space-y-8">
        {/* ── Metadata cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          {/* Current Stock */}
          <Card className="bg-background shadow-xs min-h-[110px] flex flex-col">
            <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
              <p className="text-[10px] font-black uppercase text-muted-foreground ">
                Current Stock
              </p>
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-black text-foreground leading-none tracking-tighter">
                  {isFinished
                    ? (item.totalCartons as number)
                    : parseFloat(String(item.totalStock ?? 0)).toFixed(0)}
                </span>
                <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20 uppercase w-fit">
                  {isFinished
                    ? "Cartons"
                    : unit}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Cost per unit */}
          <Card className="bg-background shadow-xs min-h-[110px] flex flex-col">
            <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
              <p className="text-[10px] font-black uppercase text-muted-foreground ">
                Value / Unit
              </p>
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-black text-foreground leading-none tracking-tighter">
                  {costPerUnit
                    ? parseFloat(String(costPerUnit)).toFixed(2)
                    : "—"}
                </span>
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20 uppercase  w-fit">
                  PKR
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Threshold / Warehouse */}
          <Card className="bg-background shadow-xs min-h-[110px] flex flex-col">
            <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
              <p className="text-[10px] font-black uppercase text-muted-foreground ">
                {isFinished ? "Loose Units" : "Threshold"}
              </p>
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-black text-foreground leading-none tracking-tighter">
                  {isFinished
                    ? (item.totalContainers as number)
                    : minLevel !== null
                    ? minLevel.toFixed(0)
                    : "N/A"}
                </span>
                {!isFinished && minLevel !== null && (
                  <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-1 rounded-md border border-border uppercase w-fit">
                    {unit}
                  </span>
                )}
                {isFinished && (
                  <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/20 uppercase w-fit">
                    Loose
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Warehouse breakdown ─────────────────────────────────────── */}
        {warehouses.length > 1 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase ">
              <Warehouse className="size-3.5" />
              <span>Stock by Warehouse</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {warehouses.map((w) => (
                <div
                  key={w.warehouseId}
                  className="p-4 rounded-xl border bg-muted/10 space-y-1"
                >
                  <p className="text-[10px] font-black uppercase text-muted-foreground ">
                    {w.warehouseName}
                  </p>
                  {isFinished ? (
                    <p className="text-sm font-bold">
                      {w.quantityCartons ?? 0} ctn / {w.quantityContainers ?? 0} loose
                    </p>
                  ) : (
                    <p className="text-sm font-bold">
                      {parseFloat(String(w.quantity ?? 0)).toFixed(2)} {unit}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Transfer history table ──────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase ">
            <Truck className="size-3.5" />
            <span>Transfer History</span>
            {transferHistory && (
              <Badge variant="secondary" className="text-[10px] font-bold ml-1">
                {transferHistory.total} records
              </Badge>
            )}
          </div>

          <DataTable
            columns={columns}
            data={(transferHistory?.data as TransferRow[]) ?? []}
            isLoading={isLoading}
            showSearch={false}
            showViewOptions={false}
            showPagination={true}
            emptyState={
              <div className="p-8 flex flex-col items-center justify-center text-center gap-2">
                <Truck className="size-8 text-muted-foreground/20" />
                <p className="text-sm font-medium text-muted-foreground">
                  No transfer history found
                </p>
                <p className="text-[10px] text-muted-foreground/60 uppercase ">
                  Stock has not been moved between warehouses yet.
                </p>
              </div>
            }
            {...paginationProps}
          />
        </div>

        {/* ── Lab Reports (chemicals only) ────────────────────────────── */}
        {isChemical && item.id && (
          <>
            <Separator />
            <LabReportsList
              chemicalId={item.id as string}
              chemicalName={item.name as string}
            />
          </>
        )}
      </div>
    </div>
  );
}

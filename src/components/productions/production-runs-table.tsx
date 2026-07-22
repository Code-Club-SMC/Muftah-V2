import { formatDistanceToNow } from "date-fns";
import { ArrowUpDown, Eye, Play, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useDeleteProductionRun } from "@/hooks/production/use-delete-production-run";
import { useStartProduction } from "@/hooks/production/use-start-production";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { DataTable } from "../custom/data-table";

type ProductionRunsTableProps = {
  runs: any[];
  manualPagination?: boolean;
  pageCount?: number;
  pagination?: { pageIndex: number; pageSize: number };
  onPaginationChange?: (updater: any) => void;
  totalRecords?: number;
};

export const ProductionRunsTable = ({
  runs,
  manualPagination,
  pageCount,
  pagination,
  onPaginationChange,
  totalRecords,
}: ProductionRunsTableProps) => {
  const startProduction = useStartProduction();
  const deleteProductionRun = useDeleteProductionRun();

  const [startDialogRunId, setStartDialogRunId] = useState<string | null>(null);
  const [deleteDialogRunId, setDeleteDialogRunId] = useState<string | null>(
    null,
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled":
        return <Badge variant="secondary">Scheduled</Badge>;
      case "in_progress":
        return (
          <Badge variant="default" className="bg-blue-600">
            In Progress
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="default" className="bg-green-600">
            Completed
          </Badge>
        );
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      case "failed":
        return (
          <Badge variant="destructive" className="bg-destructive/10">
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      {
        accessorKey: "batchId",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-3 h-auto py-1 uppercase text-[10px] font-bold tracking-tight"
          >
            Batch ID
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs font-bold text-primary tracking-tighter">
            {row.getValue("batchId")}
          </span>
        ),
      },
      {
        id: "recipe",
        accessorFn: (row) => row.recipe.name,
        header: () => (
          <span className="text-[10px] font-bold uppercase tracking-wide">
            Recipe
          </span>
        ),
        cell: ({ row }) => (
          <div>
            <p className="font-bold text-sm tracking-tight">
              {row.original.recipe.name}
            </p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase">
              {row.original.recipe.product.name}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: () => (
          <span className="text-[10px] font-bold uppercase tracking-tight text-center block w-full">
            Status
          </span>
        ),
        cell: ({ row }) => getStatusBadge(row.getValue("status")),
      },
      {
        id: "progress",
        header: () => (
          <span className="text-[10px] font-bold uppercase tracking-wide text-center block w-full">
            Progress
          </span>
        ),
        cell: ({ row }) => {
          const run = row.original;
          const progress =
            run.containersProduced > 0
              ? ((run.completedUnits || 0) / run.containersProduced) * 100
              : 0;

          if (run.status !== "in_progress") {
            return (
              <span className="block text-center text-xs text-muted-foreground">
                -
              </span>
            );
          }

          return (
            <div className="mx-auto w-[80px] space-y-1">
              <Progress value={progress} className="h-1.5" />
              <p className="text-center text-[10px] font-medium text-muted-foreground">
                {Math.round(progress)}%
              </p>
            </div>
          );
        },
      },
      {
        id: "target",
        accessorKey: "containersProduced",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-3 h-auto py-1 uppercase text-[10px] font-bold tracking-wide"
          >
            Target
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="text-sm">
            <p className="font-bold">
              {row.original.containersProduced}{" "}
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                Units
              </span>
            </p>
            {row.original.recipe.containersPerCarton > 0 ? (
              <p className="text-[10px] font-bold uppercase leading-none text-muted-foreground">
                {Math.ceil(
                  row.original.containersProduced /
                    row.original.recipe.containersPerCarton,
                )}{" "}
                Cartons
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "produced",
        header: () => (
          <span className="text-[10px] font-bold uppercase tracking-wide text-center block w-full">
            Produced
          </span>
        ),
        cell: ({ row }) => {
          const run = row.original;
          const produced = run.completedUnits || 0;
          const perCarton = run.recipe.containersPerCarton || 0;
          const cartons = perCarton > 0 ? Math.floor(produced / perCarton) : 0;
          const loose = perCarton > 0 ? produced % perCarton : produced;

          if (run.status === "scheduled") {
            return (
              <span className="block text-center text-xs text-muted-foreground">
                -
              </span>
            );
          }

          return (
            <div className="text-center text-sm">
              <p className="font-bold text-green-700">
                {produced.toLocaleString()}{" "}
                <span className="text-[10px] font-medium uppercase text-green-600/70">
                  Units
                </span>
              </p>
              {run.shortfallUnits > 0 ? (
                <Badge
                  variant="outline"
                  className="mt-1 h-4 border-amber-200 bg-amber-50 px-1 py-0 text-[9px] font-bold text-amber-700"
                >
                  SHORT: {run.shortfallUnits}
                </Badge>
              ) : null}
              {perCarton > 0 && produced > 0 ? (
                <p className="mt-1 text-[10px] font-bold uppercase leading-none text-muted-foreground">
                  {cartons > 0 ? `${cartons} Cartons ` : ""}
                  {loose > 0 ? `+ ${loose} Loose` : ""}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "totalCost",
        accessorKey: "totalProductionCost",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-3 h-auto py-1 uppercase text-[10px] font-bold tracking-wide"
          >
            Total Cost
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="text-sm font-black tracking-tight">
              PKR{" "}
              {parseFloat(
                row.original.totalProductionCost || "0",
              ).toLocaleString()}
            </p>
            {row.original.totalChemicalCost ? (
              <p className="flex items-center gap-1 text-[10px] font-black uppercase text-muted-foreground">
                <span className="text-blue-600/60">
                  Chem: {parseFloat(row.original.totalChemicalCost).toFixed(0)}
                </span>
                <span className="text-muted-foreground/30">|</span>
                <span className="text-purple-600/60">
                  Pkg: {parseFloat(row.original.totalPackagingCost).toFixed(0)}
                </span>
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "costPerContainer",
        accessorKey: "costPerContainer",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-3 h-auto py-1 uppercase text-[10px] font-bold tracking-wide"
          >
            Cost/Unit
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const run = row.original;
          const actualCost = Number(run.actualCostPerPack || "0");
          const displayCost =
            actualCost > 0
              ? actualCost.toFixed(2)
              : (() => {
                  const totalCostNumeric = parseFloat(
                    run.totalProductionCost || "0",
                  );
                  const hasGeneratedOutput = (run.completedUnits || 0) > 0;
                  const isStarted =
                    run.status === "in_progress" || run.status === "completed";

                  return isStarted && hasGeneratedOutput
                    ? (totalCostNumeric / run.completedUnits!).toFixed(2)
                    : parseFloat(run.costPerContainer || "0").toFixed(2);
                })();

          return (
            <Badge
              variant="outline"
              className="border-green-200 bg-green-50/50 font-bold text-green-600"
            >
              PKR {displayCost}
            </Badge>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-3 h-auto py-1 uppercase text-[10px] font-bold tracking-wide"
          >
            Created
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-xs font-medium text-muted-foreground">
            {formatDistanceToNow(new Date(row.getValue("createdAt")), {
              addSuffix: true,
            })}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => (
          <span className="text-[10px] font-bold uppercase tracking-wide text-center block w-full">
            Actions
          </span>
        ),
        cell: ({ row }) => {
          const run = row.original;

          return (
            <div className="flex justify-end gap-2">
              {run.status === "scheduled" ? (
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 text-[10px] font-black uppercase tracking-wider"
                  disabled={startProduction.isPending}
                  onClick={() => setStartDialogRunId(run.id)}
                >
                  <Play className="mr-1.5 size-3" />
                  Start Run
                </Button>
              ) : null}

              {run.status === "in_progress" ? (
                <Badge variant="outline" className="hidden sm:inline-flex">
                  Manage in operator screen
                </Badge>
              ) : null}

              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground transition-colors hover:text-primary"
                asChild
              >
                <Link
                  to={`/manufacturing/productions/$runId`}
                  params={{ runId: run.id }}
                >
                  <Eye className="size-4" />
                </Link>
              </Button>

              {run.status === "scheduled" || run.status === "cancelled" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteDialogRunId(run.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [startProduction.isPending, deleteProductionRun.isPending],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={runs}
        showSearch={false}
        pageSize={pagination?.pageSize || 6}
        manualPagination={manualPagination}
        pageCount={pageCount}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        autoResetPageIndex={false}
        totalRecords={totalRecords}
      />

      <AlertDialog
        open={!!startDialogRunId}
        onOpenChange={(open) => !open && setStartDialogRunId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start Production?</AlertDialogTitle>
            <AlertDialogDescription>
              This deducts chemicals immediately from factory-floor stock.
              Packaging is deducted later from operator logs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!startDialogRunId) {
                  return;
                }

                startProduction.mutate(
                  {
                    data: { productionRunId: startDialogRunId },
                  },
                  {
                    onSuccess: () => {
                      toast.success("Production Started", {
                        description:
                          "Materials deducted. Status set to In Progress.",
                      });
                      setStartDialogRunId(null);
                    },
                    onError: (err) => {
                      toast.error("Failed to start production", {
                        description: err.message,
                      });
                    },
                  },
                );
              }}
            >
              Start Production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteDialogRunId}
        onOpenChange={(open) => !open && setDeleteDialogRunId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" />
              Delete Production Run?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the production run and associated
              material usage records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteProductionRun.isPending}
              onClick={() => {
                if (!deleteDialogRunId) {
                  return;
                }

                deleteProductionRun.mutate(
                  {
                    data: { productionRunId: deleteDialogRunId },
                  },
                  {
                    onSuccess: () => {
                      setDeleteDialogRunId(null);
                    },
                  },
                );
              }}
            >
              {deleteProductionRun.isPending ? "Deleting..." : "Delete Run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/custom/data-table";
import { CartonStatusBadge, PackCountBar } from "../components";
import type { CartonStatus } from "@/lib/cartons/carton.types";

type CartonRow = {
  id: string;
  sku: string | null;
  capacity: number;
  currentPacks: number;
  status: CartonStatus;
  zone: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Props = {
  data: CartonRow[];
  isLoading?: boolean;
  onTopUp?: (carton: CartonRow) => void;
  onRemovePacks?: (carton: CartonRow) => void;
  onSetCount?: (carton: CartonRow) => void;
  onRepack?: (carton: CartonRow) => void;
  onRetire?: (carton: CartonRow) => void;
  onHold?: (carton: CartonRow) => void;
  onReleaseHold?: (carton: CartonRow) => void;
  onViewAuditLog?: (carton: CartonRow) => void;
  onTransfer?: (carton: CartonRow) => void;
};

export function CartonTable({
  data,
  isLoading,
  onTopUp,
  onRemovePacks,
  onSetCount,
  onRepack,
  onRetire,
  onHold,
  onReleaseHold,
  onViewAuditLog,
  onTransfer,
}: Props) {
  const columns = useMemo<ColumnDef<CartonRow>[]>(
    () => [
      {
        accessorKey: "sku",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-[10px] font-bold uppercase tracking-wider"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            SKU
            <ArrowUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs font-bold">
            {row.original.sku || "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <CartonStatusBadge status={row.original.status} />,
      },
      {
        id: "packs",
        header: "Packs",
        cell: ({ row }) => (
          <PackCountBar
            current={row.original.currentPacks}
            capacity={row.original.capacity}
            size="sm"
          />
        ),
      },
      {
        accessorKey: "zone",
        header: "Zone",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.zone || "—"}
          </span>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-[10px] font-bold uppercase tracking-wider"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Updated
            <ArrowUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const d = new Date(row.original.updatedAt);
          return (
            <span className="text-xs text-muted-foreground tabular-nums">
              {d.toLocaleDateString("en-PK", { month: "short", day: "numeric" })}
              {" "}
              {d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
            </span>
          );
        },
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const c = row.original;
          const isMutable = !["DISPATCHED", "RETIRED", "ARCHIVED"].includes(c.status);
          const isOnHold = c.status === "ON_HOLD";

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {isMutable && !isOnHold && onTopUp && (
                  <DropdownMenuItem onClick={() => onTopUp(c)}>Top-Up Packs</DropdownMenuItem>
                )}
                {isMutable && !isOnHold && onRemovePacks && (
                  <DropdownMenuItem onClick={() => onRemovePacks(c)}>Remove Packs</DropdownMenuItem>
                )}
                {isMutable && !isOnHold && onSetCount && (
                  <DropdownMenuItem onClick={() => onSetCount(c)}>Override Count</DropdownMenuItem>
                )}
                {isMutable && !isOnHold && onTransfer && (
                  <DropdownMenuItem onClick={() => onTransfer(c)}>Transfer Packs</DropdownMenuItem>
                )}
                {(["COMPLETE", "SEALED"].includes(c.status)) && onRepack && (
                  <DropdownMenuItem onClick={() => onRepack(c)}>Repack Carton</DropdownMenuItem>
                )}
                {isMutable && !isOnHold && onHold && (
                  <DropdownMenuItem onClick={() => onHold(c)}>Apply QC Hold</DropdownMenuItem>
                )}
                {isOnHold && onReleaseHold && (
                  <DropdownMenuItem onClick={() => onReleaseHold(c)}>Release Hold</DropdownMenuItem>
                )}
                {isMutable && onRetire && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onRetire(c)}
                    >
                      Retire Carton
                    </DropdownMenuItem>
                  </>
                )}
                {onViewAuditLog && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onViewAuditLog(c)}>
                      View Audit Log
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [onTopUp, onRemovePacks, onSetCount, onRepack, onRetire, onHold, onReleaseHold, onViewAuditLog, onTransfer],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      isLoading={isLoading}
      searchKey="sku"
      searchPlaceholder="Search by SKU…"
      pageSize={15}
    />
  );
}
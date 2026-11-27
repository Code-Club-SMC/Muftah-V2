import Big from "big.js";
import { format } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplierReturnMutations, useSupplierReturns } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import { SUPPLIER_RETURN_STATUS_LABELS, type SupplierReturnQueue, type SupplierReturnRow } from "@/lib/suppliers/supplier-returns";
import { CompleteSupplierReturnDialog } from "./complete-supplier-return-dialog";
import { DebitNotePrintDialog } from "./debit-note-print-dialog";
import { SupplierReturnReasonDialog } from "./supplier-return-reason-dialog";

const QUEUES: { key: SupplierReturnQueue; label: string }[] = [
  { key: "to_dispatch", label: "To dispatch" },
  { key: "dispatched", label: "Dispatched" },
  { key: "done", label: "Done" },
];

export function SupplierReturnsPanel({ supplierId, canManage }: { supplierId: string; canManage: boolean }) {
  const [queue, setQueue] = useState<SupplierReturnQueue>("to_dispatch");
  const { data, isLoading } = useSupplierReturns(supplierId, queue);
  const { dispatch } = useSupplierReturnMutations();
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  const [reason, setReason] = useState<{ mode: "cancel" | "void"; row: SupplierReturnRow } | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {QUEUES.map((q) => (
          <Button
            key={q.key}
            size="sm"
            variant={queue === q.key ? "default" : "outline"}
            onClick={() => setQueue(q.key)}
          >
            {`${q.label} (${data?.counts[q.key] ?? 0})`}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-24" />
      ) : !data?.rows.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {queue === "to_dispatch"
            ? "Nothing waiting to go back. Use Return to supplier on a purchase to start one."
            : "No returns here."}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {data.rows.map((row) => {
            const open = row.status === "requested" || row.status === "dispatched";
            const showMenu = row.status === "completed" || (canManage && open);
            return (
              <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{`${new Big(row.quantity).toString()} ${row.unit} ${row.materialName}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      row.debitNoteNumber ?? row.returnNumber,
                      format(new Date(row.requestedAt), "d MMM yyyy"),
                      row.warehouseName,
                      row.reason,
                    ].join(" · ")}
                  </p>
                  {row.status === "cancelled" && row.cancelReason && (
                    <p className="text-xs text-muted-foreground">Cancelled: {row.cancelReason}</p>
                  )}
                  {row.status === "voided" && row.voidReason && (
                    <p className="text-xs text-muted-foreground">Voided: {row.voidReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">{formatRupees(row.totalAmount)}</span>
                  {queue === "done" && (
                    <Badge variant={row.status === "completed" ? "default" : "secondary"}>
                      {SUPPLIER_RETURN_STATUS_LABELS[row.status]}
                    </Badge>
                  )}
                  {canManage && row.status === "requested" && (
                    <Button size="sm" disabled={dispatch.isPending} onClick={() => dispatch.mutate({ data: { id: row.id } })}>
                      Mark as dispatched
                    </Button>
                  )}
                  {canManage && row.status === "dispatched" && (
                    <Button size="sm" onClick={() => setCompleteId(row.id)}>
                      Complete and issue debit note
                    </Button>
                  )}
                  {showMenu && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label="More actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {row.status === "completed" && (
                          <DropdownMenuItem onClick={() => setPrintId(row.id)}>Print debit note</DropdownMenuItem>
                        )}
                        {canManage && row.status === "completed" && (
                          <DropdownMenuItem onClick={() => setReason({ mode: "void", row })}>Void debit note</DropdownMenuItem>
                        )}
                        {canManage && open && (
                          <DropdownMenuItem onClick={() => setReason({ mode: "cancel", row })}>Cancel return</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CompleteSupplierReturnDialog
        open={!!completeId}
        onOpenChange={(o) => {
          if (!o) setCompleteId(null);
        }}
        returnId={completeId}
      />
      <SupplierReturnReasonDialog
        open={!!reason}
        onOpenChange={(o) => {
          if (!o) setReason(null);
        }}
        mode={reason?.mode ?? "cancel"}
        row={reason?.row ?? null}
      />
      <DebitNotePrintDialog
        open={!!printId}
        onOpenChange={(o) => {
          if (!o) setPrintId(null);
        }}
        returnId={printId}
      />
    </div>
  );
}

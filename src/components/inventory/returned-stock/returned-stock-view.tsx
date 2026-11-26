import { useState } from "react";
import Big from "big.js";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useReturnedStock,
  useVoidReturnedStockMovement,
  type ReturnedStockMovementRow,
  type ReturnedStockRow,
} from "@/hooks/inventory/use-returned-stock";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { formatRupees } from "@/lib/finance/expense-entry";
import { RETURNED_STOCK_MOVEMENT_LABELS, type ReturnedStockMovementKind } from "@/lib/inventory/returned-stock";
import { hasPermission } from "@/lib/rbac";
import { formatUnits } from "@/lib/sales/returns/return-lifecycle";
import { DisposeReturnedStockDialog } from "./dispose-returned-stock-dialog";
import { SetReturnedStockValueDialog } from "./set-returned-stock-value-dialog";

function VoidMovementDialog({ movement, onClose }: { movement: ReturnedStockMovementRow; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const voidMovement = useVoidReturnedStockMovement();
  const valid = reason.trim().length >= 3;
  async function submit() {
    if (!valid || voidMovement.isPending) return;
    setError("");
    try {
      await voidMovement.mutateAsync({ movementId: movement.id, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not void. Your entries are kept.");
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !voidMovement.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Void this entry</DialogTitle>
            <DialogDescription>
              {movement.kind === "seconds_sale"
                ? `The packs go back into stock and ${formatRupees(movement.saleAmount ?? "0")} is taken back out of ${movement.walletName ?? "the account"}.`
                : movement.kind === "scrap"
                  ? "The packs and their value go back into stock."
                  : "The old value goes back onto these packs."}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <Label htmlFor="void-movement-reason">Reason</Label>
            <Textarea id="void-movement-reason" minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={voidMovement.isPending} onClick={onClose}>Close</Button>
            <Button type="submit" variant="destructive" disabled={!valid || voidMovement.isPending}>
              {voidMovement.isPending ? "Voiding..." : "Void entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnedStockView() {
  const { data: viewer } = useViewerAccess();
  const canDispose = hasPermission(viewer?.permissions ?? [], "inventory.returns.dispose");
  const stock = useReturnedStock();
  const [disposing, setDisposing] = useState<ReturnedStockRow | null>(null);
  const [valuing, setValuing] = useState<ReturnedStockRow | null>(null);
  const [voiding, setVoiding] = useState<ReturnedStockMovementRow | null>(null);

  if (stock.isLoading) return <Skeleton className="h-48 w-full" />;
  if (stock.isError) return <p role="alert" className="text-destructive">{stock.error.message}</p>;
  const { rows, movements } = stock.data ?? { rows: [], movements: [] };

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Returned stock">
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No damaged or expired packs</EmptyTitle>
              <EmptyDescription>Packs marked damaged or expired when a return is received show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Packs</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Per pack</TableHead>
                {canDispose && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={`${row.warehouseId}-${row.recipeId}-${row.condition}`}>
                  <TableCell>{row.recipeName}</TableCell>
                  <TableCell>{row.warehouseName}</TableCell>
                  <TableCell><Badge variant={row.condition === "expired" ? "destructive" : "secondary"}>{row.condition}</Badge></TableCell>
                  <TableCell className="text-right">{formatUnits(row.units, row.unitsPerCarton)}</TableCell>
                  <TableCell className="text-right">{formatRupees(row.value)}</TableCell>
                  <TableCell className="text-right">{row.units > 0 ? formatRupees(new Big(row.value).div(row.units).toFixed(2)) : "—"}</TableCell>
                  {canDispose && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={row.units === 0} onClick={() => setValuing(row)}>Set value</Button>
                        <Button size="sm" disabled={row.units === 0} onClick={() => setDisposing(row)}>Dispose</Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-label="Disposal history" className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg">History</h2>
        {movements.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing scrapped, sold or revalued yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Packs</TableHead>
                <TableHead className="text-right">Sale</TableHead>
                <TableHead className="text-right">Loss / gain</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Note</TableHead>
                {canDispose && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map(movement => (
                <TableRow key={movement.id} className={movement.voidedAt ? "opacity-60" : undefined}>
                  <TableCell>{format(new Date(movement.movementDate), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    {RETURNED_STOCK_MOVEMENT_LABELS[movement.kind as ReturnedStockMovementKind] ?? movement.kind}
                    {movement.voidedAt && <Badge variant="outline" className="ml-2">Voided</Badge>}
                  </TableCell>
                  <TableCell>{movement.recipeName} ({movement.condition}), {movement.warehouseName}</TableCell>
                  <TableCell className="text-right">{movement.units || "—"}</TableCell>
                  <TableCell className="text-right">
                    {movement.saleAmount ? `${formatRupees(movement.saleAmount)}${movement.walletName ? ` → ${movement.walletName}` : ""}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(movement.lossAmount) < 0
                      ? <span className="text-emerald-600 dark:text-emerald-400">Gain {formatRupees(-Number(movement.lossAmount))}</span>
                      : formatRupees(movement.lossAmount)}
                  </TableCell>
                  <TableCell>{movement.performedByName ?? "—"}</TableCell>
                  <TableCell>{movement.voidedAt ? `Voided: ${movement.voidReason ?? ""}` : movement.note ?? ""}</TableCell>
                  {canDispose && (
                    <TableCell className="text-right">
                      {!movement.voidedAt && <Button size="sm" variant="ghost" onClick={() => setVoiding(movement)}>Void</Button>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {disposing && <DisposeReturnedStockDialog row={disposing} onClose={() => setDisposing(null)} />}
      {valuing && <SetReturnedStockValueDialog row={valuing} onClose={() => setValuing(null)} />}
      {voiding && <VoidMovementDialog movement={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}

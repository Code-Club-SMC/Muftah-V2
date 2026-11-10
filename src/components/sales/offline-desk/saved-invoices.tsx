import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OfflineDeskEntry } from "@/lib/sales/offline/desk-pack";
import { formatPKR } from "@/lib/currency-format";

const statusLabel: Record<OfflineDeskEntry["status"], string> = {
  saved: "Saved, not printed",
  printed: "Printed",
  sent: "Sent to office",
  cancelled: "Cancelled",
};

export function SavedInvoices({
  entries,
  onPrint,
  onEdit,
  onDelete,
  onCancel,
}: {
  entries: OfflineDeskEntry[];
  onPrint: (entry: OfflineDeskEntry) => void;
  onEdit: (entry: OfflineDeskEntry) => void;
  onDelete: (entry: OfflineDeskEntry) => void;
  onCancel: (entry: OfflineDeskEntry) => void;
}) {
  const sorted = [...entries].sort((a, b) => b.reservedSerial - a.reservedSerial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices on this computer</CardTitle>
        <CardDescription>
          A printed invoice is locked. Only an invoice that was never printed can be changed or deleted; a printed
          one can be cancelled and keeps its number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No invoices yet</EmptyTitle>
              <EmptyDescription>Invoices you save while offline appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((entry) => (
                <TableRow key={entry.slotNumber}>
                  <TableCell>
                    <p className="font-mono text-xs">{entry.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.saleDate} {entry.saleTime}
                    </p>
                  </TableCell>
                  <TableCell>{entry.customerName || "—"}</TableCell>
                  <TableCell className="text-right">{formatPKR(entry.invoiceAmount, false)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.status === "cancelled"
                          ? "destructive"
                          : entry.status === "sent"
                            ? "secondary"
                            : entry.status === "printed"
                              ? "outline"
                              : "default"
                      }
                    >
                      {statusLabel[entry.status]}
                    </Badge>
                    {entry.cancelled && <p className="mt-1 text-xs text-muted-foreground">{entry.cancelled.reason}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {entry.status !== "cancelled" && (
                        <Button size="sm" variant="outline" onClick={() => onPrint(entry)}>
                          {entry.printedAt ? "Reprint" : "Print"}
                        </Button>
                      )}
                      {entry.status === "printed" && (
                        <Button size="sm" variant="destructive" onClick={() => onCancel(entry)}>
                          Cancel
                        </Button>
                      )}
                      {entry.status === "saved" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
                            Change
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => onDelete(entry)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

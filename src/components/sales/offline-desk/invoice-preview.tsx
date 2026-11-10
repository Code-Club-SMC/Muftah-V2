import { useMemo } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { DistributorInvoiceView } from "@/components/sales/distributor-invoice";
import { RetailerInvoiceView } from "@/components/sales/retailer-invoice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { OfflineDeskEntry, OfflineDeskPack } from "@/lib/sales/offline/desk-pack";
import { buildOfflinePrintData } from "./print-data";

/**
 * Shows the same invoice layouts the online system prints. Press the Print
 * button inside the invoice to print it.
 */
export function InvoicePreview({
  entry,
  pack,
  allEntries,
  reprint,
  onClose,
}: {
  entry: OfflineDeskEntry | null;
  pack: OfflineDeskPack;
  allEntries: OfflineDeskEntry[];
  reprint: boolean;
  onClose: () => void;
}) {
  const printable = useMemo(
    () => (entry ? buildOfflinePrintData(entry, pack, allEntries) : null),
    [entry, pack, allEntries],
  );

  return (
    <ResponsiveDialog
      title={entry ? `Print ${entry.invoiceNumber}` : "Print invoice"}
      description="Same layout as the online invoice. Press Print inside the invoice."
      open={Boolean(entry)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="lg:min-w-[80vw]"
      noScroll
    >
      {entry && printable && (
        <div className="flex flex-col gap-4 p-1">
          {reprint && (
            <Alert>
              <AlertDescription>
                This invoice was printed before. Hand over only one copy and keep it on file.
              </AlertDescription>
            </Alert>
          )}
          <div className="max-h-[70vh] min-h-[400px] flex-1 overflow-auto border bg-gray-50 p-4 dark:bg-zinc-900">
            {printable.kind === "distributor" ? (
              <DistributorInvoiceView invoice={printable.data} showActions />
            ) : (
              <RetailerInvoiceView invoice={printable.data} showActions />
            )}
          </div>
          <div className="flex justify-end border-t pt-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </ResponsiveDialog>
  );
}

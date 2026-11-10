import { useState } from "react";
import type { ChemicalPurchaseRef } from "@/lib/inventory/chemical-report-contract";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateLabReportForm } from "./create-lab-report-form";

export function PurchaseReportPrompt({
  purchase,
  onClose,
}: {
  purchase: ChemicalPurchaseRef | null;
  onClose(): void;
}) {
  const { data: viewer } = useViewerAccess();
  if (
    !purchase ||
    !hasPermission(viewer?.permissions ?? [], "inventory.manage") ||
    !hasPermission(viewer?.permissions ?? [], "inventory.view")
  )
    return null;
  return (
    <Prompt key={purchase.purchaseId} purchase={purchase} onClose={onClose} />
  );
}

function Prompt({
  purchase,
  onClose,
}: {
  purchase: ChemicalPurchaseRef;
  onClose(): void;
}) {
  const [creating, setCreating] = useState(false);
  if (creating)
    return (
      <CreateLabReportForm
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        chemicalId={purchase.chemicalId}
        chemicalName={purchase.chemicalName}
        purchaseId={purchase.purchaseId}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Purchase saved. Add a lab report?</DialogTitle>
          <DialogDescription>
            {purchase.chemicalName}, purchase {purchase.purchaseId}. You can
            create its certificate now or add it later from missing reports. The
            purchase is already saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Later
          </Button>
          <Button onClick={() => setCreating(true)}>Create report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

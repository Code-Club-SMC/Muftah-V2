import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Minus, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { getFailedProductionChemicalRecoveryContextFn } from "@/server-functions/inventory/stock/get-failed-production-chemical-recovery-context-fn";
import { useAdjustStock } from "@/hooks/stock/use-adjust-stock";
import { useRecoverFailedProductionChemical } from "@/hooks/stock/use-recover-failed-production-chemical";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

type AdjustStockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialType: "chemical" | "packaging";
  materialId: string;
  materialName: string;
  currentStock: number;
  unit: string;
};

type FailedBatchRecoveryContext = Awaited<
  ReturnType<typeof getFailedProductionChemicalRecoveryContextFn>
>;

export const AdjustStockDialog = ({
  open,
  onOpenChange,
  materialType,
  materialId,
  materialName,
  currentStock,
  unit,
}: AdjustStockDialogProps) => {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [batchId, setBatchId] = useState("");
  const [recoveryContext, setRecoveryContext] =
    useState<FailedBatchRecoveryContext | null>(null);

  const { data: viewerAccess } = useViewerAccess();
  const canManageInventory = viewerAccess
    ? hasPermission(viewerAccess.permissions, "inventory.manage")
    : false;
  const canRecoverFailedBatch = viewerAccess
    ? canManageInventory ||
      hasPermission(viewerAccess.permissions, "operator.run.fail")
    : false;

  const adjustStock = useAdjustStock();
  const recoverFailedChemical = useRecoverFailedProductionChemical();
  const recoveryLookup = useMutation({
    mutationFn: getFailedProductionChemicalRecoveryContextFn,
    onSuccess: (result) => {
      setRecoveryContext(result);

      if (result.alreadySettled) {
        toast.error("This failed batch chemical is already settled.");
        return;
      }

      toast.success(
        `Failed batch ${result.batchId} validated for ${result.chemicalName}.`,
      );
    },
    onError: (error: Error) => {
      setRecoveryContext(null);
      toast.error(error.message || "Failed batch validation failed.");
    },
  });

  const resetState = () => {
    setMode("add");
    setAmount("");
    setReason("");
    setBatchId("");
    setRecoveryContext(null);
  };

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open]);

  useEffect(() => {
    if (mode === "remove") {
      setBatchId("");
      setRecoveryContext(null);
    }
  }, [mode]);

  const numericAmount = amount === "" ? Number.NaN : Number(amount);
  const isChemicalRecoveryFlow =
    materialType === "chemical" &&
    mode === "add" &&
    canRecoverFailedBatch &&
    recoveryContext !== null;
  const isSettledRecovery = !!recoveryContext?.alreadySettled;
  const recoveryAmountValid =
    amount !== "" &&
    Number.isFinite(numericAmount) &&
    numericAmount >= 0 &&
    numericAmount <= (recoveryContext?.expectedQuantity ?? 0);
  const genericAmountValid = Number.isFinite(numericAmount) && numericAmount > 0;
  const projectedQty =
    currentStock +
    (mode === "add"
      ? Number.isFinite(numericAmount)
        ? numericAmount
        : 0
      : Number.isFinite(numericAmount)
        ? -numericAmount
        : 0);
  const recoveryLossQty = recoveryContext
    ? Math.max(
        0,
        recoveryContext.expectedQuantity -
          (Number.isFinite(numericAmount) ? numericAmount : 0),
      )
    : 0;
  const recoveryLossAmount = recoveryContext
    ? Number((recoveryLossQty * recoveryContext.costPerUnit).toFixed(2))
    : 0;

  const handleValidateBatch = () => {
    if (!batchId.trim()) {
      toast.error("Batch ID is required.");
      return;
    }

    recoveryLookup.mutate({
      data: {
        batchId: batchId.trim(),
        chemicalId: materialId,
      },
    });
  };

  const closeDialog = () => {
    onOpenChange(false);
  };

  const handleSubmit = () => {
    if (!reason.trim()) {
      toast.error("Reason is required.");
      return;
    }

    if (isChemicalRecoveryFlow) {
      if (!recoveryContext || isSettledRecovery) {
        toast.error("This failed batch chemical is already settled.");
        return;
      }

      if (!recoveryAmountValid) {
        toast.error(
          `Recovered quantity must be between 0 and ${recoveryContext.expectedQuantity.toFixed(3)} ${recoveryContext.chemicalUnit}.`,
        );
        return;
      }

      recoverFailedChemical.mutate(
        {
          data: {
            batchId: batchId.trim(),
            chemicalId: materialId,
            recoveredQuantity: numericAmount,
            reason: reason.trim(),
          },
        },
        {
          onSuccess: (result) => {
            toast.success(
              `${result.chemicalName}: ${result.recoveredQuantity.toFixed(3)} ${result.chemicalUnit} returned, ${result.lossQuantity.toFixed(3)} ${result.chemicalUnit} expensed.`,
            );
            closeDialog();
          },
        },
      );
      return;
    }

    if (!canManageInventory) {
      toast.error(
        "Only failed-batch chemical recovery is allowed for your access level.",
      );
      return;
    }

    if (!genericAmountValid) {
      toast.error("Please enter a valid positive quantity.");
      return;
    }

    if (mode === "remove" && numericAmount > currentStock) {
      toast.error(
        `Cannot remove ${numericAmount} ${unit}. Only ${currentStock.toFixed(2)} ${unit} available.`,
      );
      return;
    }

    adjustStock.mutate(
      {
        data: {
          materialType,
          materialId,
          adjustment: mode === "add" ? numericAmount : -numericAmount,
          reason: reason.trim(),
        },
      },
      {
        onSuccess: (result) => {
          toast.success(
            `Stock adjusted: ${materialName} ${mode === "add" ? "+" : "-"}${numericAmount} ${unit}. New stock: ${result.newQty.toFixed(2)} ${unit}`,
          );
          closeDialog();
        },
      },
    );
  };

  const submitPending =
    adjustStock.isPending ||
    recoverFailedChemical.isPending ||
    recoveryLookup.isPending;
  const submitDisabled = isChemicalRecoveryFlow
    ? !reason.trim() || !recoveryAmountValid || isSettledRecovery || submitPending
    : !canManageInventory || !reason.trim() || !genericAmountValid || submitPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Stock Adjustment
          </DialogTitle>
          <DialogDescription>
            Adjust stock for <strong>{materialName}</strong> on the factory
            floor. Failed-batch chemical recovery is allowed only when the run
            was marked failed before any operator output was logged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <span className="text-sm font-medium text-muted-foreground">
              Current Stock
            </span>
            <span className="text-lg font-bold tabular-nums">
              {currentStock.toFixed(2)}{" "}
              <span className="text-xs text-muted-foreground">{unit}</span>
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "add" ? "default" : "outline"}
              className={`flex-1 ${mode === "add" ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
              onClick={() => setMode("add")}
            >
              <Plus className="mr-1 size-4" />
              Add Back
            </Button>
            <Button
              type="button"
              variant={mode === "remove" ? "default" : "outline"}
              className={`flex-1 ${mode === "remove" ? "bg-red-600 hover:bg-red-700" : ""}`}
              onClick={() => setMode("remove")}
              disabled={!canManageInventory}
            >
              <Minus className="mr-1 size-4" />
              Remove
            </Button>
          </div>

          {materialType === "chemical" && mode === "add" && canRecoverFailedBatch ? (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    Failed Batch Recovery
                  </p>
                  <p className="text-xs text-amber-800/80">
                    Enter failed batch ID. Run must be failed and have zero
                    operator logs.
                  </p>
                </div>
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  Chemicals Only
                </Badge>
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Search batch ID"
                  value={batchId}
                  onChange={(e) => {
                    setBatchId(e.target.value);
                    setRecoveryContext(null);
                  }}
                  className="bg-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleValidateBatch}
                  disabled={!batchId.trim() || recoveryLookup.isPending}
                  className="shrink-0"
                >
                  {recoveryLookup.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                </Button>
              </div>

              {recoveryContext ? (
                <div
                  className={`space-y-2 rounded-md border p-3 ${
                    recoveryContext.alreadySettled
                      ? "border-rose-200 bg-rose-50"
                      : "border-emerald-200 bg-emerald-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        recoveryContext.alreadySettled
                          ? "border-rose-300 text-rose-700"
                          : "border-emerald-300 text-emerald-700"
                      }
                    >
                      {recoveryContext.batchId}
                    </Badge>
                    <span className="text-xs font-medium text-foreground/80">
                      {recoveryContext.productName} / {recoveryContext.recipeName}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Chemical</span>
                      <p className="font-semibold">{recoveryContext.chemicalName}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Max recoverable</span>
                      <p className="font-semibold">
                        {recoveryContext.expectedQuantity.toFixed(3)}{" "}
                        {recoveryContext.chemicalUnit}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cost / unit</span>
                      <p className="font-semibold">
                        PKR {recoveryContext.costPerUnit.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Settlement</span>
                      <p className="font-semibold">
                        {recoveryContext.alreadySettled
                          ? `Done on ${new Date(
                              recoveryContext.settledAt!,
                            ).toLocaleDateString("en-GB")}`
                          : "Pending"}
                      </p>
                    </div>
                  </div>
                  {!recoveryContext.alreadySettled ? (
                    <p className="text-xs text-emerald-800/90">
                      Any quantity not returned to stock is posted as a
                      non-cash expense in reports.
                    </p>
                  ) : (
                    <p className="text-xs text-rose-800/90">
                      This failed batch chemical already has a recovery/loss
                      settlement and cannot be posted again.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {!canManageInventory && !(materialType === "chemical" && mode === "add") ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              Your access allows failed-batch chemical recovery only.
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>
              {isChemicalRecoveryFlow
                ? `Recovered Quantity (${unit})`
                : `Quantity (${unit})`}
            </Label>
            <Input
              type="number"
              placeholder={
                isChemicalRecoveryFlow
                  ? `0 to ${recoveryContext?.expectedQuantity.toFixed(3) ?? "0"}`
                  : `Enter ${unit} to ${mode}`
              }
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="any"
              min={isChemicalRecoveryFlow ? "0" : "0.001"}
              className="h-11 font-mono text-lg"
            />
            {amount ? (
              <p className="text-xs text-muted-foreground">
                {isChemicalRecoveryFlow ? (
                  <>
                    Stock returned:{" "}
                    <strong className="text-emerald-600">
                      {Number.isFinite(numericAmount) ? numericAmount.toFixed(3) : "0.000"} {unit}
                    </strong>
                    . Expense recognized:{" "}
                    <strong className="text-rose-600">
                      {recoveryLossQty.toFixed(3)} {unit} / PKR{" "}
                      {recoveryLossAmount.toFixed(2)}
                    </strong>
                    .
                  </>
                ) : (
                  <>
                    New stock will be:{" "}
                    <strong
                      className={mode === "add" ? "text-emerald-600" : "text-red-600"}
                    >
                      {projectedQty.toFixed(2)} {unit}
                    </strong>
                    .
                  </>
                )}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>
              Reason{" "}
              <Badge variant="destructive" className="ml-1 text-[9px]">
                Required
              </Badge>
            </Label>
            <Textarea
              placeholder={
                isChemicalRecoveryFlow
                  ? "e.g., Failed batch AB1042 recovered from reactor cleanup; remaining chemical was spoiled."
                  : "e.g., Machine breakdown, cleanup spill, verified manual correction."
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <div className="rounded-md border border-amber-100 bg-amber-50/60 p-3 text-xs text-muted-foreground">
            All adjustments are permanently logged with your name, reason, and
            batch reference when applicable.
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitDisabled}
            className={
              mode === "add"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-red-600 hover:bg-red-700"
            }
          >
            {submitPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving...
              </>
            ) : isChemicalRecoveryFlow ? (
              "Settle Failed Batch"
            ) : mode === "add" ? (
              "Add Stock"
            ) : (
              "Remove Stock"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

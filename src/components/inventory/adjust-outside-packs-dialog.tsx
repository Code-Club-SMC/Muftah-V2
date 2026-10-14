import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateOutsidePackStockFn } from "@/server-functions/inventory/stock/update-stock-fn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AdjustOutsidePacksDialog({
  stockId,
  name,
  currentCount,
  onClose,
}: {
  stockId: string;
  name: string;
  currentCount: number;
  onClose: () => void;
}) {
  const [count, setCount] = useState(String(currentCount));
  const [reason, setReason] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: updateOutsidePackStockFn,
    retry: false,
    onSuccess: async () => {
      await Promise.all(
        [
          "factory-floor",
          "inventory",
          "warehouses",
          "cartons",
          "carton-availability",
          "item-detail",
          "consumption-history",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      toast.success(
        "Loose pack count corrected. The change is recorded in stock history.",
      );
      onClose();
    },
  });
  const validCount =
    /^\d+$/.test(count) &&
    Number.isSafeInteger(Number(count)) &&
    Number(count) <= 2147483647;
  const changed = validCount && Number(count) !== currentCount;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct loose pack count</DialogTitle>
          <DialogDescription>
            {name}. Count only sealed packs outside cartons. This adjustment and
            your reason will be saved in stock history.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (changed && reason.trim() && !mutation.isPending)
              mutation.mutate({
                data: {
                  stockId,
                  adjustmentType: "set",
                  quantity: Number(count),
                  expectedCurrent: currentCount,
                  reason: reason.trim(),
                },
              });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Recorded loose packs:{" "}
            <strong className="tabular-nums text-foreground">
              {currentCount.toLocaleString()}
            </strong>
          </p>
          <FieldGroup>
            <Field data-invalid={!validCount}>
              <FieldLabel htmlFor="outside-count">
                Actual loose packs counted
              </FieldLabel>
              <Input
                id="outside-count"
                inputMode="numeric"
                value={count}
                disabled={mutation.isPending}
                className="h-12"
                aria-invalid={!validCount}
                aria-describedby="outside-count-help"
                onChange={(event) => setCount(event.target.value)}
              />
              <FieldDescription id="outside-count-help">
                Enter a whole number, zero or more.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="outside-reason">
                Reason for correction
              </FieldLabel>
              <Textarea
                id="outside-reason"
                value={reason}
                disabled={mutation.isPending}
                maxLength={500}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {changed && (
            <p className="text-sm">
              This will {Number(count) > currentCount ? "add" : "remove"}{" "}
              <strong>
                {Math.abs(Number(count) - currentCount).toLocaleString()}
              </strong>{" "}
              loose packs.
            </p>
          )}
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!changed || !reason.trim() || mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

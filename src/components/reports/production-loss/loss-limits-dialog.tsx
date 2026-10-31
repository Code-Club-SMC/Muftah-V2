import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatReportTimestamp } from "@/lib/report-dates";
import { isValidLossLimit, LOSS_LIMIT_ERROR, LOSS_LIMIT_KEYS, LOSS_LIMIT_LABELS, type LossLimits } from "@/lib/production/loss-report";
import { updateLossLimitsFn } from "@/server-functions/reports/production-loss-fn";

export function LossLimitsDialog({ open, onOpenChange, limits, updatedAt, updatedBy }: {
  open: boolean; onOpenChange: (open: boolean) => void; limits: LossLimits; updatedAt: string | null; updatedBy: string | null;
}) {
  const [draft, setDraft] = useState<LossLimits>(limits);
  useEffect(() => { if (open) setDraft(limits); }, [open, limits]);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => updateLossLimitsFn({ data: draft }),
    onSuccess: () => {
      toast.success("Loss limits saved");
      void queryClient.invalidateQueries({ queryKey: ["reports", "production-loss"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save loss limits"),
  });
  const invalid = LOSS_LIMIT_KEYS.some((key) => !isValidLossLimit(draft[key]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Loss limits</DialogTitle>
          <DialogDescription>Rows with loss % above the limit show red. Changing a limit doesn't change saved data.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {LOSS_LIMIT_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <Label htmlFor={`limit-${key}`}>{LOSS_LIMIT_LABELS[key]}</Label>
              <div className="flex items-center gap-1.5">
                <Input id={`limit-${key}`} inputMode="decimal" className="w-20 text-right" value={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ))}
          {invalid && <p className="text-sm text-destructive">{LOSS_LIMIT_ERROR}</p>}
          <p className="text-xs text-muted-foreground">
            {updatedAt ? `Last changed by ${updatedBy ?? "someone"} on ${formatReportTimestamp(updatedAt)}` : "Not changed yet. Every limit starts at 10%."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

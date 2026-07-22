import { useState, useEffect } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOverrideBradford } from "@/hooks/hr/use-override-bradford";
import { Loader2, ShieldAlert, AlertTriangle } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payslipId: string;
  currentScore: string | null;
};

export const OverrideBradfordDialog = ({
  open,
  onOpenChange,
  payslipId,
  currentScore,
}: Props) => {
  const [score, setScore] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const mutate = useOverrideBradford();

  useEffect(() => {
    if (open) {
      setScore(currentScore || "");
      setReason("");
    }
  }, [open, currentScore]);

  const handleSave = async () => {
    if (!reason.trim() || reason.trim().length < 5) return;

    const val = score.trim() === "" ? null : score.trim();
    await mutate.mutateAsync(
      { payslipId, overrideScore: val, reason: reason.trim() },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const isReasonValid = reason.trim().length >= 5;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Override Bradford Factor"
      description="Manually adjust the Bradford Factor score. This action is audited."
      icon={ShieldAlert}
    >
      <div className="space-y-4 py-4">
        {/* Warning Banner */}
        <div className="flex items-start gap-3 p-3 rounded-xl border-2 border-amber-200/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black uppercase tracking-tight text-amber-700 dark:text-amber-400 mb-0.5">
              Audited Action
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This override will be permanently logged with your name, the
              computed score, and your justification. Only super-admins may
              perform this action.
            </p>
          </div>
        </div>

        {/* Score Input */}
        <div className="flex flex-col space-y-2">
          <label className="text-sm font-semibold text-foreground">
            New Score
          </label>
          <Input
            type="number"
            placeholder="e.g. 50 (leave empty to reset to computed)"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            Leaving this blank will remove the override and revert to the
            system-calculated score.
          </p>
        </div>

        {/* Reason Input (mandatory) */}
        <div className="flex flex-col space-y-2">
          <label className="text-sm font-semibold text-foreground">
            Justification <span className="text-rose-500">*</span>
          </label>
          <Textarea
            placeholder="Explain why you are overriding the computed Bradford Factor..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="resize-none"
          />
          {reason.length > 0 && !isReasonValid && (
            <p className="text-xs text-rose-500 font-medium">
              Justification must be at least 5 characters.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutate.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={mutate.isPending || !isReasonValid}
          >
            {mutate.isPending ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : null}
            Save & Log Override
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
};

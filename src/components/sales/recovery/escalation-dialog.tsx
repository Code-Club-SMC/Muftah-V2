import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { EscalationLadder } from "./escalation-ladder";

type Direction = "escalate" | "deEscalate";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: Direction | null;
  currentLevel: number;
  labels: Record<number, string> | undefined;
  onConfirm: (reason: string) => void;
  isPending: boolean;
};

export function EscalationDialog({
  open,
  onOpenChange,
  direction,
  currentLevel,
  labels,
  onConfirm,
  isPending,
}: Props) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!direction) return null;

  const isEscalate = direction === "escalate";
  const targetLevel = isEscalate ? currentLevel + 1 : currentLevel - 1;
  const atMax = isEscalate && currentLevel >= 3;
  const atMin = !isEscalate && currentLevel <= 0;
  const blocked = atMax || atMin;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEscalate ? (
              <ChevronUp className="size-5 text-orange-600" />
            ) : (
              <ChevronDown className="size-5 text-blue-600" />
            )}
            {isEscalate ? "Escalate Recovery" : "De-escalate Recovery"}
          </DialogTitle>
          <DialogDescription>
            {blocked
              ? isEscalate
                ? "This slip is already at the maximum escalation level."
                : "This slip is at the minimum escalation level."
              : isEscalate
                ? `Move this slip from L${currentLevel} to L${targetLevel}.`
                : `Reduce this slip from L${currentLevel} to L${targetLevel}.`}
          </DialogDescription>
        </DialogHeader>

        {!blocked && (
          <div className="py-2">
            <EscalationLadder currentLevel={targetLevel} labels={labels} />
            <p className="text-center text-xs font-semibold mt-3 text-muted-foreground">
              Target:{" "}
              <span className="text-foreground">
                L{targetLevel} — {labels?.[targetLevel] ?? `Level ${targetLevel}`}
              </span>
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="escalation-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="escalation-reason"
            placeholder={
              isEscalate
                ? "Why is this slip being escalated? (e.g., no response after 3 calls)"
                : "Why is this slip being de-escalated? (e.g., customer made partial payment)"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            disabled={blocked}
            className="resize-none"
          />
        </div>

        {isEscalate && targetLevel === 3 && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40 p-2.5">
            <AlertTriangle className="size-4 text-red-600 mt-0.5 shrink-0" />
            <p className="text-xs text-red-800 dark:text-red-300">
              Level 3 typically indicates legal/default action. Confirm
              thoroughly before proceeding.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setReason("");
              onOpenChange(false);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant={isEscalate ? "destructive" : "default"}
            onClick={() => onConfirm(reason.trim())}
            disabled={isPending || blocked || !reason.trim()}
          >
            {isEscalate ? (
              <>
                <ChevronUp className="size-4 mr-1" />
                Confirm Escalation
              </>
            ) : (
              <>
                <ChevronDown className="size-4 mr-1" />
                Confirm De-escalation
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

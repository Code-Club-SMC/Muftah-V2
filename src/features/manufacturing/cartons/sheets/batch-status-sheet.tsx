import { useState } from "react";
import { Lock, Unlock, Loader2, AlertCircle } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCloseBatch, useReopenBatch } from "../hooks/use-carton-mutations";
import { cn } from "@/lib/utils";

type CloseProps = {
  mode: "close";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
};

type ReopenProps = {
  mode: "reopen";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
};

type Props = CloseProps | ReopenProps;

export function BatchStatusSheet(props: Props) {
  if (props.mode === "close") {
    return <CloseBatchSheet {...props} />;
  }
  return <ReopenBatchSheet {...props} />;
}

function CloseBatchSheet({ open, onOpenChange, batchId }: CloseProps) {
  const [reason, setReason] = useState("");
  const [acknowledgeShortfall, setAcknowledgeShortfall] = useState(false);
  const mutation = useCloseBatch();

  const handleSubmit = () => {
    mutation.mutate(
      { productionRunId: batchId, acknowledgeShortfall },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason("");
          setAcknowledgeShortfall(false);
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Close Production Batch"
      description="Apply operational lock"
      icon={Lock}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={reason !== ""}
    >
      <div className="flex flex-col gap-8 py-6">
        {/* Risk/Warning Card */}
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="size-3 text-destructive" />
            <p className="text-[10px] font-black uppercase tracking-widest text-destructive">Finalize & Seal</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Closing this batch will freeze all carton quantities and statuses. This is a permanent record update for inventory audits.
          </p>
        </div>

        <div className="grid gap-6">
          <div className="space-y-2">
            <Label htmlFor="reason" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Finalization Statement
            </Label>
            <Textarea
              id="reason"
              placeholder="Record any final observations or closing justifications..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none min-h-[120px] bg-muted/10 focus:bg-background transition-colors"
            />
          </div>

          <label className="flex items-start gap-4 p-4 rounded-lg border border-border bg-muted/5 hover:bg-muted/10 cursor-pointer transition-all group">
            <div className="pt-1">
              <input
                type="checkbox"
                checked={acknowledgeShortfall}
                onChange={(e) => setAcknowledgeShortfall(e.target.checked)}
                className="size-4 rounded border-muted-foreground/30 accent-primary"
              />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-bold text-foreground block group-hover:text-primary transition-colors">Yield Acknowledgment</span>
              <span className="text-[11px] text-muted-foreground leading-relaxed block">
                I acknowledge the current yield and fill rate as the final production output for this batch.
              </span>
            </div>
          </label>
        </div>

        <div className="pt-4 mt-auto">
          <Button
            size="lg"
            variant="destructive"
            className="w-full h-12 font-bold uppercase tracking-widest text-xs shadow-lg shadow-destructive/10"
            onClick={handleSubmit}
            disabled={mutation.isPending || !reason.trim()}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Sealing Batch...
              </>
            ) : (
              "Confirm & Close Batch"
            )}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function ReopenBatchSheet({ open, onOpenChange, batchId }: ReopenProps) {
  const [reason, setReason] = useState("");
  const mutation = useReopenBatch();

  const handleSubmit = () => {
    mutation.mutate(
      { productionRunId: batchId, reopenReason: reason },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Unlock Production Batch"
      description="Restore operational access"
      icon={Unlock}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={reason !== ""}
    >
      <div className="flex flex-col gap-8 py-6">
        {/* Warning Card */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Unlock className="size-3 text-amber-600" />
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Active Reconciliation</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Reopening a batch allows manual inventory adjustments. Ensure all changes are properly audited and verified.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Justification for Reopening
          </Label>
          <Textarea
            id="reason"
            placeholder="e.g. Correcting reporting discrepancy in carton #42"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="resize-none min-h-[150px] bg-muted/10 focus:bg-background transition-colors"
          />
        </div>

        <div className="pt-4 mt-auto">
          <Button
            size="lg"
            className="w-full h-12 font-bold uppercase tracking-widest text-xs"
            onClick={handleSubmit}
            disabled={mutation.isPending || !reason.trim()}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Unlocking...
              </>
            ) : (
              "Confirm Reopen"
            )}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
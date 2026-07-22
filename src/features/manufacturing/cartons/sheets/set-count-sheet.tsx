import { useState } from "react";
import { PenLine, Loader2, AlertCircle } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSetCartonCount } from "../hooks/use-carton-mutations";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonId: string;
  batchId: string;
  currentPacks: number;
  capacity: number;
  sku: string | null;
};

export function SetCountSheet({ open, onOpenChange, cartonId, batchId, currentPacks, capacity, sku }: Props) {
  const [newCount, setNewCount] = useState(currentPacks);
  const [reason, setReason] = useState("");
  const mutation = useSetCartonCount(cartonId, batchId);

  const isDirty = newCount !== currentPacks;
  const delta = newCount - currentPacks;
  const overLimit = newCount > capacity;

  const handleSubmit = () => {
    mutation.mutate(
      { newCount, reason },
      {
        onSuccess: () => {
          onOpenChange(false);
          setNewCount(currentPacks);
          setReason("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Override Count"
      description={`Set exact pack count for carton${sku ? ` ${sku}` : ""}`}
      icon={PenLine}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={isDirty}
      confirmCloseTitle="Discard count override?"
      confirmCloseDescription="The new count will not be saved."
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5 flex flex-col gap-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Current quantity</span>
            <span className="font-semibold tabular-nums text-foreground">{currentPacks}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Capacity</span>
            <span className="font-semibold tabular-nums text-foreground">{capacity}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="newCount" className="text-sm font-medium text-foreground">
            New count
          </Label>
          <Input
            id="newCount"
            type="number"
            min={0}
            max={capacity}
            value={newCount}
            onChange={(e) => setNewCount(Math.max(0, parseInt(e.target.value) || 0))}
            className={cn(
              "h-10 font-semibold",
              overLimit && "border-destructive focus-visible:ring-destructive/20"
            )}
          />
          {overLimit && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="size-3.5 shrink-0" />
              Exceeds carton capacity.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="reason" className="text-sm font-medium text-foreground">
            Reason for override
          </Label>
          <Textarea
            id="reason"
            placeholder="e.g. Physical inventory correction"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>

        {isDirty && (
          <div 
            className={cn(
              "rounded-xl border px-4 py-3.5 flex justify-between text-sm",
              delta > 0 
                ? "border-green-200 dark:border-green-900 bg-green-50/60 dark:bg-green-950/20" 
                : "border-destructive/20 bg-destructive/5"
            )}
          >
            <span className={cn(delta > 0 ? "text-green-700 dark:text-green-400" : "text-destructive")}>
              Variance
            </span>
            <span className={cn("font-semibold tabular-nums", delta > 0 ? "text-green-700 dark:text-green-400" : "text-destructive")}>
              {delta > 0 ? "+" : ""}{delta} packs
            </span>
          </div>
        )}

        <Button
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending || !isDirty || overLimit}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Overriding…
            </>
          ) : (
            `Set count to ${newCount}`
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
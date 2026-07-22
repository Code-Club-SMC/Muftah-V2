import { useState } from "react";
import { PackagePlus, Loader2, AlertCircle } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTopUpCarton } from "../hooks/use-carton-mutations";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonId: string;
  batchId: string;
  currentPacks: number;
  capacity: number;
  sku: string | null;
};

export function TopUpSheet({ open, onOpenChange, cartonId, batchId, currentPacks, capacity, sku }: Props) {
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("");
  const mutation = useTopUpCarton(cartonId, batchId);

  const maxAdd = capacity - currentPacks;
  const isDirty = delta !== 1 || reason !== "";
  const overLimit = delta > maxAdd;
  const newTotal = currentPacks + (overLimit ? 0 : delta);
  const progressPercent = (newTotal / capacity) * 100;

  const handleSubmit = () => {
    mutation.mutate(
      { delta, reason: reason || undefined },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDelta(1);
          setReason("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Top-Up Packs"
      description={sku || "Add packs to carton"}
      icon={PackagePlus}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={isDirty}
    >
      <div className="flex flex-col gap-8 py-6">
        {/* Status Card */}
        <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-1">Current Fill</p>
              <h3 className="text-2xl font-bold tracking-tighter tabular-nums">
                {currentPacks} <span className="text-muted-foreground/40 font-medium text-lg">/ {capacity}</span>
              </h3>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-1">Available</p>
              <p className="text-lg font-bold text-emerald-600 tracking-tight tabular-nums">+{maxAdd}</p>
            </div>
          </div>

          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: `${(currentPacks / capacity) * 100}%` }}
              animate={{ width: `${progressPercent}%` }}
              className="h-full bg-emerald-500"
            />
          </div>
        </div>

        <div className="grid gap-6">
          <div className="space-y-2">
            <Label htmlFor="delta" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Quantity to Add
            </Label>
            <div className="relative">
              <Input
                id="delta"
                type="number"
                min={1}
                max={maxAdd}
                value={delta}
                onChange={(e) => setDelta(Math.max(1, parseInt(e.target.value) || 0))}
                className={cn(
                  "h-12 text-lg font-bold tabular-nums pl-4",
                  overLimit && "border-destructive focus-visible:ring-destructive/20"
                )}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground uppercase">
                Packs
              </div>
            </div>
            {overLimit && (
              <p className="text-[11px] font-medium text-destructive flex items-center gap-1.5 mt-1">
                <AlertCircle className="size-3.5" />
                Exceeds carton capacity by {delta - maxAdd} units
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Reason / Notes
            </Label>
            <Textarea
              id="reason"
              placeholder="e.g. Completing partial carton from previous run"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none min-h-[100px] bg-muted/20 focus:bg-background transition-colors"
            />
          </div>
        </div>

        <div className="pt-4 mt-auto">
          <Button
            size="lg"
            className="w-full h-12 font-bold uppercase tracking-widest text-xs"
            onClick={handleSubmit}
            disabled={mutation.isPending || overLimit || delta < 1}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Updating Carton…
              </>
            ) : (
              `Confirm Top-Up (+${delta})`
            )}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
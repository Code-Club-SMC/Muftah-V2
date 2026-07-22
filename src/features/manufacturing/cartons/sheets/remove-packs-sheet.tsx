import { useState } from "react";
import { PackageMinus, Loader2, AlertCircle } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRemovePacks } from "../hooks/use-carton-mutations";
import { REMOVAL_REASONS } from "@/lib/cartons/carton.types";
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

const reasonLabels: Record<string, string> = {
  QC_FAIL: "QC Failure",
  DAMAGED: "Damaged",
  TRANSFER: "Transfer Out",
  OTHER: "Other",
};

export function RemovePacksSheet({ open, onOpenChange, cartonId, batchId, currentPacks, capacity, sku }: Props) {
  const [packsToRemove, setPacksToRemove] = useState(1);
  const [reason, setReason] = useState<"QC_FAIL" | "DAMAGED" | "TRANSFER" | "OTHER">("OTHER");
  const [notes, setNotes] = useState("");
  const mutation = useRemovePacks(cartonId, batchId);

  const isDirty = packsToRemove !== 1 || notes !== "";
  const overLimit = packsToRemove > currentPacks;
  const newTotal = currentPacks - (overLimit ? 0 : packsToRemove);
  const progressPercent = (newTotal / capacity) * 100;

  const handleSubmit = () => {
    mutation.mutate(
      { delta: packsToRemove, reason, notes: notes || undefined },
      {
        onSuccess: () => {
          onOpenChange(false);
          setPacksToRemove(1);
          setReason("OTHER");
          setNotes("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Remove Packs"
      description={sku || "Reduce carton quantity"}
      icon={PackageMinus}
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
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-1">After Removal</p>
              <p className="text-lg font-bold text-destructive tracking-tight tabular-nums">
                {newTotal}
              </p>
            </div>
          </div>

          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: `${(currentPacks / capacity) * 100}%` }}
              animate={{ width: `${progressPercent}%` }}
              className="h-full bg-destructive/60"
            />
          </div>
        </div>

        <div className="grid gap-6">
          <div className="space-y-2">
            <Label htmlFor="packsToRemove" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Quantity to Remove
            </Label>
            <div className="relative">
              <Input
                id="packsToRemove"
                type="number"
                min={1}
                max={currentPacks}
                value={packsToRemove}
                onChange={(e) => setPacksToRemove(Math.max(1, parseInt(e.target.value) || 0))}
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
                Cannot remove more than {currentPacks} available packs
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason for Removal</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
              <SelectTrigger className="h-12 bg-muted/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMOVAL_REASONS.map((r) => (
                  <SelectItem key={r} value={r} className="font-medium">
                    {reasonLabels[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Audit Notes
            </Label>
            <Textarea
              id="notes"
              placeholder="Provide context for this manual adjustment..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none min-h-[80px] bg-muted/20 focus:bg-background transition-colors"
            />
          </div>
        </div>

        <div className="pt-4 mt-auto">
          <Button
            size="lg"
            variant="destructive"
            className="w-full h-12 font-bold uppercase tracking-widest text-xs"
            onClick={handleSubmit}
            disabled={mutation.isPending || overLimit || packsToRemove < 1}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Processing...
              </>
            ) : (
              `Remove ${packsToRemove} Pack${packsToRemove !== 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
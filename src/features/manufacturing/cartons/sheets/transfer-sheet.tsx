import { useState, useEffect } from "react";
import { ArrowRightLeft, Package, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTransferPacks, useCartonDetail } from "../hooks/use-carton-mutations";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  sourceCartonId: string;
  sourceSku: string | null;
  sourcePacks: number;
};

export function TransferSheet({
  open,
  onOpenChange,
  batchId,
  sourceCartonId,
  sourceSku,
  sourcePacks,
}: Props) {
  const [destinationCartonId, setDestinationCartonId] = useState("");
  const [debouncedId, setDebouncedId] = useState("");
  const [packCount, setPackCount] = useState(1);
  const mutation = useTransferPacks(batchId);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedId(destinationCartonId.trim()), 400);
    return () => clearTimeout(timer);
  }, [destinationCartonId]);

  const { data: targetCarton, isLoading, isError } = useCartonDetail(
    debouncedId && debouncedId !== sourceCartonId ? debouncedId : ""
  );

  const handleSubmit = () => {
    mutation.mutate(
      { sourceCartonId, destinationCartonId, packCount },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDestinationCartonId("");
          setPackCount(1);
        },
      }
    );
  };

  const isSameCatrton = debouncedId && debouncedId === sourceCartonId;
  const skuMismatch = targetCarton && sourceSku && targetCarton.sku !== sourceSku;
  const overLimit = packCount > sourcePacks;

  const canSubmit =
    !mutation.isPending &&
    destinationCartonId.trim() &&
    !isSameCatrton &&
    !skuMismatch &&
    !isError &&
    !overLimit &&
    !!targetCarton;

  const fillPercent = targetCarton
    ? Math.min(100, (targetCarton.currentPacks / targetCarton.capacity) * 100)
    : 0;

  return (
    <ResponsiveSheet
      title="Transfer Packs"
      description="Internal Stock Movement"
      icon={ArrowRightLeft}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={destinationCartonId !== "" || packCount !== 1}
    >
      <div className="flex flex-col gap-8 py-6">
        {/* Source Section */}
        <div className="rounded-lg border border-border bg-muted/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="size-1.5 rounded-full bg-muted-foreground/30" />
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Source Origin</p>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-lg font-bold tracking-tight text-foreground">{sourceSku ?? "General SKU"}</p>
              <p className="text-[11px] font-mono text-muted-foreground/60 uppercase tracking-widest">#{sourceCartonId.slice(-6).toUpperCase()}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tracking-tighter tabular-nums text-foreground">{sourcePacks}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Available</p>
            </div>
          </div>
        </div>

        {/* Destination Section */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="destinationCartonId" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Destination Unit ID
            </Label>
            <div className="relative">
              <Input
                id="destinationCartonId"
                placeholder="Scan or paste target ID"
                value={destinationCartonId}
                onChange={(e) => setDestinationCartonId(e.target.value)}
                autoComplete="off"
                className={cn(
                  "h-12 font-mono text-sm pr-12 bg-muted/10 focus:bg-background transition-all",
                  isSameCatrton && "border-amber-500 ring-amber-500/10",
                  (isError || skuMismatch) && "border-destructive ring-destructive/10",
                  targetCarton && !skuMismatch && "border-emerald-600 ring-emerald-500/10"
                )}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                {isLoading && (
                  <Loader2 className="size-4 text-muted-foreground animate-spin" />
                )}
                {targetCarton && !skuMismatch && !isLoading && (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                )}
                {(isError || skuMismatch) && !isLoading && (
                  <AlertCircle className="size-4 text-destructive" />
                )}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {isSameCatrton && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-[11px] font-medium text-amber-600 flex items-center gap-1.5 mt-1">
                  <AlertCircle className="size-3.5" />
                  Self-transfer is not permitted
                </motion.p>
              )}
              {debouncedId && debouncedId !== sourceCartonId && isError && !isLoading && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-[11px] font-medium text-destructive flex items-center gap-1.5 mt-1">
                  <AlertCircle className="size-3.5" />
                  Invalid or missing carton ID
                </motion.p>
              )}
              {skuMismatch && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-[11px] font-medium text-destructive flex items-center gap-1.5 mt-1">
                  <AlertCircle className="size-3.5" />
                  Product SKU mismatch ({targetCarton?.sku})
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {targetCarton && !skuMismatch && debouncedId !== sourceCartonId && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-5 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <div className="size-1.5 rounded-full bg-emerald-500" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Verified Target</p>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm font-bold tracking-tight text-foreground">{targetCarton.sku}</p>
                    <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">#{targetCarton.id.slice(-6).toUpperCase()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tracking-tight text-foreground tabular-nums">
                      {targetCarton.currentPacks} <span className="text-muted-foreground/40 font-medium text-xs">/ {targetCarton.capacity}</span>
                    </p>
                  </div>
                </div>
                <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${fillPercent}%` }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Transfer Amount */}
        <div className="space-y-2">
          <Label htmlFor="packCount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Packs to Transfer
          </Label>
          <div className="relative">
            <Input
              id="packCount"
              type="number"
              min={1}
              max={sourcePacks}
              value={packCount}
              onChange={(e) => setPackCount(Math.max(1, parseInt(e.target.value) || 0))}
              className={cn(
                "h-12 text-lg font-bold tabular-nums pl-4 bg-muted/10 focus:bg-background transition-all",
                overLimit && "border-destructive focus-visible:ring-destructive/20"
              )}
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-muted-foreground/40 uppercase tracking-tighter">
              Quantity
            </div>
          </div>
          {overLimit && (
            <p className="text-[11px] font-medium text-destructive flex items-center gap-1.5 mt-1">
              <AlertCircle className="size-3.5" />
              Transfer exceeds available stock ({sourcePacks})
            </p>
          )}
        </div>

        <div className="pt-4 mt-auto">
          <Button
            size="lg"
            className="w-full h-12 font-bold uppercase tracking-widest text-xs"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Executing Transfer...
              </>
            ) : (
              `Confirm Transfer (${packCount} Units)`
            )}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
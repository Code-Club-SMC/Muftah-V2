import { useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBulkAdjust } from "../hooks/use-carton-mutations";
import { BULK_ADJUST_STRATEGIES } from "@/lib/cartons/carton.types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonIds: string[];
};

export function BulkAdjustSheet({ open, onOpenChange, cartonIds }: Props) {
  const [delta, setDelta] = useState(0);
  const [strategy, setStrategy] = useState<string>("CAP");
  const mutation = useBulkAdjust();

  const handleSubmit = () => {
    mutation.mutate(
      {
        cartonIds,
        delta,
        strategy: strategy as "SKIP" | "CAP",
        reason: "Bulk adjustment",
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDelta(0);
          setStrategy("CAP");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Bulk Adjust"
      description={`Adjust ${cartonIds.length} carton${cartonIds.length !== 1 ? "s" : ""}`}
      icon={ArrowRightLeft}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={delta !== 0}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5">
          <p className="text-xs font-medium text-foreground">
            {cartonIds.length} carton{cartonIds.length !== 1 ? "s" : ""} selected.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Positive values add packs; negative values remove packs.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="delta" className="text-sm font-medium text-foreground">
            Packs per carton
          </Label>
          <Input
            id="delta"
            type="number"
            value={delta}
            onChange={(e) => setDelta(parseInt(e.target.value) || 0)}
            className="h-10 font-semibold"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Overflow strategy
          </span>
          <div className="flex flex-col gap-2">
            {BULK_ADJUST_STRATEGIES.map((s) => (
              <label
                key={s}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5 rounded-xl border cursor-pointer transition-colors",
                  strategy === s 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:bg-muted/40"
                )}
              >
                <input
                  type="radio"
                  name="strategy"
                  value={s}
                  checked={strategy === s}
                  onChange={() => setStrategy(s)}
                  className="accent-primary mt-0.5 shrink-0"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {s === "SKIP" ? "Skip overflow" : "Cap at capacity"}
                  </span>
                  <span className="text-xs text-muted-foreground leading-snug">
                    {s === "SKIP"
                      ? "Omit cartons where the update exceeds full capacity"
                      : "Fill completely if the increment goes over capacity"}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <Button
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending || delta === 0}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Adjusting…
            </>
          ) : (
            `Apply ${delta > 0 ? "+" : ""}${delta} packs`
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
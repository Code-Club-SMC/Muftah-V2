import { useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateStockCount } from "../hooks/use-carton-mutations";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId?: string;
};

export function StockCountSheet({ open, onOpenChange, batchId }: Props) {
  const [sku, setSku] = useState("");
  const [notes, setNotes] = useState("");
  const mutation = useCreateStockCount();

  const isDirty = sku !== "" || notes !== "";

  const handleSubmit = () => {
    mutation.mutate(
      {
        batchId,
        sku: sku || undefined,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setSku("");
          setNotes("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Start Stock Count"
      description="Create a new physical inventory count session"
      icon={ClipboardList}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={isDirty}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5 flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            A stock count session populates ledger lines automatically for targeted inventory.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Operators will perform manual counts before finalizing the report.
          </p>
        </div>

        {batchId && (
          <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex justify-between items-center">
            <span className="text-sm text-muted-foreground font-medium">Batch filter</span>
            <span className="text-xs font-mono font-semibold text-foreground">{batchId}</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="sku" className="text-sm font-medium text-foreground">
            SKU filter <span className="text-muted-foreground text-xs font-normal">(optional)</span>
          </Label>
          <Input
            id="sku"
            placeholder="Leave blank to include all inventory"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="h-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes" className="text-sm font-medium text-foreground">
            Notes
          </Label>
          <Textarea
            id="notes"
            placeholder="Provide audit session context..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        <Button
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Start Stock Count"
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
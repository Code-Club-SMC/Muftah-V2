import { useState } from "react";
import { RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRepackCarton } from "../hooks/use-carton-mutations";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonId: string;
  batchId: string;
  currentCapacity: number;
  currentPacks: number;
};

export function RepackSheet({ open, onOpenChange, cartonId, batchId, currentCapacity, currentPacks }: Props) {
  const [newCapacity, setNewCapacity] = useState(currentCapacity);
  const [justification, setJustification] = useState("");
  const mutation = useRepackCarton(cartonId, batchId);

  const isDirty = newCapacity !== currentCapacity || justification !== "";
  const packsWillBeCapped = newCapacity < currentPacks;

  const handleSubmit = () => {
    mutation.mutate(
      { newCapacity, justification },
      {
        onSuccess: () => {
          onOpenChange(false);
          setNewCapacity(currentCapacity);
          setJustification("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Repack Carton"
      description="Change carton capacity (pack count will adjust)"
      icon={RefreshCw}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={isDirty}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5 flex flex-col gap-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Current capacity</span>
            <span className="font-semibold tabular-nums text-foreground">{currentCapacity}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Current quantity</span>
            <span className="font-semibold tabular-nums text-foreground">{currentPacks}</span>
          </div>
        </div>

        {packsWillBeCapped && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 flex items-center gap-1.5">
            <AlertCircle className="size-3.5 text-destructive shrink-0" />
            <p className="text-xs text-destructive leading-relaxed">
              Capacity drop removes {currentPacks - newCapacity} packs.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="newCapacity" className="text-sm font-medium text-foreground">
            New capacity
          </Label>
          <Input
            id="newCapacity"
            type="number"
            min={1}
            value={newCapacity}
            onChange={(e) => setNewCapacity(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-10 font-semibold"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="justification" className="text-sm font-medium text-foreground">
            Justification
          </Label>
          <Textarea
            id="justification"
            placeholder="Why is the capacity configuration being updated?"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={2}
          />
        </div>

        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5 flex justify-between text-sm">
          <span className="text-muted-foreground">Packs after repack</span>
          <span className="font-semibold tabular-nums text-foreground">
            {Math.min(currentPacks, newCapacity)} / {newCapacity}
          </span>
        </div>

        <Button
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending || !isDirty || newCapacity < 1}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Repacking…
            </>
          ) : (
            "Repack Carton"
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
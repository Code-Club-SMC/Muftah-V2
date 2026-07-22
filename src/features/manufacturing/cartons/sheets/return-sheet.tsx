import { useState } from "react";
import { RotateCcw, Loader2 } from "lucide-react";
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
import { useProcessReturn } from "../hooks/use-carton-mutations";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReturnSheet({ open, onOpenChange }: Props) {
  const [dispatchOrderId, setDispatchOrderId] = useState("");
  const [cartonId, setCartonId] = useState("");
  const [packsReturned, setPacksReturned] = useState(1);
  const [condition, setCondition] = useState<"GOOD" | "DAMAGED">("GOOD");
  const [destinationCartonId, setDestinationCartonId] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useProcessReturn();
  const isDirty = dispatchOrderId !== "" || cartonId !== "" || packsReturned !== 1 || notes !== "";

  const handleSubmit = () => {
    mutation.mutate(
      {
        dispatchOrderId,
        lines: [
          {
            cartonId,
            packsReturned,
            condition,
            ...(destinationCartonId ? { destinationCartonId } : {}),
          },
        ],
        notes,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDispatchOrderId("");
          setCartonId("");
          setPacksReturned(1);
          setCondition("GOOD");
          setDestinationCartonId("");
          setNotes("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Process Return"
      description="Record returned carton(s) from a dispatch"
      icon={RotateCcw}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={isDirty}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="dispatchOrderId" className="text-sm font-medium text-foreground">
            Dispatch order ID <span className="text-destructive">*</span>
          </Label>
          <Input
            id="dispatchOrderId"
            placeholder="e.g. INV-2026-0123"
            value={dispatchOrderId}
            onChange={(e) => setDispatchOrderId(e.target.value)}
            className="h-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cartonId" className="text-sm font-medium text-foreground">
            Carton ID <span className="text-destructive">*</span>
          </Label>
          <Input
            id="cartonId"
            placeholder="Scan or enter carton ID"
            value={cartonId}
            onChange={(e) => setCartonId(e.target.value)}
            className="h-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="packsReturned" className="text-sm font-medium text-foreground">
              Packs returned
            </Label>
            <Input
              id="packsReturned"
              type="number"
              min={1}
              value={packsReturned}
              onChange={(e) => setPacksReturned(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-10 font-semibold"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium text-foreground">Condition</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as "GOOD" | "DAMAGED")}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GOOD">Good — Restock</SelectItem>
                <SelectItem value="DAMAGED">Damaged — Quarantine</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="destinationCartonId" className="text-sm font-medium text-foreground">
            Destination carton <span className="text-muted-foreground text-xs font-normal">(optional)</span>
          </Label>
          <Input
            id="destinationCartonId"
            placeholder="Leave blank to use source"
            value={destinationCartonId}
            onChange={(e) => setDestinationCartonId(e.target.value)}
            className="h-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">Default drops items into original container.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes" className="text-sm font-medium text-foreground">
            Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span>
          </Label>
          <Textarea
            id="notes"
            placeholder="Record logistics discrepancies..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <Button
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending || !dispatchOrderId.trim() || !cartonId.trim()}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Processing…
            </>
          ) : (
            "Process Return"
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRetireCarton } from "../hooks/use-carton-mutations";
import { RETIRE_REASONS } from "@/lib/cartons/carton.types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonId: string;
  batchId: string;
  currentPacks: number;
  sku: string | null;
};

const reasonLabels: Record<string, string> = {
  LOST: "Lost",
  DESTROYED: "Destroyed",
  CONDEMNED: "Condemned (QC)",
  OTHER: "Other",
};

export function RetireSheet({ open, onOpenChange, cartonId, batchId, currentPacks, sku }: Props) {
  const [reasonCategory, setReasonCategory] = useState<"LOST" | "DESTROYED" | "CONDEMNED" | "OTHER">("OTHER");
  const [notes, setNotes] = useState("");
  const mutation = useRetireCarton(cartonId, batchId);

  const isDirty = notes !== "" || reasonCategory !== "OTHER";

  const handleSubmit = () => {
    mutation.mutate(
      { reason: reasonCategory, notes: notes || undefined },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReasonCategory("OTHER");
          setNotes("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Retire Carton"
      description="Permanently remove carton from active inventory"
      icon={Trash2}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={isDirty}
      confirmCloseTitle="Cancel retirement?"
      confirmCloseDescription="This carton will not be retired."
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3.5 flex flex-col gap-1">
          <p className="text-xs font-medium text-destructive">
            This action cannot be reversed.
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Carton{sku ? ` ${sku}` : ""} with {currentPacks} packs will be flagged retired and omitted from stock reporting.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium text-foreground">Reason</Label>
          <Select value={reasonCategory} onValueChange={(v) => setReasonCategory(v as typeof reasonCategory)}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETIRE_REASONS.map((r) => (
                <SelectItem key={r} value={r}>{reasonLabels[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="note" className="text-sm font-medium text-foreground">
            Additional details
          </Label>
          <Textarea
            id="note"
            placeholder="Provide audit justification..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        <Button
          variant="destructive"
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Retiring…
            </>
          ) : (
            "Retire Carton"
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
import { useState } from "react";
import { Merge, Loader2 } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMergeCartons } from "../hooks/use-carton-mutations";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  sourceCartonId: string;
  sourceSku: string | null;
  sourcePacks: number;
};

export function MergeSheet({ open, onOpenChange, batchId, sourceCartonId, sourceSku, sourcePacks }: Props) {
  const [destinationCartonId, setDestinationCartonId] = useState("");
  const mutation = useMergeCartons(batchId);

  const handleSubmit = () => {
    mutation.mutate(
      {
        sourceCartonIds: [sourceCartonId],
        destinationCartonId,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDestinationCartonId("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Merge Cartons"
      description="Move all packs from this carton into another"
      icon={Merge}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={destinationCartonId !== ""}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5 flex flex-col gap-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Source SKU</span>
            <span className="font-semibold text-foreground">{sourceSku ?? "Unknown SKU"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Packs to transfer</span>
            <span className="font-semibold tabular-nums text-foreground">{sourcePacks}</span>
          </div>
        </div>

        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <p className="text-xs text-destructive leading-relaxed">
            The source container will be retired upon successful inventory allocation.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="destinationCartonId" className="text-sm font-medium text-foreground">
            Destination carton ID
          </Label>
          <Input
            id="destinationCartonId"
            placeholder="Paste or scan carton ID"
            value={destinationCartonId}
            onChange={(e) => setDestinationCartonId(e.target.value)}
            className="h-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <Button
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending || !destinationCartonId.trim()}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Merging…
            </>
          ) : (
            "Merge Cartons"
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
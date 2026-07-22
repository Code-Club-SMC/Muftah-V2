import { useState } from "react";
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
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
import { useApplyQcHold, useReleaseQcHold } from "../hooks/use-carton-mutations";
import { HOLD_OUTCOMES } from "@/lib/cartons/carton.types";

type ApplyHoldProps = {
  mode: "apply";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonId: string;
  batchId: string;
  sku: string | null;
};

type ReleaseHoldProps = {
  mode: "release";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonId: string;
  batchId: string;
  sku: string | null;
  preHoldStatus: string;
};

type Props = ApplyHoldProps | ReleaseHoldProps;

export function QcHoldSheet(props: Props) {
  if (props.mode === "apply") {
    return <ApplyHoldSheet {...props} />;
  }
  return <ReleaseHoldSheet {...props} />;
}

function ApplyHoldSheet({ open, onOpenChange, cartonId, batchId, sku }: ApplyHoldProps) {
  const [reason, setReason] = useState("");
  const mutation = useApplyQcHold(cartonId, batchId);

  const handleSubmit = () => {
    mutation.mutate(
      { reason },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Apply QC Hold"
      description={`Place carton${sku ? ` ${sku}` : ""} on hold`}
      icon={ShieldAlert}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={reason !== ""}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            This carton will be restricted from operational updates until a technician releases the hold.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="reason" className="text-sm font-medium text-foreground">
            Hold reason
          </Label>
          <Textarea
            id="reason"
            placeholder="Provide explicit reason for quarantine"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>

        <Button
          className="w-full h-10"
          variant="destructive"
          onClick={handleSubmit}
          disabled={mutation.isPending || !reason.trim()}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Applying…
            </>
          ) : (
            "Apply QC Hold"
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}

function ReleaseHoldSheet({ open, onOpenChange, cartonId, batchId, sku, preHoldStatus }: ReleaseHoldProps) {
  const [outcome, setOutcome] = useState<string>("CLEARED");
  const [notes, setNotes] = useState("");
  const mutation = useReleaseQcHold(cartonId, batchId);

  const handleSubmit = () => {
    mutation.mutate(
      {
        outcome: outcome as "CLEARED" | "CONDEMNED",
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setOutcome("CLEARED");
          setNotes("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Release QC Hold"
      description={`Release hold on carton${sku ? ` ${sku}` : ""}`}
      icon={ShieldCheck}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={notes !== ""}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Release action will restore previous state or discard carton entirely.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium text-foreground">Action</Label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOLD_OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {o === "CLEARED" ? "Cleared — Resume normal status" : "Condemned — Retire carton"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes" className="text-sm font-medium text-foreground">
            Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span>
          </Label>
          <Textarea
            id="notes"
            placeholder="Record inspection findings..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <Button
          className="w-full h-10"
          variant={outcome === "CONDEMNED" ? "destructive" : "default"}
          onClick={handleSubmit}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Releasing…
            </>
          ) : outcome === "CONDEMNED" ? (
            "Condemn & Retire"
          ) : (
            "Clear & Release"
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
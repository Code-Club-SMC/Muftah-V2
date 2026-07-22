import { useState } from "react";
import { Truck, Loader2 } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDispatch } from "../hooks/use-carton-mutations";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartonIds: string[];
  userId: string;
};

export function DispatchSheet({ open, onOpenChange, cartonIds, userId }: Props) {
  const [orderId, setOrderId] = useState("");
  const mutation = useDispatch();

  const handleSubmit = () => {
    mutation.mutate(
      {
        lines: cartonIds.map((id) => ({ cartonId: id, packsToDispatch: 0 })),
        dispatchedBy: userId,
        orderId: orderId || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setOrderId("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      title="Dispatch Cartons"
      description={`Mark ${cartonIds.length} carton${cartonIds.length !== 1 ? "s" : ""} as dispatched`}
      icon={Truck}
      open={open}
      onOpenChange={onOpenChange}
      isDirty={orderId !== ""}
    >
      <div className="flex flex-col gap-6 py-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5">
          <p className="text-xs font-medium text-foreground">
            {cartonIds.length} carton${cartonIds.length !== 1 ? "s" : ""} selected for dispatch.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Only complete or sealed containers are authorized for operational release.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="orderId" className="text-sm font-medium text-foreground">
            Sales order / invoice ID <span className="text-muted-foreground text-xs font-normal">(optional)</span>
          </Label>
          <Input
            id="orderId"
            placeholder="e.g. INV-2026-0123"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="h-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <Button
          className="w-full h-10"
          onClick={handleSubmit}
          disabled={mutation.isPending || cartonIds.length === 0}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Dispatching…
            </>
          ) : (
            `Dispatch ${cartonIds.length} carton${cartonIds.length !== 1 ? "s" : ""}`
          )}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
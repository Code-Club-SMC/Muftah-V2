import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { LotPicker, lotPicksValid } from "@/components/inventory/lot-picker";
import { useMaterialLots } from "@/hooks/stock/use-material-lots";
import type { LotBalance, LotPick, MaterialLotPicks } from "@/lib/inventory/material-lots";
import { getMixingStartRequirementsFn } from "@/server-functions/manufacturing/mixing/get-mixing-start-requirements-fn";

type Requirement = { chemicalId: string; name: string; unit: string; quantity: string };

export function StartMixingDialogBody({ materials, lots, pending, onStart }: { materials: Requirement[]; lots: Record<string, LotBalance[]>; pending: boolean; onStart: (picks: MaterialLotPicks[]) => void }) {
  const [picks, setPicks] = useState<Record<string, LotPick[]>>({});
  const ready = materials.every((item) => lotPicksValid(item.quantity, picks[item.chemicalId] ?? [], lots[item.chemicalId] ?? [], item.name, item.unit));
  return (
    <div className="flex flex-col gap-4">
      {materials.map((item) => (
        <LotPicker key={item.chemicalId} name={item.name} unit={item.unit} required={item.quantity} lots={lots[item.chemicalId] ?? []}
          value={picks[item.chemicalId] ?? []} onChange={(next) => setPicks((current) => ({ ...current, [item.chemicalId]: next }))} />
      ))}
      <Button disabled={!ready || pending} onClick={() => onStart(materials.map((item) => ({ materialId: item.chemicalId, picks: (picks[item.chemicalId] ?? []).filter((pick) => pick.quantity !== "") })))}>
        {pending ? "Starting..." : "Start Mixing Batch"}
      </Button>
    </div>
  );
}

export function StartMixingDialog({ runId, open, onOpenChange, pending, onStart }: { runId: string; open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; onStart: (picks: MaterialLotPicks[]) => void }) {
  const requirements = useQuery({ queryKey: ["mixing-start-requirements", runId], queryFn: () => getMixingStartRequirementsFn({ data: { mixingRunId: runId } }), enabled: open });
  const lots = useMaterialLots(requirements.data?.warehouseId, "chemical", requirements.data?.materials.map((item) => item.chemicalId) ?? []);
  const error = requirements.error ?? lots.error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick lots to start</DialogTitle>
          <DialogDescription>Choose which price lot each chemical comes from. Lots must add up to the formula amount.</DialogDescription>
        </DialogHeader>
        {error
          ? <p className="text-sm text-destructive">{error.message}</p>
          : !requirements.data || !lots.data
            ? <Skeleton className="h-40 w-full" />
            : <StartMixingDialogBody materials={requirements.data.materials} lots={lots.data} pending={pending} onStart={onStart} />}
      </DialogContent>
    </Dialog>
  );
}

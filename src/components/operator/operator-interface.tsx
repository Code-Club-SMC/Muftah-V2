import { useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Package2,
  Layers,
  FlaskConicalIcon,
  ChevronDown,
  Server,
  Settings2,
  Info,
} from "lucide-react";
import { getProductionRunsFn } from "@/server-functions/inventory/production/get-production-run-fn";
import { GenericEmpty } from "../custom/empty";
import { Button } from "../ui/button";
import { useProductionRunsSync } from "@/hooks/production/use-production-runs-sync";
import { OperationEmptyIllustration } from "../illustrations/OperationEmptyIllustration";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const OperatorInterface = () => {
  const { data: allRuns } = useSuspenseQuery({
    queryKey: ["operator-production-runs"],
    queryFn: () => getProductionRunsFn({ data: { filter: "active" } }),
  });

  useProductionRunsSync();

  const activeRuns = allRuns.filter((run) => run.status === "in_progress");

  if (activeRuns.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-200px)] animate-in fade-in duration-500">
        <GenericEmpty
          title="Floor on Standby"
          description="Waiting for production runs to be scheduled. Machinery is currently inactive."
          icon={OperationEmptyIllustration}
        />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 w-full mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-12">
        {activeRuns.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
};

const RunCard = ({ run }: { run: any }) => {
  const navigate = useNavigate();

  // Math for progress
  const target = run.containersProduced || 1;
  const produced = run.completedUnits || 0;
  const progressPercent = Math.min(100, Math.round((produced / target) * 100));

  return (
    <Card className="group flex flex-col bg-card border-border/60 hover:border-primary/30 transition-all duration-200 shadow-sm hover:shadow-md overflow-hidden min-h-[360px] rounded-xl">
      <CardContent className="p-5 flex flex-col flex-1">

        {/* ── Status Badge & Batch ID ── */}
        <div className="flex items-start justify-between mb-5">
          <Badge variant="outline" className="font-mono bg-muted/40 border-border/60 text-muted-foreground shadow-none px-2 py-0.5 text-[11px] rounded-md">
            #{run.batchId}
          </Badge>
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-500 text-[12px] font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Active Run
          </div>
        </div>

        {/* ── Product Identity ── */}
        <div className="flex items-start gap-3 mb-6">
          <div className="size-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 shadow-sm">
            <Package2 className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-[15px] leading-tight line-clamp-2" title={run.recipe.name}>
              {run.recipe.name}
            </h3>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Server className="size-3.5" />
              <span>Target: <span className="font-medium text-foreground">{target}</span> units</span>
            </div>
          </div>
        </div>

        {/* ── Dynamic Metric Grid ── */}
        <div className="grid grid-cols-2 gap-3 mb-6 mt-auto">
          <div className="flex flex-col bg-muted/30 rounded-xl p-3.5 border border-border/50">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Yield Progress</span>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold text-foreground">{produced}</span>
              <span className="text-[12px] text-muted-foreground font-medium">/ {target}</span>
            </div>
            {/* Integrated Progress Bar */}
            <div className="mt-2.5 w-full bg-muted-foreground/15 h-1.5 rounded-full overflow-hidden">
              <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div className="flex flex-col bg-muted/30 rounded-xl p-3.5 border border-border/50">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Batches</span>
            <div className="flex items-baseline gap-1 mt-auto pb-1">
              <span className="text-xl font-bold text-foreground">{run.batchesProduced}</span>
              <span className="text-[12px] text-muted-foreground font-medium">Runs completed</span>
            </div>
          </div>
        </div>

        {/* ── Technical BOM Dialog ── */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full mb-5 h-10 gap-2 border-border/60 text-muted-foreground hover:text-foreground transition-all shadow-none rounded-lg"
            >
              <Info className="size-3.5" />
              View Bill of Materials
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="size-5 text-primary" />
                Bill of Materials
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6 pt-4">
              {/* Chemicals */}
              {run.recipe.ingredients?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    <FlaskConicalIcon className="size-3.5" /> Formulation
                  </div>
                  <ul className="space-y-2 list-none text-[13px] font-mono">
                    {run.recipe.ingredients.map((ing: any) => (
                      <li key={ing.id} className="flex justify-between items-start gap-4 p-2 rounded-md bg-muted/30">
                        <span className="text-muted-foreground">{ing.chemical.name}</span>
                        <span className="text-foreground font-bold shrink-0">
                          {(Number(ing.quantityPerBatch) * run.batchesProduced).toFixed(2)}
                          <span className="text-[10px] ml-1">KG</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Packaging */}
              {run.recipe.containerPackaging && (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                    <Package2 className="size-3.5" /> Packaging Materials
                  </div>
                  <ul className="space-y-2 list-none text-[13px] font-mono">
                    <li className="flex justify-between items-start gap-4 p-2 rounded-md bg-muted/30">
                      <span className="text-muted-foreground">{run.recipe.containerPackaging.name}</span>
                      <span className="text-foreground font-bold shrink-0">
                        {run.containersProduced}
                        <span className="text-[10px] ml-1">UNITS</span>
                      </span>
                    </li>
                    {run.recipe.cartonPackaging && run.recipe.containersPerCarton > 0 && (
                       <li className="flex justify-between items-start gap-4 p-2 rounded-md bg-muted/30">
                        <span className="text-muted-foreground">{run.recipe.cartonPackaging.name}</span>
                        <span className="text-foreground font-bold shrink-0">
                          {Math.floor(run.containersProduced / run.recipe.containersPerCarton)}
                          <span className="text-[10px] ml-1">CARTONS</span>
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Launch Control ── */}
        <Button
          onClick={() => navigate({ to: `/operator/${run.id}` })}
          className="w-full h-10 gap-2 rounded-lg text-[13px] font-medium shadow-sm transition-all"
        >
          <Settings2 className="size-3.5" />
          Open Console
        </Button>
      </CardContent>
    </Card>
  );
};
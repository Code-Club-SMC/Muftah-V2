import { useSuspenseQuery } from "@tanstack/react-query";
import { getMixingRunFn } from "@/server-functions/manufacturing/mixing/get-mixing-run-fn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  useLogMixingProgress,
  useCompleteMixingRun,
  useFailMixingRun,
} from "@/hooks/manufacturing/mixing/use-mixing-mutations";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { BatchPackingForm } from "@/components/packaging/batch-packing-form";
import { hasPermission } from "@/lib/rbac";
import { ArrowLeftIcon, Database, CheckCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const MixingConsole = ({ runId }: { runId: string }) => {
  const { data: run } = useSuspenseQuery({
    queryKey: ["operator-mixing-run", runId],
    queryFn: () => getMixingRunFn({ data: { id: runId } }),
  });

  const [yieldAmount, setYieldAmount] = useState("");
  const [shortfallReason, setShortfallReason] = useState("");
  const logProgress = useLogMixingProgress();
  const completeRun = useCompleteMixingRun();
  const failRun = useFailMixingRun();
  const { data: viewerAccess } = useViewerAccess();

  const handleLog = () => {
    if (!yieldAmount || isNaN(Number(yieldAmount))) return;
    logProgress.mutate(
      {
        data: {
          mixingRunId: runId,
          quantityProduced: Number(yieldAmount),
        },
      },
      {
        onSuccess: () => {
          setYieldAmount("");
        },
      },
    );
  };

  const handleComplete = () => {
    completeRun.mutate(
      {
        data: {
          mixingRunId: runId,
          shortfallReason: shortfallReason || undefined,
        },
      },
    );
  };

  if (!run) return <div>Mixing batch not found</div>;

  if (run.status === "completed") return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <Button asChild variant="outline" className="w-fit"><Link to="/operator">Back to batches</Link></Button>
      <BatchPackingForm mixingRunId={runId} />
    </main>
  );

  const target = Number(run.targetBulkQuantity) || 1;
  const produced = Number(run.actualBulkProduced) || 0;
  const permissions = viewerAccess?.permissions ?? [];
  const canManage = hasPermission(permissions, "manufacturing.run.manage");
  const canAct = canManage || run.operatorId === viewerAccess?.user.id;
  const canLog =
    canAct && (canManage || hasPermission(permissions, "operator.run.log"));
  const canComplete =
    canAct &&
    (canManage || hasPermission(permissions, "operator.run.complete"));
  const canFail =
    canAct &&
    produced === 0 &&
    run.progressLogs.length === 0 &&
    (canManage || hasPermission(permissions, "operator.run.fail"));

  return (
    <div className="flex-1 overflow-y-auto min-h-screen bg-muted/20 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="icon" asChild>
            <Link to="/operator">
              <ArrowLeftIcon className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Mixing Batch
            </h1>
            <p className="text-muted-foreground">
              Batch {run.batchId} — {run.formula?.name}
            </p>
          </div>
          <div className="ml-auto">
            <Badge
              variant="outline"
              className="text-sm px-3 py-1 bg-background"
            >
              {run.status.toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-blue-500 text-white border-none">
            <CardHeader>
              <CardTitle className="text-blue-100">Target Bulk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-5xl font-bold flex items-baseline gap-2">
                {target}{" "}
                <span className="text-2xl text-blue-200">{run.bulkUnit}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-emerald-500 text-white border-none">
            <CardHeader>
              <CardTitle className="text-emerald-100">Actual Yield</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-5xl font-bold flex items-baseline gap-2">
                {produced}{" "}
                <span className="text-2xl text-emerald-200">
                  {run.bulkUnit}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {run.status === "in_progress" && (canLog || canComplete || canFail) && (
          <Card className="border-border/50 shadow-sm mt-8">
            <CardHeader>
              <CardTitle>Record Mixing Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {canLog && (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Input
                      type="number"
                      min="0.001"
                      max={Math.max(0, target - produced)}
                      step="0.001"
                      placeholder={`Enter yield amount in ${run.bulkUnit}...`}
                      className="h-14 text-xl"
                      value={yieldAmount}
                      onChange={(e) => setYieldAmount(e.target.value)}
                    />
                  </div>
                  <Button
                    size="lg"
                    className="h-14 px-8 text-lg"
                    onClick={handleLog}
                    disabled={logProgress.isPending || !yieldAmount}
                  >
                    <Database className="w-5 h-5 mr-2" />
                    Record Bulk Output
                  </Button>
                </div>
              )}

              <div className="pt-6 border-t border-border/50">
                {(canComplete || canFail) && produced < target && (
                  <Input
                    value={shortfallReason}
                    onChange={(event) => setShortfallReason(event.target.value)}
                    placeholder="Reason for completing below target"
                    className="mb-3"
                  />
                )}
                {canComplete && (
                  <Button
                    variant="outline"
                    className="w-full h-14 text-lg border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    onClick={handleComplete}
                    disabled={
                      completeRun.isPending ||
                      produced <= 0 ||
                      (produced < target && !shortfallReason.trim())
                    }
                  >
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Mark Batch as Completed
                  </Button>
                )}
                {canFail && (
                  <Button
                    variant="destructive"
                    className="mt-3 w-full"
                    disabled={failRun.isPending || !shortfallReason.trim()}
                    onClick={() =>
                      failRun.mutate({
                        data: { id: runId, reason: shortfallReason },
                      })
                    }
                  >
                    Mark zero-output batch failed
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

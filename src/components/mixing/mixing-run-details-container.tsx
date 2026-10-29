import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getMixingRunFn } from "@/server-functions/manufacturing/mixing/get-mixing-run-fn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { MixingLabReports } from "./mixing-lab-reports";
import { PackagingAllocationsTable } from "../packaging/packaging-allocations-table";
import { BatchPackingForm } from "../packaging/batch-packing-form";
import { Button } from "@/components/ui/button";
import {
  useStartMixingRun,
  useCancelMixingRun,
} from "@/hooks/manufacturing/mixing/use-mixing-mutations";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { Link } from "@tanstack/react-router";
import { StartMixingDialog } from "./start-mixing-dialog";

export function MixingRunDetailsContainer({ runId }: { runId: string }) {
  const { data: run } = useSuspenseQuery({
    queryKey: ["mixing-run", runId],
    queryFn: () => getMixingRunFn({ data: { id: runId } }),
  });
  const startRun = useStartMixingRun();
  const cancelRun = useCancelMixingRun();
  const [startOpen, setStartOpen] = useState(false);
  const { data: viewerAccess } = useViewerAccess();
  const canManage =
    !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "manufacturing.run.manage");
  const canCancel =
    !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "manufacturing.manage");

  if (!run) return <div>Mixing batch not found</div>;

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Batch: {run.batchId}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {canManage && run.status === "scheduled" && (
              <Button
                onClick={() => setStartOpen(true)}
                disabled={startRun.isPending || cancelRun.isPending}
              >
                {startRun.isPending ? "Starting..." : "Start Mixing Batch"}
              </Button>
            )}
            {canCancel && run.status === "scheduled" && (
              <Button
                variant="destructive"
                onClick={() => cancelRun.mutate({ data: { id: runId } })}
                disabled={cancelRun.isPending || startRun.isPending}
              >
                {cancelRun.isPending ? "Cancelling..." : "Cancel Mixing Batch"}
              </Button>
            )}
          </div>
          <StartMixingDialog
            runId={runId}
            open={startOpen}
            onOpenChange={setStartOpen}
            pending={startRun.isPending}
            onStart={(lotPicks) =>
              startRun.mutate(
                { data: { mixingRunId: runId, lotPicks } },
                { onSuccess: () => setStartOpen(false) },
              )
            }
          />
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Mixing Formula</p>
            <p className="font-medium">{run.formula?.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Status</p>
            <Badge variant="outline">{run.status}</Badge>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Target Bulk</p>
            <p className="font-medium">
              {run.targetBulkQuantity} {run.bulkUnit}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Actual Yield</p>
            <p className="font-medium">
              {run.actualBulkProduced} {run.bulkUnit}
            </p>
          </div>
        </CardContent>
        {run.status === "in_progress" && (
          <div className="px-6 pb-6">
            <Button asChild variant="outline">
              <Link to="/operator/mixing/$runId" params={{ runId }}>
                Open Batch
              </Link>
            </Button>
          </div>
        )}
      </Card>

      <Tabs defaultValue="packaging">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="packaging">Packing</TabsTrigger>
          <TabsTrigger value="ingredients">Ingredients Used</TabsTrigger>
          <TabsTrigger value="logs">Progress Logs</TabsTrigger>
          <TabsTrigger value="lab">Quality Control</TabsTrigger>
        </TabsList>

        <TabsContent value="packaging" className="space-y-4">
          {run.status === "completed" ? (
            <BatchPackingForm mixingRunId={runId} />
          ) : (
            <p className="py-6 text-sm text-muted-foreground">Complete mixing to record the packed formats on this batch.</p>
          )}
          {run.packagingAllocations?.some((allocation) => ["allocated", "in_progress"].includes(allocation.status)) && (
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer py-2 font-medium">Existing packing jobs</summary>
              <p className="py-3 text-sm text-muted-foreground">Finish or cancel these earlier jobs before recording the same output above.</p>
              <PackagingAllocationsTable data={run.packagingAllocations.filter((allocation) => ["allocated", "in_progress"].includes(allocation.status))} />
            </details>
          )}
        </TabsContent>

        <TabsContent value="ingredients">
          <Card>
            <CardHeader>
              <CardTitle>Raw Materials</CardTitle>
            </CardHeader>
            <CardContent>
              {run.materialsUsed.map((material) => (
                <div
                  key={material.id}
                  className="flex justify-between border-b py-2 text-sm"
                >
                  <span>{material.chemical.name}</span>
                  <span>
                    {material.quantityUsed} {material.chemical.unit} · PKR{" "}
                    {material.totalCost}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Activity Logs</CardTitle>
            </CardHeader>
            <CardContent>
              {run.progressLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex justify-between border-b py-2 text-sm"
                >
                  <span>
                    {format(new Date(log.createdAt), "dd MMM yyyy HH:mm")}
                  </span>
                  <span>
                    {log.quantityProduced} {run.bulkUnit}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lab">
          <MixingLabReports mixingRunId={runId} batchId={run.batchId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

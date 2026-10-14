import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  useLogPackagingProgress,
  useCompletePackagingAllocation,
  useStartPackagingAllocation,
} from "@/hooks/manufacturing/packaging/use-packaging-mutations";
import { ArrowLeftIcon, PackageIcon, CheckCircle2 } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { getPackagingAllocationsFn } from "@/server-functions/manufacturing/packaging/get-packaging-allocations-fn";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { GenericEmpty } from "@/components/custom/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const PackagingConsole = ({
  allocationId,
}: {
  allocationId: string;
}) => {
  const {
    data: allocationsData,
    isPending,
    error,
  } = useQuery({
    queryKey: ["operator-packaging", allocationId],
    queryFn: () => getPackagingAllocationsFn({ data: { allocationId } }),
  });

  const alloc = allocationsData?.allocations?.find(
    (a: any) => a.id === allocationId,
  );

  const [containersAmount, setContainersAmount] = useState("");
  const [shortfallReason, setShortfallReason] = useState("");
  const logProgress = useLogPackagingProgress();
  const completeAllocation = useCompletePackagingAllocation();
  const startAllocation = useStartPackagingAllocation();
  const navigate = useNavigate();
  const { data: viewerAccess } = useViewerAccess();

  const handleLog = () => {
    if (!containersAmount || isNaN(Number(containersAmount))) return;
    logProgress.mutate(
      {
        data: {
          allocationId,
          containersProduced: Number(containersAmount),
        },
      },
      {
        onSuccess: () => {
          setContainersAmount("");
        },
      },
    );
  };

  const handleComplete = () => {
    completeAllocation.mutate(
      { data: { allocationId, shortfallReason: shortfallReason || undefined } },
      {
        onSuccess: () => {
          navigate({ to: "/operator" });
        },
      },
    );
  };

  if (isPending) return <div className="p-8">Loading packing job...</div>;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  if (!alloc)
    return (
      <GenericEmpty
        title="Packing job not found"
        description="This packing job is unavailable or is not assigned to you."
      />
    );

  const target = Number(alloc.targetContainers) || 1;
  const produced = Number(alloc.completedContainers) || 0;
  const permissions = viewerAccess?.permissions ?? [];
  const canManage = hasPermission(permissions, "manufacturing.run.manage");
  const canAct = canManage || alloc.operatorId === viewerAccess?.user.id;
  const canLog =
    canAct && (canManage || hasPermission(permissions, "operator.run.log"));
  const canComplete =
    canAct &&
    (canManage || hasPermission(permissions, "operator.run.complete"));

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
              Packing Job
            </h1>
            <p className="text-muted-foreground">Packaging Format: {alloc.recipe?.name}</p>
          </div>
          <div className="ml-auto">
            <Badge
              variant="outline"
              className="text-sm px-3 py-1 bg-background"
            >
              {alloc.status === "allocated" ? "SCHEDULED" : alloc.status.replace("_", " ").toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-purple-600 text-white border-none">
            <CardHeader>
              <CardTitle className="text-purple-100">Target Units</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-5xl font-bold flex items-baseline gap-2">
                {target} <span className="text-2xl text-purple-200">units</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-emerald-500 text-white border-none">
            <CardHeader>
              <CardTitle className="text-emerald-100">Filled Units</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-5xl font-bold flex items-baseline gap-2">
                {produced}{" "}
                <span className="text-2xl text-emerald-200">units</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {alloc.status === "allocated" && canLog && (
          <Button
            onClick={() => startAllocation.mutate({ data: { allocationId } })}
            disabled={startAllocation.isPending}
          >
            Start Packing Job
          </Button>
        )}

        {alloc.status === "in_progress" && (canLog || canComplete) && (
          <Card className="border-border/50 shadow-sm mt-8">
            <CardHeader>
              <CardTitle>Record Packing Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {canLog && (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Input
                      type="number"
                      min="1"
                      max={Math.max(0, target - produced)}
                      step="1"
                      placeholder={`Enter number of units packed...`}
                      className="h-14 text-xl"
                      value={containersAmount}
                      onChange={(e) => setContainersAmount(e.target.value)}
                    />
                  </div>
                  <Button
                    size="lg"
                    className="h-14 px-8 text-lg bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={handleLog}
                    disabled={logProgress.isPending || !containersAmount}
                  >
                    <PackageIcon className="w-5 h-5 mr-2" />
                    Record Packed Units
                  </Button>
                </div>
              )}

              {canComplete && (
                <div className="pt-6 border-t border-border/50">
                  {produced < target && (
                    <Input
                      value={shortfallReason}
                      onChange={(event) =>
                        setShortfallReason(event.target.value)
                      }
                      placeholder="Reason for completing below target"
                      className="mb-3"
                    />
                  )}
                  <Button
                    variant="outline"
                    className="w-full h-14 text-lg border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    onClick={handleComplete}
                    disabled={
                      completeAllocation.isPending ||
                      produced <= 0 ||
                      (produced < target && !shortfallReason.trim())
                    }
                  >
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Complete Packing Job
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

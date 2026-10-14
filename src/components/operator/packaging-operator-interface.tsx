import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package2, Settings2, Box } from "lucide-react";
import { getPackagingAllocationsFn } from "@/server-functions/manufacturing/packaging/get-packaging-allocations-fn";
import { GenericEmpty } from "@/components/custom/empty";

export const PackagingOperatorInterface = () => {
  const { data } = useSuspenseQuery({
    queryKey: ["operator-packaging", "list", "in_progress"],
    queryFn: () => getPackagingAllocationsFn({ data: { status: "in_progress" } }),
  });
  
  const { data: scheduled } = useSuspenseQuery({
    queryKey: ["operator-packaging", "list", "allocated"],
    queryFn: () => getPackagingAllocationsFn({ data: { status: "allocated" } }),
  });

  const activeAllocations = [...(data?.allocations || []), ...(scheduled?.allocations || [])];

  if (activeAllocations.length === 0) {
    return (
      <div className="flex justify-center mt-12">
        <GenericEmpty
          title="No Active Packing Jobs"
          description="There are currently no packing jobs pending or in progress."
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-12">
      {activeAllocations.map((alloc: any) => (
        <PackagingCard key={alloc.id} allocation={alloc} />
      ))}
    </div>
  );
};

const PackagingCard = ({ allocation: alloc }: { allocation: any }) => {
  const navigate = useNavigate();

  const target = Number(alloc.targetContainers) || 1;
  const produced = Number(alloc.completedContainers) || 0;
  const progressPercent = Math.min(100, Math.round((produced / target) * 100));

  return (
    <Card className="group flex flex-col bg-card border-border/60 hover:border-primary/30 transition-all duration-200 shadow-sm hover:shadow-md overflow-hidden min-h-[300px] rounded-xl">
      <CardContent className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-5">
          <Badge variant="outline" className="font-mono bg-muted/40 border-border/60 text-muted-foreground shadow-none px-2 py-0.5 text-[11px] rounded-md">
            Batch: {alloc.mixingRun?.batchId}
          </Badge>
          <div className={`flex items-center gap-1.5 text-[12px] font-medium ${alloc.status === 'in_progress' ? 'text-purple-600 dark:text-purple-500' : 'text-blue-600 dark:text-blue-500'}`}>
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${alloc.status === 'in_progress' ? 'bg-purple-400' : 'bg-blue-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${alloc.status === 'in_progress' ? 'bg-purple-500' : 'bg-blue-500'}`}></span>
            </span>
            {alloc.status === 'in_progress' ? 'Packaging' : 'Scheduled'}
          </div>
        </div>

        <div className="flex items-start gap-3 mb-6">
          <div className="size-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 shadow-sm">
            <Package2 className="size-5 text-purple-600 dark:text-purple-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-[15px] leading-tight line-clamp-2">
              {alloc.recipe?.name}
            </h3>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Box className="size-3.5" />
              <span>Target: <span className="font-medium text-foreground">{target} units</span></span>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-muted/30 rounded-xl p-3.5 border border-border/50 mb-6 mt-auto">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Fill Progress</span>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-foreground">{produced}</span>
            <span className="text-[12px] text-muted-foreground font-medium">/ {target} units</span>
          </div>
          <div className="mt-2.5 w-full bg-muted-foreground/15 h-1.5 rounded-full overflow-hidden">
            <div className="bg-purple-500 h-full rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <Button
          onClick={() => navigate({ to: `/operator/packaging/$allocationId`, params: { allocationId: alloc.id } })}
          className="w-full h-10 gap-2 rounded-lg text-[13px] font-medium shadow-sm transition-all"
        >
          <Settings2 className="size-3.5" />
          Open Job
        </Button>
      </CardContent>
    </Card>
  );
};

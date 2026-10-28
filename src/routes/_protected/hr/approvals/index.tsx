import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { OvertimeApprovalsContainer } from "@/components/hr/attendance/overtime-approvals-container";
import { LeaveApprovalsContainer } from "@/components/hr/attendance/leave-approvals-container";
import { LateEarlyApprovalsContainer } from "@/components/hr/attendance/late-early-approvals-container";
import { AdvancesContainer } from "@/components/hr/advances/advances-container";
import { getOvertimeApprovalsFn } from "@/server-functions/hr/attendance/get-overtime-approvals-fn";
import { getLeaveApprovalsFn } from "@/server-functions/hr/attendance/leave-approvals-fn";
import { getTimeExceptionsFn } from "@/server-functions/hr/attendance/time-exceptions-fn";
import { listSalaryAdvancesFn } from "@/server-functions/hr/advances/advances-fn";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, CalendarX, Banknote, ShieldCheck, Timer, UserX } from "lucide-react";
import { EmployeeDeletionApprovalsContainer } from "@/components/hr/employees/employee-deletion-approvals-container";
import { getEmployeeDeletionRequestsFn } from "@/server-functions/hr/employees/delete-employee-fn";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";

export const Route = createFileRoute("/_protected/hr/approvals/")({
  loader: async ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery({
      queryKey: ["overtime-approvals", "pending"],
      queryFn: () => getOvertimeApprovalsFn({ data: { status: "pending" } }),
    });
    void queryClient.prefetchQuery({
      queryKey: ["leave-approvals", "pending"],
      queryFn: () => getLeaveApprovalsFn({ data: { status: "pending" } }),
    });
    // Users without hr.manage get a 403 here; prefetchQuery swallows it.
    void queryClient.prefetchQuery({
      queryKey: ["time-exceptions", "pending", null, null, null],
      queryFn: () => getTimeExceptionsFn({ data: { view: "pending" } }),
    });
    void queryClient.prefetchQuery({
      queryKey: ["salary-advances"],
      queryFn: () => listSalaryAdvancesFn({ data: { limit: 50 } }),
    });
    void queryClient.prefetchQuery({
      queryKey: ["employee-deletion-requests"],
      queryFn: () => getEmployeeDeletionRequestsFn(),
    });
  },
  component: ApprovalsPage,
});

type ApprovalTab = "overtime" | "leave" | "lateEarly" | "advances" | "removal";

function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState<ApprovalTab>("overtime");
  const { data: viewerAccess } = useViewerAccess();
  const canDecideLateEarly =
    !!viewerAccess && hasPermission(viewerAccess.permissions, "hr.manage");

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8 animate-in fade-in duration-500">
        <header className="border-b pb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <ShieldCheck className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-3xl uppercase tracking-tighter">
                Approval Center
              </h1>
              <p className="text-sm text-muted-foreground">
                Review and manage overtime, leave, late/early, salary advance, and employee removal requests.
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 py-6 flex flex-col">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ApprovalTab)}
            className="w-full"
          >
            <TabsList className="bg-muted/50 p-1 h-10 rounded-lg border border-border/40 mb-6 w-full sm:w-auto flex">
              <TabsTrigger
                value="overtime"
                className="gap-2 px-4 h-8 text-[13px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-background data-[state=active]: rounded-md transition-all"
              >
                <Clock className="size-3.5 opacity-70" />
                Overtime
              </TabsTrigger>

              <TabsTrigger
                value="leave"
                className="gap-2 px-4 h-8 text-[13px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-background data-[state=active]: rounded-md transition-all"
              >
                <CalendarX className="size-3.5 opacity-70" />
                Leave Requests
              </TabsTrigger>

              {canDecideLateEarly && (
                <TabsTrigger
                  value="lateEarly"
                  className="gap-2 px-4 h-8 text-[13px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-background data-[state=active]: rounded-md transition-all"
                >
                  <Timer className="size-3.5 opacity-70" />
                  Late / Early
                </TabsTrigger>
              )}

              <TabsTrigger
                value="advances"
                className="gap-2 px-4 h-8 text-[13px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-background data-[state=active]: rounded-md transition-all"
              >
                <Banknote className="size-3.5 opacity-70" />
                Advance Requests
              </TabsTrigger>

              <TabsTrigger
                value="removal"
                className="gap-2 px-4 h-8 text-[13px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-background data-[state=active]: rounded-md transition-all"
              >
                <UserX className="size-3.5 opacity-70" />
                Employee Removal
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overtime" className="mt-0 outline-none">
              <Suspense
                fallback={
                  <GenericLoader
                    title="Loading overtime approvals"
                    description="Fetching pending requests..."
                  />
                }
              >
                <OvertimeApprovalsContainer />
              </Suspense>
            </TabsContent>

            <TabsContent value="leave" className="mt-0 outline-none">
              <Suspense
                fallback={
                  <GenericLoader
                    title="Loading leave approvals"
                    description="Fetching pending requests..."
                  />
                }
              >
                <LeaveApprovalsContainer />
              </Suspense>
            </TabsContent>

            {canDecideLateEarly && (
              <TabsContent value="lateEarly" className="mt-0 outline-none">
                <Suspense
                  fallback={
                    <GenericLoader
                      title="Loading late/early items"
                      description="Fetching pending items..."
                    />
                  }
                >
                  <LateEarlyApprovalsContainer />
                </Suspense>
              </TabsContent>
            )}

            <TabsContent value="advances" className="mt-0 outline-none">
              <Suspense
                fallback={
                  <GenericLoader
                    title="Loading advance approvals"
                    description="Fetching pending requests..."
                  />
                }
              >
                <AdvancesContainer />
              </Suspense>
            </TabsContent>

            <TabsContent value="removal" className="mt-0 outline-none">
              <Suspense
                fallback={
                  <GenericLoader
                    title="Processing removal registry"
                    description="Fetching deletion requests..."
                  />
                }
              >
                <EmployeeDeletionApprovalsContainer />
              </Suspense>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}

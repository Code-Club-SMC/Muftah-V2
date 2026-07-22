import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { PayrollContainer } from "@/components/hr/payroll/payroll-container";
import { getMonthlyPayrollTableFn } from "@/server-functions/hr/payroll/dashboard-fn";
import { getCurrentActiveCycle } from "@/lib/payroll-cycle";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_protected/hr/payroll/")({
  loader: async ({ context: { queryClient } }) => {
    const month = getCurrentActiveCycle().payoutMonthKey;
    void queryClient.prefetchQuery({
      queryKey: ["payroll-dashboard", month],
      queryFn: () => getMonthlyPayrollTableFn({ data: { month } }),
    });
  },
  component: PayrollPage,
});

function PayrollPage() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8 space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Payroll Management</h2>
          <p className="text-muted-foreground mt-2">
            Manage monthly salary processing, approvals, and history.
          </p>
        </div>
        <Separator />
        <div className="flex-1 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading payroll"
                description="Please wait..."
              />
            }
          >
            <PayrollContainer />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

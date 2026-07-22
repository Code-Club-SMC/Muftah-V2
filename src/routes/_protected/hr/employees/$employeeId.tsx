import { createFileRoute } from "@tanstack/react-router";
import { getEmployeeFn } from "@/server-functions/hr/employees/get-employee-fn";
import { getEmployeePayrollHistoryFn } from "@/server-functions/hr/payroll/dashboard-fn";
import { EmployeeDetailView } from "@/components/hr/employees/employee-detail-view";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";

export const Route = createFileRoute("/_protected/hr/employees/$employeeId")({
  loader: ({ params, context }) => {
    // Prefetch both employee details and payroll history in parallel
    void context.queryClient.prefetchQuery({
      queryKey: ["employee", params.employeeId],
      queryFn: () => getEmployeeFn({ data: { id: params.employeeId } }),
      staleTime: 2 * 60 * 1000,
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["employee-payroll-history", params.employeeId],
      queryFn: () =>
        getEmployeePayrollHistoryFn({ data: { employeeId: params.employeeId } }),
      staleTime: 5 * 60 * 1000,
    });
  },

  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <Suspense fallback={<GenericLoader
        className="my-auto"
        title="Loading Employee Details..."
        description="Please wait while we load the employee details."

      />}>
        <EmployeeDetailView />
      </Suspense>
    </>
  );
}

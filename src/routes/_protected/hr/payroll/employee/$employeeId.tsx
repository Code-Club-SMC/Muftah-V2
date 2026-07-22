import { createFileRoute } from "@tanstack/react-router";
import { getEmployeePayrollHistoryFn } from "@/server-functions/hr/payroll/dashboard-fn";
import { EmployeePayrollHistoryContainer } from "@/components/hr/employees/hr-payroll-employee-container";
import { GenericLoader } from "@/components/custom/generic-loader";
import { Suspense } from "react";


export const Route = createFileRoute(
  "/_protected/hr/payroll/employee/$employeeId",
)({
  loader: async ({ context: { queryClient }, params: { employeeId } }) => {
    void queryClient.prefetchQuery({
      queryKey: ["employee-payroll-history", employeeId, "last12", undefined],
      queryFn: () =>
        getEmployeePayrollHistoryFn({
          data: { employeeId, filterMode: "last12" },
        }),
      gcTime: 0,
    });
  },
  errorComponent: (error) => {
    return <div>Error: {error.error.message}</div>
  },
  component: Page,
});


function Page() {
  const { employeeId } = Route.useParams();
  return <Suspense fallback={<GenericLoader title="Loading Employee Payroll History" />}>
    <EmployeePayrollHistoryContainer employeeId={employeeId} />
  </Suspense>
}
import { GenericLoader } from "@/components/custom/generic-loader";
import { EmployeeListContainer } from "@/components/hr/employees/employee-list-container";
import { Separator } from "@/components/ui/separator";
import { getEmployeesFn } from "@/server-functions/hr/employees/get-employees-fn";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

export const Route = createFileRoute("/_protected/hr/employees/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["employees"],
      queryFn: getEmployeesFn,
    });
  },
  component: EmployeeListPage,
});

function EmployeeListPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Employees</h2>
        <p className="text-muted-foreground">
          Manage your employees and view transaction history.
        </p>
      </div>

      <Separator />
      <Suspense fallback={<GenericLoader title="Loading Employees" />}>
        <EmployeeListContainer />
      </Suspense>
    </div>
  );
}

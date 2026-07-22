import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Settings2 } from "lucide-react";
import { ExpenseCategoriesManager } from "@/components/finance/expense-categories-manager";
import { Button } from "@/components/ui/button";
import { listAllExpenseCategoriesFn } from "@/server-functions/finance/expense-categories-fn";

export const Route = createFileRoute("/_protected/finance/expenses/settings/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["expense-categories", "all"],
      queryFn: () => listAllExpenseCategoriesFn(),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8">
        <header className="border-b pb-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Settings2 className="size-6" />
                <h1 className="font-bold text-3xl uppercase tracking-tighter">
                  Expense Schema
                </h1>
              </div>
              <p className="mt-2 text-muted-foreground">
                Manage categories, fields, and select options used by expense
                entry and reporting.
              </p>
            </div>

            <Button asChild variant="outline" className="rounded-none shadow-none">
              <Link to="/finance/expenses">
                <ArrowLeft className="size-4 mr-2" />
                Back to Expenses
              </Link>
            </Button>
          </div>
        </header>

        <div className="flex-1 py-8">
          <ExpenseCategoriesManager />
        </div>
      </div>
    </main>
  );
}

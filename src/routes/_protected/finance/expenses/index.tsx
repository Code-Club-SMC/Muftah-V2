import { createFileRoute } from "@tanstack/react-router";
import { ExpensesContainer } from "@/components/finance/expenses-container";
import {
  getExpenseCategoryDefinitionsQueryOptions,
  getExpenseKpiQueryOptions,
  getExpenseListQueryOptions,
} from "@/hooks/finance/use-finance";
import {
  getCurrentMonthRange,
  getExpenseDateRangeFilters,
} from "@/lib/finance-expenses";

export const Route = createFileRoute("/_protected/finance/expenses/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      getExpenseCategoryDefinitionsQueryOptions(),
    );

    const { dateFrom, dateTo } = getExpenseDateRangeFilters(
      getCurrentMonthRange(),
    );

    void context.queryClient.prefetchQuery(
      getExpenseListQueryOptions({
        page: 1,
        limit: 60,
        offset: 0,
        dateFrom,
        dateTo,
      }),
    );

    void context.queryClient.prefetchQuery(
      getExpenseKpiQueryOptions({
        dateFrom,
        dateTo,
      }),
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8">
        <header className="border-b pb-8">
          <h1 className="font-bold text-3xl uppercase tracking-tighter">
            Expenses
          </h1>
          <p className="mt-2 text-muted-foreground">
            View and track all recorded expenses across accounts.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <ExpensesContainer />
        </div>
      </div>
    </main>
  );
}

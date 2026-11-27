import { useExpenseMonthSummary } from "@/hooks/finance/use-finance";
import { formatRupees } from "@/lib/finance/expense-entry";
import { describeMonthChange, toDayKey } from "@/lib/finance/expense-templates";

/** This calendar month, company-wide. Ignores the list filters on purpose. */
export function ExpenseMonthSummary() {
  const { data, isError } = useExpenseMonthSummary(toDayKey(new Date()));
  if (isError) return null;

  const change = data ? describeMonthChange(data.currentTotal, data.previousTotal) : null;
  const changeText =
    !data || !change
      ? "…"
      : data.previousTotal === 0
        ? "No spending last month"
        : change.direction === "same"
          ? "Same as the same days last month"
          : `${formatRupees(change.amount)} ${change.direction === "up" ? "more" : "less"} than the same days last month (${change.percent}%)`;

  return (
    <section className="grid gap-px border bg-border md:grid-cols-[1fr_2fr]" aria-label="This month">
      <div className="bg-card p-5">
        <p className="text-sm text-muted-foreground">This month</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{data ? formatRupees(data.currentTotal) : "…"}</p>
        {/* Spending going up is bad news, so the change line stays neutral rather than green or red. */}
        <p className="mt-1 text-sm text-muted-foreground">{changeText}</p>
      </div>
      <div className="bg-card p-5">
        <p className="text-sm text-muted-foreground">Top categories</p>
        {data && data.topCategories.length > 0 ? (
          <ol className="mt-2 space-y-1">
            {data.topCategories.map((category) => (
              <li key={category.categoryId} className="flex justify-between gap-4 text-sm">
                <span className="font-medium">{category.name}</span>
                <span className="tabular-nums">{formatRupees(category.total)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{data ? "Nothing spent yet this month." : "…"}</p>
        )}
      </div>
    </section>
  );
}

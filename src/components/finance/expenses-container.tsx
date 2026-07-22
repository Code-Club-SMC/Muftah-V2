import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { motion } from "framer-motion";
import {
  Banknote,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Receipt,
  Settings2,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { DatePicker } from "@/components/custom/date-picker";
import { GenericEmpty } from "@/components/custom/empty";
import { GenericLoader } from "@/components/custom/generic-loader";
import { FinanceEmptyIllustration } from "@/components/illustrations/FinanceEmptyIllustration";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import {
  useExpenseCategoryDefinitions,
  useExpenseKpis,
  useExpenses,
} from "@/hooks/finance/use-finance";
import {
  ALL_EXPENSE_CATEGORIES,
  getCurrentMonthRange,
  getExpenseDateRangeFilters,
  resolveExpenseCategoryFilter,
} from "@/lib/finance-expenses";
import { hasPermission } from "@/lib/rbac";
import type {
  ExpenseFieldValueDisplay,
  ExpenseListItem,
} from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const LIMIT = 60;

export const ExpensesContainer = () => {
  const [offset, setOffset] = useState(0);
  const [activeCategoryId, setActiveCategoryId] = useState(ALL_EXPENSE_CATEGORIES);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => getCurrentMonthRange());

  const { data: viewerAccess } = useViewerAccess();
  const canManageFinance = viewerAccess
    ? hasPermission(viewerAccess.permissions, "finance.manage")
    : false;

  const {
    data: categories = [],
    isLoading: isCategoriesLoading,
    isError: isCategoriesError,
    error: categoriesError,
  } = useExpenseCategoryDefinitions();

  const effectiveCategoryId = useMemo(() => {
    if (activeCategoryId === ALL_EXPENSE_CATEGORIES) {
      return ALL_EXPENSE_CATEGORIES;
    }

    return categories.some((category) => category.id === activeCategoryId)
      ? activeCategoryId
      : ALL_EXPENSE_CATEGORIES;
  }, [activeCategoryId, categories]);

  const selectedCategory = categories.find(
    (category) => category.id === effectiveCategoryId,
  );

  const { dateFrom, dateTo } = getExpenseDateRangeFilters(range);
  const categoryIdFilter = resolveExpenseCategoryFilter(effectiveCategoryId);

  const expensesQuery = useExpenses({
    limit: LIMIT,
    offset,
    categoryId: categoryIdFilter,
    dateFrom,
    dateTo,
  });

  const kpisQuery = useExpenseKpis({
    categoryId: categoryIdFilter,
    dateFrom,
    dateTo,
  });

  const expenses = expensesQuery.data?.data ?? [];
  const total = expensesQuery.data?.total ?? 0;
  const hasMore = expensesQuery.data?.hasMore ?? false;
  const page = Math.floor(offset / LIMIT) + 1;
  const pageCount = Math.max(1, Math.ceil(total / LIMIT));

  const onRangeChange = (nextRange: DateRange | undefined) => {
    setRange(nextRange ?? getCurrentMonthRange());
    setOffset(0);
  };

  const handleCategoryChange = (nextCategoryId: string) => {
    setActiveCategoryId(nextCategoryId);
    setExpandedExpenseId(null);
    setOffset(0);
  };

  const toggleExpenseDetails = (expenseId: string) => {
    setExpandedExpenseId((current) => (current === expenseId ? null : expenseId));
  };

  const startTutorial = () => {
    const tour = driver({
      showProgress: true,
      allowClose: true,
      steps: [
        {
          popover: {
            title: "Expense Management Guide",
            description:
              "This guide shows how to filter, review, and manage expense records.",
          },
        },
        {
          element: '[data-tour="manage-tutorial-btn"]',
          popover: {
            title: "Replay Tutorial",
            description: "Use this button anytime to run the guide again.",
          },
        },
        {
          element: '[data-tour="category-filters"]',
          popover: {
            title: "Filter by Category",
            description: "Click category tabs to show only expenses from that category.",
          },
        },
        {
          element: '[data-tour="date-filter"]',
          popover: {
            title: "Filter by Date",
            description: "Use date range to focus on a specific period.",
          },
        },
        {
          element: '[data-tour="schema-btn"]',
          popover: {
            title: "Manage Schema",
            description:
              "Open schema settings to change categories and fields used in expenses.",
          },
        },
        {
          element: '[data-tour="expense-table"]',
          popover: {
            title: "Review Expenses",
            description: "This table shows all matching expenses with amount, account, and remarks.",
          },
        },
        {
          element: '[data-tour="expense-expand"]',
          popover: {
            title: "View Saved Field Details",
            description: "Use the expand arrow to see saved custom fields for a record.",
          },
        },
      ],
    });

    tour.drive();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" data-tour="category-filters">
          <Button
            variant={
              effectiveCategoryId === ALL_EXPENSE_CATEGORIES ? "default" : "outline"
            }
            className={cn(
              "h-9 rounded-none",
              effectiveCategoryId !== ALL_EXPENSE_CATEGORIES && "shadow-none",
            )}
            onClick={() => handleCategoryChange(ALL_EXPENSE_CATEGORIES)}
          >
            All Categories
          </Button>

          {categories.map((category) => (
            <Button
              key={category.id}
              variant={category.id === effectiveCategoryId ? "default" : "outline"}
              className={cn(
                "h-9 rounded-none",
                category.id !== effectiveCategoryId && "shadow-none",
              )}
              onClick={() => handleCategoryChange(category.id)}
            >
              {category.name}
            </Button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <DatePicker
            mode="range"
            range={range}
            onRangeChange={onRangeChange}
            placeholder="Current month"
            className="h-9 min-w-65 rounded-none shadow-none"
            tourId="date-filter"
          />

          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-none shadow-none"
            onClick={startTutorial}
            data-tour="manage-tutorial-btn"
          >
            <BookOpen className="size-4 mr-2" />
            Start Tutorial
          </Button>

          {canManageFinance ? (
            <Button asChild variant="outline" className="h-9 rounded-none shadow-none" data-tour="schema-btn">
              <Link to="/finance/expenses/settings">
                <Settings2 className="size-4 mr-2" />
                Manage Schema
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {isCategoriesLoading ? (
        <div className="border border-border rounded-none">
          <GenericLoader
            title="Loading category filters"
            description="Preparing expense categories for reporting."
          />
        </div>
      ) : null}

      {isCategoriesError ? (
        <Alert variant="destructive" className="rounded-none">
          <TriangleAlert className="size-4" />
          <AlertTitle>Category filters unavailable</AlertTitle>
          <AlertDescription>
            {categoriesError instanceof Error
              ? categoriesError.message
              : "Expense categories could not be loaded. Expense reporting is still available for all categories."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isCategoriesLoading && !isCategoriesError && categories.length === 0 ? (
        <Alert className="rounded-none">
          <TriangleAlert className="size-4" />
          <AlertTitle>No active expense categories</AlertTitle>
          <AlertDescription>
            Reporting still shows saved historical expenses, but there are no active categories
            available for filtering.
            {canManageFinance ? (
              <>
                {" "}
                Use{" "}
                <Link
                  to="/finance/expenses/settings"
                  className="font-medium underline underline-offset-4"
                >
                  schema settings
                </Link>{" "}
                to add or reactivate categories.
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ExpenseKpiCard
          title="Total Records"
          icon={Receipt}
          theme="rose"
          value={
            kpisQuery.isError
              ? "—"
              : kpisQuery.isFetching
                ? "..."
                : (kpisQuery.data?.totalRecords ?? 0).toLocaleString()
          }
        />
        <ExpenseKpiCard
          title="Total Cash"
          icon={Banknote}
          theme="emerald"
          value={
            kpisQuery.isError
              ? "—"
              : kpisQuery.isFetching
                ? "..."
                : `₨ ${(kpisQuery.data?.totalCash ?? 0).toLocaleString()}`
          }
        />
        <ExpenseKpiCard
          title="Avg Cash / Record"
          icon={TrendingUp}
          theme="blue"
          value={
            kpisQuery.isError
              ? "—"
              : kpisQuery.isFetching
                ? "..."
                : `₨ ${(kpisQuery.data?.avgCashPerRecord ?? 0).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}`
          }
        />
      </div>

      {kpisQuery.isError ? (
        <Alert variant="destructive" className="rounded-none">
          <TriangleAlert className="size-4" />
          <AlertTitle>KPI data unavailable</AlertTitle>
          <AlertDescription>
            {kpisQuery.error instanceof Error
              ? kpisQuery.error.message
              : "Expense summary metrics could not be loaded."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="border border-border rounded-none overflow-hidden" data-tour="expense-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Slip / Ref</TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead>Performed By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expensesQuery.isFetching && !expensesQuery.data ? (
              <TableRow>
                <TableCell colSpan={9} className="h-28 text-center">
                  <GenericLoader
                    title="Loading expenses"
                    description="Fetching expense records for the selected filters."
                  />
                </TableCell>
              </TableRow>
            ) : expensesQuery.isError ? (
              <TableRow>
                <TableCell colSpan={9} className="p-0">
                  <Alert variant="destructive" className="rounded-none border-0">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>Expense list unavailable</AlertTitle>
                    <AlertDescription>
                      {expensesQuery.error instanceof Error
                        ? expensesQuery.error.message
                        : "Expense records could not be loaded."}
                    </AlertDescription>
                  </Alert>
                </TableCell>
              </TableRow>
            ) : expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-28 p-0">
                  <GenericEmpty
                    icon={FinanceEmptyIllustration}
                    title="No Expenses Found"
                    description="No expenses match the selected category and date range."
                  />
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((expense) => {
                const isExpanded = expandedExpenseId === expense.id;

                return (
                  <Fragment key={expense.id}>
                    <TableRow>
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-none"
                          onClick={() => toggleExpenseDetails(expense.id)}
                          aria-label={
                            isExpanded
                              ? "Hide expense details"
                              : "Show expense details"
                          }
                          data-tour="expense-expand"
                        >
                          {isExpanded ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums align-top">
                        {format(new Date(expense.expenseDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="font-medium align-top">
                        {expense.description}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-2">
                          <span>{expense.category?.name ?? "—"}</span>
                          {expense.category?.isArchived ? (
                            <Badge variant="destructive" className="rounded-none w-fit">
                              Archived Category
                            </Badge>
                          ) : expense.category && !expense.category.isActive ? (
                            <Badge variant="outline" className="rounded-none w-fit">
                              Inactive Category
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {expense.wallet?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums align-top">
                        ₨ {Number(expense.amount || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="align-top">
                        {expense.slipNumber || "—"}
                      </TableCell>
                      <TableCell className="align-top">
                        {expense.remarks || "—"}
                      </TableCell>
                      <TableCell className="align-top">
                        {expense.performer?.name ?? "—"}
                      </TableCell>
                    </TableRow>

                    {isExpanded ? (
                      <TableRow className="bg-muted/10">
                        <TableCell colSpan={9}>
                          <ExpenseDynamicFieldDetails expense={expense} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground font-semibold uppercase tabular-nums">
          Page {page} of {pageCount} · {total} total
          {selectedCategory ? ` · ${selectedCategory.name}` : ""}
        </p>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            className="rounded-none shadow-none flex-1 sm:flex-none"
            disabled={offset <= 0}
            onClick={() => {
              setExpandedExpenseId(null);
              setOffset((prev) => Math.max(0, prev - LIMIT));
            }}
          >
            <ChevronLeft className="size-4 mr-1" />
            Prev
          </Button>
          <Button
            variant="outline"
            className="rounded-none shadow-none flex-1 sm:flex-none"
            disabled={!hasMore}
            onClick={() => {
              setExpandedExpenseId(null);
              setOffset((prev) => prev + LIMIT);
            }}
          >
            Next
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
};

function ExpenseKpiCard({
  title,
  value,
  icon: Icon,
  theme,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  theme: KPITheme;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2",
        styles.border,
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
          backgroundSize: "8px 8px",
        }}
      />

      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>

      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
          {value}
        </h3>
        <div className="h-4" />
      </div>
    </motion.div>
  );
}

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

const sharpThemeStyles = {
  blue: {
    border: "border-t-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
  },
  rose: {
    border: "border-t-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-500",
  },
  emerald: {
    border: "border-t-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
  },
  violet: {
    border: "border-t-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-500",
  },
  amber: {
    border: "border-t-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
  },
};

function ExpenseDynamicFieldDetails({
  expense,
}: {
  expense: ExpenseListItem;
}) {
  if (expense.dynamicFields.length === 0) {
    return (
      <div className="py-2">
        <p className="text-sm font-medium">No custom field data saved for this expense.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Saved Custom Fields</p>
          <p className="text-xs text-muted-foreground">
            Historical field values remain visible even if the schema changed later.
          </p>
        </div>
        <Badge variant="outline" className="rounded-none">
          {expense.dynamicFields.length} saved values
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {expense.dynamicFields.map((field) => (
          <ExpenseDynamicFieldCard key={field.id} field={field} />
        ))}
      </div>
    </div>
  );
}

function ExpenseDynamicFieldCard({
  field,
}: {
  field: ExpenseFieldValueDisplay;
}) {
  return (
    <div className="border border-border rounded-none p-3 space-y-2 bg-background">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {field.fieldLabel}
        </p>
        {field.isFieldActive === false ? (
          <Badge variant="outline" className="rounded-none">
            Inactive Field
          </Badge>
        ) : null}
        {field.isOptionActive === false ? (
          <Badge variant="outline" className="rounded-none">
            Inactive Option
          </Badge>
        ) : null}
      </div>

      <p className="text-sm font-semibold wrap-break-word">{field.displayValue}</p>

      <p className="text-xs text-muted-foreground">
        {[field.fieldKey, field.fieldType].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

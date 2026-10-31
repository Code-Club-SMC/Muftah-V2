import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { motion } from "framer-motion";
import {
  Ban,
  Banknote,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pencil,
  Plus,
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
  useWallets,
} from "@/hooks/finance/use-finance";
import {
  ALL_EXPENSE_CATEGORIES,
  getCurrentMonthRange,
  getExpenseDateRangeFilters,
  resolveExpenseCategoryFilter,
} from "@/lib/finance-expenses";
import { getExpenseLockReason } from "@/lib/finance/expense-corrections";
import { getExpenseTitle, isNewExpenseShortcut } from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";
import type {
  ExpenseFieldValueDisplay,
  ExpenseListItem,
} from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExpenseFormSheet } from "./expense-form-sheet";
import { ExpenseHistory } from "./expense-history";
import { VoidExpenseDialog } from "./void-expense-dialog";

const LIMIT = 60;
const COLUMN_COUNT = 9;

export const ExpensesContainer = () => {
  const [offset, setOffset] = useState(0);
  const [activeCategoryId, setActiveCategoryId] = useState(ALL_EXPENSE_CATEGORIES);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => getCurrentMonthRange());
  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseListItem | null>(null);
  const [voidTarget, setVoidTarget] = useState<ExpenseListItem | null>(null);

  const { data: viewerAccess } = useViewerAccess();
  const canManageFinance = viewerAccess
    ? hasPermission(viewerAccess.permissions, "finance.manage")
    : false;

  const { data: wallets = [] } = useWallets();
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

  const openCreate = () => {
    setEditingExpense(null);
    setFormOpen(true);
  };

  const openEdit = (expense: ExpenseListItem) => {
    setEditingExpense(expense);
    setFormOpen(true);
  };

  // "N" opens Record expense, unless the user is typing or another dialog is open.
  useEffect(() => {
    if (!canManageFinance) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewExpenseShortcut(event)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      setEditingExpense(null);
      setFormOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canManageFinance]);

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

  return (
    <div className="space-y-5">
      {canManageFinance ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button className="h-10 gap-2 rounded-none shadow-none" onClick={openCreate}>
            <Plus className="size-4" />
            Record expense
            <Kbd className="ml-1">N</Kbd>
          </Button>
          <Button asChild variant="outline" className="h-10 rounded-none shadow-none">
            <Link to="/finance/expenses/settings">
              <Settings2 className="mr-2 size-4" />
              Expense Categories
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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

        <DatePicker
          mode="range"
          range={range}
          onRangeChange={onRangeChange}
          placeholder="Current month"
          className="h-9 min-w-65 rounded-none shadow-none"
        />
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
            Saved expenses still show below, but there are no active categories to filter by or
            to record new expenses with.
            {canManageFinance ? (
              <>
                {" "}
                Add or switch them on in{" "}
                <Link
                  to="/finance/expenses/settings"
                  className="font-medium underline underline-offset-4"
                >
                  Expense Categories
                </Link>
                .
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

      <div className="border border-border rounded-none overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Date</TableHead>
              <TableHead>Expense</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Paid to</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {expensesQuery.isFetching && !expensesQuery.data ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="h-28 text-center">
                  <GenericLoader
                    title="Loading expenses"
                    description="Fetching expense records for the selected filters."
                  />
                </TableCell>
              </TableRow>
            ) : expensesQuery.isError ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="p-0">
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
                <TableCell colSpan={COLUMN_COUNT} className="h-28 p-0">
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
                const isVoided = expense.voidedAt !== null;
                const lockReason = getExpenseLockReason(expense);

                return (
                  <Fragment key={expense.id}>
                    <TableRow className={cn(isVoided && "opacity-60")}>
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-none"
                          onClick={() => toggleExpenseDetails(expense.id)}
                          aria-label={isExpanded ? "Hide expense details" : "Show expense details"}
                        >
                          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums align-top">
                        {format(new Date(expense.expenseDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="font-medium align-top">
                        <div className="flex flex-col gap-1">
                          <span className={cn(isVoided && "line-through")}>{getExpenseTitle(expense)}</span>
                          {isVoided ? (
                            <Badge variant="destructive" className="rounded-none w-fit">
                              Voided
                            </Badge>
                          ) : null}
                        </div>
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
                      <TableCell className="align-top">{expense.payee ?? "—"}</TableCell>
                      <TableCell className="align-top">{expense.wallet?.name ?? "—"}</TableCell>
                      <TableCell className={cn("text-right font-semibold tabular-nums align-top", isVoided && "line-through")}>
                        ₨ {Number(expense.amount || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="align-top">{expense.performer?.name ?? "—"}</TableCell>
                      <TableCell className="align-top text-right">
                        {isVoided ? null : lockReason ? (
                          <Badge
                            variant="outline"
                            className="rounded-none"
                            title={lockReason}
                          >
                            Auto
                          </Badge>
                        ) : canManageFinance ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-none"
                              aria-label="Edit expense"
                              onClick={() => openEdit(expense)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-none text-rose-500 hover:text-rose-600"
                              aria-label="Void expense"
                              onClick={() => setVoidTarget(expense)}
                            >
                              <Ban className="size-4" />
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>

                    {isExpanded ? (
                      <TableRow className="bg-muted/10">
                        <TableCell colSpan={COLUMN_COUNT}>
                          <ExpenseRowDetails expense={expense} />
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

      <ExpenseFormSheet
        open={formOpen}
        // The expense stays set while the sheet animates closed; opening "Record expense" clears it.
        onOpenChange={setFormOpen}
        wallets={wallets}
        expense={editingExpense}
      />
      <VoidExpenseDialog
        expense={voidTarget}
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
      />
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

function ExpenseRowDetails({ expense }: { expense: ExpenseListItem }) {
  const facts = (
    [
      ["Note", expense.description],
      ["Slip / ref", expense.slipNumber],
      ["Remarks", expense.remarks],
    ] satisfies Array<[string, string | null]>
  ).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));

  return (
    <div className="grid gap-6 py-2 lg:grid-cols-2">
      <div className="space-y-4">
        {facts.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {facts.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        ) : null}
        <ExpenseDynamicFieldDetails expense={expense} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">History</p>
        <ExpenseHistory expense={expense} />
      </div>
    </div>
  );
}

function ExpenseDynamicFieldDetails({
  expense,
}: {
  expense: ExpenseListItem;
}) {
  if (expense.dynamicFields.length === 0) {
    return (
      <div className="py-2">
        <p className="text-sm text-muted-foreground">No extra details saved for this expense.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Extra details</p>
          <p className="text-xs text-muted-foreground">
            Saved values stay visible even if the category's fields change later.
          </p>
        </div>
        <Badge variant="outline" className="rounded-none">
          {expense.dynamicFields.length} saved values
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        <p className="text-sm font-medium text-muted-foreground">{field.fieldLabel}</p>
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
    </div>
  );
}

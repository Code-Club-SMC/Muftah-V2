import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Repeat, Settings2, TriangleAlert } from "lucide-react";
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
import { getExpenseDateRangeFilters } from "@/lib/finance-expenses";
import { getExpenseLockReason } from "@/lib/finance/expense-corrections";
import { formatRupees, isNewExpenseShortcut } from "@/lib/finance/expense-entry";
import type { TemplateReminder } from "@/lib/finance/expense-templates";
import { hasPermission } from "@/lib/rbac";
import type { ExpenseListItem, ExpenseTemplate } from "@/lib/types/finance-types";
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
import { ExpenseDetailSheet } from "./expense-detail-sheet";
import { defaultExpenseFilters, ExpenseFilters, type ExpenseFilterState } from "./expense-filters";
import { ExpenseFormSheet } from "./expense-form-sheet";
import { ExpenseMonthSummary } from "./expense-month-summary";
import { ExpenseReminders } from "./expense-reminders";
import { ExpenseTemplateDialog, type TemplateSource } from "./expense-template-dialog";
import { ExpenseTemplatesSheet } from "./expense-templates-sheet";
import { VoidExpenseDialog } from "./void-expense-dialog";

const LIMIT = 60;
const COLUMN_COUNT = 5;

export const ExpensesContainer = () => {
  const [filters, setFilters] = useState<ExpenseFilterState>(defaultExpenseFilters);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<ExpenseListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseListItem | null>(null);
  const [formTemplate, setFormTemplate] = useState<{ template: ExpenseTemplate; reminder: TemplateReminder } | null>(
    null,
  );
  const [voidTarget, setVoidTarget] = useState<ExpenseListItem | null>(null);
  const [templateSource, setTemplateSource] = useState<TemplateSource>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

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

  // Filters reset paging. Stable so the filters' typing pause doesn't restart on every render.
  const changeFilters = useCallback((next: ExpenseFilterState) => {
    setFilters(next);
    setOffset(0);
  }, []);

  const { dateFrom, dateTo } = getExpenseDateRangeFilters(filters.range);
  const shared = {
    categoryIds: filters.categoryIds,
    walletId: filters.walletId || undefined,
    payee: filters.payee.trim() || undefined,
    dateFrom,
    dateTo,
  };
  const expensesQuery = useExpenses({ limit: LIMIT, offset, ...shared });
  const kpisQuery = useExpenseKpis(shared);

  const expenses = expensesQuery.data?.data ?? [];
  const total = expensesQuery.data?.total ?? 0;
  const hasMore = expensesQuery.data?.hasMore ?? false;
  const page = Math.floor(offset / LIMIT) + 1;
  const pageCount = Math.max(1, Math.ceil(total / LIMIT));

  const openCreate = () => {
    setEditingExpense(null);
    setFormTemplate(null);
    setFormOpen(true);
  };
  const openEdit = (expense: ExpenseListItem) => {
    setDetail(null);
    setEditingExpense(expense);
    setFormTemplate(null);
    setFormOpen(true);
  };
  const openVoid = (expense: ExpenseListItem) => {
    setDetail(null);
    setVoidTarget(expense);
  };
  const openSaveTemplate = (expense: ExpenseListItem) => {
    setDetail(null);
    setTemplateSource({ kind: "expense", expense });
  };
  const recordFromReminder = (template: ExpenseTemplate, reminder: TemplateReminder) => {
    setEditingExpense(null);
    setFormTemplate({ template, reminder });
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
      setFormTemplate(null);
      setFormOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canManageFinance]);

  return (
    <div className="space-y-5">
      {canManageFinance ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button className="h-10 gap-2 rounded-none shadow-none" onClick={openCreate}>
            <Plus className="size-4" />
            Record expense
            <Kbd className="ml-1">N</Kbd>
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10 flex-1 rounded-none shadow-none sm:flex-none"
              onClick={() => setTemplatesOpen(true)}
            >
              <Repeat className="mr-2 size-4" />
              Templates
            </Button>
            <Button asChild variant="outline" className="h-10 flex-1 rounded-none shadow-none sm:flex-none">
              <Link to="/finance/expenses/settings">
                <Settings2 className="mr-2 size-4" />
                Expense Categories
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      {canManageFinance ? <ExpenseReminders onRecord={recordFromReminder} /> : null}
      <ExpenseMonthSummary />
      <ExpenseFilters value={filters} onChange={changeFilters} categories={categories} wallets={wallets} />

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

      {/* w-0 + min-w-full: the table scrolls inside its box instead of widening the whole page. */}
      <div className="w-0 min-w-full overflow-x-auto border border-border rounded-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Paid to</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Account</TableHead>
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
                    description="No expenses match these filters."
                  />
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((expense) => {
                const isVoided = expense.voidedAt !== null;
                const note = expense.description.trim();
                return (
                  <TableRow
                    key={expense.id}
                    tabIndex={0}
                    className={cn("cursor-pointer", isVoided && "opacity-60")}
                    onClick={() => setDetail(expense)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setDetail(expense);
                    }}
                  >
                    <TableCell className="font-medium tabular-nums align-top">
                      {format(new Date(expense.expenseDate), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="min-w-44 whitespace-normal align-top">
                      <div className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          {expense.category?.name ?? "—"}
                          {isVoided ? (
                            <Badge variant="destructive" className="rounded-none">
                              Voided
                            </Badge>
                          ) : null}
                          {!isVoided && getExpenseLockReason(expense) ? (
                            <Badge variant="outline" className="rounded-none">
                              Auto
                            </Badge>
                          ) : null}
                        </span>
                        {note ? <span className="text-xs text-muted-foreground wrap-break-word">{note}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-28 whitespace-normal wrap-break-word align-top">
                      {expense.payee ?? "—"}
                    </TableCell>
                    <TableCell
                      className={cn("text-right font-semibold tabular-nums align-top", isVoided && "line-through")}
                    >
                      {formatRupees(expense.amount)}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">{expense.wallet?.name ?? "—"}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* The count is rows on screen (voided included); the money is real spend (voided left out). */}
        <p className="text-sm text-muted-foreground tabular-nums">
          Page {page} of {pageCount} · {total} {total === 1 ? "expense" : "expenses"}
          {kpisQuery.data ? ` · ${formatRupees(kpisQuery.data.totalCash)}` : ""}
        </p>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            className="rounded-none shadow-none flex-1 sm:flex-none"
            disabled={offset <= 0}
            onClick={() => setOffset((prev) => Math.max(0, prev - LIMIT))}
          >
            <ChevronLeft className="size-4 mr-1" />
            Prev
          </Button>
          <Button
            variant="outline"
            className="rounded-none shadow-none flex-1 sm:flex-none"
            disabled={!hasMore}
            onClick={() => setOffset((prev) => prev + LIMIT)}
          >
            Next
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </div>

      <ExpenseDetailSheet
        expense={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        canManage={canManageFinance}
        onEdit={openEdit}
        onVoid={openVoid}
        onSaveTemplate={openSaveTemplate}
      />
      <ExpenseFormSheet
        open={formOpen}
        // The expense stays set while the sheet animates closed; opening "Record expense" clears it.
        onOpenChange={setFormOpen}
        wallets={wallets}
        expense={editingExpense}
        template={formTemplate?.template ?? null}
        reminder={formTemplate?.reminder ?? null}
      />
      <VoidExpenseDialog
        expense={voidTarget}
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
      />
      <ExpenseTemplateDialog
        open={templateSource !== null}
        onOpenChange={(open) => {
          if (!open) setTemplateSource(null);
        }}
        source={templateSource}
      />
      <ExpenseTemplatesSheet open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </div>
  );
};

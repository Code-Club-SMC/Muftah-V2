import { Fragment } from "react";
import { format } from "date-fns";
import { Ban, Pencil, Repeat } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getExpenseLockReason } from "@/lib/finance/expense-corrections";
import { formatRupees, getExpenseTitle } from "@/lib/finance/expense-entry";
import type { ExpenseFieldValueDisplay, ExpenseListItem } from "@/lib/types/finance-types";
import { ExpenseHistory } from "./expense-history";

export function ExpenseDetailSheet({
  expense,
  open,
  onOpenChange,
  canManage,
  onEdit,
  onVoid,
  onSaveTemplate,
}: {
  expense: ExpenseListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onEdit: (expense: ExpenseListItem) => void;
  onVoid: (expense: ExpenseListItem) => void;
  onSaveTemplate: (expense: ExpenseListItem) => void;
}) {
  if (!expense) return null;
  const isVoided = expense.voidedAt !== null;
  const lockReason = getExpenseLockReason(expense);

  const facts = (
    [
      ["Date", format(new Date(expense.expenseDate), "dd MMM yyyy")],
      ["What for", expense.category?.name ?? null],
      ["Paid to", expense.payee],
      ["Paid from", expense.wallet?.name ?? null],
      ["Note", expense.description],
      ["Slip / ref", expense.slipNumber],
      ["Remarks", expense.remarks],
      ["Recorded by", expense.performer?.name ?? null],
    ] satisfies Array<[string, string | null]>
  ).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Expense details"
      description={getExpenseTitle(expense)}
    >
      <div className="space-y-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className={isVoided ? "text-3xl font-bold tabular-nums line-through" : "text-3xl font-bold tabular-nums"}>
            {formatRupees(expense.amount)}
          </p>
          {isVoided ? (
            <Badge variant="destructive" className="rounded-none">
              Voided
            </Badge>
          ) : null}
          {!isVoided && lockReason ? (
            <Badge variant="outline" className="rounded-none" title={lockReason}>
              Auto
            </Badge>
          ) : null}
        </div>

        {canManage && !isVoided ? (
          <div className="flex flex-wrap gap-2">
            {!lockReason ? (
              <>
                <Button variant="outline" className="rounded-none shadow-none" onClick={() => onEdit(expense)}>
                  <Pencil className="mr-2 size-4" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className="rounded-none text-rose-500 shadow-none hover:text-rose-600"
                  onClick={() => onVoid(expense)}
                >
                  <Ban className="mr-2 size-4" />
                  Void
                </Button>
              </>
            ) : null}
            <Button variant="outline" className="rounded-none shadow-none" onClick={() => onSaveTemplate(expense)}>
              <Repeat className="mr-2 size-4" />
              Save as template
            </Button>
          </div>
        ) : null}
        {!isVoided && lockReason ? <p className="text-sm text-muted-foreground">{lockReason}</p> : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="wrap-break-word">{value}</dd>
            </Fragment>
          ))}
        </dl>

        <ExpenseDynamicFieldDetails expense={expense} />

        <div className="space-y-2">
          <p className="text-sm font-semibold">History</p>
          <ExpenseHistory expense={expense} />
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function ExpenseDynamicFieldDetails({ expense }: { expense: ExpenseListItem }) {
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

function ExpenseDynamicFieldCard({ field }: { field: ExpenseFieldValueDisplay }) {
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

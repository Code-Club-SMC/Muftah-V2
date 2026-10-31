import { useEffect, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  Building2,
  ChevronDown,
  ReceiptIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { DatePicker } from "@/components/custom/date-picker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateExpense,
  useExpenseCategoryDefinitions,
  useExpenseEntryDefaults,
  useUpdateExpense,
} from "@/hooks/finance/use-finance";
import {
  buildExpenseFieldValueInputs,
  toExpenseFieldDrafts,
  type ExpenseFieldDraftValue,
} from "@/lib/finance-expenses";
import {
  describeWalletChange,
  isOverdrawConfirmError,
  planExpenseWalletChanges,
} from "@/lib/finance/expense-corrections";
import {
  formatAmountInput,
  formatRupees,
  getBalanceAfter,
  MAX_EXPENSE_AMOUNT,
  parseAmountInput,
} from "@/lib/finance/expense-entry";
import type {
  ExpenseCategoryDefinition,
  ExpenseCategoryFieldDefinition,
  ExpenseListItem,
  FinanceWalletSummary,
} from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";
import { DepositSheet } from "./deposit-sheet";
import { ExpenseAmountField } from "./expense-amount-field";
import { ExpenseCategoryPicker } from "./expense-category-picker";
import { ExpenseDynamicFieldInput } from "./expense-dynamic-field-input";
import { ExpensePayeeField } from "./expense-payee-field";
import { OverdrawConfirmDialog } from "./overdraw-confirm-dialog";

type ExpenseFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: FinanceWalletSummary[];
  preselectedWalletId?: string | null;
  expense?: ExpenseListItem | null;
};

type SaveMode = "close" | "another";

type ExpenseDraft = {
  amount: string;
  categoryId: string;
  payee: string;
  walletId: string;
  expenseDate: Date | undefined;
  note: string;
  slipNumber: string;
  fieldValues: Record<string, ExpenseFieldDraftValue>;
};

const emptyDraft = (): ExpenseDraft => ({
  amount: "",
  categoryId: "",
  payee: "",
  walletId: "",
  expenseDate: new Date(),
  note: "",
  slipNumber: "",
  fieldValues: {},
});

const draftFromExpense = (expense: ExpenseListItem): ExpenseDraft => ({
  amount: formatAmountInput(String(Number(expense.amount))),
  categoryId: expense.category?.id ?? "",
  payee: expense.payee ?? "",
  walletId: expense.wallet?.id ?? "",
  expenseDate: new Date(expense.expenseDate),
  note: expense.description,
  slipNumber: expense.slipNumber ?? "",
  fieldValues: toExpenseFieldDrafts(expense.dynamicFields),
});

/** Compares two drafts by what the user can see, so an untouched edit form is not "dirty". */
const draftKey = (draft: ExpenseDraft) =>
  JSON.stringify({ ...draft, expenseDate: draft.expenseDate?.toDateString() ?? null });

/**
 * Field definitions rebuilt from the values an expense already has. Used when its category has
 * been switched off since, because switched-off categories are not in the category list.
 */
const fieldsFromSavedValues = (expense: ExpenseListItem): ExpenseCategoryFieldDefinition[] =>
  expense.dynamicFields.flatMap((saved, index) =>
    saved.fieldType && saved.isFieldActive !== false
      ? [
          {
            id: saved.fieldId,
            key: saved.fieldKey ?? saved.fieldId,
            label: saved.fieldLabel,
            fieldType: saved.fieldType,
            isRequired: false,
            isActive: true,
            sortOrder: index,
            placeholder: null,
            options: saved.valueOptionId
              ? [
                  {
                    id: saved.valueOptionId,
                    value: saved.valueOptionId,
                    label: saved.optionLabel ?? saved.displayValue,
                    sortOrder: 0,
                    isActive: saved.isOptionActive !== false,
                  },
                ]
              : [],
          },
        ]
      : [],
  );

/** Keeps a saved select option on screen even if it was switched off since (the server allows keeping it). */
const withSavedOptions = (
  fields: ExpenseCategoryFieldDefinition[],
  expense: ExpenseListItem,
): ExpenseCategoryFieldDefinition[] =>
  fields.map((field) => {
    const saved = expense.dynamicFields.find((value) => value.fieldId === field.id);
    if (field.fieldType !== "select" || !saved?.valueOptionId) return field;
    if (field.options.some((option) => option.id === saved.valueOptionId)) return field;
    return {
      ...field,
      options: [
        ...field.options,
        {
          id: saved.valueOptionId,
          value: saved.valueOptionId,
          label: saved.optionLabel ?? saved.displayValue,
          sortOrder: Number.MAX_SAFE_INTEGER,
          isActive: false,
        },
      ],
    };
  });

const labelClass = "text-sm font-medium";

export function ExpenseFormSheet({
  open,
  onOpenChange,
  wallets,
  preselectedWalletId = null,
  expense = null,
}: ExpenseFormSheetProps) {
  const isEdit = expense !== null;
  const {
    data: categories = [],
    isLoading: isLoadingCategories,
    isError: isCategoriesError,
  } = useExpenseCategoryDefinitions();
  const { data: defaults } = useExpenseEntryDefaults(open);
  const createMutation = useCreateExpense();
  const updateMutation = useUpdateExpense();
  const amountRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [initialKey, setInitialKey] = useState(() => draftKey(emptyDraft()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<SaveMode | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  // Fresh form each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const preselected = wallets.some((item) => item.id === preselectedWalletId) ? preselectedWalletId : null;
    const next = expense ? draftFromExpense(expense) : { ...emptyDraft(), walletId: preselected ?? "" };
    setDraft(next);
    setInitialKey(draftKey(next));
    setDetailsOpen(false);
    setPendingMode(null);
    setDepositOpen(false);
    // Wallet balances change often; the form only needs them once per open to pick a valid default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense, preselectedWalletId]);

  // "Paid from" defaults to the account on this user's most recent expense, unless one is already picked.
  const lastWalletId = defaults?.lastWalletId ?? null;
  useEffect(() => {
    if (!open || isEdit || !lastWalletId || !wallets.some((wallet) => wallet.id === lastWalletId)) return;
    setDraft((current) => (current.walletId ? current : { ...current, walletId: lastWalletId }));
  }, [open, isEdit, lastWalletId, wallets]);

  // An edit may keep a category that was switched off later; show it so it is still selected.
  const keepsInactiveCategory =
    expense?.category != null && !categories.some((category) => category.id === expense.category?.id);
  const pickerCategories: ExpenseCategoryDefinition[] =
    expense?.category && keepsInactiveCategory
      ? [
          ...categories,
          {
            ...expense.category,
            name: `${expense.category.name} (switched off)`,
            sortOrder: Number.MAX_SAFE_INTEGER,
            fields: fieldsFromSavedValues(expense),
          },
        ]
      : categories;
  const categoryFields = pickerCategories.find((category) => category.id === draft.categoryId)?.fields ?? [];
  const selectedFields =
    expense && draft.categoryId === expense.category?.id ? withSavedOptions(categoryFields, expense) : categoryFields;
  const hasRequiredDetails = selectedFields.some((field) => field.isRequired);
  const showDetails = detailsOpen || hasRequiredDetails;

  const wallet = wallets.find((item) => item.id === draft.walletId);
  const amount = parseAmountInput(draft.amount);
  const walletChanges =
    expense?.wallet && draft.walletId && amount > 0
      ? planExpenseWalletChanges({ walletId: expense.wallet.id, amount: expense.amount }, { walletId: draft.walletId, amount })
      : [];
  // Create: the whole amount leaves the account. Edit: only the extra taken from the chosen account.
  const debitOnWallet: string | number = isEdit
    ? (walletChanges.find((change) => change.walletId === draft.walletId && change.type === "debit")?.amount ?? 0)
    : amount;
  const balanceAfter = wallet && amount > 0 ? getBalanceAfter(wallet.balance, debitOnWallet) : null;
  const overdrawn = balanceAfter !== null && Number(debitOnWallet) > 0 && Number(balanceAfter) < 0;

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isDirty = draftKey(draft) !== initialKey;
  const update = (patch: Partial<ExpenseDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const changeCategory = (categoryId: string) => {
    if (categoryId === draft.categoryId) return;
    // Going back to the expense's own category brings its saved details back.
    const fieldValues =
      expense && categoryId === expense.category?.id ? toExpenseFieldDrafts(expense.dynamicFields) : {};
    update({ categoryId, fieldValues });
  };

  const save = (mode: SaveMode, allowOverdraw = false) => {
    if (isPending) return;
    if (amount <= 0) return void toast.error("Enter the amount");
    if (amount > MAX_EXPENSE_AMOUNT) return void toast.error("Amount is too large");
    if (!draft.categoryId) return void toast.error("Pick what the money was for");
    if (!draft.walletId || !wallet) return void toast.error("Pick the account the money was paid from");
    if (!draft.expenseDate) return void toast.error("Pick the date");

    const built = buildExpenseFieldValueInputs(selectedFields, draft.fieldValues);
    if (built.error) {
      setDetailsOpen(true);
      return void toast.error(built.error);
    }
    if (overdrawn && !allowOverdraw) return void setPendingMode(mode);

    const payload = {
      categoryId: draft.categoryId,
      amount,
      walletId: draft.walletId,
      payee: draft.payee.trim() || undefined,
      description: draft.note.trim(),
      expenseDate: draft.expenseDate.toISOString(),
      slipNumber: draft.slipNumber.trim() || undefined,
      allowOverdraw,
      fieldValues: built.values ?? [],
    };
    // The balance can change between typing and saving; the server then asks for the same confirmation.
    const onError = (error: Error) => {
      if (isOverdrawConfirmError(error)) setPendingMode(mode);
    };

    if (expense) {
      updateMutation.mutate(
        { data: { ...payload, expenseId: expense.id } },
        { onSuccess: () => onOpenChange(false), onError },
      );
      return;
    }

    createMutation.mutate(
      { data: payload },
      {
        onSuccess: () => {
          if (mode === "close") return onOpenChange(false);
          const next = { ...emptyDraft(), walletId: draft.walletId, expenseDate: draft.expenseDate };
          setDraft(next);
          setInitialKey(draftKey(next));
          setDetailsOpen(false);
          amountRef.current?.focus();
        },
        onError,
      },
    );
  };

  const confirmOverdraw = () => {
    const mode = pendingMode ?? "close";
    setPendingMode(null);
    save(mode, true);
  };

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? "Edit expense" : "Record expense"}
        description={
          isEdit
            ? "Your changes are saved with your name. Any money difference is corrected on the account today."
            : "What did you pay for, and how much?"
        }
        icon={ReceiptIcon}
        isDirty={isDirty && !isPending}
        confirmCloseTitle="Discard this expense?"
        confirmCloseDescription="What you typed has not been saved."
      >
        <div
          className="space-y-6 py-4"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing) return;
            const target = event.target as HTMLElement;
            // Only the form's own text boxes, not popups (category search, calendars) that bubble through portals.
            if (target.tagName !== "INPUT" || !event.currentTarget.contains(target)) return;
            event.preventDefault();
            save("close");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="expense-amount" className={labelClass}>Amount</Label>
            <ExpenseAmountField
              id="expense-amount"
              inputRef={amountRef}
              value={draft.amount}
              onChange={(value) => update({ amount: value })}
            />
          </div>

          <div className="space-y-2" role="group" aria-labelledby="expense-category-label">
            <p id="expense-category-label" className={labelClass}>What for</p>
            {isLoadingCategories ? (
              <p className="text-sm text-muted-foreground">Loading categories...</p>
            ) : isCategoriesError && pickerCategories.length === 0 ? (
              <p className="text-sm text-destructive">
                Categories could not be loaded. Close this form and try again.
              </p>
            ) : pickerCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No expense categories yet. A finance manager can add them under Expense Categories.
              </p>
            ) : (
              <ExpenseCategoryPicker
                categories={pickerCategories}
                usageRank={defaults?.categoryUsageRank ?? []}
                value={draft.categoryId}
                onChange={changeCategory}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-payee" className={labelClass}>Paid to</Label>
            <ExpensePayeeField
              id="expense-payee"
              value={draft.payee}
              onChange={(payee) => update({ payee })}
              payees={defaults?.payees ?? []}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-wallet" className={labelClass}>Paid from</Label>
            <Select value={draft.walletId} onValueChange={(walletId) => update({ walletId })}>
              <SelectTrigger id="expense-wallet" className="h-11 w-full rounded-none shadow-none">
                <SelectValue placeholder={wallets.length === 0 ? "No accounts yet" : "Pick an account"} />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                {wallets.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="rounded-none">
                    <span className="flex w-full items-center gap-2">
                      {item.type === "bank" ? (
                        <Building2 className="size-3.5 text-blue-500" />
                      ) : (
                        <BanknoteIcon className="size-3.5 text-violet-500" />
                      )}
                      <span className="font-medium">{item.name}</span>
                      <span
                        className={cn(
                          "ml-auto pl-4 tabular-nums",
                          Number(item.balance ?? 0) < 0 ? "text-rose-500" : "text-muted-foreground",
                        )}
                      >
                        {formatRupees(item.balance ?? "0")}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {walletChanges.map((change) => (
              <p key={`${change.type}-${change.walletId}`} className="text-sm text-muted-foreground">
                {describeWalletChange(change, wallets.find((item) => item.id === change.walletId)?.name ?? "the account")}
              </p>
            ))}

            {overdrawn && wallet && balanceAfter ? (
              <div
                role="alert"
                className="flex flex-col gap-2 border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex items-start gap-2">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  {`${wallet.name} will go to ${formatRupees(balanceAfter)}. Usually means a deposit wasn't recorded.`}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-none shadow-none"
                  onClick={() => setDepositOpen(true)}
                >
                  Record deposit
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className={labelClass}>Date</p>
              <DatePicker
                date={draft.expenseDate}
                onChange={(expenseDate) => update({ expenseDate })}
                placeholder="Pick a date"
                className="h-11 w-full justify-start rounded-none shadow-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-note" className={labelClass}>
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="expense-note"
                value={draft.note}
                onChange={(event) => update({ note: event.target.value })}
                placeholder="e.g. October electricity bill"
                maxLength={1000}
                className="h-11 rounded-none shadow-none"
              />
            </div>
          </div>

          <Collapsible open={showDetails} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="h-9 gap-2 rounded-none px-2" disabled={hasRequiredDetails}>
                <ChevronDown className={cn("size-4 transition-transform", showDetails && "rotate-180")} />
                More details
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label htmlFor="expense-slip" className={labelClass}>Slip / reference number</Label>
                <Input
                  id="expense-slip"
                  value={draft.slipNumber}
                  onChange={(event) => update({ slipNumber: event.target.value })}
                  maxLength={100}
                  className="h-11 rounded-none shadow-none"
                />
              </div>
              {keepsInactiveCategory && draft.categoryId === expense?.category?.id ? (
                <p className="text-sm text-muted-foreground">
                  This category has been switched off, so only the details already saved can be changed.
                </p>
              ) : null}
              {selectedFields.map((field) => (
                <ExpenseDynamicFieldInput
                  key={field.id}
                  field={field}
                  value={draft.fieldValues[field.id]}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      fieldValues: {
                        ...current.fieldValues,
                        [field.id]: { ...current.fieldValues[field.id], ...next },
                      },
                    }))
                  }
                />
              ))}
            </CollapsibleContent>
          </Collapsible>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="rounded-none shadow-none" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {!isEdit ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-none shadow-none"
                disabled={isPending}
                onClick={() => save("another")}
              >
                Save & add another
              </Button>
            ) : null}
            <Button type="button" className="rounded-none shadow-none" disabled={isPending} onClick={() => save("close")}>
              {isPending ? "Saving..." : isEdit ? "Save changes" : "Save"}
            </Button>
          </div>
        </div>
      </ResponsiveSheet>

      <OverdrawConfirmDialog
        open={pendingMode !== null}
        onOpenChange={(next) => {
          if (!next) setPendingMode(null);
        }}
        walletName={wallet?.name ?? "This account"}
        balance={wallet?.balance ?? "0"}
        balanceAfter={balanceAfter ?? "0"}
        onConfirm={confirmOverdraw}
        pending={isPending}
      />
      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        wallets={wallets}
        preselectedWalletId={draft.walletId || null}
      />
    </>
  );
}

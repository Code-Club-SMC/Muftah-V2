import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  BookOpen,
  Building2,
  CheckCircle2Icon,
  ReceiptIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { DatePicker } from "@/components/custom/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import {
  useCreateExpense,
  useExpenseCategoryDefinitions,
} from "@/hooks/finance/use-finance";
import { hasPermission } from "@/lib/rbac";
import {
  buildExpenseFieldValueInputs,
  getDefaultExpenseCategoryId,
  type ExpenseFieldDraftValue,
} from "@/lib/finance-expenses";
import type {
  ExpenseCategoryFieldDefinition,
  FinanceWalletSummary,
} from "@/lib/types/finance-types";

type ExpenseRecordSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: FinanceWalletSummary[];
  preselectedWalletId: string | null;
};

const getEmptyDraftValues = (): Record<string, ExpenseFieldDraftValue> => ({});

export function ExpenseRecordSheet({
  open,
  onOpenChange,
  wallets,
  preselectedWalletId,
}: ExpenseRecordSheetProps) {
  const [walletId, setWalletId] = useState(preselectedWalletId || "");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState<Date | undefined>(new Date());
  const [slipNumber, setSlipNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [description, setDescription] = useState("");
  const [fieldValues, setFieldValues] = useState<
    Record<string, ExpenseFieldDraftValue>
  >(getEmptyDraftValues);

  const mutation = useCreateExpense();
  const { data: viewerAccess } = useViewerAccess();
  const {
    data: categoryDefinitions = [],
    isLoading: isLoadingCategories,
    isError: isCategoriesError,
    error: categoriesError,
  } = useExpenseCategoryDefinitions();

  const canManageFinance = viewerAccess
    ? hasPermission(viewerAccess.permissions, "finance.manage")
    : false;
  const effectiveWalletId = walletId || preselectedWalletId || "";
  const selectedWallet = wallets.find((wallet) => wallet.id === effectiveWalletId);
  const currentBalance = parseFloat(selectedWallet?.balance || "0");
  const parsedAmount = parseFloat(amount) || 0;
  const insufficientFunds = parsedAmount > 0 && parsedAmount > currentBalance;
  const selectedCategory = categoryDefinitions.find((cat) => cat.id === categoryId);
  const selectedCategoryFields = selectedCategory?.fields ?? [];

  const startTutorial = () => {
    const tour = driver({
      showProgress: true,
      allowClose: true,
      steps: [
        {
          popover: {
            title: "How to Record and Pay an Expense",
            description:
              "This walkthrough shows the exact flow: choose payment account, fill details, and confirm.",
          },
        },
        {
          element: '[data-tour="expense-tutorial-btn"]',
          popover: {
            title: "Replay Tutorial",
            description: "Click this anytime to run the guide again.",
          },
        },
        {
          element: '[data-tour="expense-pay-from"]',
          popover: {
            title: "Step 1: Choose Payment Account",
            description:
              "Select which wallet or bank account will be charged for this expense.",
          },
        },
        {
          element: '[data-tour="expense-category"]',
          popover: {
            title: "Step 2: Pick Category",
            description:
              "Choose the expense category. Custom fields will appear based on this category.",
          },
        },
        {
          element: '[data-tour="expense-amount"]',
          popover: {
            title: "Step 3: Enter Amount",
            description:
              "Enter the amount to pay. The available balance and after-expense balance are shown.",
          },
        },
        {
          element: '[data-tour="expense-description"]',
          popover: {
            title: "Step 4: Add Description",
            description: "Write a clear reason so the expense is easy to track later.",
          },
        },
        {
          element: '[data-tour="expense-confirm"]',
          popover: {
            title: "Step 5: Confirm Expense",
            description:
              "Click Confirm Expense to save and immediately debit the selected account.",
          },
        },
      ],
    });

    tour.drive();
  };

  const resetForm = () => {
    setAmount("");
    setCategoryId(getDefaultExpenseCategoryId(categoryDefinitions));
    setDescription("");
    setExpenseDate(new Date());
    setSlipNumber("");
    setRemarks("");
    setFieldValues(getEmptyDraftValues());
    setWalletId(preselectedWalletId || "");
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    setWalletId(preselectedWalletId || "");
  }, [open, preselectedWalletId]);

  useEffect(() => {
    if (!open || categoryDefinitions.length === 0) {
      return;
    }

    setCategoryId((current) => {
      if (current && categoryDefinitions.some((category) => category.id === current)) {
        return current;
      }

      return getDefaultExpenseCategoryId(categoryDefinitions);
    });
  }, [categoryDefinitions, open]);

  const handleSubmit = () => {
    if (!effectiveWalletId) {
      toast.error("Please select a payment source");
      return;
    }

    if (isCategoriesError) {
      toast.error("Expense categories are unavailable right now");
      return;
    }

    if (!categoryDefinitions.length) {
      toast.error("No active expense categories are configured");
      return;
    }

    if (!categoryId) {
      toast.error("Please select a category");
      return;
    }

    if (!selectedCategory) {
      toast.error("Selected category is unavailable");
      return;
    }

    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!description.trim()) {
      toast.error("Please provide a description");
      return;
    }

    if (insufficientFunds) {
      toast.error(
        `Insufficient balance in "${selectedWallet?.name}". Available: ₨ ${currentBalance.toLocaleString()}`,
      );
      return;
    }

    const builtFieldValues = buildExpenseFieldValueInputs(
      selectedCategoryFields,
      fieldValues,
    );

    if (builtFieldValues.error) {
      toast.error(builtFieldValues.error);
      return;
    }

    mutation.mutate(
      {
        data: {
          walletId: effectiveWalletId,
          amount: parsedAmount,
          categoryId,
          description: description.trim(),
          expenseDate: expenseDate?.toISOString(),
          slipNumber: slipNumber.trim() || undefined,
          remarks: remarks.trim() || undefined,
          fieldValues: builtFieldValues.values,
        },
      },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Record Expense"
      description="Record an expense and debit from an account."
      icon={ReceiptIcon}
    >
      <div className="space-y-6 py-4">
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            onClick={startTutorial}
            data-tour="expense-tutorial-btn"
          >
            <BookOpen className="size-4 mr-2" />
            Start Tutorial
          </Button>
        </div>

        {isCategoriesError && (
          <Alert variant="destructive" className="rounded-none">
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>Categories unavailable</AlertTitle>
            <AlertDescription>
              {categoriesError instanceof Error
                ? categoriesError.message
                : "Expense categories could not be loaded."}
            </AlertDescription>
          </Alert>
        )}

        {!isLoadingCategories && !isCategoriesError && categoryDefinitions.length === 0 && (
          <Alert className="rounded-none">
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>No active categories</AlertTitle>
            <AlertDescription>
              Record-expense is disabled until a finance manager creates at least one active
              expense category.
              {canManageFinance ? (
                <>
                  {" "}
                  <Link
                    to="/finance/expenses/settings"
                    className="font-medium underline underline-offset-4"
                  >
                    Open schema settings
                  </Link>
                  .
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3" data-tour="expense-pay-from">
          <Label className="text-[11px] font-bold uppercase text-muted-foreground">
            Pay From
          </Label>
          <Select value={effectiveWalletId} onValueChange={setWalletId}>
            <SelectTrigger className="h-11 rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
              <SelectValue placeholder="Select payment source..." />
            </SelectTrigger>
            <SelectContent className="rounded-none shadow-none border-border">
              {wallets.map((wallet) => (
                <SelectItem
                  key={wallet.id}
                  value={wallet.id}
                  className="rounded-none"
                >
                  <div className="flex items-center gap-2">
                    {wallet.type === "bank" ? (
                      <Building2 className="size-3.5 text-blue-500" />
                    ) : (
                      <BanknoteIcon className="size-3.5 text-violet-500" />
                    )}
                    <span className="font-bold">{wallet.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedWallet ? (
            <div
              className={cn(
                "flex items-center justify-between p-3 border",
                insufficientFunds
                  ? "bg-rose-500/10 border-rose-500/20"
                  : "bg-muted/20 border-border",
              )}
            >
              <span className="text-[11px] font-bold uppercase text-muted-foreground">
                Available Balance
              </span>
              <span
                className={cn(
                  "text-sm font-black tabular-nums",
                  insufficientFunds && "text-rose-500",
                )}
              >
                ₨ {currentBalance.toLocaleString()}
              </span>
            </div>
          ) : null}

          {insufficientFunds ? (
            <div className="flex items-center gap-2 text-rose-500 text-[10px] font-bold uppercase p-2 bg-rose-500/10 border border-rose-500/20">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              Insufficient funds. You need ₨{" "}
              {(parsedAmount - currentBalance).toLocaleString()} more.
            </div>
          ) : null}
        </div>

        <div className="space-y-3" data-tour="expense-category">
          <Label className="text-[11px] font-bold uppercase text-muted-foreground">
            Category
          </Label>
          <Select
            value={categoryId}
            onValueChange={(value) => {
              setCategoryId(value);
              setFieldValues(getEmptyDraftValues());
            }}
            disabled={isLoadingCategories || isCategoriesError || categoryDefinitions.length === 0}
          >
            <SelectTrigger className="h-11 rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
              <SelectValue
                placeholder={
                  isLoadingCategories
                    ? "Loading categories..."
                    : "Select expense category..."
                }
              />
            </SelectTrigger>
            <SelectContent className="rounded-none shadow-none border-border">
              {categoryDefinitions.map((category) => (
                <SelectItem
                  key={category.id}
                  value={category.id}
                  className="rounded-none"
                >
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Label className="text-[11px] font-bold uppercase text-muted-foreground">
              Expense Date
            </Label>
            <DatePicker
              date={expenseDate}
              onChange={setExpenseDate}
              placeholder="Pick expense date"
              className="h-11 w-full rounded-none shadow-none border-border justify-start"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-[11px] font-bold uppercase text-muted-foreground">
              Slip Number
            </Label>
            <Input
              placeholder="Optional reference slip no."
              value={slipNumber}
              onChange={(event) => setSlipNumber(event.target.value)}
              className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-3" data-tour="expense-amount">
          <Label className="text-[11px] font-bold uppercase text-muted-foreground">
            Amount (PKR)
          </Label>
          <Input
            type="number"
            min="1"
            placeholder="Enter amount..."
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-11 text-lg font-mono rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
          {selectedWallet && parsedAmount > 0 && !insufficientFunds ? (
            <p className="text-[10px] text-emerald-600 font-bold uppercase flex items-center gap-1">
              <CheckCircle2Icon className="size-3" />
              After expense: ₨ {(currentBalance - parsedAmount).toLocaleString()} remaining
            </p>
          ) : null}
        </div>

        <div className="space-y-3" data-tour="expense-description">
          <Label className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            Description
            <Badge
              variant="destructive"
              className="rounded-none text-[9px] px-1 py-0 shadow-none"
            >
              Required
            </Badge>
          </Label>
          <Textarea
            placeholder="e.g., February 2026 electricity bill from LESCO..."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-20 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase text-muted-foreground">
            Remarks
          </Label>
          <Textarea
            placeholder="Optional additional notes for auditing"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            className="min-h-16 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>

        {selectedCategoryFields.length > 0 ? (
          <div className="space-y-4 border border-border p-4 bg-muted/10">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase text-muted-foreground">
                Custom Fields
              </p>
              <Badge variant="outline" className="rounded-none shadow-none text-[10px]">
                {selectedCategoryFields.length} fields
              </Badge>
            </div>

            {selectedCategoryFields.map((field) => (
              <ExpenseDynamicFieldInput
                key={field.id}
                field={field}
                value={fieldValues[field.id]}
                onChange={(nextValue) =>
                  setFieldValues((prev) => ({
                    ...prev,
                    [field.id]: {
                      ...prev[field.id],
                      ...nextValue,
                    },
                  }))
                }
              />
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="outline"
            className="rounded-none shadow-none border-border flex-1"
            onClick={() => {
              resetForm();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            className="rounded-none shadow-none flex-1"
            onClick={handleSubmit}
            disabled={mutation.isPending || isCategoriesError || categoryDefinitions.length === 0}
            data-tour="expense-confirm"
          >
            {mutation.isPending ? "Saving..." : "Confirm Expense"}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function ExpenseDynamicFieldInput({
  field,
  value,
  onChange,
}: {
  field: ExpenseCategoryFieldDefinition;
  value?: ExpenseFieldDraftValue;
  onChange: (value: ExpenseFieldDraftValue) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-2">
        {field.label}
        {field.isRequired ? (
          <Badge
            variant="destructive"
            className="rounded-none text-[9px] px-1 py-0 shadow-none"
          >
            Required
          </Badge>
        ) : null}
      </Label>

      {(field.fieldType === "text" || field.fieldType === "textarea") &&
        (field.fieldType === "textarea" ? (
          <Textarea
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={value?.valueText || ""}
            onChange={(event) => onChange({ valueText: event.target.value })}
            className="min-h-16 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        ) : (
          <Input
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={value?.valueText || ""}
            onChange={(event) => onChange({ valueText: event.target.value })}
            className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        ))}

      {field.fieldType === "number" ? (
        <Input
          type="number"
          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
          value={value?.valueNumber || ""}
          onChange={(event) => onChange({ valueNumber: event.target.value })}
          className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
        />
      ) : null}

      {field.fieldType === "date" ? (
        <DatePicker
          date={value?.valueDate}
          onChange={(date) => onChange({ valueDate: date })}
          placeholder={`Pick ${field.label.toLowerCase()}`}
          className="h-11 w-full rounded-none shadow-none border-border justify-start"
        />
      ) : null}

      {field.fieldType === "select" ? (
        <Select
          value={value?.valueOptionId || ""}
          onValueChange={(nextValue) => onChange({ valueOptionId: nextValue })}
        >
          <SelectTrigger className="h-11 rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
            <SelectValue
              placeholder={field.placeholder || `Select ${field.label.toLowerCase()}...`}
            />
          </SelectTrigger>
          <SelectContent className="rounded-none shadow-none border-border">
            {field.options.map((option) => (
              <SelectItem key={option.id} value={option.id} className="rounded-none">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {field.fieldType === "boolean" ? (
        <Select
          value={value?.valueBoolean || ""}
          onValueChange={(nextValue: "true" | "false") =>
            onChange({ valueBoolean: nextValue })
          }
        >
          <SelectTrigger className="h-11 rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
            <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
          </SelectTrigger>
          <SelectContent className="rounded-none shadow-none border-border">
            <SelectItem value="true" className="rounded-none">
              Yes
            </SelectItem>
            <SelectItem value="false" className="rounded-none">
              No
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

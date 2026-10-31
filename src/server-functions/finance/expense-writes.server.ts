import Big from "big.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { isValid, parseISO } from "date-fns";
import { z } from "zod";
import type { db } from "@/db";
import {
  categoryFieldOptions,
  categoryFields,
  expenseCategories,
  expenseFieldValues,
  expenses,
  transactions,
  wallets,
} from "@/db/schemas/finance-schema";
import { formatExpenseFieldDisplayValue } from "@/lib/finance-expenses";
import {
  overdrawError,
  toExpenseSnapshot,
  type ExpenseSnapshot,
  type WalletChange,
} from "@/lib/finance/expense-corrections";
import { MAX_EXPENSE_AMOUNT } from "@/lib/finance/expense-entry";
import type { FinanceDynamicFieldValueInput } from "@/lib/types/finance-types";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


/** A rupee amount that is still above zero once rounded to paisa, and fits the column. */
export const expenseAmountSchema = z
  .number()
  .finite()
  .positive("Amount must be greater than 0")
  .max(MAX_EXPENSE_AMOUNT, "Amount is too large")
  .refine((value) => new Big(value).round(2).gt(0), "Amount must be at least Rs 0.01");

/** Parses an ISO date from the form; throws a readable error on anything else. */
export function parseExpenseDate(value: string): Date {
  const date = parseISO(value);
  if (!isValid(date)) throw new Error("Invalid expense date");
  return date;
}

export const dynamicFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "boolean",
]);

export const dynamicFieldValueSchema = z
  .object({
    fieldId: z.string().min(1),
    fieldType: dynamicFieldTypeSchema,
    valueText: z.string().optional(),
    valueNumber: z.number().optional(),
    valueDate: z.string().optional(),
    valueBoolean: z.boolean().optional(),
    valueOptionId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.fieldType === "text" || data.fieldType === "textarea") && !data.valueText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Text value is required",
        path: ["valueText"],
      });
    }

    if (data.fieldType === "number" && data.valueNumber === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Number value is required",
        path: ["valueNumber"],
      });
    }

    if (data.fieldType === "date" && !data.valueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date value is required",
        path: ["valueDate"],
      });
    }

    if (data.fieldType === "select" && !data.valueOptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select option is required",
        path: ["valueOptionId"],
      });
    }

    if (data.fieldType === "boolean" && data.valueBoolean === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Boolean value is required",
        path: ["valueBoolean"],
      });
    }
  });

export async function resolveExpenseCategory(
  tx: Tx,
  input: { categoryId?: string; category?: string },
  options: { allowInactiveId?: string } = {},
): Promise<{ id: string; name: string }> {
  const columns = { id: true, name: true, isActive: true, isArchived: true } as const;
  const record = input.categoryId
    ? await tx.query.expenseCategories.findFirst({
        where: eq(expenseCategories.id, input.categoryId),
        columns,
      })
    : input.category
      ? await tx.query.expenseCategories.findFirst({
          where: and(eq(expenseCategories.name, input.category), eq(expenseCategories.isArchived, false)),
          columns,
        })
      : null;

  // An edit may keep the category it already has, even if that was switched off or archived since.
  const keepsCurrent = record !== undefined && record !== null && record.id === options.allowInactiveId;
  if (!record || (!keepsCurrent && (!record.isActive || record.isArchived))) {
    throw new Error("Please select an active category");
  }

  return { id: record.id, name: record.name };
}

/**
 * Checks submitted custom-field values against the category's active fields; returns those field ids.
 * `keepOptionIds` are options the expense already has saved: an edit may keep one that was switched off since.
 */
export async function validateExpenseFieldValues(
  tx: Tx,
  categoryId: string,
  values: FinanceDynamicFieldValueInput[],
  options: { keepOptionIds?: string[] } = {},
): Promise<string[]> {
  const activeFields = await tx.query.categoryFields.findMany({
    where: and(eq(categoryFields.categoryId, categoryId), eq(categoryFields.isActive, true)),
    columns: {
      id: true,
      key: true,
      label: true,
      fieldType: true,
      isRequired: true,
      minLength: true,
      maxLength: true,
      minNumber: true,
      maxNumber: true,
      minDate: true,
      maxDate: true,
      regexPattern: true,
    },
  });

  const defsById = new Map(activeFields.map((f) => [f.id, f]));
  const keepOptionIds = new Set(options.keepOptionIds ?? []);
  const seen = new Set<string>();

  for (const value of values) {
    const def = defsById.get(value.fieldId);
    if (!def) {
      throw new Error("Submitted field is not active for this category");
    }

    if (seen.has(value.fieldId)) {
      throw new Error(`Field \"${def.label}\" was sent more than once`);
    }
    seen.add(value.fieldId);

    if (def.fieldType !== value.fieldType) {
      throw new Error(`Field \"${def.label}\" type mismatch`);
    }

    if (value.fieldType === "text" || value.fieldType === "textarea") {
      const textValue = value.valueText ?? "";

      if (def.minLength !== null && textValue.length < def.minLength) {
        throw new Error(`Field \"${def.label}\" is shorter than allowed`);
      }

      if (def.maxLength !== null && textValue.length > def.maxLength) {
        throw new Error(`Field \"${def.label}\" is longer than allowed`);
      }

      if (def.regexPattern) {
        let regex: RegExp;
        try {
          regex = new RegExp(def.regexPattern);
        } catch {
          throw new Error(`Field \"${def.label}\" has a broken format rule. Fix it in Expense Categories.`);
        }
        if (!regex.test(textValue)) {
          throw new Error(`Field \"${def.label}\" format is invalid`);
        }
      }
    }

    if (value.fieldType === "number") {
      const numberValue = value.valueNumber ?? 0;
      if (!Number.isFinite(numberValue)) {
        throw new Error(`Field \"${def.label}\" must be a number`);
      }
      const minNumber = def.minNumber !== null ? parseFloat(def.minNumber) : undefined;
      const maxNumber = def.maxNumber !== null ? parseFloat(def.maxNumber) : undefined;

      if (minNumber !== undefined && numberValue < minNumber) {
        throw new Error(`Field \"${def.label}\" is below minimum value`);
      }

      if (maxNumber !== undefined && numberValue > maxNumber) {
        throw new Error(`Field \"${def.label}\" exceeds maximum value`);
      }
    }

    if (value.fieldType === "date") {
      const dateValue = value.valueDate ? parseISO(value.valueDate) : null;
      if (!dateValue || !isValid(dateValue)) {
        throw new Error(`Field \"${def.label}\" has an invalid date`);
      }

      if (def.minDate && dateValue < def.minDate) {
        throw new Error(`Field \"${def.label}\" is before minimum date`);
      }

      if (def.maxDate && dateValue > def.maxDate) {
        throw new Error(`Field \"${def.label}\" is after maximum date`);
      }
    }

    if (value.fieldType === "select") {
      const optionId = value.valueOptionId;
      if (!optionId) {
        throw new Error(`Field \"${def.label}\" requires an option`);
      }

      const option = await tx.query.categoryFieldOptions.findFirst({
        where: and(eq(categoryFieldOptions.id, optionId), eq(categoryFieldOptions.fieldId, def.id)),
        columns: { id: true, isActive: true },
      });

      if (!option || (!option.isActive && !keepOptionIds.has(option.id))) {
        throw new Error(`Field \"${def.label}\" has an invalid option`);
      }
    }
  }

  const missingRequired = activeFields.filter((f) => f.isRequired && !seen.has(f.id));

  if (missingRequired.length > 0) {
    throw new Error(`Missing required fields: ${missingRequired.map((f) => f.label).join(", ")}`);
  }

  return activeFields.map((f) => f.id);
}

export async function insertExpenseFieldValues(
  tx: Tx,
  expenseId: string,
  values: FinanceDynamicFieldValueInput[],
): Promise<void> {
  if (values.length === 0) return;

  await tx.insert(expenseFieldValues).values(
    values.map((value) => {
      const parsedDate = value.valueDate ? parseISO(value.valueDate) : null;
      return {
        id: createId(),
        expenseId,
        fieldId: value.fieldId,
        valueText:
          value.fieldType === "text" || value.fieldType === "textarea" ? (value.valueText ?? null) : null,
        valueNumber:
          value.fieldType === "number" && value.valueNumber !== undefined ? value.valueNumber.toString() : null,
        valueDate:
          value.fieldType === "date" && parsedDate && isValid(parsedDate) ? parsedDate : null,
        valueBoolean: value.fieldType === "boolean" ? (value.valueBoolean ?? null) : null,
        valueOptionId: value.fieldType === "select" ? (value.valueOptionId ?? null) : null,
      };
    }),
  );
}

/** Deletes all saved custom-field values, or only those for `fieldIds`. */
export async function deleteExpenseFieldValues(tx: Tx, expenseId: string, fieldIds?: string[]): Promise<void> {
  if (fieldIds && fieldIds.length === 0) return;
  await tx
    .delete(expenseFieldValues)
    .where(
      fieldIds
        ? and(eq(expenseFieldValues.expenseId, expenseId), inArray(expenseFieldValues.fieldId, fieldIds))
        : eq(expenseFieldValues.expenseId, expenseId),
    );
}

/**
 * Moves money on one account and writes the journal row. A debit that leaves the account below
 * zero throws the overdraft marker unless `allowOverdraw` is set; the caller's transaction rolls back.
 * The balance update is a single row-locking statement, so concurrent writes cannot both slip under zero.
 */
export async function applyWalletChange(
  tx: Tx,
  change: WalletChange,
  options: { allowOverdraw: boolean; performedById: string; referenceId: string; description?: string },
): Promise<string> {
  if (!new Big(change.amount).gt(0)) {
    throw new Error("Wallet change must be above zero");
  }

  const [wallet] = await tx
    .update(wallets)
    .set({
      balance:
        change.type === "debit"
          ? sql`${wallets.balance} - ${change.amount}`
          : sql`${wallets.balance} + ${change.amount}`,
    })
    .where(eq(wallets.id, change.walletId))
    .returning({ name: wallets.name, balance: wallets.balance });

  if (!wallet) throw new Error("Wallet not found");
  if (change.type === "debit" && !options.allowOverdraw && new Big(wallet.balance).lt(0)) {
    throw overdrawError(wallet.name, wallet.balance);
  }

  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: change.walletId,
    type: change.type,
    amount: change.amount,
    source: "Expense",
    referenceId: options.referenceId,
    description: options.description ?? null,
    performedById: options.performedById,
  });
  return id;
}

export async function loadExpenseSnapshot(tx: Tx, expenseId: string): Promise<ExpenseSnapshot> {
  const row = await tx.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
    with: {
      category: { columns: { name: true } },
      wallet: { columns: { name: true } },
      fieldValues: {
        with: {
          field: { columns: { label: true, sortOrder: true } },
          option: { columns: { label: true } },
        },
      },
    },
  });
  if (!row) throw new Error("Expense not found");

  const fields = [...row.fieldValues]
    .sort(
      (left, right) =>
        (left.field?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.field?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left.field?.label ?? "").localeCompare(right.field?.label ?? ""),
    )
    .map((value) => ({
      label: value.field?.label ?? "Unknown field",
      displayValue: formatExpenseFieldDisplayValue({
        optionLabel: value.option?.label,
        valueBoolean: value.valueBoolean,
        valueDate: value.valueDate,
        valueNumber: value.valueNumber,
        valueText: value.valueText,
      }),
    }));

  return toExpenseSnapshot({
    amount: row.amount,
    description: row.description,
    payee: row.payee,
    slipNumber: row.slipNumber,
    expenseDate: row.expenseDate,
    categoryName: row.category?.name ?? "",
    walletName: row.wallet?.name ?? "",
    fields,
  });
}

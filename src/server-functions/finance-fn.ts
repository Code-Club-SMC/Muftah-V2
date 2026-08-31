import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import {
  categoryFieldOptions,
  categoryFields,
  expenseCategories,
  expenseFieldValues,
  expenses,
  transactions,
  wallets,
} from "@/db/schemas/finance-schema";
import {
  requireFinanceManageMiddleware,
  requireFinanceViewMiddleware,
  requireSuperAdminMiddleware,
} from "@/lib/middlewares";
import { formatExpenseFieldDisplayValue } from "@/lib/finance-expenses";
import type {
  ExpenseKpis,
  ExpenseListItem,
  ExpenseListResponse,
  FinanceDynamicFieldType,
} from "@/lib/types/finance-types";
import { and, count, eq, SQL, sql, gte, lte } from "drizzle-orm";
import { parseISO, isValid } from "date-fns";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";

const dynamicFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "boolean",
]);

const dynamicFieldValueSchema = z
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

const dynamicFieldFilterSchema = z
  .object({
    fieldId: z.string().min(1),
    fieldType: dynamicFieldTypeSchema,
    operator: z.enum(["eq", "contains", "gte", "lte"]),
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
        message: "Text filter value is required",
        path: ["valueText"],
      });
    }

    if (data.fieldType === "number" && data.valueNumber === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Number filter value is required",
        path: ["valueNumber"],
      });
    }

    if (data.fieldType === "date" && !data.valueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date filter value is required",
        path: ["valueDate"],
      });
    }

    if (data.fieldType === "select" && !data.valueOptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select filter option is required",
        path: ["valueOptionId"],
      });
    }

    if (data.fieldType === "boolean" && data.valueBoolean === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Boolean filter value is required",
        path: ["valueBoolean"],
      });
    }
  });

type ExpenseFilterInput = {
  categoryId?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  fieldFilters?: Array<z.infer<typeof dynamicFieldFilterSchema>>;
};

const buildExpenseFilterConditions = (data: ExpenseFilterInput): SQL[] => {
  const conditions: SQL[] = [];

  if (data.categoryId) {
    conditions.push(eq(expenses.categoryId, data.categoryId));
  } else if (data.category) {
    conditions.push(eq(expenses.category, data.category));
  }

  if (data.dateFrom) {
    const from = parseISO(data.dateFrom);
    if (isValid(from)) {
      conditions.push(gte(expenses.expenseDate, from));
    }
  }

  if (data.dateTo) {
    const to = parseISO(data.dateTo);
    if (isValid(to)) {
      conditions.push(lte(expenses.expenseDate, to));
    }
  }

  for (const filter of data.fieldFilters ?? []) {
    let clause: SQL;

    if (filter.fieldType === "text" || filter.fieldType === "textarea") {
      clause =
        filter.operator === "contains"
          ? sql`efv.value_text ILIKE ${`%${filter.valueText ?? ""}%`}`
          : sql`efv.value_text = ${filter.valueText ?? ""}`;
    } else if (filter.fieldType === "number") {
      if (filter.operator === "gte") {
        clause = sql`efv.value_number >= ${String(filter.valueNumber ?? 0)}::numeric`;
      } else if (filter.operator === "lte") {
        clause = sql`efv.value_number <= ${String(filter.valueNumber ?? 0)}::numeric`;
      } else {
        clause = sql`efv.value_number = ${String(filter.valueNumber ?? 0)}::numeric`;
      }
    } else if (filter.fieldType === "date") {
      const dateValue = filter.valueDate ? parseISO(filter.valueDate) : null;
      if (!dateValue || !isValid(dateValue)) {
        continue;
      }

      if (filter.operator === "gte") {
        clause = sql`efv.value_date >= ${dateValue}`;
      } else if (filter.operator === "lte") {
        clause = sql`efv.value_date <= ${dateValue}`;
      } else {
        clause = sql`efv.value_date = ${dateValue}`;
      }
    } else if (filter.fieldType === "select") {
      clause = sql`efv.value_option_id = ${filter.valueOptionId ?? ""}`;
    } else {
      clause = sql`efv.value_boolean = ${filter.valueBoolean ?? false}`;
    }

    conditions.push(
      sql`exists (
        select 1
        from expense_field_values efv
        where efv.expense_id = ${expenses.id}
          and efv.field_id = ${filter.fieldId}
          and ${clause}
      )`,
    );
  }

  return conditions;
};

// ─────────────────────────────────────────────────────────
// 1. WALLETS — CRUD + Balance
// ─────────────────────────────────────────────────────────

/**
 * List all wallets with their current balance
 */
export const getWalletsListFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .handler(async () => {
    return await db.query.wallets.findMany({
      orderBy: (wallets, { asc }) => [asc(wallets.createdAt)],
    });
  });

const MAX_BALANCE = 999999999999.99;

const bankFieldsSchema = z.object({
  bankName: z.string().min(1, "Bank name is required").optional(),
  accountNumber: z.string().min(1, "Account number is required").optional(),
  branchName: z.string().optional(),
  iban: z.string().optional(),
  swiftCode: z.string().optional(),
  accountTitle: z.string().optional(),
});

/**
 * Create a new wallet (cash box or bank account)
 */
export const createWalletFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      name: z.string().min(1, "Wallet name is required"),
      type: z.enum(["cash", "bank"]),
      initialBalance: z
        .number()
        .min(0, "Balance cannot be negative")
        .max(MAX_BALANCE, `Balance cannot exceed PKR ${MAX_BALANCE.toLocaleString()}`)
        .default(0),
      ...bankFieldsSchema.shape,
    }),
  )
  .handler(async ({ data, context }) => {
    if (data.type === "bank") {
      if (!data.bankName?.trim()) {
        throw new Error("Bank name is required for bank accounts");
      }
      if (!data.accountNumber?.trim()) {
        throw new Error("Account number is required for bank accounts");
      }
      if (data.iban && !/^PK\d{22}$/i.test(data.iban.replace(/\s/g, ""))) {
        throw new Error("Invalid IBAN format. Expected PK followed by 22 characters");
      }
    }

    const id = createId();
    const [wallet] = await db
      .insert(wallets)
      .values({
        id,
        name: data.name,
        type: data.type,
        balance: data.initialBalance.toString(),
        bankName: data.bankName?.trim() || null,
        accountNumber: data.accountNumber?.trim() || null,
        branchName: data.branchName?.trim() || null,
        iban: data.iban?.trim().replace(/\s/g, "") || null,
        swiftCode: data.swiftCode?.trim() || null,
        accountTitle: data.accountTitle?.trim() || null,
      })
      .returning();

    if (data.initialBalance > 0) {
      await db.insert(transactions).values({
        id: createId(),
        walletId: id,
        type: "credit",
        amount: data.initialBalance.toString(),
        source: "Opening Balance",
        performedById: context.session.user.id,
      });
    }

    logActivityQuiet({
      module: "finance",
      action: "created",
      entityType: "wallet",
      actorId: context.authContext.session.user.id,
      actorName: context.authContext.session.user.name,
      description: `Created wallet ${data.name} with initial balance ${data.initialBalance}`,
    });

    return wallet;
  });

/**
 * Update wallet details (name, type, balance, bank fields)
 */
export const updateWalletFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      walletId: z.string().min(1),
      name: z.string().min(1, "Wallet name is required"),
      type: z.enum(["cash", "bank"]),
      initialBalance: z
        .number()
        .min(0, "Balance cannot be negative")
        .max(MAX_BALANCE, `Balance cannot exceed PKR ${MAX_BALANCE.toLocaleString()}`)
        .default(0),
      ...bankFieldsSchema.shape,
    }),
  )
  .handler(async ({ data }) => {
    if (data.type === "bank") {
      if (!data.bankName?.trim()) {
        throw new Error("Bank name is required for bank accounts");
      }
      if (!data.accountNumber?.trim()) {
        throw new Error("Account number is required for bank accounts");
      }
      if (data.iban && !/^PK\d{22}$/i.test(data.iban.replace(/\s/g, ""))) {
        throw new Error("Invalid IBAN format. Expected PK followed by 22 characters");
      }
    }

    const [updated] = await db
      .update(wallets)
      .set({
        name: data.name,
        type: data.type,
        balance: data.initialBalance.toString(),
        bankName: data.bankName?.trim() || null,
        accountNumber: data.accountNumber?.trim() || null,
        branchName: data.branchName?.trim() || null,
        iban: data.iban?.trim().replace(/\s/g, "") || null,
        swiftCode: data.swiftCode?.trim() || null,
        accountTitle: data.accountTitle?.trim() || null,
      })
      .where(eq(wallets.id, data.walletId))
      .returning();
    return updated;
  });

/**
 * Delete a wallet (super-admin only). References (transactions, expenses) are preserved.
 */
export const deleteWalletFn = createServerFn()
  .middleware([requireSuperAdminMiddleware])
  .inputValidator(
    z.object({
      walletId: z.string().min(1),
      confirmationName: z.string().min(1, "Please type the account name to confirm"),
    }),
  )
  .handler(async ({ data }) => {
    const wallet = await db.query.wallets.findFirst({
      where: eq(wallets.id, data.walletId),
    });

    if (!wallet) {
      throw new Error("Account not found");
    }

    if (data.confirmationName.trim() !== wallet.name) {
      throw new Error(
        `Account name does not match. Please type "${wallet.name}" exactly to confirm deletion.`,
      );
    }

    await db.delete(wallets).where(eq(wallets.id, data.walletId));

    return { deleted: true, walletName: wallet.name };
  });

// ─────────────────────────────────────────────────────────
// 2. DEPOSITS — Add money to a wallet
// ─────────────────────────────────────────────────────────

/**
 * Deposit money into a wallet (credit)
 */
export const depositToWalletFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      walletId: z.string().min(1),
      amount: z.number().positive("Amount must be greater than 0"),
      description: z.string().optional().default("Manual Deposit"),
      source: z.string().optional().default("Manual Adjustment"),
    }),
  )
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // Update wallet balance
      const [updatedWallet] = await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} + ${data.amount}`,
        })
        .where(eq(wallets.id, data.walletId))
        .returning();

      // Create transaction record
      const [txn] = await tx
        .insert(transactions)
        .values({
          id: createId(),
          walletId: data.walletId,
          type: "credit",
          amount: data.amount.toString(),
          source: data.source,
          performedById: context.session.user.id,
        })
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "created",
        entityType: "transaction",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Deposited ${data.amount} to wallet ${updatedWallet?.name || data.walletId}`,
      });

      return txn;
    });
  });

// ─────────────────────────────────────────────────────────
// 3. EXPENSES — Record and debit from wallet
// ─────────────────────────────────────────────────────────

/**
 * Record an expense — validates wallet has enough balance
 */
export const createExpenseFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      description: z.string().min(1, "Description is required"),
      category: z.string().optional(),
      categoryId: z.string().optional(),
      amount: z.number().positive("Amount must be greater than 0"),
      walletId: z.string().min(1, "Please select a payment source"),
      expenseDate: z.string().optional(),
      slipNumber: z.string().max(100).optional(),
      remarks: z.string().max(1000).optional(),
      fieldValues: z.array(dynamicFieldValueSchema).optional().default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // 0. Resolve category from id (preferred) or name (compatibility path)
      const categoryRecord = data.categoryId
        ? await tx.query.expenseCategories.findFirst({
            where: and(
              eq(expenseCategories.id, data.categoryId),
              eq(expenseCategories.isArchived, false),
            ),
            columns: { id: true, name: true, isActive: true },
          })
        : data.category
          ? await tx.query.expenseCategories.findFirst({
              where: and(
                eq(expenseCategories.name, data.category),
                eq(expenseCategories.isArchived, false),
              ),
              columns: { id: true, name: true, isActive: true },
            })
          : null;

      if (!categoryRecord || !categoryRecord.isActive) {
        throw new Error("Please select an active category");
      }

      // 1. Validate custom fields against active category definitions
      const activeFields = await tx.query.categoryFields.findMany({
        where: and(
          eq(categoryFields.categoryId, categoryRecord.id),
          eq(categoryFields.isActive, true),
        ),
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

      for (const value of data.fieldValues) {
        const def = defsById.get(value.fieldId);
        if (!def) {
          throw new Error("Submitted field is not active for this category");
        }

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
            const regex = new RegExp(def.regexPattern);
            if (!regex.test(textValue)) {
              throw new Error(`Field \"${def.label}\" format is invalid`);
            }
          }
        }

        if (value.fieldType === "number") {
          const numberValue = value.valueNumber ?? 0;
          const minNumber =
            def.minNumber !== null ? parseFloat(def.minNumber) : undefined;
          const maxNumber =
            def.maxNumber !== null ? parseFloat(def.maxNumber) : undefined;

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
            where: and(
              eq(categoryFieldOptions.id, optionId),
              eq(categoryFieldOptions.fieldId, def.id),
              eq(categoryFieldOptions.isActive, true),
            ),
            columns: { id: true },
          });

          if (!option) {
            throw new Error(`Field \"${def.label}\" has an invalid option`);
          }
        }
      }

      const providedFieldIds = new Set(data.fieldValues.map((f) => f.fieldId));
      const missingRequired = activeFields.filter(
        (f) => f.isRequired && !providedFieldIds.has(f.id),
      );

      if (missingRequired.length > 0) {
        throw new Error(
          `Missing required fields: ${missingRequired.map((f) => f.label).join(", ")}`,
        );
      }

      // 2. Debit the wallet atomically so concurrent expense writes cannot overspend.
      const [debitedWallet] = await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} - ${data.amount}`,
        })
        .where(
          and(
            eq(wallets.id, data.walletId),
            gte(wallets.balance, data.amount.toString()),
          ),
        )
        .returning({
          id: wallets.id,
          name: wallets.name,
          balance: wallets.balance,
        });

      if (!debitedWallet) {
        const wallet = await tx.query.wallets.findFirst({
          where: eq(wallets.id, data.walletId),
          columns: {
            id: true,
            name: true,
            balance: true,
          },
        });

        if (!wallet) {
          throw new Error("Wallet not found");
        }

        const currentBalance = parseFloat(wallet.balance || "0");

        throw new Error(
          `Insufficient balance in "${wallet.name}". Available: PKR ${currentBalance.toLocaleString()}, Required: PKR ${data.amount.toLocaleString()}`,
        );
      }

      // 3. Create the expense record
      const expenseId = createId();
      const expenseDate = data.expenseDate ? parseISO(data.expenseDate) : new Date();

      if (!isValid(expenseDate)) {
        throw new Error("Invalid expense date");
      }

      const [expense] = await tx
        .insert(expenses)
        .values({
          id: expenseId,
          description: data.description,
          category: categoryRecord.name,
          categoryId: categoryRecord.id,
          expenseDate,
          amount: data.amount.toString(),
          slipNumber: data.slipNumber ?? null,
          remarks: data.remarks ?? null,
          walletId: data.walletId,
          performedById: context.session.user.id,
        })
        .returning();

      if (data.fieldValues.length > 0) {
        await tx.insert(expenseFieldValues).values(
          data.fieldValues.map((value) => {
            const parsedDate = value.valueDate ? parseISO(value.valueDate) : null;
            return {
              id: createId(),
              expenseId,
              fieldId: value.fieldId,
              valueText:
                value.fieldType === "text" || value.fieldType === "textarea"
                  ? (value.valueText ?? null)
                  : null,
              valueNumber:
                value.fieldType === "number" && value.valueNumber !== undefined
                  ? value.valueNumber.toString()
                  : null,
              valueDate:
                value.fieldType === "date" && parsedDate && isValid(parsedDate)
                  ? parsedDate
                  : null,
              valueBoolean:
                value.fieldType === "boolean" ? (value.valueBoolean ?? null) : null,
              valueOptionId:
                value.fieldType === "select" ? (value.valueOptionId ?? null) : null,
            };
          }),
        );
      }

      // 4. Create transaction journal entry
      await tx.insert(transactions).values({
        id: createId(),
        walletId: data.walletId,
        type: "debit",
        amount: data.amount.toString(),
        source: "Expense",
        referenceId: expenseId,
        performedById: context.session.user.id,
      });

      logActivityQuiet({
        module: "finance",
        action: "created",
        entityType: "expense",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Recorded expense of ${data.amount} for ${data.description}`,
      });

      return expense;
    });
  });

/**
 * List all expenses with wallet info
 */
export const getExpensesFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(
    z.object({
      categoryId: z.string().optional(),
      category: z.string().optional(),
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().default(60),
      offset: z.number().int().min(0).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      fieldFilters: z.array(dynamicFieldFilterSchema).optional().default([]),
    }),
  )
  .handler(async ({ data }) => {
    const offset = data.offset ?? (data.page - 1) * data.limit;

    const conditions = buildExpenseFilterConditions(data);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(expenses)
      .where(whereClause);

    const data_ = await db.query.expenses.findMany({
      where: whereClause,
      with: {
        category: {
          columns: {
            id: true,
            name: true,
            slug: true,
            icon: true,
            isActive: true,
            isArchived: true,
          },
        },
        wallet: { columns: { id: true, name: true, type: true } },
        performer: { columns: { id: true, name: true } },
        fieldValues: {
          with: {
            field: {
              columns: {
                id: true,
                key: true,
                label: true,
                fieldType: true,
                isActive: true,
                sortOrder: true,
              },
            },
            option: {
              columns: {
                id: true,
                value: true,
                label: true,
                isActive: true,
              },
            },
          },
        },
      },
      orderBy: (e, { desc }) => [desc(e.expenseDate), desc(e.createdAt)],
      limit: data.limit,
      offset,
    });

    const page = Math.floor(offset / data.limit) + 1;
    const pageCount = Math.ceil(total / data.limit);
    const rows: ExpenseListItem[] = data_.map((expense) => ({
      id: expense.id,
      expenseDate: expense.expenseDate,
      description: expense.description,
      amount: expense.amount,
      slipNumber: expense.slipNumber,
      remarks: expense.remarks,
      category: expense.category
        ? {
            id: expense.category.id,
            name: expense.category.name,
            slug: expense.category.slug,
            icon: expense.category.icon,
            isActive: expense.category.isActive,
            isArchived: expense.category.isArchived,
          }
        : null,
      wallet: expense.wallet
        ? {
            id: expense.wallet.id,
            name: expense.wallet.name,
            type: expense.wallet.type,
          }
        : null,
      performer: expense.performer
        ? {
            id: expense.performer.id,
            name: expense.performer.name,
          }
        : null,
      dynamicFields: [...expense.fieldValues]
        .sort((left, right) => {
          const leftSort = left.field?.sortOrder ?? Number.MAX_SAFE_INTEGER;
          const rightSort = right.field?.sortOrder ?? Number.MAX_SAFE_INTEGER;

          if (leftSort !== rightSort) {
            return leftSort - rightSort;
          }

          return (left.field?.label ?? "").localeCompare(right.field?.label ?? "");
        })
        .map((fieldValue) => ({
          id: fieldValue.id,
          fieldId: fieldValue.fieldId,
          fieldKey: fieldValue.field?.key ?? null,
          fieldLabel: fieldValue.field?.label ?? "Unknown field",
          fieldType:
            (fieldValue.field?.fieldType as FinanceDynamicFieldType | undefined) ??
            null,
          displayValue: formatExpenseFieldDisplayValue({
            optionLabel: fieldValue.option?.label,
            valueBoolean: fieldValue.valueBoolean,
            valueDate: fieldValue.valueDate,
            valueNumber: fieldValue.valueNumber,
            valueText: fieldValue.valueText,
          }),
          isFieldActive: fieldValue.field?.isActive ?? null,
          isOptionActive: fieldValue.option?.isActive ?? null,
          optionLabel: fieldValue.option?.label ?? null,
          valueText: fieldValue.valueText,
          valueNumber: fieldValue.valueNumber,
          valueDate: fieldValue.valueDate,
          valueBoolean: fieldValue.valueBoolean,
        })),
    }));

    const response: ExpenseListResponse = {
      data: rows,
      total,
      pageCount,
      page,
      limit: data.limit,
      offset,
      hasMore: offset + data.limit < total,
    };

    return response;
  });

/**
 * Aggregated KPI values for expenses list filters
 */
export const getExpensesKpisFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(
    z.object({
      categoryId: z.string().optional(),
      category: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      fieldFilters: z.array(dynamicFieldFilterSchema).optional().default([]),
    }),
  )
  .handler(async ({ data }) => {
    const conditions = buildExpenseFilterConditions(data);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [agg] = await db
      .select({
        totalRecords: count(),
        totalCash: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
        avgCashPerRecord: sql<string>`coalesce(avg(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(whereClause);

    const response: ExpenseKpis = {
      totalRecords: agg?.totalRecords ?? 0,
      totalCash: parseFloat(agg?.totalCash ?? "0"),
      avgCashPerRecord: parseFloat(agg?.avgCashPerRecord ?? "0"),
    };

    return response;
  });

// ─────────────────────────────────────────────────────────
// 4. TRANSACTIONS — Ledger / Journal
// ─────────────────────────────────────────────────────────

/**
 * Get transaction ledger for a specific wallet or all wallets
 */
export const getTransactionsFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(
    z.object({
      walletId: z.string().optional(),
      source: z.string().optional(), // filter by source e.g. "Payroll", "Expense"
      type: z.enum(["credit", "debit"]).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().default(20),
    }),
  )
  .handler(async ({ data }) => {
    const offset = (data.page - 1) * data.limit;

    const conditions: SQL[] = [];
    if (data.walletId) conditions.push(eq(transactions.walletId, data.walletId));
    if (data.source) conditions.push(eq(transactions.source, data.source));
    if (data.type) conditions.push(eq(transactions.type, data.type));
    
    if (data.dateFrom) {
      const from = parseISO(data.dateFrom);
      if (isValid(from)) conditions.push(gte(transactions.createdAt, from));
    }
    if (data.dateTo) {
      const to = parseISO(data.dateTo);
      if (isValid(to)) conditions.push(lte(transactions.createdAt, to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(transactions)
      .where(whereClause);

    const data_ = await db.query.transactions.findMany({
      where: whereClause,
      with: {
        wallet: { columns: { id: true, name: true, type: true } },
        performer: { columns: { id: true, name: true } },
      },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: data.limit,
      offset,
    });

    return {
      data: data_,
      total,
      pageCount: Math.ceil(total / data.limit),
      page: data.page,
    };
  });

// ─────────────────────────────────────────────────────────
// 5. WALLET PAYMENT — Generic debit function with validation
//    Used by payroll, advances, etc.
// ─────────────────────────────────────────────────────────

/**
 * Debit a wallet with balance validation.
 * Used as a shared utility by payroll, advance approval, etc.
 */
export const debitWalletFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      walletId: z.string().min(1, "Please select a payment source"),
      amount: z.number().positive("Amount must be greater than 0"),
      source: z.string().min(1), // "Payroll", "Advance Payment", "Expense"
      referenceId: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // 1. Validate wallet balance
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, data.walletId));

      if (!wallet) throw new Error("Wallet not found");

      const currentBalance = parseFloat(wallet.balance || "0");
      if (currentBalance < data.amount) {
        throw new Error(
          `Insufficient balance in "${wallet.name}". Available: PKR ${currentBalance.toLocaleString()}, Required: PKR ${data.amount.toLocaleString()}`,
        );
      }

      // 2. Debit the wallet
      await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} - ${data.amount}`,
        })
        .where(eq(wallets.id, data.walletId));

      // 3. Create transaction
      const [txn] = await tx
        .insert(transactions)
        .values({
          id: createId(),
          walletId: data.walletId,
          type: "debit",
          amount: data.amount.toString(),
          source: data.source,
          referenceId: data.referenceId,
          performedById: context.session.user.id,
        })
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "created",
        entityType: "transaction",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Debited ${data.amount} from wallet ${wallet.name} for ${data.source}`,
      });

      return {
        transaction: txn,
        walletName: wallet.name,
        remainingBalance: currentBalance - data.amount,
      };
    });
  });

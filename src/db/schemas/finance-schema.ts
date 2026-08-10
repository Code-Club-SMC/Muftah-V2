import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  decimal,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { createId } from "@paralleldrive/cuid2";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

// --- EXPENSE CATEGORIES ---
export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").default(true).notNull(),
    isArchived: boolean("is_archived").default(false).notNull(),
    ...timestamps,
  },
  (table) => ({
    sortIdx: index("expense_categories_sort_idx").on(
      table.sortOrder,
      table.name,
    ),
    activeIdx: index("expense_categories_active_idx").on(
      table.isActive,
      table.isArchived,
    ),
  }),
);

export const categoryFields = pgTable(
  "category_fields",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    categoryId: text("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(), // text | textarea | number | date | select | boolean
    isRequired: boolean("is_required").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    placeholder: text("placeholder"),
    helperText: text("helper_text"),
    minLength: integer("min_length"),
    maxLength: integer("max_length"),
    minNumber: decimal("min_number", { precision: 12, scale: 2 }),
    maxNumber: decimal("max_number", { precision: 12, scale: 2 }),
    minDate: timestamp("min_date"),
    maxDate: timestamp("max_date"),
    regexPattern: text("regex_pattern"),
    ...timestamps,
  },
  (table) => ({
    categorySortIdx: index("category_fields_category_sort_idx").on(
      table.categoryId,
      table.isActive,
      table.sortOrder,
    ),
    categoryKeyUnique: uniqueIndex("category_fields_category_key_unique").on(
      table.categoryId,
      table.key,
    ),
  }),
);

export const categoryFieldOptions = pgTable(
  "category_field_options",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    fieldId: text("field_id")
      .notNull()
      .references(() => categoryFields.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    fieldSortIdx: index("category_field_options_field_sort_idx").on(
      table.fieldId,
      table.isActive,
      table.sortOrder,
    ),
    fieldValueUnique: uniqueIndex("category_field_options_field_value_unique").on(
      table.fieldId,
      table.value,
    ),
  }),
);

// --- WALLETS (Cash vs Bank) ---
export const wallets = pgTable("wallets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  balance: decimal("balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  branchName: text("branch_name"),
  iban: text("iban"),
  swiftCode: text("swift_code"),
  accountTitle: text("account_title"),
  ...timestamps,
});

// --- EXPENSES ---
export const expenses = pgTable("expenses", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  category: text("category").notNull(), // legacy snapshot for backward compatibility
  categoryId: text("category_id")
    .notNull()
    .references(() => expenseCategories.id),
  expenseDate: timestamp("expense_date").defaultNow().notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  slipNumber: text("slip_number"),
  remarks: text("remarks"),

  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  performedById: text("performed_by_id")
    .notNull()
    .references(() => user.id),
  ...timestamps,
},
  (table) => ({
    categoryDateIdx: index("expenses_category_date_idx").on(
      table.categoryId,
      table.expenseDate,
      table.id,
    ),
    dateIdx: index("expenses_date_idx").on(table.expenseDate),
    walletDateIdx: index("expenses_wallet_date_idx").on(
      table.walletId,
      table.expenseDate,
    ),
  }),
);

export const expenseFieldValues = pgTable(
  "expense_field_values",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    fieldId: text("field_id")
      .notNull()
      .references(() => categoryFields.id, { onDelete: "cascade" }),
    valueText: text("value_text"),
    valueNumber: decimal("value_number", { precision: 12, scale: 2 }),
    valueDate: timestamp("value_date"),
    valueBoolean: boolean("value_boolean"),
    valueOptionId: text("value_option_id").references(() => categoryFieldOptions.id),
    ...timestamps,
  },
  (table) => ({
    expenseFieldUnique: uniqueIndex("expense_field_values_expense_field_unique").on(
      table.expenseId,
      table.fieldId,
    ),
    fieldTextIdx: index("expense_field_values_field_text_idx").on(
      table.fieldId,
      table.valueText,
    ),
    fieldNumberIdx: index("expense_field_values_field_number_idx").on(
      table.fieldId,
      table.valueNumber,
    ),
    fieldDateIdx: index("expense_field_values_field_date_idx").on(
      table.fieldId,
      table.valueDate,
    ),
    fieldBooleanIdx: index("expense_field_values_field_boolean_idx").on(
      table.fieldId,
      table.valueBoolean,
    ),
    fieldOptionIdx: index("expense_field_values_field_option_idx").on(
      table.fieldId,
      table.valueOptionId,
    ),
  }),
);

// --- TRANSACTIONS (Journal) ---
export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id),

    type: text("type").notNull(), // "credit", "debit"
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    source: text("source").notNull(), // "Sale", "Expense", "Payroll", "Manual Adjustment"
    referenceId: text("reference_id"), // ID of Invoice, Expense, or Payroll record
    effectiveDate: timestamp("effective_date", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reversalOfTransactionId: text("reversal_of_transaction_id").references(
      (): AnyPgColumn => transactions.id,
      { onDelete: "restrict" },
    ),

    performedById: text("performed_by_id")
      .notNull()
      .references(() => user.id),
    ...timestamps,
  },
  (table) => ({
    effectiveDateIdx: index("transactions_effective_date_idx").on(
      table.effectiveDate,
    ),
    reversalUnique: uniqueIndex("transactions_reversal_unique")
      .on(table.reversalOfTransactionId)
      .where(sql`${table.reversalOfTransactionId} is not null`),
  }),
);

// --- RELATIONS ---

export const expenseCategoriesRelations = relations(expenseCategories, ({ many }) => ({
  expenses: many(expenses),
  fields: many(categoryFields),
}));

export const categoryFieldsRelations = relations(categoryFields, ({ one, many }) => ({
  category: one(expenseCategories, {
    fields: [categoryFields.categoryId],
    references: [expenseCategories.id],
  }),
  options: many(categoryFieldOptions),
  values: many(expenseFieldValues),
}));

export const categoryFieldOptionsRelations = relations(categoryFieldOptions, ({ one, many }) => ({
  field: one(categoryFields, {
    fields: [categoryFieldOptions.fieldId],
    references: [categoryFields.id],
  }),
  values: many(expenseFieldValues),
}));

export const walletsRelations = relations(wallets, ({ many }) => ({
  expenses: many(expenses),
  transactions: many(transactions),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  category: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
  wallet: one(wallets, {
    fields: [expenses.walletId],
    references: [wallets.id],
  }),
  performer: one(user, {
    fields: [expenses.performedById],
    references: [user.id],
  }),
  fieldValues: many(expenseFieldValues),
}));

export const expenseFieldValuesRelations = relations(expenseFieldValues, ({ one }) => ({
  expense: one(expenses, {
    fields: [expenseFieldValues.expenseId],
    references: [expenses.id],
  }),
  field: one(categoryFields, {
    fields: [expenseFieldValues.fieldId],
    references: [categoryFields.id],
  }),
  option: one(categoryFieldOptions, {
    fields: [expenseFieldValues.valueOptionId],
    references: [categoryFieldOptions.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  wallet: one(wallets, {
    fields: [transactions.walletId],
    references: [wallets.id],
  }),
  performer: one(user, {
    fields: [transactions.performedById],
    references: [user.id],
  }),
  reversalOf: one(transactions, {
    fields: [transactions.reversalOfTransactionId],
    references: [transactions.id],
    relationName: "transactionReversal",
  }),
}));

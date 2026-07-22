export type FinanceDynamicFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "boolean";

export type FinanceDynamicFieldValueInput = {
  fieldId: string;
  fieldType: FinanceDynamicFieldType;
  valueText?: string;
  valueNumber?: number;
  valueDate?: string;
  valueBoolean?: boolean;
  valueOptionId?: string;
};

export type FinanceDynamicFieldFilterInput = {
  fieldId: string;
  fieldType: FinanceDynamicFieldType;
  operator: "eq" | "contains" | "gte" | "lte";
  valueText?: string;
  valueNumber?: number;
  valueDate?: string;
  valueBoolean?: boolean;
  valueOptionId?: string;
};

export type ExpenseCategoryFieldOptionDefinition = {
  id: string;
  value: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

export type ExpenseCategoryFieldDefinition = {
  id: string;
  key: string;
  label: string;
  fieldType: FinanceDynamicFieldType;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  placeholder: string | null;
  options: ExpenseCategoryFieldOptionDefinition[];
};

export type ExpenseCategoryDefinition = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  isArchived: boolean;
  fields: ExpenseCategoryFieldDefinition[];
};

export type ExpenseFieldValueDisplay = {
  id: string;
  fieldId: string;
  fieldKey: string | null;
  fieldLabel: string;
  fieldType: FinanceDynamicFieldType | null;
  displayValue: string;
  isFieldActive: boolean | null;
  isOptionActive: boolean | null;
  optionLabel: string | null;
  valueText: string | null;
  valueNumber: string | null;
  valueDate: Date | string | null;
  valueBoolean: boolean | null;
};

export type FinanceWalletSummary = {
  id: string;
  name: string;
  type: string;
  balance?: string;
};

export type ExpenseListItem = {
  id: string;
  expenseDate: Date | string;
  description: string;
  amount: string;
  slipNumber: string | null;
  remarks: string | null;
  category: {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    isActive: boolean;
    isArchived: boolean;
  } | null;
  wallet: FinanceWalletSummary | null;
  performer: {
    id: string;
    name: string | null;
  } | null;
  dynamicFields: ExpenseFieldValueDisplay[];
};

export type ExpenseListResponse = {
  data: ExpenseListItem[];
  total: number;
  pageCount: number;
  page: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type ExpenseKpis = {
  totalRecords: number;
  totalCash: number;
  avgCashPerRecord: number;
};

export type CreateExpenseInput = {
  description: string;
  category?: string;
  categoryId?: string;
  amount: number;
  walletId: string;
  expenseDate?: string;
  slipNumber?: string;
  remarks?: string;
  fieldValues?: FinanceDynamicFieldValueInput[];
};

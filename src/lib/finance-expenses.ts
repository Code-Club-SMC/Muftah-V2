import {
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
} from "date-fns";
import type { DateRange } from "react-day-picker";
import type {
  ExpenseCategoryDefinition,
  ExpenseCategoryFieldDefinition,
  FinanceDynamicFieldValueInput,
} from "@/lib/types/finance-types";

export const ALL_EXPENSE_CATEGORIES = "all";

export type ExpenseFieldDraftValue = {
  valueText?: string;
  valueNumber?: string;
  valueDate?: Date;
  valueBoolean?: "" | "true" | "false";
  valueOptionId?: string;
};

export const getCurrentMonthRange = (today = new Date()): DateRange => ({
  from: startOfMonth(today),
  to: endOfMonth(today),
});

export const getExpenseDateRangeFilters = (range?: DateRange) => ({
  dateFrom: range?.from ? startOfDay(range.from).toISOString() : undefined,
  dateTo: range?.to ? endOfDay(range.to).toISOString() : undefined,
});

export const getDefaultExpenseCategoryId = (
  categories: ExpenseCategoryDefinition[],
) => categories[0]?.id ?? "";

export const resolveExpenseCategoryFilter = (categoryId?: string) =>
  categoryId && categoryId !== ALL_EXPENSE_CATEGORIES ? categoryId : undefined;

export const formatExpenseFieldDisplayValue = (value: {
  optionLabel?: string | null;
  valueBoolean?: boolean | null;
  valueDate?: Date | string | null;
  valueNumber?: string | null;
  valueText?: string | null;
}) => {
  if (value.optionLabel) {
    return value.optionLabel;
  }

  if (value.valueBoolean !== null && value.valueBoolean !== undefined) {
    return value.valueBoolean ? "Yes" : "No";
  }

  if (value.valueDate) {
    const parsed = new Date(value.valueDate);
    if (!Number.isNaN(parsed.getTime())) {
      return format(parsed, "dd MMM yyyy");
    }
  }

  if (value.valueNumber !== null && value.valueNumber !== undefined) {
    return Number(value.valueNumber).toLocaleString();
  }

  if (value.valueText) {
    return value.valueText;
  }

  return "—";
};

export const buildExpenseFieldValueInputs = (
  fields: ExpenseCategoryFieldDefinition[],
  draftValues: Record<string, ExpenseFieldDraftValue>,
):
  | { values: FinanceDynamicFieldValueInput[]; error?: never }
  | { values?: never; error: string } => {
  const values: FinanceDynamicFieldValueInput[] = [];

  for (const field of fields) {
    const current = draftValues[field.id] ?? {};

    if (field.fieldType === "text" || field.fieldType === "textarea") {
      const textValue = (current.valueText ?? "").trim();
      if (field.isRequired && !textValue) {
        return { error: `${field.label} is required` };
      }
      if (textValue) {
        values.push({
          fieldId: field.id,
          fieldType: field.fieldType,
          valueText: textValue,
        });
      }
      continue;
    }

    if (field.fieldType === "number") {
      const rawNumber = (current.valueNumber ?? "").trim();
      if (field.isRequired && !rawNumber) {
        return { error: `${field.label} is required` };
      }
      if (rawNumber) {
        const numberValue = Number(rawNumber);
        if (!Number.isFinite(numberValue)) {
          return { error: `${field.label} must be a valid number` };
        }
        values.push({
          fieldId: field.id,
          fieldType: "number",
          valueNumber: numberValue,
        });
      }
      continue;
    }

    if (field.fieldType === "date") {
      if (field.isRequired && !current.valueDate) {
        return { error: `${field.label} is required` };
      }
      if (current.valueDate) {
        values.push({
          fieldId: field.id,
          fieldType: "date",
          valueDate: current.valueDate.toISOString(),
        });
      }
      continue;
    }

    if (field.fieldType === "select") {
      const optionId = current.valueOptionId ?? "";
      if (field.isRequired && !optionId) {
        return { error: `${field.label} is required` };
      }
      if (optionId) {
        values.push({
          fieldId: field.id,
          fieldType: "select",
          valueOptionId: optionId,
        });
      }
      continue;
    }

    const booleanValue = current.valueBoolean ?? "";
    if (field.isRequired && !booleanValue) {
      return { error: `${field.label} is required` };
    }
    if (booleanValue) {
      values.push({
        fieldId: field.id,
        fieldType: "boolean",
        valueBoolean: booleanValue === "true",
      });
    }
  }

  return { values };
};

import { describe, expect, it } from "vitest";
import { endOfDay, startOfDay } from "date-fns";
import {
  ALL_EXPENSE_CATEGORIES,
  buildExpenseFieldValueInputs,
  formatExpenseFieldDisplayValue,
  getDefaultExpenseCategoryId,
  getExpenseDateRangeFilters,
  resolveExpenseCategoryFilter,
  toExpenseFieldDrafts,
} from "@/lib/finance-expenses";
import type { ExpenseCategoryDefinition, ExpenseFieldValueDisplay } from "@/lib/types/finance-types";

describe("finance-expenses helpers", () => {
  it("uses the exact selected range boundaries", () => {
    const from = new Date("2026-04-10T14:20:00.000Z");
    const to = new Date("2026-04-15T09:45:00.000Z");

    const result = getExpenseDateRangeFilters({ from, to });

    expect(result.dateFrom).toBe(startOfDay(from).toISOString());
    expect(result.dateTo).toBe(endOfDay(to).toISOString());
  });

  it("returns undefined category filter for the all-categories tab", () => {
    expect(resolveExpenseCategoryFilter(ALL_EXPENSE_CATEGORIES)).toBeUndefined();
    expect(resolveExpenseCategoryFilter("fuel")).toBe("fuel");
  });

  it("picks the first category as the default entry category", () => {
    const categories: ExpenseCategoryDefinition[] = [
      {
        id: "fuel",
        name: "Fuel",
        slug: "fuel",
        icon: null,
        sortOrder: 0,
        isActive: true,
        isArchived: false,
        fields: [],
      },
      {
        id: "utilities",
        name: "Utilities",
        slug: "utilities",
        icon: null,
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        fields: [],
      },
    ];

    expect(getDefaultExpenseCategoryId(categories)).toBe("fuel");
  });

  it("builds lightweight client field payloads from dynamic field drafts", () => {
    const result = buildExpenseFieldValueInputs(
      [
        {
          id: "vendor",
          key: "vendor",
          label: "Vendor",
          fieldType: "text",
          isRequired: true,
          isActive: true,
          sortOrder: 0,
          placeholder: null,
          options: [],
        },
        {
          id: "invoice_no",
          key: "invoice_no",
          label: "Invoice No",
          fieldType: "number",
          isRequired: false,
          isActive: true,
          sortOrder: 1,
          placeholder: null,
          options: [],
        },
        {
          id: "billable",
          key: "billable",
          label: "Billable",
          fieldType: "boolean",
          isRequired: true,
          isActive: true,
          sortOrder: 2,
          placeholder: null,
          options: [],
        },
      ],
      {
        vendor: { valueText: "PSO" },
        invoice_no: { valueNumber: "42" },
        billable: { valueBoolean: "true" },
      },
    );

    expect(result).toEqual({
      values: [
        {
          fieldId: "vendor",
          fieldType: "text",
          valueText: "PSO",
        },
        {
          fieldId: "invoice_no",
          fieldType: "number",
          valueNumber: 42,
        },
        {
          fieldId: "billable",
          fieldType: "boolean",
          valueBoolean: true,
        },
      ],
    });
  });

  it("returns a user-facing error when a required dynamic field is missing", () => {
    const result = buildExpenseFieldValueInputs(
      [
        {
          id: "vendor",
          key: "vendor",
          label: "Vendor",
          fieldType: "text",
          isRequired: true,
          isActive: true,
          sortOrder: 0,
          placeholder: null,
          options: [],
        },
      ],
      {},
    );

    expect(result).toEqual({
      error: "Vendor is required",
    });
  });

  it("formats saved field values for historical reporting", () => {
    expect(
      formatExpenseFieldDisplayValue({
        valueBoolean: false,
      }),
    ).toBe("No");

    expect(
      formatExpenseFieldDisplayValue({
        valueNumber: "4200",
      }),
    ).toBe("4,200");
  });
});

describe("toExpenseFieldDrafts", () => {
  const base: ExpenseFieldValueDisplay = {
    id: "v", fieldId: "f", fieldKey: null, fieldLabel: "Label", fieldType: "text", displayValue: "",
    isFieldActive: true, isOptionActive: null, optionLabel: null,
    valueText: null, valueNumber: null, valueDate: null, valueBoolean: null, valueOptionId: null,
  };

  it("turns saved values back into form values", () => {
    const drafts = toExpenseFieldDrafts([
      { ...base, fieldId: "meter", fieldType: "text", valueText: "M-12" },
      { ...base, fieldId: "units", fieldType: "number", valueNumber: "340.00" },
      { ...base, fieldId: "due", fieldType: "date", valueDate: "2026-10-20T00:00:00.000Z" },
      { ...base, fieldId: "area", fieldType: "select", valueOptionId: "opt-1" },
      { ...base, fieldId: "late", fieldType: "boolean", valueBoolean: false },
      { ...base, fieldId: "unknown", fieldType: null },
    ]);

    expect(drafts).toEqual({
      meter: { valueText: "M-12" },
      units: { valueNumber: "340.00" },
      due: { valueDate: new Date("2026-10-20T00:00:00.000Z") },
      area: { valueOptionId: "opt-1" },
      late: { valueBoolean: "false" },
    });
  });
});

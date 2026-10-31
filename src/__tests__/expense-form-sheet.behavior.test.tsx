import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseCategoryDefinition, ExpenseListItem } from "@/lib/types/finance-types";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));

vi.mock("@/components/custom/responsive-sheet", () => ({
  ResponsiveSheet: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <section><h2>{title}</h2>{children}</section> : null,
}));
vi.mock("@/components/finance/deposit-sheet", () => ({
  DepositSheet: ({ open }: { open: boolean }) => (open ? <div>deposit sheet open</div> : null),
}));
// Stands in for popups (calendars, search boxes) that render in a portal but bubble React events to the form.
vi.mock("@/components/custom/date-picker", () => ({
  DatePicker: () => createPortal(<input aria-label="Portal box" />, document.body),
}));
vi.mock("@/hooks/finance/use-finance", () => {
  const categories: ExpenseCategoryDefinition[] = [
    { id: "fuel", name: "Fuel", slug: "fuel", icon: null, sortOrder: 0, isActive: true, isArchived: false, fields: [] },
    {
      id: "rent",
      name: "Rent",
      slug: "rent",
      icon: null,
      sortOrder: 1,
      isActive: true,
      isArchived: false,
      fields: [
        { id: "month", key: "month", label: "Month", fieldType: "text", isRequired: false, isActive: true, sortOrder: 0, placeholder: null, options: [] },
      ],
    },
  ];
  return {
    useExpenseCategoryDefinitions: () => ({ data: categories, isLoading: false, isError: false }),
    useExpenseEntryDefaults: () => ({ data: { lastWalletId: null, categoryUsageRank: [], payees: ["LESCO"] } }),
    useCreateExpense: () => ({ mutate: mocks.create, isPending: false }),
    useUpdateExpense: () => ({ mutate: mocks.update, isPending: false }),
  };
});

import { ExpenseFormSheet } from "@/components/finance/expense-form-sheet";

const wallets = [{ id: "w1", name: "Cash Box", type: "cash", balance: "2000.00" }];

const savedExpense: ExpenseListItem = {
  id: "e1",
  expenseDate: "2026-10-12T05:00:00.000Z",
  description: "October bill",
  amount: "1500.00",
  slipNumber: null,
  remarks: null,
  payee: "LESCO",
  origin: "manual",
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  edits: [],
  category: { id: "fuel", name: "Fuel", slug: "fuel", icon: null, isActive: true, isArchived: false },
  wallet: { id: "w1", name: "Cash Box", type: "cash" },
  performer: { id: "u1", name: "Accountant" },
  dynamicFields: [],
};

const savedField = {
  id: "v1",
  fieldId: "litres",
  fieldKey: "litres",
  fieldLabel: "Litres",
  fieldType: "number" as const,
  displayValue: "40",
  isFieldActive: true,
  isOptionActive: null,
  optionLabel: null,
  valueText: null,
  valueNumber: "40",
  valueDate: null,
  valueBoolean: null,
  valueOptionId: null,
};

describe("ExpenseFormSheet", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.update.mockReset();
  });

  it("asks in the order people think", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);
    const text = document.body.textContent ?? "";
    const order = ["Amount", "What for", "Paid to", "Paid from", "Date", "Note", "More details"].map((label) => text.indexOf(label));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.queryByText(/Tutorial/)).toBeNull();
  });

  it("warns before an overdraft, then saves with the user's confirmation", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));

    expect(screen.getByRole("alert").textContent).toContain("Cash Box will go to −Rs 3,000. Usually means a deposit wasn't recorded.");
    fireEvent.click(screen.getByRole("button", { name: "Record deposit" }));
    expect(screen.getByText("deposit sheet open")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("will be −Rs 3,000 after this expense");

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(mocks.create).toHaveBeenCalledWith(
      { data: expect.objectContaining({ amount: 5000, categoryId: "fuel", walletId: "w1", description: "", allowOverdraw: true, fieldValues: [] }) },
      expect.any(Object),
    );
  });

  it("asks to confirm when the server finds the account would go below zero", () => {
    mocks.create.mockImplementationOnce((_input, options: { onError: (error: Error) => void }) =>
      options.onError(new Error('OVERDRAW_CONFIRM_REQUIRED: "Cash Box" would go to −Rs 100')),
    );
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(mocks.create).toHaveBeenLastCalledWith(
      { data: expect.objectContaining({ amount: 100, allowOverdraw: true }) },
      expect.any(Object),
    );
  });

  it("keeps the account and date after Save & add another", () => {
    mocks.create.mockImplementation((_input, options: { onSuccess: () => void }) => options.onSuccess());
    const onOpenChange = vi.fn();
    render(<ExpenseFormSheet open onOpenChange={onOpenChange} wallets={wallets} preselectedWalletId="w1" />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Rent" }));
    fireEvent.change(screen.getByLabelText("Paid to"), { target: { value: "Landlord" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & add another" }));

    expect(mocks.create).toHaveBeenCalledWith(
      { data: expect.objectContaining({ amount: 500, categoryId: "rent", payee: "Landlord", walletId: "w1", allowOverdraw: false }) },
      expect.any(Object),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Paid to")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Rent" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByText("Cash Box").length).toBeGreaterThan(0);
  });

  it("saves when Enter is pressed in a text box", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.keyDown(screen.getByLabelText("Amount"), { key: "Enter" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not save on Enter inside a popup outside the form", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.keyDown(screen.getByLabelText("Portal box"), { key: "Enter" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps typed details when the chosen category is clicked again", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);
    fireEvent.click(screen.getByRole("button", { name: "Rent" }));
    fireEvent.click(screen.getByRole("button", { name: "More details" }));
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "October" } });
    fireEvent.click(screen.getByRole("button", { name: "Rent" }));
    expect(screen.getByLabelText("Month")).toHaveProperty("value", "October");
  });

  it("edits a saved expense and explains the account correction", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} expense={savedExpense} />);

    expect(screen.getByText("Edit expense")).toBeTruthy();
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "1,500");
    expect(screen.getByLabelText("Paid to")).toHaveProperty("value", "LESCO");
    expect(screen.queryByRole("button", { name: "Save & add another" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2000" } });
    expect(screen.getByText("Rs 500 more will be taken from Cash Box")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // 2,000 + 1,500 back − 2,000 = 1,500, still above zero

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mocks.update).toHaveBeenCalledWith(
      { data: expect.objectContaining({ expenseId: "e1", amount: 2000, categoryId: "fuel", walletId: "w1", payee: "LESCO", description: "October bill", allowOverdraw: false }) },
      expect.any(Object),
    );
  });

  it("keeps the saved details of a category that has been switched off", () => {
    const switchedOff: ExpenseListItem = {
      ...savedExpense,
      category: { id: "generator", name: "Generator", slug: "generator", icon: null, isActive: false, isArchived: false },
      dynamicFields: [savedField],
    };
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} expense={switchedOff} />);

    expect(screen.getByRole("button", { name: "Generator (switched off)" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "More details" }));
    expect(screen.getByLabelText("Litres")).toHaveProperty("value", "40");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mocks.update).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          categoryId: "generator",
          fieldValues: [{ fieldId: "litres", fieldType: "number", valueNumber: 40 }],
        }),
      },
      expect.any(Object),
    );
  });

  it("brings saved details back when switching away and back to the expense's category", () => {
    const withDetails: ExpenseListItem = {
      ...savedExpense,
      category: { id: "rent", name: "Rent", slug: "rent", icon: null, isActive: true, isArchived: false },
      dynamicFields: [{ ...savedField, id: "v2", fieldId: "month", fieldKey: "month", fieldLabel: "Month", fieldType: "text", displayValue: "Sept", valueNumber: null, valueText: "Sept" }],
    };
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} expense={withDetails} />);
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.click(screen.getByRole("button", { name: "Rent" }));
    fireEvent.click(screen.getByRole("button", { name: "More details" }));
    expect(screen.getByLabelText("Month")).toHaveProperty("value", "Sept");
  });
});

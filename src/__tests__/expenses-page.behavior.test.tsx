import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseListItem } from "@/lib/types/finance-types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
const access = vi.hoisted(() => ({ permissions: ["finance.view", "finance.manage"] }));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: access.permissions } }),
}));
vi.mock("@/components/finance/expense-form-sheet", () => ({
  ExpenseFormSheet: ({ open, expense, template }: { open: boolean; expense?: ExpenseListItem | null; template?: { id: string } | null }) =>
    open ? <div>form for {expense?.id ?? template?.id ?? "new"}</div> : null,
}));
vi.mock("@/components/finance/void-expense-dialog", () => ({
  VoidExpenseDialog: ({ open, expense }: { open: boolean; expense: ExpenseListItem | null }) =>
    open ? <div>void {expense?.id}</div> : null,
}));

const base: ExpenseListItem = {
  id: "manual",
  expenseDate: "2026-10-12T05:00:00.000Z",
  description: "",
  amount: "5000.00",
  slipNumber: "S-1",
  remarks: null,
  payee: "LESCO",
  origin: "manual",
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  edits: [
    {
      id: "edit-1",
      editedAt: "2026-10-13T06:00:00.000Z",
      editor: { id: "u1", name: "Sana" },
      changes: [{ field: "Amount", from: "Rs 4,500", to: "Rs 5,000" }],
    },
  ],
  category: { id: "power", name: "Electricity", slug: "power", icon: null, isActive: true, isArchived: false },
  wallet: { id: "w1", name: "Cash Box", type: "cash" },
  performer: { id: "u1", name: "Sana" },
  dynamicFields: [],
};
const rows: ExpenseListItem[] = [
  base,
  { ...base, id: "system", origin: "system", description: "Supplier Purchase: Soda Ash", payee: null, edits: [] },
  { ...base, id: "voided", description: "Duplicate", payee: "K-Electric", voidedAt: "2026-10-14T06:00:00.000Z", voidReason: "Entered twice", voidedBy: { id: "u1", name: "Sana" }, edits: [] },
];

vi.mock("@/components/custom/responsive-sheet", () => ({
  ResponsiveSheet: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <section aria-label={title}>{children}</section> : null,
}));
const listCalls = vi.hoisted(() => ({ params: [] as unknown[] }));
vi.mock("@/hooks/finance/use-finance", () => ({
  useExpenseCategoryDefinitions: () => ({
    data: [
      { id: "power", name: "Electricity", slug: "power", icon: null, sortOrder: 0, isActive: true, isArchived: false, fields: [] },
      { id: "fuel", name: "Fuel", slug: "fuel", icon: null, sortOrder: 1, isActive: true, isArchived: false, fields: [] },
    ],
    isLoading: false,
    isError: false,
  }),
  useExpenses: (params: unknown) => {
    listCalls.params.push(params);
    return { data: { data: rows, total: 3, hasMore: false }, isFetching: false, isError: false };
  },
  useExpenseKpis: () => ({ data: { totalRecords: 2, totalCash: 10000, avgCashPerRecord: 5000 }, isFetching: false, isError: false }),
  useExpenseMonthSummary: () => ({
    data: { currentTotal: 120000, previousTotal: 100000, topCategories: [{ categoryId: "power", name: "Electricity", total: 90000 }] },
  }),
  useWallets: () => ({ data: [{ id: "w1", name: "Cash Box", type: "cash", balance: "2000.00" }] }),
}));
const templates = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/hooks/finance/use-expense-templates", () => ({
  useExpenseTemplates: () => ({ data: templates.data }),
  useSaveExpenseTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveExpenseTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useSkipExpenseTemplateMonth: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ExpensesContainer } from "@/components/finance/expenses-container";

const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;
const drawer = () => screen.getByRole("region", { name: "Expense details" });

describe("Expenses page", () => {
  afterEach(cleanup);
  beforeEach(() => {
    access.permissions = ["finance.view", "finance.manage"];
    templates.data = [];
    listCalls.params = [];
  });

  it("has a Record expense button, a Templates button and no tutorial", () => {
    render(<ExpensesContainer />);
    fireEvent.click(screen.getByRole("button", { name: /Record expense/ }));
    expect(screen.getByText("form for new")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Templates" })).toBeTruthy();
    expect(screen.queryByText(/Tutorial/)).toBeNull();
    expect(screen.queryByText(/Schema/)).toBeNull();
  });

  it("opens the form when N is pressed, but not while typing or with Ctrl/Cmd", () => {
    render(<><input aria-label="Search" /><ExpensesContainer /></>);
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "n" });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(screen.queryByText("form for new")).toBeNull();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("form for new")).toBeTruthy();
  });

  it("shows this month's total, the change against last month and the top categories", () => {
    render(<ExpensesContainer />);
    expect(screen.getByText("Rs 1,20,000")).toBeTruthy();
    expect(screen.getByText(/Rs 20,000 more than the same days last month \(20%\)/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "This month" })).getByText("Electricity")).toBeTruthy();
  });

  it("puts the filtered total in the footer", () => {
    render(<ExpensesContainer />);
    expect(screen.getByText(/3 expenses · Rs 10,000/)).toBeTruthy();
  });

  it("shows date, category, paid to, amount and account in each row", () => {
    render(<ExpensesContainer />);
    const row = rowOf("LESCO");
    for (const text of ["12 Oct 2026", "Electricity", "Rs 5,000", "Cash Box"]) {
      expect(within(row).getByText(text)).toBeTruthy();
    }
  });

  it("opens the drawer with details and history when a row is clicked", () => {
    render(<ExpensesContainer />);
    fireEvent.click(rowOf("LESCO"));
    expect(within(drawer()).getByText(/Edited by Sana/)).toBeTruthy();
    expect(within(drawer()).getByText("S-1")).toBeTruthy();
  });

  it("edits, voids and saves as template from the drawer", () => {
    render(<ExpensesContainer />);
    fireEvent.click(rowOf("LESCO"));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Edit" }));
    expect(screen.getByText("form for manual")).toBeTruthy();
    fireEvent.click(rowOf("LESCO"));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Void" }));
    expect(screen.getByText("void manual")).toBeTruthy();
    fireEvent.click(rowOf("LESCO"));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Save as template" }));
    expect(screen.getByRole("dialog", { name: "Save as template" })).toBeTruthy();
  });

  it("offers only Save as template on expenses made by other screens", () => {
    render(<ExpensesContainer />);
    fireEvent.click(rowOf("Supplier Purchase: Soda Ash"));
    expect(within(drawer()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(drawer()).getByRole("button", { name: "Save as template" })).toBeTruthy();
  });

  it("strikes through voided expenses and shows who voided and why, with no actions", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Duplicate");
    expect(within(row).getByText("Voided")).toBeTruthy();
    expect(within(row).getByText("Rs 5,000").className).toContain("line-through");
    fireEvent.click(row);
    expect(within(drawer()).getByText(/Voided by Sana/)).toBeTruthy();
    expect(within(drawer()).getByText("Reason: Entered twice")).toBeTruthy();
    expect(within(drawer()).queryByRole("button", { name: "Void" })).toBeNull();
    expect(within(drawer()).queryByRole("button", { name: "Save as template" })).toBeNull();
  });

  it("gives view-only users the list and drawer without any actions", () => {
    access.permissions = ["finance.view"];
    render(<ExpensesContainer />);
    expect(screen.queryByRole("button", { name: /Record expense/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Templates" })).toBeNull();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.queryByText("form for new")).toBeNull();
    fireEvent.click(rowOf("LESCO"));
    expect(within(drawer()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(drawer()).queryByRole("button", { name: "Save as template" })).toBeNull();
  });

  it("sends the account and paid-to filters to the list query", async () => {
    vi.useFakeTimers();
    render(<ExpensesContainer />);
    fireEvent.change(screen.getByLabelText("Paid to"), { target: { value: "lesco" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(listCalls.params.at(-1)).toMatchObject({ payee: "lesco", offset: 0 });
    vi.useRealTimers();
  });

  it("records from a reminder with the template filled in", () => {
    templates.data = [{
      id: "t-rent", name: "Shop rent", categoryId: "rent", categoryName: "Rent", amount: "85000.00",
      payee: "Landlord", walletId: "w1", note: null, reminderDay: 1, skippedMonth: null, expenseDates: [],
    }];
    render(<ExpensesContainer />);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByText("form for t-rent")).toBeTruthy();
  });
});

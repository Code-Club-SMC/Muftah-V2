import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  ExpenseFormSheet: ({ open, expense }: { open: boolean; expense?: ExpenseListItem | null }) =>
    open ? <div>form for {expense?.id ?? "new"}</div> : null,
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
  { ...base, id: "voided", description: "Duplicate", voidedAt: "2026-10-14T06:00:00.000Z", voidReason: "Entered twice", voidedBy: { id: "u1", name: "Sana" }, edits: [] },
];

vi.mock("@/hooks/finance/use-finance", () => ({
  useExpenseCategoryDefinitions: () => ({ data: [], isLoading: false, isError: false }),
  useExpenses: () => ({ data: { data: rows, total: 3, hasMore: false }, isFetching: false, isError: false }),
  useExpenseKpis: () => ({ data: { totalRecords: 2, totalCash: 10000, avgCashPerRecord: 5000 }, isFetching: false, isError: false }),
  useWallets: () => ({ data: [{ id: "w1", name: "Cash Box", type: "cash", balance: "2000.00" }] }),
}));

import { ExpensesContainer } from "@/components/finance/expenses-container";

const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

describe("Expenses page", () => {
  afterEach(cleanup);
  beforeEach(() => {
    access.permissions = ["finance.view", "finance.manage"];
  });

  it("has a Record expense button and no tutorial", () => {
    render(<ExpensesContainer />);
    fireEvent.click(screen.getByRole("button", { name: /Record expense/ }));
    expect(screen.getByText("form for new")).toBeTruthy();
    expect(screen.queryByText(/Tutorial/)).toBeNull();
    // Once on the top button and once in the "no active categories" notice.
    expect(screen.getAllByText("Expense Categories").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Schema/)).toBeNull();
  });

  it("opens the form when N is pressed", () => {
    render(<ExpensesContainer />);
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("form for new")).toBeTruthy();
  });

  it("titles a row Category · Paid to when there is no note", () => {
    render(<ExpensesContainer />);
    expect(screen.getByText("Electricity · LESCO")).toBeTruthy();
  });

  it("lets manual expenses be edited and voided", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Electricity · LESCO");
    fireEvent.click(within(row).getByRole("button", { name: "Edit expense" }));
    expect(screen.getByText("form for manual")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Void expense" }));
    expect(screen.getByText("void manual")).toBeTruthy();
  });

  it("locks expenses made by other screens", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Supplier Purchase: Soda Ash");
    expect(within(row).getByText("Auto")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Edit expense" })).toBeNull();
  });

  it("strikes through voided expenses and offers no actions", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Duplicate");
    expect(within(row).getByText("Voided")).toBeTruthy();
    expect(screen.getByText("Duplicate").className).toContain("line-through");
    expect(within(row).queryByRole("button", { name: "Void expense" })).toBeNull();
  });

  it("shows the edit history when a row is opened", () => {
    render(<ExpensesContainer />);
    fireEvent.click(within(rowOf("Electricity · LESCO")).getByRole("button", { name: "Show expense details" }));
    expect(screen.getByText(/Edited by Sana/)).toBeTruthy();
    expect(screen.getByText("Rs 4,500 → Rs 5,000", { exact: false })).toBeTruthy();
    expect(screen.getByText("S-1")).toBeTruthy();
  });

  it("shows who voided and why", () => {
    render(<ExpensesContainer />);
    fireEvent.click(within(rowOf("Duplicate")).getByRole("button", { name: "Show expense details" }));
    expect(screen.getByText(/Voided by Sana/)).toBeTruthy();
    expect(screen.getByText("Reason: Entered twice")).toBeTruthy();
  });

  it("ignores N while typing in a text box", () => {
    render(
      <>
        <input aria-label="Search" />
        <ExpensesContainer />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "n" });
    expect(screen.queryByText("form for new")).toBeNull();
  });

  it("ignores N with Ctrl or Cmd held", () => {
    render(<ExpensesContainer />);
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(screen.queryByText("form for new")).toBeNull();
  });

  it("gives view-only users the list without record, edit, void or the shortcut", () => {
    access.permissions = ["finance.view"];
    render(<ExpensesContainer />);
    expect(screen.queryByRole("button", { name: /Record expense/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit expense" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void expense" })).toBeNull();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.queryByText("form for new")).toBeNull();
    expect(screen.getByText("Electricity · LESCO")).toBeTruthy();
  });

  it("opens Record expense empty after editing another expense", () => {
    render(<ExpensesContainer />);
    fireEvent.click(within(rowOf("Electricity · LESCO")).getByRole("button", { name: "Edit expense" }));
    expect(screen.getByText("form for manual")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Record expense/ }));
    expect(screen.getByText("form for new")).toBeTruthy();
  });
});

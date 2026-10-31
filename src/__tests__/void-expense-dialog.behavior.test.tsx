import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseListItem } from "@/lib/types/finance-types";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@/hooks/finance/use-finance", () => ({
  useVoidExpense: () => ({ mutate: mocks.mutate, isPending: mocks.isPending }),
}));

import { VoidExpenseDialog } from "@/components/finance/void-expense-dialog";
import { ExpenseHistory } from "@/components/finance/expense-history";

const expense: ExpenseListItem = {
  id: "e1",
  expenseDate: "2026-10-12T05:00:00.000Z",
  description: "",
  amount: "5000.00",
  slipNumber: null,
  remarks: null,
  payee: "LESCO",
  origin: "manual",
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  edits: [],
  category: null,
  wallet: { id: "w1", name: "Cash Box", type: "cash" },
  performer: null,
  dynamicFields: [],
};

describe("VoidExpenseDialog", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.isPending = false;
  });

  it("says where the money goes and needs a reason", () => {
    render(<VoidExpenseDialog expense={expense} open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("alertdialog").textContent).toContain("Rs 5,000 goes back to Cash Box today.");

    const button = screen.getByRole("button", { name: "Void expense" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "  " } });
    expect(button).toHaveProperty("disabled", true);
  });

  it("voids with the trimmed reason and closes when done", () => {
    const onOpenChange = vi.fn();
    mocks.mutate.mockImplementation((_input, options: { onSuccess: () => void }) => options.onSuccess());
    render(<VoidExpenseDialog expense={expense} open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "  Entered twice  " } });
    fireEvent.click(screen.getByRole("button", { name: "Void expense" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { data: { expenseId: "e1", reason: "Entered twice" } },
      expect.any(Object),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cannot be dismissed while the void is saving", () => {
    mocks.isPending = true;
    const onOpenChange = vi.fn();
    render(<VoidExpenseDialog expense={expense} open onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveProperty("disabled", true);
  });
});

describe("ExpenseHistory", () => {
  afterEach(cleanup);

  it("says when nothing has changed", () => {
    render(<ExpenseHistory expense={expense} />);
    expect(screen.getByText("No changes since it was recorded.")).toBeTruthy();
  });

  it("shows blanks as dashes", () => {
    render(
      <ExpenseHistory
        expense={{
          ...expense,
          edits: [
            {
              id: "edit-1",
              editedAt: "2026-10-13T06:00:00.000Z",
              editor: null,
              changes: [{ field: "Paid to", from: "", to: "LESCO" }],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Edited by Unknown/)).toBeTruthy();
    expect(screen.getByText("— → LESCO", { exact: false })).toBeTruthy();
  });
});

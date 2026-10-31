import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseAmountField } from "@/components/finance/expense-amount-field";
import { ExpenseCategoryPicker } from "@/components/finance/expense-category-picker";
import { ExpensePayeeField } from "@/components/finance/expense-payee-field";
import { OverdrawConfirmDialog } from "@/components/finance/overdraw-confirm-dialog";
import type { ExpenseCategoryDefinition } from "@/lib/types/finance-types";

const category = (id: string, name: string): ExpenseCategoryDefinition => ({
  id, name, slug: id, icon: null, sortOrder: 0, isActive: true, isArchived: false, fields: [],
});

function AmountHarness() {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="amount">Amount</label>
      <ExpenseAmountField id="amount" value={value} onChange={setValue} />
    </>
  );
}

function PayeeHarness({ payees, onKeyDown }: { payees: string[]; onKeyDown?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div onKeyDown={onKeyDown}>
      <label htmlFor="payee">Paid to</label>
      <ExpensePayeeField id="payee" value={value} onChange={setValue} payees={payees} />
    </div>
  );
}

describe("expense form parts", () => {
  afterEach(cleanup);

  it("groups the amount Lac/Crore style and says it in words", () => {
    render(<AmountHarness />);
    const input = screen.getByLabelText("Amount");

    fireEvent.change(input, { target: { value: "1250000" } });

    expect(input).toHaveProperty("value", "12,50,000");
    expect(screen.getByText("Twelve Lakh Fifty Thousand Rupees Only")).toBeTruthy();
  });

  it("does not spell out small amounts", () => {
    render(<AmountHarness />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500" } });
    expect(screen.queryByText(/Rupees Only/)).toBeNull();
  });

  it("ignores a keystroke that makes the amount too large to save", () => {
    render(<AmountHarness />);
    const input = screen.getByLabelText("Amount");
    fireEvent.change(input, { target: { value: "9999999999" } });
    expect(input).toHaveProperty("value", "9,99,99,99,999");

    fireEvent.change(input, { target: { value: "99999999999" } });
    expect(input).toHaveProperty("value", "9,99,99,99,999");
  });

  it("shows six tiles, most used first, and picks one on click", () => {
    const onChange = vi.fn();
    const categories = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => category(id, `Category ${id.toUpperCase()}`));
    render(<ExpenseCategoryPicker categories={categories} usageRank={["h", "g"]} value="" onChange={onChange} />);

    const tiles = screen.getAllByRole("button", { pressed: false });
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "Category H", "Category G", "Category A", "Category B", "Category C", "Category D",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Category G" }));
    expect(onChange).toHaveBeenCalledWith("g");
    expect(screen.getByRole("button", { name: /Search all categories/ })).toBeTruthy();
  });

  it("hides the search when every category already has a tile", () => {
    const categories = ["a", "b", "c"].map((id) => category(id, `Category ${id.toUpperCase()}`));
    render(<ExpenseCategoryPicker categories={categories} usageRank={[]} value="" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Search all categories/ })).toBeNull();
  });

  it("names a picked category that is not a tile", () => {
    const categories = ["a", "b", "c", "d", "e", "f", "g"].map((id) => category(id, `Category ${id.toUpperCase()}`));
    render(<ExpenseCategoryPicker categories={categories} usageRank={[]} value="g" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Other: Category G/ })).toBeTruthy();
  });

  it("suggests past payees and fills the one clicked", () => {
    render(<PayeeHarness payees={["LESCO", "Shell Pump Ravi Road", "PSO Pump"]} />);
    const input = screen.getByLabelText("Paid to");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "pump" } });
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Shell Pump Ravi Road", "PSO Pump"]);

    fireEvent.mouseDown(options[1]);
    expect(input).toHaveProperty("value", "PSO Pump");
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  it("picks a suggestion with the arrow keys and Enter, without the Enter reaching the form", () => {
    const formKeyDown = vi.fn();
    render(<PayeeHarness payees={["LESCO", "Shell Pump Ravi Road", "PSO Pump"]} onKeyDown={formKeyDown} />);
    const input = screen.getByLabelText("Paid to");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "pump" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    formKeyDown.mockClear();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveProperty("value", "PSO Pump");
    expect(formKeyDown).not.toHaveBeenCalled();
  });

  it("lets Enter through to the form when no suggestion is highlighted", () => {
    const formKeyDown = vi.fn();
    render(<PayeeHarness payees={["LESCO"]} onKeyDown={formKeyDown} />);
    const input = screen.getByLabelText("Paid to");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(formKeyDown).toHaveBeenCalled();
  });

  it("states the account, its balance and the balance after in the overdraft dialog", () => {
    const onConfirm = vi.fn();
    render(
      <OverdrawConfirmDialog open onOpenChange={vi.fn()} walletName="Cash in Hand" balance="2000.00" balanceAfter="-3000.00" onConfirm={onConfirm} pending={false} />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Cash in Hand has Rs 2,000 now and will be −Rs 3,000 after this expense. Save anyway?");

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

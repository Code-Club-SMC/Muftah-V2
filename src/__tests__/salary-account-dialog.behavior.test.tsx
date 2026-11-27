import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalaryAccountDialog } from "@/components/hr/payroll/salary-account-dialog";

afterEach(cleanup);

const lines = [
  { employeeId: "e1", name: "Shahab Gul", amount: "100000.00" },
  { employeeId: "e2", name: "Anees Ur Rahman", amount: "28424.00" },
];
const props = {
  open: true, onOpenChange: vi.fn(), title: "Pay salaries", description: "Choose the account", confirmLabel: "Pay Rs 1,28,424",
  lines, direction: "out" as const, payrollMonth: "2026-11-01", todayKey: "2026-12-03", pending: false,
};

describe("SalaryAccountDialog", () => {
  it("lists who is paid and the total, and confirms with the first account and today", () => {
    const onConfirm = vi.fn();
    render(<SalaryAccountDialog {...props} wallets={[{ id: "cash", name: "Cash in Hand", balance: "500000.00" }]} onConfirm={onConfirm} />);
    expect(screen.getByText("Shahab Gul")).toBeTruthy();
    expect(screen.getByText("Total: Rs 1,28,424")).toBeTruthy();
    expect(screen.getByText("Balance after: Rs 3,71,576")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pay Rs 1,28,424" }));
    expect(onConfirm).toHaveBeenCalledWith({ walletId: "cash", paymentDate: "2026-12-03" });
  });

  it("blocks a short account and explains the shortfall", () => {
    render(<SalaryAccountDialog {...props} wallets={[{ id: "cash", name: "Cash in Hand", balance: "80000.00" }]} onConfirm={vi.fn()} />);
    expect(screen.getByText("Cash in Hand has Rs 80,000. Needed Rs 1,28,424. Short by Rs 48,424.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pay Rs 1,28,424" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks a future payment date", () => {
    render(<SalaryAccountDialog {...props} wallets={[{ id: "cash", name: "Cash in Hand", balance: "500000.00" }]} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Payment date"), { target: { value: "2026-12-04" } });
    expect(screen.getByText("Payment date can't be in the future")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pay Rs 1,28,424" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never blocks money coming in", () => {
    render(<SalaryAccountDialog {...props} direction="in" wallets={[{ id: "cash", name: "Cash in Hand", balance: "0.00" }]} onConfirm={vi.fn()} />);
    expect(screen.queryByText(/Short by/)).toBeNull();
    expect(screen.getByText("Balance after: Rs 1,28,424")).toBeTruthy();
  });
});

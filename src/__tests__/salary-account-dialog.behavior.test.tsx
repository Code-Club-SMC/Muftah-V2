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
  lines, direction: "out" as const, earliestDate: "2026-11-27", todayKey: "2026-12-03", pending: false,
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

  it("only offers days from when the slip was made up to today", () => {
    render(<SalaryAccountDialog {...props} wallets={[{ id: "cash", name: "Cash in Hand", balance: "500000.00" }]} onConfirm={vi.fn()} />);
    expect(screen.getByText("From 27 Nov 2026, when the last of these slips was made, up to today.")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Payment date" });
    expect(trigger.textContent).toContain("3 Dec 2026");
    fireEvent.click(trigger);
    const day = (label: RegExp) => screen.getByRole("button", { name: label }) as HTMLButtonElement;
    expect(day(/December 4th, 2026/).disabled).toBe(true);
    expect(day(/December 2nd, 2026/).disabled).toBe(false);
  });

  it("blocks a date before the slip was made", () => {
    render(<SalaryAccountDialog {...props} defaultDate="2026-11-26" wallets={[{ id: "cash", name: "Cash in Hand", balance: "500000.00" }]} onConfirm={vi.fn()} />);
    expect(screen.getByText("Payment date can't be before 27 Nov 2026, when the slip was made")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pay Rs 1,28,424" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts on the first account that can cover the total, and on the given date", () => {
    const onConfirm = vi.fn();
    render(
      <SalaryAccountDialog
        {...props}
        wallets={[{ id: "bank", name: "HBL", balance: "0.00" }, { id: "cash", name: "Cash in Hand", balance: "500000.00" }]}
        defaultDate="2026-11-30"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByText(/Short by/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pay Rs 1,28,424" }));
    expect(onConfirm).toHaveBeenCalledWith({ walletId: "cash", paymentDate: "2026-11-30" });
  });

  it("never blocks money coming in", () => {
    render(<SalaryAccountDialog {...props} direction="in" wallets={[{ id: "cash", name: "Cash in Hand", balance: "0.00" }]} onConfirm={vi.fn()} />);
    expect(screen.queryByText(/Short by/)).toBeNull();
    expect(screen.getByText("Balance after: Rs 1,28,424")).toBeTruthy();
  });
});

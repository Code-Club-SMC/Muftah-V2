import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SalaryPaymentsPanel } from "@/components/hr/payroll/salary-payments-panel";

afterEach(cleanup);

describe("SalaryPaymentsPanel", () => {
  it("lists payments with reversals and the distributor's part", () => {
    render(<SalaryPaymentsPanel history={{
      state: { status: "paid", net: "26200.00", paid: "26200.00", due: "0.00", overpaid: "0.00" },
      paidFrom: "Bank Alfalah",
      distributorPaid: "5000.00",
      payments: [
        { id: "1", kind: "payment", amount: "26200.00", walletName: "Cash in Hand", paymentDate: "2026-11-30", enteredAt: new Date("2026-12-03T05:00:00Z"), recordedBy: "Ali", status: "reversed", reversalReason: "Account changed to Bank Alfalah", reversedAt: new Date("2026-12-03T06:00:00Z"), reversedBy: "Ali" },
        { id: "2", kind: "payment", amount: "26200.00", walletName: "Bank Alfalah", paymentDate: "2026-11-30", enteredAt: new Date("2026-12-03T06:00:00Z"), recordedBy: "Ali", status: "active", reversalReason: null, reversedAt: null, reversedBy: null },
      ],
    }} />);
    expect(screen.getByText("Paid by distributor: Rs 5,000 (already deducted on this slip)")).toBeTruthy();
    expect(screen.getByText("Rs 26,200 from Bank Alfalah · paid 30 Nov 2026 · entered 3 Dec by Ali")).toBeTruthy();
    expect(screen.getByText("Reversed: Account changed to Bank Alfalah")).toBeTruthy();
  });

  it("says when nothing is paid yet", () => {
    render(<SalaryPaymentsPanel history={{ state: { status: "unpaid", net: "26200.00", paid: "0.00", due: "26200.00", overpaid: "0.00" }, paidFrom: null, distributorPaid: "0.00", payments: [] }} />);
    expect(screen.getByText("Not paid yet")).toBeTruthy();
  });
});

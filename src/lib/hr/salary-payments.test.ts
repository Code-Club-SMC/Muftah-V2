import { describe, expect, it } from "vitest";
import {
  effectiveDateFromKey,
  isPayrollLedgerSource,
  overpaidRecoveryReason,
  paymentDateError,
  payrollAcceptsPayslipChanges,
  payrollLedgerSource,
  registerPaymentSummary,
  salaryLedgerDescription,
  salaryReversalDescription,
  shortfallMessage,
  slipPaymentState,
  type SalaryPaymentLike,
} from "./salary-payments";

const pay = (amount: string, extra: Partial<SalaryPaymentLike> = {}): SalaryPaymentLike => ({ kind: "payment", amount, status: "active", ...extra });

describe("slipPaymentState", () => {
  it("is unpaid with no payments", () => {
    expect(slipPaymentState("26200.00", [])).toEqual({ status: "unpaid", net: "26200.00", paid: "0.00", due: "26200.00", overpaid: "0.00" });
  });
  it("is paid when payments equal net", () => {
    expect(slipPaymentState("26200.00", [pay("26200.00")]).status).toBe("paid");
  });
  it("shows balance due after a revision raises net", () => {
    expect(slipPaymentState("28200.00", [pay("26200.00")])).toMatchObject({ status: "balance_due", due: "2000.00" });
  });
  it("shows overpaid after a revision lowers net", () => {
    expect(slipPaymentState("23200.00", [pay("26200.00")])).toMatchObject({ status: "overpaid", overpaid: "3000.00", due: "0.00" });
  });
  it("counts refunds and recoveries against the paid amount and ignores reversed rows", () => {
    const rows = [pay("26200.00"), pay("26200.00", { status: "reversed" }), pay("3000.00", { kind: "refund" })];
    expect(slipPaymentState("23200.00", rows)).toMatchObject({ status: "paid", paid: "23200.00" });
    expect(slipPaymentState("23200.00", [pay("26200.00"), pay("3000.00", { kind: "recovery" })]).status).toBe("paid");
  });
  it("has nothing to pay when net is zero or negative and nothing was paid", () => {
    expect(slipPaymentState("0.00", []).status).toBe("nothing_to_pay");
    expect(slipPaymentState("-500.00", []).due).toBe("0.00");
  });
});

describe("registerPaymentSummary", () => {
  it("counts paid slips and totals paid and remaining", () => {
    const states = [slipPaymentState("100000.00", [pay("100000.00")]), slipPaymentState("28424.00", []), slipPaymentState("28200.00", [pay("26200.00")])];
    expect(registerPaymentSummary(states)).toEqual({ slipCount: 3, paidCount: 1, paidTotal: "126200.00", remainingTotal: "30424.00" });
  });
});

describe("paymentDateError", () => {
  it("allows the day the slip was made up to today", () => {
    expect(paymentDateError("2026-11-27", "2026-11-27", "2026-12-03")).toBeNull();
    expect(paymentDateError("2026-12-03", "2026-11-27", "2026-12-03")).toBeNull();
  });
  it("allows an early slip to be paid before its payout month starts", () => {
    expect(paymentDateError("2026-11-27", "2026-11-27", "2026-11-27")).toBeNull();
  });
  it("blocks future dates and dates before the slip was made", () => {
    expect(paymentDateError("2026-12-04", "2026-11-27", "2026-12-03")).toBe("Payment date can't be in the future");
    expect(paymentDateError("2026-11-26", "2026-11-27", "2026-12-03")).toBe("Payment date can't be before 27 Nov 2026, when the slip was made");
    expect(paymentDateError("2026-11-26", "2026-11-27", "2026-12-03", "Rizwan Qureshi")).toBe("Payment date can't be before 27 Nov 2026, when Rizwan Qureshi's slip was made");
    expect(paymentDateError("", "2026-11-27", "2026-12-03")).toBe("Choose a payment date");
  });
});

describe("ledger text", () => {
  it("names the month and employee", () => {
    expect(payrollLedgerSource("2026-11-01")).toBe("Payroll - Nov 2026");
    expect(salaryLedgerDescription("payment", "Shahab Gul", "2026-11-01")).toBe("Salary — Shahab Gul — Nov 2026");
    expect(salaryLedgerDescription("refund", "Rafi Ullah", "2026-11-01")).toBe("Salary refund — Rafi Ullah — Nov 2026");
    expect(salaryReversalDescription("Shahab Gul", "2026-11-01", "Account changed to Bank")).toBe("Reversal of salary — Shahab Gul — Nov 2026 — Account changed to Bank");
    expect(overpaidRecoveryReason("2026-11-01")).toBe("Salary overpaid for Nov 2026 — taken back from the next salary");
  });
  it("matches payroll sources only", () => {
    expect(isPayrollLedgerSource("Payroll - Nov 2026")).toBe(true);
    expect(isPayrollLedgerSource("Payroll")).toBe(true);
    expect(isPayrollLedgerSource("Expense")).toBe(false);
  });
  it("dates a payment at noon Pakistan time on the chosen day", () => {
    expect(effectiveDateFromKey("2026-11-30").toISOString()).toBe("2026-11-30T07:00:00.000Z");
  });
  it("explains a shortfall", () => {
    expect(shortfallMessage("Cash in Hand", "80000.00", "128424.00")).toBe("Cash in Hand has Rs 80,000. Needed Rs 1,28,424. Short by Rs 48,424.");
  });
});

describe("payrollAcceptsPayslipChanges", () => {
  it("keeps draft and old approved payrolls open, and old paid payrolls closed", () => {
    expect(payrollAcceptsPayslipChanges("draft")).toBe(true);
    expect(payrollAcceptsPayslipChanges("approved")).toBe(true);
    expect(payrollAcceptsPayslipChanges("paid")).toBe(false);
    expect(payrollAcceptsPayslipChanges(undefined)).toBe(false);
  });
});

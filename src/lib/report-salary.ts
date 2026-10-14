import { formatReportMoney } from "./report-format";

type SalarySnapshot = {
  allowanceBreakdown?: Record<string, number> | null;
  [key: string]: unknown;
};
export function salaryComponents(p: SalarySnapshot) {
  const amount = (key: string) => Number(p[key] ?? 0);
  // Compare what the reader sees; never change the persisted payroll totals.
  const displayedCents = (value: number) =>
    Math.round(Number(formatReportMoney(value).replaceAll(",", "")) * 100);
  const earnings = [
    { label: "Basic salary", amount: amount("basicSalary") },
    ...Object.entries(p.allowanceBreakdown ?? {})
      .filter(
        ([key, value]) =>
          key !== "basicSalary" && key !== "nightShift" && value !== 0,
      )
      .map(([label, amount]) => ({
        label: label.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " "),
        amount,
      })),
    ...[
      ["Incentive", "incentiveAmount"],
      ["Commission", "commissionAmount"],
      ["Overtime", "overtimeAmount"],
      ["Night shift allowance", "nightShiftAllowanceAmount"],
      ["Bonus", "bonusAmount"],
    ]
      .map(([label, key]) => ({ label, amount: amount(key) }))
      .filter((x) => x.amount !== 0),
  ];
  const deductions = [
    ["Absence", "absentDeduction"],
    ["Leave", "leaveDeduction"],
    ["Not employed", "notEmployedDeduction"],
    ["Advance", "advanceDeduction"],
    ["Tax", "taxDeduction"],
    ["Other", "otherDeduction"],
  ]
    .map(([label, key]) => ({ label, amount: amount(key) }))
    .filter((x) => x.amount !== 0);
  return {
    earnings,
    deductions,
    grossDifference:
      (displayedCents(amount("grossSalary")) -
        earnings.reduce((s, x) => s + displayedCents(x.amount), 0)) /
      100,
    deductionDifference:
      (displayedCents(amount("totalDeductions")) -
        deductions.reduce((s, x) => s + displayedCents(x.amount), 0)) /
      100,
    netDifference:
      (displayedCents(amount("netSalary")) -
        (displayedCents(amount("grossSalary")) -
          displayedCents(amount("totalDeductions")) +
          displayedCents(amount("arrearsAmount")))) /
      100,
  };
}

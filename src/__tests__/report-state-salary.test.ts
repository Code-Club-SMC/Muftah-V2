import { describe, expect, it } from "vitest";
import {
  formatReportMoney,
  reportCanExport,
  reportGenerationAction,
} from "@/lib/report-format";
import { salaryComponents } from "@/lib/report-salary";
describe("report state and precision", () => {
  it("retains cents, known zero and negatives", () => {
    expect(formatReportMoney(1234.56)).toBe("1,234.56");
    expect(formatReportMoney(0)).toBe("0.00");
    expect(formatReportMoney(-10.25)).toBe("-10.25");
  });
  it("exports successful empty results but never drafts, loading or failed refreshes", () => {
    expect(
      reportCanExport({
        generatedAt: 123,
        draft: false,
        loading: false,
        error: false,
      }),
    ).toBe(true);
    for (const key of ["draft", "loading", "error"])
      expect(
        reportCanExport({
          generatedAt: 123,
          draft: false,
          loading: false,
          error: false,
          [key]: true,
        }),
      ).toBe(false);
  });
  it("regenerates identical applied filters", () => {
    expect(
      reportGenerationAction(
        { dateFrom: "2026-10-01" },
        { dateFrom: "2026-10-01" },
      ),
    ).toBe("refetch");
    expect(reportGenerationAction(null, { dateFrom: "2026-10-01" })).toBe(
      "apply",
    );
  });
});
describe("persisted salary components", () => {
  it("explains a difference between displayed rounded components and the stored total", () => {
    const result = salaryComponents({
      basicSalary: 1.005,
      allowanceBreakdown: { housing: 1.005 },
      grossSalary: 2.01,
      netSalary: 2.01,
    });
    expect(result.grossDifference).toBe(-0.01);
  });
  it("reconciles a real payroll snapshot without counting basic salary twice or adding arrears twice", () => {
    const result = salaryComponents({
      basicSalary: 40000,
      allowanceBreakdown: {
        basicSalary: 40000,
        houseRent: 5000,
        nightShift: 100,
      },
      nightShiftAllowanceAmount: 500,
      commissionAmount: 2000,
      incentiveAmount: 1000,
      overtimeAmount: 1000,
      bonusAmount: 500,
      grossSalary: 50000,
      taxDeduction: 500,
      totalDeductions: 500,
      arrearsAmount: 1000,
      netSalary: 50500,
    });
    expect(result.earnings.reduce((total, row) => total + row.amount, 0)).toBe(
      50000,
    );
    expect(
      result.earnings.filter((row) => /basic/i.test(row.label)),
    ).toHaveLength(1);
    expect(result.grossDifference).toBe(0);
    expect(result.netDifference).toBe(0);
  });
  it("shows commission and named allowances once and keeps historical differences", () => {
    const result = salaryComponents({
      basicSalary: 100,
      allowanceBreakdown: { housing: 20, nightShift: 5 },
      commissionAmount: 10,
      nightShiftAllowanceAmount: 15,
      grossSalary: 150,
      totalDeductions: 3,
      netSalary: 147,
      taxDeduction: 2,
      arrearsAmount: 8,
    });
    expect(result.earnings).toEqual(
      expect.arrayContaining([
        { label: "housing", amount: 20 },
        { label: "Commission", amount: 10 },
        { label: "Night shift allowance", amount: 15 },
      ]),
    );
    expect(result.earnings.some((x) => x.label === "nightShift")).toBe(false);
    expect(result.grossDifference).toBe(5);
    expect(result.deductionDifference).toBe(1);
    expect(result.netDifference).toBe(-8);
  });
});

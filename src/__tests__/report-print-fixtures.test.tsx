/** Run with REPORT_FIXTURE_DIR to save actual report DOM for browser PDF inspection. */
import React from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ report: {} as any }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/server-functions/reports/sales-report-fn", () => ({
  getSalesReportFn: async () => state.report,
}));
vi.mock("@/server-functions/reports/collections-report-fn", () => ({
  getCollectionsReportFn: async () => state.report,
}));
vi.mock("@/server-functions/reports/outstanding-report-fn", () => ({
  getOutstandingReportFn: async () => state.report,
}));
vi.mock("@/server-functions/reports/purchases-report-fn", () => ({
  getPurchasesReportFn: async () => state.report,
}));
vi.mock("@/server-functions/reports/salaries-report-fn", () => ({
  getSalariesReportFn: async () => state.report,
}));
vi.mock("@/server-functions/reports/expenses-report-fn", () => ({
  getExpensesReportFn: async () => state.report,
}));
vi.mock("@/server-functions/finance-fn", () => ({
  getWalletsListFn: async () => [],
}));
vi.mock("@/server-functions/reports/offline-report-status-fn", () => ({
  getOfflineReportStatusFn: async () => ({ hasUnpostedOfflineInvoices: true }),
}));

import { Route as Sales } from "@/routes/_protected/reports/sales/index";
import { Route as Collections } from "@/routes/_protected/reports/collections/index";
import { Route as Outstanding } from "@/routes/_protected/reports/outstanding/index";
import { Route as Purchases } from "@/routes/_protected/reports/purchases/index";
import { Route as Salaries } from "@/routes/_protected/reports/salaries/index";
import { Route as Expenses } from "@/routes/_protected/reports/expenses/index";

const routes = {
  sales: Sales,
  collections: Collections,
  outstanding: Outstanding,
  purchases: Purchases,
  salaries: Salaries,
  expenses: Expenses,
};
type Kind = keyof typeof routes;
const stamp = "2026-10-13T10:15:00Z";

function fixture(kind: Kind, count: number) {
  const rows = Array.from({ length: count }, (_, i) => {
    const id = `ROW-${String(i + 1).padStart(3, "0")}`;
    const name = `${id} ${i % 3 === 0 ? "Muhammad Abdullah Industrial Chemicals and Distribution Company Pakistan Limited" : "Customer"}`;
    return { id, name, amount: i === 1 ? -10.25 : 1234567.89 };
  });
  const sum = rows.reduce((total, row) => total + row.amount, 0);
  if (kind === "sales")
    return {
      invoices: rows.map(({ id, name, amount }) => ({
        invoiceId: id,
        invoiceNumber: id,
        date: stamp,
        customerName: name,
        customerType: "distributor",
        source: "offline_import",
        paidAmount: amount,
        outstandingAmount: 0,
        totalPrice: amount,
        items: [
          {
            pack: "Industrial detergent 500 ml carton with 24 bottles",
            cartons: 1,
            units: 24,
            perCartonPrice: amount,
            amount,
            hsnCode: "3402.9000",
          },
        ],
      })),
      summary: {
        count,
        paidAmount: sum,
        outstandingAmount: 0,
        totalRevenue: sum,
      },
    };
  if (kind === "outstanding")
    return {
      invoices: rows.map(({ id, name, amount }) => ({
        slipId: id,
        invoiceNumber: id,
        invoiceDate: stamp,
        source: "offline_import",
        customerName: name,
        salesmanName: "Abdul Rehman",
        recoveryStatus: "partially_paid",
        paymentDueDate: stamp,
        invoiceAmount: amount + 100,
        paidAmount: 100,
        returnedAmount: 0,
        outstandingAmount: amount,
      })),
      summary: {
        count,
        invoiceAmount: sum + 100 * count,
        paidAmount: 100 * count,
        returnedAmount: 0,
        outstandingAmount: sum,
      },
    };
  if (kind === "collections")
    return {
      confirmed: rows.map(({ id, name, amount }) => ({
        paymentId: id,
        invoiceNumber: id,
        customerName: name,
        source: "offline_import",
        method: "cash",
        amount,
        effectiveDate: stamp,
      })),
      pending: [],
      exceptions: [],
      summary: { cash: sum, bankTransfer: 0, cheque: 0, pending: 0 },
    };
  if (kind === "purchases")
    return {
      purchases: rows.map(({ id, name, amount }) => ({
        purchaseId: id,
        purchaseDate: stamp,
        invoiceNumber: id,
        supplierName: name,
        warehouseName: "Central manufacturing warehouse",
        materialName: "Linear alkyl benzene sulphonic acid",
        materialType: "chemical",
        quantity: 12.5,
        unit: "kg",
        unitCost: amount / 12.5,
        cost: amount,
        paidAmount: amount,
        paymentMethod: "bank_transfer",
      })),
      summary: { count, totalCost: sum, totalPaid: sum, totalOutstanding: 0 },
    };
  if (kind === "salaries")
    return {
      payslips: rows.map(({ id, name }) => ({
        payslipId: id,
        employeeName: name,
        employeeCode: id,
        designation: "Senior manufacturing and distribution supervisor",
        department: "Production",
        payrollMonth: "2026-10-01",
        paidAt: stamp,
        daysPresent: 25,
        daysAbsent: 1,
        daysLeave: 1,
        basicSalary: 40000,
        allowanceBreakdown: {
          basicSalary: 40000,
          houseRent: 5000,
          nightShift: 100,
        },
        incentiveAmount: 1000,
        commissionAmount: 2000,
        overtimeAmount: 1000,
        nightShiftAllowanceAmount: 500,
        bonusAmount: 500,
        grossSalary: 50000,
        absentDeduction: 100,
        leaveDeduction: 50,
        notEmployedDeduction: 0,
        advanceDeduction: 200,
        taxDeduction: 100,
        otherDeduction: 50,
        totalDeductions: 500,
        netSalary: 50500,
        arrearsAmount: 1000,
        arrearsFromMonths: ["2026-09"],
      })),
      summary: {
        count,
        totalGross: 50000 * count,
        totalDeductions: 500 * count,
        totalNet: 50500 * count,
        totalArrears: 1000 * count,
      },
    };
  return {
    financeExpenses: rows.map(({ id, name, amount }) => ({
      expenseId: id,
      expenseDate: stamp,
      description: name,
      categoryName: "Factory utilities",
      walletName: "Operations",
      slipNumber: id,
      amount,
    })),
    productionCosts: count
      ? [
          {
            runId: "run",
            batchId: "BATCH-01",
            actualCompletionDate: stamp,
            productName: "Industrial detergent",
            recipeName: "500 ml cartons",
            warehouseName: "Central warehouse",
            containersProduced: 100,
            totalChemicalCost: 1000.25,
            totalPackagingCost: 300.5,
            totalProductionCost: 1300.75,
            actualCostPerPack: 0,
            costPerContainer: 0,
          },
        ]
      : [],
    failedBatchLosses: [],
    summary: {
      totalFinanceExpenses: sum,
      totalProductionCosts: count ? 1300.75 : 0,
      totalFailedBatchLosses: 0,
      grandTotal: sum + (count ? 1300.75 : 0),
    },
  };
}

afterEach(cleanup);

describe("report documents retain full fixture data", () => {
  for (const kind of Object.keys(routes) as Kind[]) {
    for (const count of [0, 3, 100]) {
      it(`${kind}: ${count} records`, async () => {
        state.report = fixture(kind, count);
        const client = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const Component = routes[kind].options.component as React.ComponentType;
        const { container, unmount } = render(
          <QueryClientProvider client={client}>
            <Component />
          </QueryClientProvider>,
        );
        fireEvent.click(
          screen.getByRole("button", { name: /generate report/i }),
        );
        await waitFor(() =>
          expect(screen.queryByText(/generating report/i)).toBeNull(),
        );
        await waitFor(() =>
          expect(
            screen
              .getByRole("button", { name: /^print$/i })
              .hasAttribute("disabled"),
          ).toBe(false),
        );
        if (count) {
          for (let i = 1; i <= count; i++)
            expect(container.textContent).toContain(
              `ROW-${String(i).padStart(3, "0")}`,
            );
        } else {
          expect(container.textContent).toMatch(/no records/i);
        }
        const output = process.env.REPORT_FIXTURE_DIR;
        if (output) {
          mkdirSync(output, { recursive: true });
          writeFileSync(
            join(output, `${kind}-${count}.html`),
            `<!doctype html><html class="dark"><head><meta charset="utf-8"><title>${kind} report fixture</title><link rel="stylesheet" href="report-app.css"></head><body><div style="min-height:100vh;display:flex"><main style="padding:28px 40px;width:100%">${container.innerHTML}</main></div></body></html>`,
          );
        }
        unmount();
        client.clear();
      });
    }
  }
});

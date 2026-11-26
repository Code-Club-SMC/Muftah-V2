import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayslipView } from "@/components/hr/payroll/payslip-view";
import { basePayslip } from "./fixtures/payslip-fixture";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn(), Link: (p: any) => p.children }));
afterEach(cleanup);
const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("Payslip commission lines", () => {
  it("shows commission on recoveries with the payment count, deductions and carried forward", () => {
    render(<PayslipView showActions={false} payslip={{ ...basePayslip, commissionAmount: "0.00", commissionBreakdown: {
      kind: "recovery", paymentsCount: 18, earned: 12400, deductions: 15400, carriedForward: 3000, lines: [],
    } }} />);
    expect(screen.getByText("Commission on recoveries: Rs 12,400 (18 payments)")).toBeTruthy();
    expect(screen.getByText("Deductions (reversed payments): −Rs 15,400")).toBeTruthy();
    expect(screen.getByText("Rs 3,000 carried forward to next month")).toBeTruthy();
  });

  it("keeps showing old per-order commission payslips as before", () => {
    render(<PayslipView showActions={false} payslip={{ ...basePayslip, commissionAmount: "2000.00", commissionBreakdown: [
      { orderId: "o1", orderRef: "ORD-1", orderDate: "2026-09-01", orderValue: 100000, rate: 2, amount: 2000 },
    ] }} />);
    expect(screen.getByText("Commission")).toBeTruthy();
  });
});

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InvoicePrintDialog } from "@/components/sales/invoice-print-dialog";

const state = vi.hoisted(() => ({ invoice: {} as any }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { invoice: state.invoice }, isLoading: false, isError: false }) }));
vi.mock("@/server-functions/sales/invoice-detail-fn", () => ({ getInvoiceDetailFn: vi.fn() }));
vi.mock("@/components/custom/responsive-dialog", () => ({ ResponsiveDialog: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/sales/distributor-invoice", () => ({ DistributorInvoiceView: ({ invoice }: any) => <output data-testid="profit">{invoice.totalProfit}</output> }));
vi.mock("@/components/sales/retailer-invoice", () => ({ RetailerInvoiceView: ({ invoice }: any) => <output data-testid="profit">{invoice.totalProfit}</output> }));
afterEach(cleanup);

it.each([
  ["retailer", "0.00", "40"],
  ["distributor", "0.00", "40"],
  ["retailer", "16.00", "24"],
  ["distributor", "16.00", "24"],
])("prints %s profit using recorded COGS %s", (customerType, cost, profit) => {
  state.invoice = { id: "invoice", date: "2026-10-06", customer: { name: "Customer", customerType }, items: [{ amount: "40.00", costOfGoodsSold: cost, numberOfCartons: 1, actualPackSize: 4, perCartonPrice: "40.00", quantity: 0 }] };
  render(<InvoicePrintDialog open invoiceId="invoice" onOpenChange={vi.fn()} />);
  expect(screen.getByTestId("profit").textContent).toBe(profit);
});

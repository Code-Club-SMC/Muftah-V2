import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentBadge } from "@/components/suppliers/purchase-history-table";

describe("purchase payment badge", () => {
  afterEach(cleanup);

  it("shows Paid when payments plus debit notes cover the cost", () => {
    render(<PaymentBadge cost={50000} paidAmount={45000} returnedAmount={5000} />);
    expect(screen.getByText("Paid")).toBeTruthy();
  });

  it("shows Partial when a debit note covers only part", () => {
    render(<PaymentBadge cost={50000} paidAmount={0} returnedAmount={5000} />);
    expect(screen.getByText("Partial")).toBeTruthy();
  });

  it("shows Unpaid when nothing is settled", () => {
    render(<PaymentBadge cost={50000} paidAmount={0} />);
    expect(screen.getByText("Unpaid")).toBeTruthy();
  });
});

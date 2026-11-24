import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server-functions/sales/invoice-detail-fn", () => ({ getInvoiceDetailFn: vi.fn() }));

import { DistributorInvoiceView } from "@/components/sales/distributor-invoice";
import { buildDistributorData } from "@/components/sales/invoice-print-dialog";

afterEach(cleanup);
const print = (...items: object[]) =>
  buildDistributorData({ id: "invoice-1", date: "2026-11-24", totalPrice: "0", customer: { name: "Distributor", customerType: "distributor" }, items });
const loose = { pack: "Nice 20 Kg Pack", numberOfCartons: 0, quantity: 10, actualPackSize: 1, perCartonPrice: "4000", marginPercent: "8", amount: "36800", margin: "766.38" };

describe("online distributor print", () => {
  it("prints packs sold without cartons", () => {
    expect(print(loose).items[0]).toMatchObject({ cartonQty: "0-10", cartonRate: 4000, grossAmount: 40000, discount: 3200, netAmount: 36800 });
  });
  it("prints loose packs of a carton product", () => {
    expect(print({ ...loose, actualPackSize: 12, perCartonPrice: "1200", quantity: 3, marginPercent: null, amount: "300" }).items[0])
      .toMatchObject({ cartonQty: "0-3", grossAmount: 300, discount: 0, netAmount: 300 });
  });
  it("prints cartons as before, with free cartons as goods", () => {
    expect(print({ pack: "Oil", numberOfCartons: 10, freeCartons: 1, quantity: 0, actualPackSize: 12, perCartonPrice: "1000", marginPercent: "8", amount: "9200" }).items[0])
      .toMatchObject({ cartonQty: "10-0", schemeCarton: "1-0", grossAmount: 10000, discount: 800, netAmount: 9200 });
  });
  it("never invents a discount from the rupee profit on a pack", () => {
    expect(print({ pack: "Oil", numberOfCartons: 10, quantity: 0, actualPackSize: 12, perCartonPrice: "1000", marginPercent: null, margin: "5.00", amount: "10000" }).items[0])
      .toMatchObject({ discount: 0, netAmount: 10000 });
  });
  it("shows the numbers on the printed page", () => {
    render(<DistributorInvoiceView invoice={print(loose)} showActions={false} />);
    expect(screen.getByText("0-10")).toBeTruthy();
    expect(screen.getAllByText(/36,?800/).length).toBeGreaterThan(0);
  });
});

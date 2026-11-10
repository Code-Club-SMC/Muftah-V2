import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LowStockAlerts } from "@/components/inventory/low-stocks-alert";

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), state: {} as any }));
vi.mock("@/hooks/stock/use-low-stock-alert", () => ({
  useLowStockAlerts: () => ({ refetch: mocks.refetch, ...mocks.state }),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { data: [], isLoading: false, isError: false };
});
describe("stock alert request states", () => {
  it("shows Checking stock during the first request", () => {
    mocks.state = { isLoading: true };
    render(<LowStockAlerts />);
    expect(screen.getByText(/Checking stock/)).toBeTruthy();
    expect(screen.queryByText(/No stock alerts/)).toBeNull();
  });
  it("only shows No stock alerts for a successful empty response", () => {
    render(<LowStockAlerts />);
    expect(screen.getByText(/No stock alerts/)).toBeTruthy();
  });
  it("shows an error and retries without claiming stock is healthy", () => {
    mocks.state = { isError: true };
    render(<LowStockAlerts />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Unable to check stock",
    );
    expect(screen.queryByText(/No stock alerts/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it("keeps cached severity, quantities and units visible while a refresh fails", () => {
    mocks.state = {
      isError: true,
      data: [
        {
          id: "floor:packaging:p",
          materialName: "Shopper",
          warehouseName: "Floor",
          currentStock: "0.000",
          minLevel: "0",
          unit: "kg",
          status: "out",
        },
        {
          id: "floor:raw:c",
          materialName: "Soda",
          warehouseName: "Floor",
          currentStock: "4.99",
          minLevel: "5",
          unit: "kg",
          status: "low",
        },
      ],
    };
    render(<LowStockAlerts />);
    expect(screen.getByText(/Unable to check stock/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /2 stock alerts/i }));
    expect(screen.getByText("Shopper")).toBeTruthy();
    expect(screen.getByText("Out of stock")).toBeTruthy();
    expect(screen.getByText("Low stock")).toBeTruthy();
    expect(screen.getByText(/Current: 0.00 kg/)).toBeTruthy();
    expect(screen.getByText(/Minimum: 5.00 kg/)).toBeTruthy();
  });
});

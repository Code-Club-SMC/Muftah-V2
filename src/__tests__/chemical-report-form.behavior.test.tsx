import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateLabReportForm } from "@/components/inventory/lab-reports/create-lab-report-form";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/inventory/use-lab-reports", () => ({
  useCreateLabReport: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateLabReport: () => ({ mutate: mocks.update, isPending: false }),
  useChemicalReportPurchases: () => ({ data: [
    { purchaseId: "p1", supplierName: "Supplier", purchaseDate: "2026-11-05", quantity: "100", unit: "kg", voidedAt: null },
    { purchaseId: "p2", supplierName: "Supplier", purchaseDate: "2026-11-06", quantity: "100", unit: "kg", voidedAt: null },
    { purchaseId: "void", supplierName: "Supplier", purchaseDate: "2026-11-06", quantity: "100", unit: "kg", voidedAt: "2026-11-06" },
  ], isPending: false, isError: false }),
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const props = { open: true, onOpenChange: vi.fn(), chemicalId: "c", chemicalName: "Soda", purchaseId: "p1" };
describe("existing certificate form ownership compatibility", () => {
  it("requires an active purchase and explicit supplied results/status instead of default certification", () => {
    const { rerender } = render(<CreateLabReportForm {...props} />);
    expect(screen.getByText("Purchase reference: p1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(screen.queryByDisplayValue("ISO 9001:2015")).toBeNull();
    expect((screen.getByRole("button", { name: "Create Certificate" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Lab technician" } });
    for (const input of screen.getAllByPlaceholderText("e.g., 5-7")) fireEvent.change(input, { target: { value: "Lab supplied" } });
    for (const input of screen.getAllByPlaceholderText("e.g., 6.5")) fireEvent.change(input, { target: { value: "8.1" } });
    expect((screen.getByRole("button", { name: "Create Certificate" }) as HTMLButtonElement).disabled).toBe(true);
    for (const button of screen.getAllByRole("button", { name: "Set result" })) fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Create Certificate" }));
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ chemicalId: "c", purchaseId: "p1", certifiedBy: "Lab technician", analysisItems: expect.arrayContaining([{ item: "pH", requirement: "Lab supplied", result: "8.1", passed: true }]) });
    rerender(<CreateLabReportForm {...props} purchaseId="p2" />);
    expect(screen.getAllByPlaceholderText("e.g., 6.5").every(input => !(input as HTMLInputElement).value)).toBe(true);
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
  });
  it("resets the selected purchase and analysis when reopened", () => {
    const { rerender } = render(<CreateLabReportForm {...props} />);
    fireEvent.change(screen.getAllByPlaceholderText("e.g., 6.5")[0], { target: { value: "8.1" } });
    rerender(<CreateLabReportForm {...props} open={false} />);
    rerender(<CreateLabReportForm {...props} />);
    expect(screen.getByText("Purchase reference: p1")).toBeTruthy();
    expect(screen.getAllByPlaceholderText("e.g., 6.5").every(input => !(input as HTMLInputElement).value)).toBe(true);
  });
});

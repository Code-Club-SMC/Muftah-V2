import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SimilarMaterialWarning } from "@/components/inventory/similar-material-warning";

describe("SimilarMaterialWarning", () => {
  afterEach(cleanup);

  it("offers Add stock and New item for a similar name", () => {
    const onAddStock = vi.fn();
    const onConfirmNew = vi.fn();
    render(<SimilarMaterialWarning matches={[{ id: "s", name: "Soda Ash", exact: false, stock: "620", unit: "kg" }]} onAddStock={onAddStock} onConfirmNew={onConfirmNew} />);
    expect(screen.getByText('Similar item already exists: "Soda Ash" (620 kg in stock)')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add stock to Soda Ash instead" }));
    expect(onAddStock).toHaveBeenCalledWith("s");
    fireEvent.click(screen.getByRole("button", { name: "No, this is a new item" }));
    expect(onConfirmNew).toHaveBeenCalled();
  });

  it("offers only Add stock when the name is the same apart from capitals, spaces or dashes", () => {
    render(<SimilarMaterialWarning matches={[{ id: "s", name: "Soda Ash", exact: true, stock: "0", unit: "kg" }]} onAddStock={vi.fn()} onConfirmNew={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "No, this is a new item" })).toBeNull();
  });
});

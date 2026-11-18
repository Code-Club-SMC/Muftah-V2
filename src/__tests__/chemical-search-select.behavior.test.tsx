import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChemicalSearchSelect } from "@/components/formulas/chemical-search-select";

describe("ChemicalSearchSelect", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  const chemicals = [
    { id: "chem-1", name: "MC-001", unit: "kg" },
    { id: "chem-2", name: "Caustic Soda", unit: "kg" },
    { id: "chem-3", name: "Sulfonic Acid", unit: "liters" },
  ];

  it("displays placeholder when no chemical is selected", () => {
    render(
      <ChemicalSearchSelect
        value=""
        onChange={vi.fn()}
        chemicals={chemicals}
        placeholder="Select a chemical..."
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Select a chemical...");
  });

  it("displays selected chemical name and unit", () => {
    render(
      <ChemicalSearchSelect
        value="chem-1"
        onChange={vi.fn()}
        chemicals={chemicals}
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("MC-001 (kg)");
  });

  it("opens popover and allows searching chemicals by name", () => {
    const onChange = vi.fn();
    render(
      <ChemicalSearchSelect
        value=""
        onChange={onChange}
        chemicals={chemicals}
      />,
    );

    // Open dropdown
    fireEvent.click(screen.getByRole("combobox"));

    // Search input should be visible
    const searchInput = screen.getByPlaceholderText("Search chemical by name...");
    expect(searchInput).toBeTruthy();

    // Type query to filter
    fireEvent.change(searchInput, { target: { value: "Caustic" } });

    // Should see Caustic Soda
    expect(screen.getByText(/Caustic Soda/)).toBeTruthy();

    // Click on Caustic Soda to select
    fireEvent.click(screen.getByText(/Caustic Soda/));
    expect(onChange).toHaveBeenCalledWith("chem-2");
  });
});

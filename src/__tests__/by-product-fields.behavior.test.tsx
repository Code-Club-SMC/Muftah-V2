import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ByProductFields } from "@/components/inventory/by-product-fields";

function Harness({ quantity }: { quantity: string }) {
  const [value, setValue] = useState({ byProductTracked: false, containerName: "Drum", containerSize: "100" });
  return <ByProductFields value={value} onChange={setValue} quantity={quantity} unit="kg" />;
}

describe("ByProductFields", () => {
  it("hides container inputs until ticked", () => {
    render(<Harness quantity="1000" />);
    expect(screen.queryByLabelText("Container size (kg)")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "By-product" }));
    expect(screen.getByLabelText("Container size (kg)")).toBeTruthy();
    expect(screen.getByText("10 Drums")).toBeTruthy();
  });

  it("warns when quantity is not whole containers", () => {
    render(<Harness quantity="950" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "By-product" }));
    expect(screen.getByText("Quantity must be a whole number of containers")).toBeTruthy();
  });
});

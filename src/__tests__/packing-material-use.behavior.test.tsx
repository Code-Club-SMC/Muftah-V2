import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaterialUseRow, materialUseErrors, usedFor } from "@/components/packaging/material-use-row";

function Row(props: { measuredInKg: boolean; needed: string; name: string }) {
  const [value, setValue] = useState<{ used: string; reason: string; note: string } | undefined>();
  return <MaterialUseRow {...props} unit={props.measuredInKg ? "kg" : "pcs"} gramsPerShopper="1.0" value={value} onChange={setValue} disabled={false} />;
}

describe("packing materials used", () => {
  it("leaves shopper KG blank and shows the live expected, actual and loss line", () => {
    render(<Row measuredInKg needed="1080" name="100g shopper" />);
    const input = screen.getByLabelText("100g shopper used (kg)") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(materialUseErrors({ name: "100g shopper", measuredInKg: true, needed: "1080", gramsPerShopper: "1.0", value: undefined })).toEqual(["100g shopper: enter the KG used"]);
    fireEvent.change(input, { target: { value: "1.20" } });
    expect(screen.getByText("Expected 1,200 · Actual 1,080 · Loss 120 (10.0%)")).toBeTruthy();
    expect(screen.queryByLabelText("Reason for extra 100g shopper")).toBeNull();
  });

  it("warns when packs are more than the weight should give", () => {
    render(<Row measuredInKg needed="1010" name="100g shopper" />);
    fireEvent.change(screen.getByLabelText("100g shopper used (kg)"), { target: { value: "1" } });
    expect(screen.getByText("More packs than this weight should give. Check the shopper weight in material setup.")).toBeTruthy();
  });

  it("pre-fills pieces with Needed, asks a reason only above it, and blocks below it", () => {
    render(<Row measuredInKg={false} needed="1080" name="Cap 38mm" />);
    const input = screen.getByLabelText("Cap 38mm used (pcs)") as HTMLInputElement;
    expect(input.value).toBe("1080");
    expect(screen.queryByLabelText("Reason for extra Cap 38mm")).toBeNull();
    fireEvent.change(input, { target: { value: "1110" } });
    expect(screen.getByLabelText("Reason for extra Cap 38mm")).toBeTruthy();
    fireEvent.change(input, { target: { value: "1000" } });
    expect(screen.getByText("Cap 38mm: used can't be less than needed (1080). Check the pack count instead.")).toBeTruthy();
  });

  it("makes lots add up to Used, not Needed", () => {
    expect(usedFor({ measuredInKg: false, needed: "1080", value: { used: "1110", reason: "broken", note: "" } })).toBe("1110");
    expect(usedFor({ measuredInKg: false, needed: "1080", value: undefined })).toBe("1080");
    expect(usedFor({ measuredInKg: true, needed: "1080", value: undefined })).toBe("");
  });
});

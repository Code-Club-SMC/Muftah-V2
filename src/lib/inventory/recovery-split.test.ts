import { describe, expect, it } from "vitest";
import { splitRecoveryAcrossLots } from "./material-lots";

describe("splitRecoveryAcrossLots", () => {
  const usages = [{ lotId: "a", quantity: "120.000", unitPrice: "115.00" }, { lotId: "b", quantity: "80.000", unitPrice: "125.00" }];
  it("refills lots in the order the batch took them", () => {
    expect(splitRecoveryAcrossLots("150", usages)).toEqual([{ lotId: "a", quantity: "120.000" }, { lotId: "b", quantity: "30.000" }]);
    expect(splitRecoveryAcrossLots("50", usages)).toEqual([{ lotId: "a", quantity: "50.000" }]);
  });
  it("never returns more than the batch took", () => {
    expect(() => splitRecoveryAcrossLots("201", usages)).toThrow("Recovered quantity is more than this batch took");
  });
});

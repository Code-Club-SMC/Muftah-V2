import { describe, expect, it } from "vitest";
import { summarizeBatchCosts, summarizePackingCosts } from "./cost-summary";

describe("saved production costs", () => {
  const allocations = [
    {
      status: "completed",
      allocatedChemicalCost: "10.01",
      totalPackagingCost: "2.10",
      totalProductionCost: "12.11",
    },
    {
      status: "completed",
      allocatedChemicalCost: "20.02",
      totalPackagingCost: "3.20",
      totalProductionCost: "23.22",
    },
    {
      status: "cancelled",
      allocatedChemicalCost: "100",
      totalPackagingCost: "100",
      totalProductionCost: "200",
    },
    {
      status: "in_progress",
      allocatedChemicalCost: "50",
      totalPackagingCost: "10",
      totalProductionCost: "60",
    },
  ];

  it("counts full mixing cost once and only adds completed packaging", () => {
    expect(summarizeBatchCosts("100.10", allocations)).toEqual({
      chemicalCost: "100.10",
      packagingCost: "5.30",
      totalCost: "105.40",
    });
  });

  it("does not present an unrecorded chemical cost as zero", () => {
    expect(summarizeBatchCosts(null, [])).toEqual({
      chemicalCost: null,
      packagingCost: "0.00",
      totalCost: null,
    });
  });

  it("sums saved receipt costs without floating point rounding or re-pricing", () => {
    expect(summarizePackingCosts(allocations.slice(0, 2))).toEqual({
      chemicalCost: "30.03",
      packagingCost: "5.30",
      totalCost: "35.33",
    });
    expect(summarizePackingCosts([])).toEqual({
      chemicalCost: "0.00",
      packagingCost: "0.00",
      totalCost: "0.00",
    });
  });
});

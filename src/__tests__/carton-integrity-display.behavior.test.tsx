import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrityAlertsWidget } from "@/features/manufacturing/cartons/components/integrity-alerts-widget";

afterEach(cleanup);

describe("finished stock integrity display", () => {
  it("shows stock-only failures instead of claiming validation", () => {
    render(<IntegrityAlertsWidget alerts={[]} checkResult={{ allBalanced: false, stockMismatches: [{
      recipe_id: "recipe", recipe_name: "Test pack", warehouse_id: "warehouse", warehouse_name: "Factory floor",
      uses_cartons: true, stock_units: 5, carton_units: "4", inventory_value: "99", wac: "13", expected_value: "65",
    }] }} />);
    expect(screen.queryByText("System Integrity Validated")).toBeNull();
    expect(screen.getByText("Finished stock discrepancies")).toBeTruthy();
    expect(screen.getByText("Test pack")).toBeTruthy();
    expect(screen.getByText("Factory floor")).toBeTruthy();
    expect(screen.getByText(/5 packs in stock.*4 packs in cartons/)).toBeTruthy();
    expect(screen.getByText(/99.00.*65.00/)).toBeTruthy();
  });
  it("does not claim validation before an integrity check", () => {
    render(<IntegrityAlertsWidget alerts={[]} />);
    expect(screen.queryByText("System Integrity Validated")).toBeNull();
    expect(screen.getByText("No open integrity alerts")).toBeTruthy();
  });
  it("shows ledger-only results before persisted alerts arrive", () => {
    render(<IntegrityAlertsWidget alerts={[]} checkResult={{ allBalanced: false, stockMismatches: [], mismatches: [{
      packaging_allocation_id: "allocation", sku: "Missing carton group", carton_sum: "0", ledger_total: "4", delta: "-4",
    }] }} />);
    expect(screen.getByText("Missing carton group")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("-4")).toBeTruthy();
    expect(screen.queryByText("System Integrity Validated")).toBeNull();
  });
  it("reports validation after a passing check", () => {
    render(<IntegrityAlertsWidget alerts={[]} checkResult={{ allBalanced: true, stockMismatches: [] }} />);
    expect(screen.getByText("System Integrity Validated")).toBeTruthy();
  });
});

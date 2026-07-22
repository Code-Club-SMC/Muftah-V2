import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getActualPackagingQuantity,
  getPlannedPackagingQuantity,
} from "@/lib/recipe-packaging";

describe("production packaging quantity math", () => {
  it("keeps planned carton-scoped packaging aligned to target cartons", () => {
    const qty = getPlannedPackagingQuantity({
      quantityPerContainer: 1,
      usageBasis: "per_carton",
      targetUnits: 4000,
      containersPerCarton: 24,
    });

    expect(qty).toBe(167);
  });

  it("keeps actual carton-scoped packaging aligned to completed full cartons only", () => {
    const qty = getActualPackagingQuantity({
      quantityPerContainer: 1,
      usageBasis: "per_carton",
      actualUnits: 3960,
      containersPerCarton: 24,
    });

    expect(qty).toBe(165);
  });

  it("keeps unit-scoped packaging aligned to actual units", () => {
    const qty = getActualPackagingQuantity({
      quantityPerContainer: 1,
      usageBasis: "per_unit",
      actualUnits: 3960,
      containersPerCarton: 24,
    });

    expect(qty).toBe(3960);
  });
});

describe("production run regression guards", () => {
  const productionDir = resolve(
    process.cwd(),
    "src/server-functions/inventory/production",
  );
  const productionProgressCore = resolve(
    productionDir,
    "production-progress-core.ts",
  );
  const componentsDir = resolve(process.cwd(), "src/components/productions");
  const inventoryComponentsDir = resolve(
    process.cwd(),
    "src/components/inventory",
  );
  const factoryFloorStocksFn = resolve(
    process.cwd(),
    "src/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn.ts",
  );
  const operatorRoute = resolve(
    process.cwd(),
    "src/routes/_protected/operator/$runId.tsx",
  );
  const manufacturingRunRoute = resolve(
    process.cwd(),
    "src/routes/_protected/manufacturing/productions/$runId/index.tsx",
  );
  const recipeForm = resolve(
    process.cwd(),
    "src/components/recipes/create-recipe-from.tsx",
  );

  it("does not re-deduct packaging on completion after progress has already consumed it", () => {
    const source = readFileSync(
      resolve(productionDir, "complete-production-fn.ts"),
      "utf8",
    );

    expect(source).toContain("shouldDeductPackagingOnCompletion");
    expect(source).toContain("(productionRun.completedUnits || 0) === 0");
  });

  it("deducts master cartons as whole cartons during progress logging", () => {
    const source = readFileSync(
      productionProgressCore,
      "utf8",
    );

    expect(source).toContain("Math.floor(");
    expect(source).toContain("getActualPackagingQuantity");
  });

  it("tracks operator progress as latest-log-editable entries", () => {
    const logSource = readFileSync(
      resolve(productionDir, "log-production-progress-fn.ts"),
      "utf8",
    );
    const editSource = readFileSync(
      resolve(productionDir, "edit-latest-production-progress-log-fn.ts"),
      "utf8",
    );

    expect(logSource).toContain("productionProgressLogs");
    expect(logSource).toContain("progressLogId: progressLog.id");
    expect(editSource).toContain("Only latest log can be edited.");
    expect(editSource).toContain('run.status !== "in_progress"');
  });

  it("stores recipe additional packaging usage basis instead of only normalizing to per-unit", () => {
    const source = readFileSync(recipeForm, "utf8");

    expect(source).toContain("usageBasis: tempPkgUnit");
    expect(source).toContain('pkg.usageBasis === "per_carton"');
  });

  it("shows actual completion efficiency instead of a hardcoded 100 percent", () => {
    const source = readFileSync(operatorRoute, "utf8");

    expect(source).toContain("Math.round(efficiency)");
    expect(source).not.toContain(
      '<p className="text-4xl font-bold text-foreground">100%</p>',
    );
  });

  it("shows produced cartons as full cartons plus loose units in the runs table", () => {
    const source = readFileSync(
      resolve(componentsDir, "production-runs-table.tsx"),
      "utf8",
    );

    expect(source).toContain("Math.floor(produced / perCarton)");
    expect(source).not.toContain("Math.ceil(produced / perCarton)");
  });

  it("removes fail and finish controls from the runs table list surface", () => {
    const source = readFileSync(
      resolve(componentsDir, "production-runs-table.tsx"),
      "utf8",
    );

    expect(source).not.toContain("Mark Failed");
    expect(source).not.toContain("Finish Run");
    expect(source).toContain("Manage in operator screen");
  });

  it("blocks failed status once operator logs exist and routes active management to operator flow", () => {
    const failSource = readFileSync(
      resolve(productionDir, "fail-production-fn.ts"),
      "utf8",
    );
    const manufacturingSource = readFileSync(manufacturingRunRoute, "utf8");
    const operatorSource = readFileSync(operatorRoute, "utf8");

    expect(failSource).toContain("hasOperatorProductionLogs");
    expect(failSource).toContain("Complete it with shortfall instead");
    expect(manufacturingSource).toContain("Open Operator Screen");
    expect(operatorSource).toContain("Logs exist. Close with shortfall, not failed.");
    expect(operatorSource).toContain("Edit Latest Log");
    expect(operatorSource).toContain("Type batch ID to confirm");
  });

  it("uses failed-batch chemical recovery instead of auto-reversal", () => {
    const recoverySource = readFileSync(
      resolve(
        process.cwd(),
        "src/server-functions/inventory/stock/recover-failed-production-chemical-fn.ts",
      ),
      "utf8",
    );
    const dialogSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/inventory/adjust-stock-dialog.tsx",
      ),
      "utf8",
    );

    expect(recoverySource).toContain("failedProductionChemicalRecoveries");
    expect(recoverySource).toContain("[FAILED BATCH RECOVERY]");
    expect(recoverySource).toContain("[FAILED BATCH LOSS]");
    expect(dialogSource).toContain("Failed Batch Recovery");
    expect(dialogSource).toContain("Search batch ID");
    expect(dialogSource).toContain("Any quantity not returned to stock is posted as a");
  });

  it("keeps factory-floor finished-goods KPI aligned with carton-ledger totals", () => {
    const stocksSource = readFileSync(factoryFloorStocksFn, "utf8");
    const containerSource = readFileSync(
      resolve(inventoryComponentsDir, "factory-floor-container.tsx"),
      "utf8",
    );

    expect(stocksSource).toContain("quantityCartons: stats.total");
    expect(containerSource).toContain(
      "fg.cartonStats?.total ?? fg.quantityCartons ?? 0",
    );
  });
});

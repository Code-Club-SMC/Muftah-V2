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

describe("two phase production regression guards", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("retires packing-job progress and keeps material debits out of completion", () => {
    const progress = read("src/server-functions/manufacturing/packaging/log-packaging-progress-fn.ts");
    const completion = read("src/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server.ts");
    expect(progress).toContain("This packing flow is retired");
    expect(progress).not.toContain("materialStock");
    expect(completion).not.toContain(".update(materialStock)");
    expect(completion).toContain('type: "PRODUCTION_RECEIPT"');
  });

  it("keeps allocation references out of legacy batch foreign keys", () => {
    for (const path of ["src/lib/cartons/carton.service.ts", "src/lib/cartons/bulk.service.ts", "src/lib/cartons/carton-extended.service.ts", "src/lib/cartons/invoice-stock.server.ts"]) {
      const source = read(path);
      expect(source).not.toMatch(/batchId:\s*[^,\n]*packagingAllocationId/);
      expect(source).toContain("packagingAllocationId:");
    }
    expect(read("src/server-functions/sales/invoice-posting-service.ts")).toContain("await dispatchInvoiceCartons(tx,");
  });

  it("shows the names and units that current list functions return", () => {
    expect(read("src/components/mixing/mixing-runs-table.tsx")).toContain('accessorKey: "formulaName"');
    expect(read("src/components/operator/mixing-operator-interface.tsx")).toContain("run.formulaName");
    expect(read("src/components/packaging/packaging-allocations-table.tsx")).toContain("row.original.allocatedBulkUnit");
  });

  it("prefetches paginated batches for the operator workstation", () => {
    const route = read("src/routes/_protected/operator/index.tsx");
    const mixing = read("src/components/operator/mixing-operator-interface.tsx");
    expect(route).toContain('["operator-mixing-runs", "list", { page: 1, search: "", stage: "all" }]');
    expect(mixing).toContain('["operator-mixing-runs", "list", { page, search, stage }]');
    for (const source of [route, mixing]) {
      expect(source).toContain('["in_progress", "scheduled", "completed"]');
      expect(source).toContain('limit: 10');
    }
    expect(route).not.toContain("operator-packaging");
    const mutations = read("src/hooks/manufacturing/mixing/use-mixing-mutations.ts");
    expect(mutations).toContain("variables.data.mixingRunId");
    expect(mutations).toContain('queryKey: ["operator-mixing-run",');
    expect(mutations).not.toContain("as any");
  });

  it("requires a single formula selection for packaging recipes", () => {
    const form = read("src/components/recipes/create-recipe-from.tsx");
    expect(form.match(/<form.Field name="formulaId">/g)).toHaveLength(1);
    expect(form).not.toContain('title="Chemical Formulation"');
    expect(form).toContain("usageBasis: tempPkgUnit");
  });

  it("routes current manufacturing navigation to existing two phase pages", () => {
    const navigation = read("src/lib/constants.ts");
    expect(navigation).not.toContain('url: "/manufacturing/productions"');
    expect(navigation).toContain('url: "/manufacturing/mixing"');
    expect(navigation).toContain('url: "/manufacturing/packaging"');
  });

  it("connects allocation cartons and integrity to a current route", () => {
    const route = read("src/routes/_protected/manufacturing/packaging/$allocationId/cartons.tsx");
    expect(route).toContain('/_protected/manufacturing/packaging/$allocationId/cartons');
    expect(route).toContain('<BatchDetailContainer allocationId={allocationId}');
    expect(read("src/components/packaging/packaging-allocations-table.tsx")).toContain('to="/manufacturing/packaging/$allocationId/cartons"');
  });
});

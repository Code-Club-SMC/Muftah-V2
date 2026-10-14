import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { ZodType } from "zod";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  formulaRead: vi.fn(),
  queries: [] as any[],
}));
vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
    query: { formulas: { findMany: mocks.formulaRead } },
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireManufacturingViewMiddleware: {},
  requireProductionWorkReadMiddleware: {},
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: ZodType;
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: ZodType) => {
        validator = schema;
        return builder;
      },
      handler: (handler: (args: any) => unknown) => async (args: any) =>
        handler({ ...args, data: validator.parse(args.data) }),
    };
    return builder;
  },
}));

import { getMixingRunsFn } from "@/server-functions/manufacturing/mixing/get-mixing-runs-fn";
import { getFormulasFn } from "@/server-functions/manufacturing/formulas/get-formulas-fn";
import { getPaginatedPackagingAllocationsFn } from "@/server-functions/manufacturing/packaging/get-paginated-packaging-allocations-fn";
import {
  productionDateBounds,
  formatProductionCreatedDate,
} from "@/lib/production/list-filters";

function invoke(
  fn: unknown,
  data: unknown,
  permissions: string[] = ["operator.run.read"],
) {
  return (fn as (args: unknown) => Promise<any>)({
    data,
    context: {
      session: { user: { id: "assigned-operator" } },
      authContext: { permissions },
    },
  });
}
function sql(query: { where: ReturnType<typeof vi.fn> }) {
  const expression = query.where.mock.calls[0][0] as SQL;
  return expression
    ? new PgDialect().sqlToQuery(expression)
    : { sql: "", params: [] };
}

describe("paginated manufacturing read handlers", () => {
  beforeEach(() => {
    mocks.queries.length = 0;
    mocks.formulaRead.mockReset().mockResolvedValue([{ id: "formula-11" }]);
    mocks.select.mockReset().mockImplementation((fields) => {
      const isCount = "count" in fields || "value" in fields;
      const result = isCount
        ? [
            {
              count: 11,
              value: 11,
              active: 3,
              completed: 8,
              averageYield: "95.5",
              inactive: 8,
              products: 2,
              scheduled: 4,
              completedContainers: 95,
              targetContainers: 100,
            },
          ]
        : [
            {
              formula: { name: "Formula 11" },
              operator: { name: "Operator" },
              allocation: { id: "job-11" },
              mixingRun: { id: "run-11", batchId: "A0011" },
              recipe: { name: "Small pack" },
            },
          ];
      const query: any = {
        fields,
        from: () => query,
        leftJoin: () => query,
        innerJoin: () => query,
        where: vi.fn(() => query),
        orderBy: () => query,
        limit: vi.fn(() => query),
        offset: vi.fn(() => query),
        then: (
          resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      };
      mocks.queries.push(query);
      return query;
    });
  });

  it("applies active statuses and assignment to both count and paged rows", async () => {
    const result = await invoke(getMixingRunsFn, {
      statuses: ["in_progress", "scheduled"],
      page: 2,
      limit: 10,
      search: "A0011",
    });
    expect(result.runs[0].id).toBe("run-11");
    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    for (const query of mocks.queries) {
      const generated = sql(query);
      expect(generated.sql).toContain('"mixing_runs"."operator_id"');
      expect(generated.sql).toContain('"mixing_runs"."status" in');
      expect(generated.params).toEqual([
        "%A0011%",
        "in_progress",
        "scheduled",
        "assigned-operator",
      ]);
    }
    expect(mocks.queries[1].limit).toHaveBeenCalledWith(10);
    expect(mocks.queries[1].offset).toHaveBeenCalledWith(10);
  });
  it.each([
    "manufacturing.run.read",
    "manufacturing.run.manage",
    "manufacturing.view",
  ])(
    "keeps broad %s access without the operator filter",
    async (permission) => {
      await invoke(getMixingRunsFn, { statuses: ["scheduled"] }, [permission]);
      for (const query of mocks.queries) {
        expect(sql(query).sql).not.toContain('"mixing_runs"."operator_id"');
        expect(sql(query).params).toEqual(["scheduled"]);
      }
    },
  );
  it("passes formula search and second-page offsets to the relational read", async () => {
    const result = await invoke(getFormulasFn, {
      search: "Formula 11",
      pageIndex: 1,
      pageSize: 10,
    });
    expect(result).toMatchObject({
      formulas: [{ id: "formula-11" }],
      totalCount: 11,
      kpis: { total: 11, active: 3, inactive: 8, products: 2 },
    });
    const args = mocks.formulaRead.mock.calls[0][0];
    expect(args.offset).toBe(10);
    expect(args.limit).toBe(10);
    expect(new PgDialect().sqlToQuery(args.where).params).toEqual([
      "%Formula 11%",
    ]);
  });
  it.each([{ pageIndex: -1 }, { pageSize: 0 }, { pageSize: 1.5 }])(
    "rejects invalid formula pagination %j",
    async (data) => {
      await expect(invoke(getFormulasFn, data)).rejects.toThrow();
      expect(mocks.formulaRead).not.toHaveBeenCalled();
    },
  );

  it.each([
    [getMixingRunsFn, { page: 2, limit: 10, status: "completed" }],
    [getFormulasFn, { pageIndex: 1, pageSize: 10, statusFilter: "active" }],
    [
      getPaginatedPackagingAllocationsFn,
      { pageIndex: 1, pageSize: 10, status: "completed" },
    ],
  ])(
    "uses inclusive Pakistan days in the aggregate and row query",
    async (fn, pagination) => {
      await invoke(fn, { ...pagination, from: "2026-10-08", to: "2026-10-08" });
      const rowWhere =
        fn === getFormulasFn
          ? mocks.formulaRead.mock.calls[0][0].where
          : mocks.queries[1].where.mock.calls[0][0];
      const expressions = [mocks.queries[0].where.mock.calls[0][0], rowWhere];
      const generated = expressions.map((expression) =>
        new PgDialect().sqlToQuery(expression),
      );
      expect(generated[0]).toEqual(generated[1]);
      expect(generated[0].sql).toContain('"created_at" >=');
      expect(generated[0].sql).toContain('"created_at" <');
      expect(generated[0].params).toContain("2026-10-07T19:00:00.000Z");
      expect(generated[0].params).toContain("2026-10-08T19:00:00.000Z");
      if (fn === getFormulasFn)
        expect(mocks.formulaRead.mock.calls[0][0].offset).toBe(10);
      else expect(mocks.queries[1].offset).toHaveBeenCalledWith(10);
    },
  );

  it("matches every instant in a Pakistan calendar day and excludes the next midnight", () => {
    const range = productionDateBounds({
      from: "2026-10-08",
      to: "2026-10-08",
    });
    const matches = (date: string) =>
      new Date(date) >= range.from! && new Date(date) < range.to!;
    expect(matches("2026-10-07T18:59:59.999Z")).toBe(false);
    expect(matches("2026-10-07T19:00:00Z")).toBe(true);
    expect(matches("2026-10-08T18:59:59.999Z")).toBe(true);
    expect(matches("2026-10-08T19:00:00Z")).toBe(false);
    expect(formatProductionCreatedDate("2026-10-07T19:00:00Z")).toBe(
      "Oct 8, 2026",
    );
    expect(formatProductionCreatedDate("2026-10-08T19:00:00Z")).toBe(
      "Oct 9, 2026",
    );
  });

  it.each([getMixingRunsFn, getFormulasFn, getPaginatedPackagingAllocationsFn])(
    "rejects invalid dates, reversed dates and oversized pages before querying",
    async (fn) => {
      for (const data of [
        { from: "2026-02-30" },
        { to: "2026-13-01" },
        { from: "2026-10-09", to: "2026-10-08" },
        { from: "2026-2-01" },
        { from: "0000-01-01" },
        { limit: 101, pageSize: 101 },
      ])
        await expect(invoke(fn, data)).rejects.toThrow();
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.formulaRead).not.toHaveBeenCalled();
    },
  );

  it("computes mixing KPIs beyond the page using individual batch yield ratios", async () => {
    const result = await invoke(getMixingRunsFn, { page: 2 });
    expect(result.runs).toHaveLength(1);
    expect(result.kpis).toEqual({
      total: 11,
      active: 3,
      completed: 8,
      completionPercentage: (8 / 11) * 100,
      averageYieldPercentage: 95.5,
    });
    const expression = new PgDialect().sqlToQuery(
      mocks.queries[0].fields.averageYield,
    ).sql;
    expect(expression).toContain("avg(100.0 *");
    expect(expression).toContain("nullif(");
    expect(expression).not.toContain("sum(");
    expect(mocks.queries[0].limit).not.toHaveBeenCalled();
    expect(mocks.queries[0].offset).not.toHaveBeenCalled();
  });

  it("searches every job, batch and format with the same assignment scope for KPIs and rows", async () => {
    const result = await invoke(getPaginatedPackagingAllocationsFn, {
      pageIndex: 1,
      pageSize: 10,
      search: "pack",
      status: "in_progress",
    });
    expect(result.allocations[0].id).toBe("job-11");
    expect(result.kpis).toEqual({
      scheduled: 4,
      active: 3,
      completedContainers: 95,
      targetContainers: 100,
      packingPercentage: 95,
    });
    expect(result.totalCount).toBe(11);
    expect(result.allocations).toHaveLength(1);
    for (const query of mocks.queries) {
      const generated = sql(query);
      expect(generated.sql).toContain('"packaging_allocations"."operator_id"');
      expect(generated.sql).toContain('"mixing_runs"."batch_id"');
      expect(generated.sql).toContain('"recipes"."name"');
      expect(generated.params).toEqual([
        "%pack%",
        "%pack%",
        "%pack%",
        "in_progress",
        "assigned-operator",
      ]);
    }
    expect(mocks.queries[1].offset).toHaveBeenCalledWith(10);
    expect(mocks.queries[0].limit).not.toHaveBeenCalled();
  });

  it.each([
    "manufacturing.run.read",
    "manufacturing.run.manage",
    "manufacturing.view",
  ])("does not scope paginated jobs for %s", async (permission) => {
    await invoke(getPaginatedPackagingAllocationsFn, {}, [permission]);
    for (const query of mocks.queries)
      expect(sql(query).sql).not.toContain(
        '"packaging_allocations"."operator_id"',
      );
  });
});

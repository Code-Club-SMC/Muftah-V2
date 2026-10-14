import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { ZodType } from "zod";

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  userId: "qc-operator",
  reports: [] as any[],
  batches: [] as any[],
  run: null as any,
  selectQuery: null as any,
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/lib/authz.server", () => ({
  getAuthContext: async () => ({
    permissions: new Set(mocks.permissions),
    session: { user: { id: mocks.userId } },
  }),
  requirePermission: (context: any, permission: string) => {
    if (!context.permissions.has(permission) && !context.permissions.has("*"))
      throw new Error("Unauthorized");
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ url: "https://titan.test/manufacturing/qc" }),
}));
vi.mock("@tanstack/react-start", () => {
  async function execute(middleware: any, context: any): Promise<any> {
    for (const dependency of middleware.dependencies ?? [])
      context = await execute(dependency, context);
    return middleware.run({
      context,
      next: async (value: any) => ({ ...context, ...value.context }),
    });
  }
  return {
    createMiddleware: () => {
      const middleware: any = { dependencies: [] };
      const builder = {
        middleware: (dependencies: any[]) => {
          middleware.dependencies = dependencies;
          return builder;
        },
        server: (run: any) => ({ ...middleware, run }),
      };
      return builder;
    },
    createServerFn: (options: any) => {
      let validator: ZodType;
      let middlewares: any[] = [];
      const builder = {
        middleware: (value: any[]) => {
          middlewares = value;
          return builder;
        },
        inputValidator: (schema: ZodType) => {
          validator = schema;
          return builder;
        },
        handler: (handler: any) =>
          Object.assign(
            async (args: any) => {
              let context = {};
              for (const middleware of middlewares)
                context = await execute(middleware, context);
              return handler({ data: validator.parse(args.data), context });
            },
            { method: options?.method },
          ),
      };
      return builder;
    },
  };
});
vi.mock("@/db", () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
    select: mocks.select,
    query: {
      mixingRuns: { findFirst: async () => mocks.run },
      productionRunLabReports: {
        findMany: async ({ where }: any) => {
          const [batchId] = new PgDialect().sqlToQuery(where).params;
          return mocks.reports.filter(
            (report) => report.mixingRunId === batchId,
          );
        },
      },
    },
  },
}));

import {
  createMixingLabReportFn,
  deleteMixingLabReportFn,
  getMixingLabReportsFn,
  getProductionQCBatchesFn,
  updateMixingLabReportFn,
} from "@/server-functions/manufacturing/mixing/lab-reports-fn";
import { navigations } from "@/lib/constants";
import {
  canAccessPath,
  getAccessibleNavigationItems,
  getFirstAccessiblePath,
  LANDING_PATH_OPTIONS,
  PERMISSION_DEFINITIONS,
  SYSTEM_ROLE_SEEDS,
} from "@/lib/rbac";

const fields = {
  mixingRunId: "batch-1",
  reportDate: "2026-10-08",
  certifiedBy: "  QC Operator  ",
  analysisItems: [
    {
      item: "Appearance",
      requirement: "Uniform",
      result: "Uniform",
      passed: true,
    },
    {
      item: "pH",
      requirement: "Product specification",
      result: "6.5",
      passed: false,
    },
  ],
};
function invoke(fn: unknown, data: unknown) {
  return (fn as (args: any) => Promise<any>)({ data });
}
function identity(where: SQL) {
  return new PgDialect().sqlToQuery(where).params;
}

describe("production QC server and permissions", () => {
  beforeEach(() => {
    mocks.permissions = ["manufacturing.qc.manage"];
    mocks.userId = "qc-operator";
    mocks.reports = [];
    mocks.batches = [{ id: "batch-1", batchId: "A0001" }];
    mocks.run = {
      id: "batch-1",
      operatorId: "other-operator",
      batchId: "A0001",
      formula: { product: { name: "Dishwash" } },
    };
    mocks.insert.mockReset().mockImplementation(() => ({
      values: (values: any) => ({
        returning: async () => {
          const report = { id: "report-1", ...values };
          mocks.reports.push(report);
          return [report];
        },
      }),
    }));
    mocks.update.mockReset().mockImplementation(() => ({
      set: (values: any) => ({
        where: (where: SQL) => ({
          returning: async () => {
            const [reportId, batchId] = identity(where);
            const report = mocks.reports.find(
              (row) => row.id === reportId && row.mixingRunId === batchId,
            );
            if (!report) return [];
            Object.assign(report, values);
            return [report];
          },
        }),
      }),
    }));
    mocks.delete.mockReset().mockImplementation(() => ({
      where: (where: SQL) => ({
        returning: async () => {
          const [reportId, batchId] = identity(where);
          const index = mocks.reports.findIndex(
            (row) => row.id === reportId && row.mixingRunId === batchId,
          );
          return index === -1 ? [] : mocks.reports.splice(index, 1);
        },
      }),
    }));
    mocks.select.mockReset().mockImplementation(() => {
      const query: any = {
        from: () => query,
        innerJoin: () => query,
        orderBy: () => query,
        where: vi.fn(() => query),
        limit: vi.fn(() => query),
        offset: vi.fn(() => query),
        then: (resolve: any, reject: any) =>
          Promise.resolve(mocks.batches).then(resolve, reject),
      };
      mocks.selectQuery = query;
      return query;
    });
  });

  it("allows a QC operator to create, read, edit and delete a report for another operator's batch", async () => {
    const created = await invoke(createMixingLabReportFn, fields);
    expect(created).toMatchObject({
      productName: "Dishwash",
      mixingRunId: "batch-1",
      productionRunId: null,
      lotNumber: "A0001",
      certifiedBy: "QC Operator",
      createdById: "qc-operator",
      analysisItems: fields.analysisItems,
    });
    expect(
      await invoke(getMixingLabReportsFn, { mixingRunId: "batch-1" }),
    ).toHaveLength(1);
    await invoke(updateMixingLabReportFn, {
      ...fields,
      reportId: created.id,
      notes: "Retested",
      stockNumber: "S1",
    });
    expect(mocks.reports[0]).toMatchObject({
      notes: "Retested",
      stockNumber: "S1",
      createdById: "qc-operator",
      productName: "Dishwash",
    });
    expect(
      await invoke(deleteMixingLabReportFn, {
        mixingRunId: "batch-1",
        reportId: created.id,
      }),
    ).toMatchObject({ success: true });
    expect(mocks.reports).toHaveLength(0);
    for (const fn of [
      createMixingLabReportFn,
      updateMixingLabReportFn,
      deleteMixingLabReportFn,
    ])
      expect((fn as any).method).toBe("POST");
  });

  it.each(["manufacturing.qc.read", "manufacturing.qc.manage"])(
    "lets %s search all batches and read reports without manufacturing.view",
    async (permission) => {
      mocks.permissions = [permission];
      const results = await invoke(getProductionQCBatchesFn, {
        search: "Dishwash",
        page: 2,
        limit: 20,
      });
      expect(results.batches).toHaveLength(1);
      expect(mocks.selectQuery.offset).toHaveBeenCalledWith(20);
      expect(mocks.selectQuery.limit).toHaveBeenCalledWith(21);
      const query = new PgDialect().sqlToQuery(
        mocks.selectQuery.where.mock.calls[0][0],
      );
      expect(query.sql).not.toContain("operator_id");
      expect(query.params).toEqual(["%Dishwash%", "%Dishwash%", "%Dishwash%"]);
      expect(query.sql).toContain('"products"."name"');
      await expect(
        invoke(getMixingLabReportsFn, { mixingRunId: "batch-1" }),
      ).resolves.toEqual([]);
    },
  );

  it.each(["manufacturing.qc.read", "operator.run.read", "manufacturing.view"])(
    "denies all report mutations to %s",
    async (permission) => {
      mocks.permissions = [permission];
      for (const [fn, data] of [
        [createMixingLabReportFn, fields],
        [updateMixingLabReportFn, { ...fields, reportId: "report-1" }],
        [
          deleteMixingLabReportFn,
          { mixingRunId: "batch-1", reportId: "report-1" },
        ],
      ])
        await expect(invoke(fn, data)).rejects.toThrow();
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
    },
  );

  it("preserves assigned operator reads while denying other batches and QC batch selection", async () => {
    mocks.permissions = ["operator.run.read"];
    mocks.run.operatorId = mocks.userId;
    await expect(
      invoke(getMixingLabReportsFn, { mixingRunId: "batch-1" }),
    ).resolves.toEqual([]);
    mocks.run.operatorId = "another-operator";
    await expect(
      invoke(getMixingLabReportsFn, { mixingRunId: "batch-1" }),
    ).rejects.toThrow("assigned to another operator");
    await expect(invoke(getProductionQCBatchesFn, {})).rejects.toThrow();
  });

  it("rejects cross-batch edits and deletes without changing the report", async () => {
    await invoke(createMixingLabReportFn, fields);
    await expect(
      invoke(updateMixingLabReportFn, {
        ...fields,
        mixingRunId: "wrong-batch",
        reportId: "report-1",
        notes: "Wrong",
      }),
    ).rejects.toThrow("not found for this mixing batch");
    await expect(
      invoke(deleteMixingLabReportFn, {
        mixingRunId: "wrong-batch",
        reportId: "report-1",
      }),
    ).rejects.toThrow("not found for this mixing batch");
    expect(mocks.reports).toHaveLength(1);
    expect(mocks.reports[0].notes).toBeNull();
  });

  it.each([
    { certifiedBy: "   " },
    { analysisItems: [] },
    { reportDate: "2026-02-30" },
    {
      analysisItems: [
        { item: " ", requirement: "Uniform", result: "Pass", passed: true },
      ],
    },
  ])("rejects invalid report fields %j before inserting", async (invalid) => {
    await expect(
      invoke(createMixingLabReportFn, { ...fields, ...invalid }),
    ).rejects.toThrow();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a missing batch on create and read", async () => {
    mocks.run = undefined;
    await expect(invoke(createMixingLabReportFn, fields)).rejects.toThrow(
      "Mixing batch not found",
    );
    await expect(
      invoke(getMixingLabReportsFn, { mixingRunId: "missing" }),
    ).rejects.toThrow("Mixing batch not found");
  });

  it("limits the batch lookup and reports when another page is available", async () => {
    mocks.batches = [{ id: "first" }, { id: "second" }, { id: "next-page" }];
    const result = await invoke(getProductionQCBatchesFn, { limit: 2 });
    expect(result).toEqual({
      batches: [{ id: "first" }, { id: "second" }],
      hasMore: true,
      page: 1,
    });
    expect(mocks.selectQuery.limit).toHaveBeenCalledWith(3);
    await expect(
      invoke(getProductionQCBatchesFn, { limit: 101 }),
    ).rejects.toThrow();
    await expect(
      invoke(getProductionQCBatchesFn, { page: 0 }),
    ).rejects.toThrow();
  });

  it("seeds QC permissions and exposes QC navigation and landing paths without manufacturing management", () => {
    for (const permission of [
      "manufacturing.qc.read",
      "manufacturing.qc.manage",
    ] as const) {
      expect(PERMISSION_DEFINITIONS.some((row) => row.key === permission)).toBe(
        true,
      );
      expect(
        SYSTEM_ROLE_SEEDS.find((row) => row.slug === "admin")?.permissionKeys,
      ).toContain(permission);
      expect(canAccessPath("/manufacturing/qc/", [permission])).toBe(true);
      expect(canAccessPath("/manufacturing/formulas", [permission])).toBe(
        false,
      );
      const production = getAccessibleNavigationItems(navigations, [
        permission,
      ]).find((row) => row.title === "Production");
      expect(production?.items?.map((row) => row.url)).toEqual([
        "/manufacturing/qc",
      ]);
      expect(getFirstAccessiblePath([permission])).toBe("/manufacturing/qc");
    }
    expect(LANDING_PATH_OPTIONS).toContain("/manufacturing/qc");
    expect(canAccessPath("/manufacturing/qc", ["operator.run.read"])).toBe(
      false,
    );
  });
});

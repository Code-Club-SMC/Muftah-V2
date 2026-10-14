import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server-functions/manufacturing/mixing/create-mixing-run-fn", () => ({
  createMixingRunFn: vi.fn(async () => ({ id: "run-1" })),
}));
vi.mock("@/server-functions/manufacturing/mixing/start-mixing-run-fn", () => ({
  startMixingRunFn: vi.fn(),
}));
vi.mock(
  "@/server-functions/manufacturing/mixing/log-mixing-progress-fn",
  () => ({ logMixingProgressFn: vi.fn() }),
);
vi.mock(
  "@/server-functions/manufacturing/mixing/complete-mixing-run-fn",
  () => ({ completeMixingRunFn: vi.fn() }),
);
vi.mock("@/server-functions/manufacturing/mixing/cancel-mixing-run-fn", () => ({
  cancelMixingRunFn: vi.fn(),
}));
vi.mock("@/server-functions/manufacturing/mixing/fail-mixing-run-fn", () => ({
  failMixingRunFn: vi.fn(),
}));
vi.mock(
  "@/server-functions/manufacturing/packaging/create-packaging-allocation-fn",
  () => ({
    createPackagingAllocationFn: vi.fn(async () => ({ mixingRunId: "run-1" })),
  }),
);
vi.mock(
  "@/server-functions/manufacturing/packaging/start-packaging-allocation-fn",
  () => ({
    startPackagingAllocationFn: vi.fn(async () => ({ mixingRunId: "run-1" })),
  }),
);
vi.mock(
  "@/server-functions/manufacturing/packaging/log-packaging-progress-fn",
  () => ({
    logPackagingProgressFn: vi.fn(async () => ({ mixingRunId: "run-1" })),
  }),
);
vi.mock(
  "@/server-functions/manufacturing/packaging/complete-packaging-allocation-fn",
  () => ({
    completePackagingAllocationFn: vi.fn(async () => ({
      mixingRunId: "run-1",
    })),
  }),
);
vi.mock(
  "@/server-functions/manufacturing/packaging/cancel-packaging-allocation-fn",
  () => ({
    cancelPackagingAllocationFn: vi.fn(async () => ({ mixingRunId: "run-1" })),
  }),
);
vi.mock("@/server-functions/manufacturing/formulas/create-formula-fn", () => ({
  createFormulaFn: vi.fn(),
}));
vi.mock("@/server-functions/manufacturing/formulas/update-formula-fn", () => ({
  updateFormulaFn: vi.fn(async () => ({ id: "formula-1" })),
}));
vi.mock("@/server-functions/manufacturing/formulas/delete-formula-fn", () => ({
  deleteFormulaFn: vi.fn(async () => ({ formula: { id: "formula-1" } })),
}));
vi.mock("@/server-functions/inventory/recipes/create-recipe-fn", () => ({
  createRecipeFn: vi.fn(async () => ({})),
}));
vi.mock("@/server-functions/inventory/recipes/update-recipe-fn", () => ({
  updateRecipeFn: vi.fn(async () => ({})),
}));
vi.mock("@/server-functions/inventory/recipes/delete-recipe-fn", () => ({
  deleteRecipeFn: vi.fn(async () => ({})),
}));
vi.mock("@/server-functions/inventory/stock/recover-failed-production-chemical-fn", () => ({ recoverFailedProductionChemicalFn: vi.fn(async () => ({})) }));
vi.mock("@/server-functions/inventory/toggle-warehouse-status-fn", () => ({ toggleWarehouseStatusFn: vi.fn(async () => ({})) }));

import { useCreateMixingRun } from "@/hooks/manufacturing/mixing/use-mixing-mutations";
import {
  useCreatePackagingAllocation,
  useStartPackagingAllocation,
  useLogPackagingProgress,
  useCompletePackagingAllocation,
  useCancelPackagingAllocation,
} from "@/hooks/manufacturing/packaging/use-packaging-mutations";
import {
  useUpdateFormula,
  useDeleteFormula,
} from "@/hooks/manufacturing/formulas/use-formula-mutations";
import { useCreateRecipe } from "@/hooks/recipes/create-recipe-hook";
import { useUpdateRecipe } from "@/hooks/recipes/use-update-recipe-hook";
import { useDeleteRecipe } from "@/hooks/recipes/use-delete-recipe";
import { useRecoverFailedProductionChemical } from "@/hooks/stock/use-recover-failed-production-chemical";
import { useToggleWarehouseStatus } from "@/hooks/inventory/use-toggle-warehouse-status";

afterEach(cleanup);

const embeddedKeys = [
  ["mixing-run", "run-1"],
  ["operator-mixing-run", "run-1"],
  ["operator-mixing-runs", "list", { page: 1 }],
  ["operator-packaging", "allocation-1"],
];

async function mutateAndCheck(
  hook: () => { mutateAsync: (variables: any) => Promise<unknown> },
  keys: unknown[][],
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  for (const key of [...keys, ["unrelated"]])
    client.setQueryData(key, { cached: true });
  const { result, unmount } = renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await result.current.mutateAsync({
      data: {
        id: "formula-1",
        mixingRunId: "run-1",
        allocationId: "allocation-1",
      },
    });
  });
  for (const key of keys)
    expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(
      true,
    );
  expect(client.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
  unmount();
  client.clear();
}

describe("successful manufacturing mutation cache invalidation", () => {
  it("refreshes current mixing data and inventory after failed chemical recovery", async () => {
    await mutateAndCheck(useRecoverFailedProductionChemical, [["mixing-runs"], ["mixing-run", "run-1"], ["operator-mixing-runs"], ["operator-mixing-run", "run-1"], ["inventory"], ["factory-floor"]]);
  });
  it("refreshes the factory floor after warehouse stock relocation", async () => {
    await mutateAndCheck(useToggleWarehouseStatus, [["inventory"], ["warehouses"], ["factory-floor"], ["low-stock-alerts"]]);
  });
  it("refreshes assigned operator lists when mixing work is created", async () => {
    await mutateAndCheck(useCreateMixingRun, [
      ["mixing-runs", { page: 1 }],
      ["operator-mixing-runs", "list", { page: 1 }],
    ]);
  });
  it.each([
    ["creation", useCreatePackagingAllocation],
    ["start", useStartPackagingAllocation],
    ["progress", useLogPackagingProgress],
    ["completion", useCompletePackagingAllocation],
    ["cancellation", useCancelPackagingAllocation],
  ])(
    "refreshes operator allocations and embedded mixing after allocation %s",
    async (_name, hook) => {
      await mutateAndCheck(hook, [
        ["packaging-allocations"],
        ["mixing-run", "run-1"],
        ["operator-mixing-run", "run-1"],
        ["operator-packaging", "list", "allocated"],
      ]);
    },
  );
  it.each([
    ["update", useUpdateFormula],
    ["deactivation", useDeleteFormula],
  ])(
    "refreshes formula details and embedded definitions after %s",
    async (_name, hook) => {
      await mutateAndCheck(hook, [
        ["formulas"],
        ["formula", "formula-1"],
        ["mixing-runs"],
        ...embeddedKeys,
      ]);
    },
  );
  it.each([
    ["creation", useCreateRecipe],
    ["update", useUpdateRecipe],
    ["deletion", useDeleteRecipe],
  ])(
    "refreshes embedded SKU definitions after recipe %s",
    async (_name, hook) => {
      await mutateAndCheck(hook, [
        ["recipes"],
        ["recipe", "recipe-1"],
        ["formula", "formula-1"],
        ["packaging-allocations"],
        ...embeddedKeys,
      ]);
    },
  );
});

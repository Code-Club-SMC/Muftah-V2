import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceAttendanceKeys,
  useConfirmDeviceAttendance,
  useDeviceAttendanceImports,
  usePreviewDeviceAttendance,
  useUploadDeviceAttendance,
} from "./use-device-attendance";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
  list: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/server-functions/hr/attendance/device-import-fn", () => ({
  uploadDeviceAttendanceFn: mocks.upload,
  previewDeviceAttendanceFn: mocks.preview,
  confirmDeviceAttendanceFn: mocks.confirm,
  listDeviceAttendanceImportsFn: mocks.list,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.error, success: mocks.success },
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe("device attendance query hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads FormData and waits for recent uploads to refresh", async () => {
    const { client, wrapper } = setup();
    let finish!: () => void;
    const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.upload.mockResolvedValue({ importId: "import-1" });
    const { result } = renderHook(() => useUploadDeviceAttendance(), {
      wrapper,
    });
    const data = new FormData();
    data.set("file", new File(["report"], "report.csv"));
    let completed = false;
    act(() => {
      void result.current.mutateAsync(data).then(() => {
        completed = true;
      });
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: deviceAttendanceKeys.imports(),
      }),
    );
    expect(mocks.upload).toHaveBeenCalledWith({ data });
    expect(completed).toBe(false);
    expect(result.current.isPending).toBe(true);
    await act(async () => finish());
    await waitFor(() => expect(completed).toBe(true));
  });

  it("previews a chosen import with employee mappings", async () => {
    const { wrapper } = setup();
    mocks.preview.mockResolvedValue({ importId: "import-1" });
    const { result } = renderHook(() => usePreviewDeviceAttendance(), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        importId: "import-1",
        mappings: { "12": "employee-1" },
      });
    });
    expect(mocks.preview).toHaveBeenCalledWith({
      data: { importId: "import-1", mappings: { "12": "employee-1" } },
    });
  });

  it("keeps confirmation pending until attendance and payroll invalidations settle", async () => {
    const { client, wrapper } = setup();
    const resolvers: Array<() => void> = [];
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockImplementation(
        () => new Promise<void>((resolve) => resolvers.push(resolve)),
      );
    mocks.confirm.mockResolvedValue({
      importId: "import-1",
      status: "completed",
      rows: [],
    });
    const { result } = renderHook(() => useConfirmDeviceAttendance(), {
      wrapper,
    });
    let completed = false;
    act(() => {
      void result.current.mutateAsync({ importId: "import-1" }).then(() => {
        completed = true;
      });
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(6));
    for (const key of [
      deviceAttendanceKeys.all,
      ["daily-attendance"],
      ["attendance-punches"],
      ["employee-attendance-log"],
      ["payrolls"],
      ["payroll"],
    ])
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    expect(completed).toBe(false);
    await act(async () => {
      resolvers.forEach((resolve) => resolve());
    });
    await waitFor(() => expect(completed).toBe(true));
  });

  it("does not fetch disabled history and reports failed writes", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mocks.confirm.mockRejectedValue(new Error("Payroll is locked"));
    const { result } = renderHook(
      () => ({
        history: useDeviceAttendanceImports(false),
        confirm: useConfirmDeviceAttendance(),
      }),
      { wrapper },
    );
    await act(async () => {
      await expect(
        result.current.confirm.mutateAsync({ importId: "import-1" }),
      ).rejects.toThrow("Payroll is locked");
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("Payroll is locked");
  });
});

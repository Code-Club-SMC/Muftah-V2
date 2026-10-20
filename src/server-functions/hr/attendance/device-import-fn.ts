import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { DEVICE_IMPORT_MAX_BYTES } from "@/lib/attendance/device-import/contracts";
import {
  confirmDeviceAttendance,
  listDeviceAttendanceImports,
  previewDeviceAttendance,
  uploadDeviceAttendance,
} from "@/lib/attendance/device-import/service.server";

const selectionSchema = z.object({
  importId: z.string().min(1).max(100),
  mappings: z
    .record(z.string().min(1).max(128), z.string().min(1).max(100))
    .optional(),
});

export const uploadDeviceAttendanceFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData))
      throw new Error("Expected an attendance report upload.");
    const file = data.get("file");
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > DEVICE_IMPORT_MAX_BYTES
    )
      throw new Error("Choose a CSV or Excel report up to 10 MB.");
    return data;
  })
  .handler(({ data, context }) =>
    uploadDeviceAttendance(data.get("file") as File, context.session.user.id),
  );

export const previewDeviceAttendanceFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(selectionSchema)
  .handler(({ data }) => previewDeviceAttendance(data));

export const confirmDeviceAttendanceFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(selectionSchema)
  .handler(({ data, context }) =>
    confirmDeviceAttendance(data, context.session.user.id),
  );

export const listDeviceAttendanceImportsFn = createServerFn({ method: "GET" })
  .middleware([requireHrManageMiddleware])
  .handler(() => listDeviceAttendanceImports());

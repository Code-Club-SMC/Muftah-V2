import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAttendanceTerminalMiddleware } from "@/lib/middlewares";

/** Retained as a disabled RPC so existing terminal sessions cannot write punches. */
export const scanAttendanceFn = createServerFn({ method: "POST" })
  .middleware([requireAttendanceTerminalMiddleware])
  .inputValidator(z.object({ rawPayload: z.string().min(1).max(4096) }))
  .handler(() => {
    throw new Error(
      "Barcode attendance has been replaced. HR must upload the device punch report from Attendance.",
    );
  });

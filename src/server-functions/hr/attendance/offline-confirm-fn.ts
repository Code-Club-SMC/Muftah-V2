import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOfflineAttendanceEnabled } from "@/lib/attendance/offline/feature-flag.server";
import {
  processOfflineImportSlice,
  type ConfirmBatchResult,
} from "@/lib/attendance/offline/confirmation.server";
import { requireOfflineImportReviewMiddleware } from "@/lib/middlewares";

const confirmImportSchema = z.object({
  batchId: z.string().min(1),
});

export const confirmOfflineAttendanceImportFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineImportReviewMiddleware])
  .inputValidator(confirmImportSchema)
  .handler(async ({ data, context }): Promise<ConfirmBatchResult> => {
    requireOfflineAttendanceEnabled();

    return await processOfflineImportSlice({
      batchId: data.batchId,
      reviewerUserId: context.session.user.id,
    });
  });

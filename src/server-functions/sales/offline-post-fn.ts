import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOfflineSalesEnabled } from "@/lib/sales/offline/feature-flag.server";
import { postOfflineSalesBatch } from "@/lib/sales/offline/posting.server";
import { requireOfflineSalesPostMiddleware } from "@/lib/middlewares";

export const postOfflineSalesBatchFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesPostMiddleware])
  .inputValidator(z.object({ batchId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    return await postOfflineSalesBatch({
      batchId: data.batchId,
      actorId: context.session.user.id,
    });
  });

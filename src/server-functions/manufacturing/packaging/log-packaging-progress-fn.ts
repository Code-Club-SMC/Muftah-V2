import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const logProgressSchema = z.object({
  allocationId: z.string().min(1),
  containersProduced: z.number().int().positive("Must be a positive number"),
});

// Packing is recorded from the mixing batch page, where the operator picks packaging lots.
export const logPackagingProgressFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(logProgressSchema)
  .handler(async (): Promise<{ success: true; mixingRunId: string }> => {
    throw new Error("This packing flow is retired. Record packing from the mixing batch page.");
  });

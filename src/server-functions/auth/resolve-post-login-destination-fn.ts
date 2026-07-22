import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolvePostLoginDestination } from "@/lib/authz.server";

const resolvePostLoginDestinationSchema = z.object({
  redirectTo: z.string().optional(),
});

export const resolvePostLoginDestinationFn = createServerFn()
  .inputValidator(resolvePostLoginDestinationSchema)
  .handler(async ({ data }) => {
    return resolvePostLoginDestination(data.redirectTo);
  });

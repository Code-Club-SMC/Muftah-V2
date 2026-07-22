import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { employees } from "@/db/schemas/hr-schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { notFound } from "@tanstack/react-router";
import { requireHrViewMiddleware } from "@/lib/middlewares";

export const getEmployeeFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const result = await db
      .select()
      .from(employees)
      .where(eq(employees.id, data.id))
      .limit(1);

    if (!result.length) {
      throw notFound();
    }

    return result[0];
  });

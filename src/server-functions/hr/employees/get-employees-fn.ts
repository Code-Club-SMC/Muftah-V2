import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { employees } from "@/db/schemas/hr-schema";
import { desc, eq } from "drizzle-orm";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";

export const getEmployeesFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(
    z
      .object({
        status: z
          .enum(["active", "on_leave", "terminated", "resigned", "pending_deletion"])
          .optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const statusFilter = data?.status;
    const result = await db
      .select()
      .from(employees)
      .where(statusFilter ? eq(employees.status, statusFilter) : undefined)
      .orderBy(desc(employees.createdAt));

    return result;
  });

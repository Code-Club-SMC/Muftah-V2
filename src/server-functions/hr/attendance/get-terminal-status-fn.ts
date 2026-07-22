import { createServerFn } from "@tanstack/react-start";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendancePunches } from "@/db/schemas/hr-schema";
import { nowPKTDate } from "@/lib/attendance/time";
import { requireAttendanceTerminalMiddleware } from "@/lib/middlewares";

export const getTerminalStatusFn = createServerFn()
  .middleware([requireAttendanceTerminalMiddleware])
  .handler(async ({ context }) => {
    const today = nowPKTDate();
    const [result] = await db
      .select({ punchCount: count() })
      .from(attendancePunches)
      .where(eq(attendancePunches.attendanceDate, today));

    return {
      date: today,
      punchCount: Number(result?.punchCount ?? 0),
      terminalUser: {
        id: context.session.user.id,
        name: context.session.user.name,
        email: context.session.user.email,
      },
    };
  });

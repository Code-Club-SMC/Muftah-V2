import { createServerFn } from "@tanstack/react-start";
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { attendanceTerminalHeartbeats } from "@/db/schemas/offline-attendance-schema";
import { isOfflineAttendanceEnabled } from "@/lib/attendance/offline/feature-flag.server";
import { TERMINAL_HEARTBEAT_RETENTION_DAYS } from "@/lib/attendance/offline/constants";
import { requireAttendanceTerminalMiddleware } from "@/lib/middlewares";

export type TerminalHeartbeatResult = {
  enabled: boolean;
  observedAt: string | null;
};

function minuteBucket(value: Date) {
  const bucket = new Date(value);
  bucket.setUTCSeconds(0, 0);
  return bucket;
}

function retentionCutoff(value: Date) {
  return new Date(
    value.getTime() - TERMINAL_HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}

export const recordTerminalHeartbeatFn = createServerFn({ method: "POST" })
  .middleware([requireAttendanceTerminalMiddleware])
  .handler(async ({ context }): Promise<TerminalHeartbeatResult> => {
    if (!isOfflineAttendanceEnabled()) {
      return { enabled: false, observedAt: null };
    }

    const observedAt = new Date();
    const bucket = minuteBucket(observedAt);

    await db
      .insert(attendanceTerminalHeartbeats)
      .values({
        terminalUserId: context.session.user.id,
        minuteBucket: bucket,
        observedAt,
      })
      .onConflictDoNothing({
        target: [
          attendanceTerminalHeartbeats.terminalUserId,
          attendanceTerminalHeartbeats.minuteBucket,
        ],
      });

    if (observedAt.getUTCMinutes() === 0) {
      await db
        .delete(attendanceTerminalHeartbeats)
        .where(
          lt(attendanceTerminalHeartbeats.observedAt, retentionCutoff(observedAt)),
        );
    }

    return {
      enabled: true,
      observedAt: observedAt.toISOString(),
    };
  });

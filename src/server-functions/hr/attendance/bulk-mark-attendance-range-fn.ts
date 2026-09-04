import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, attendancePunches, employees } from "@/db/schemas/hr-schema";
import { recomputeAttendanceRow } from "@/lib/attendance/recompute-server";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, eq, inArray, gte, lte } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { eachDayOfInterval, format, parseISO } from "date-fns";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function parseTimeToSeconds(value?: string | null): number | null {
    if (!value || !TIME_RE.test(value)) return null;
    const [hours, minutes, seconds = "00"] = value.split(":");
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function normalizeTime(value: string): string {
    return value.length === 5 ? `${value}:00` : value;
}

function nextDateString(date: string): string {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1))
        .toISOString()
        .slice(0, 10);
}

function combinePKTDateTime(date: string, time: string): Date {
    return new Date(`${date}T${normalizeTime(time)}+05:00`);
}

function hasUsableShiftWindow(employee: {
    shifts?: { start: string; end: string }[] | null;
}) {
    const firstShift = employee.shifts?.[0];
    if (!firstShift) return false;

    const startSeconds = parseTimeToSeconds(firstShift.start);
    const endSeconds = parseTimeToSeconds(firstShift.end);

    if (startSeconds === null || endSeconds === null) {
        return false;
    }

    return startSeconds !== endSeconds;
}

// ── Schema ─────────────────────────────────────────────────────────────────

const bulkAttendanceSchema = z.object({
    /**
     * Which employees to mark.
     * Empty array = all active employees.
     */
    employeeIds: z.array(z.string()),

    startDate: z.string(), // YYYY-MM-DD
    endDate: z.string(), // YYYY-MM-DD

    template: z.object({
        status: z.enum(["present", "absent", "leave", "holiday"]),
        leaveType: z.enum(["sick", "annual", "special", "compensatory"]).nullable().optional(),
        notes: z.string().nullable().optional(),
        entrySource: z.enum(["biometric", "manual", "qr_terminal"]).default("manual"),
    }),

    /**
     * skip    — leave existing records completely untouched
     * overwrite — replace existing records with the template
     */
    conflictStrategy: z.enum(["skip", "overwrite"]).default("skip"),
}).refine(
    (data) => data.template.status !== "leave" || !!data.template.leaveType,
    {
        message: "Leave type is required when status is leave",
        path: ["template", "leaveType"],
    },
);

// ── Handler ────────────────────────────────────────────────────────────────

export const bulkMarkAttendanceRangeFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(bulkAttendanceSchema)
    .handler(async ({ data, context }) => {
        const { startDate, endDate, template, conflictStrategy } = data;

        // ── 1. Resolve employees ──────────────────────────────────────────────
        const employeesList =
            data.employeeIds.length > 0
                ? await db.query.employees.findMany({
                    where: inArray(employees.id, data.employeeIds),
                })
                : await db.query.employees.findMany({
                    where: eq(employees.status, "active"),
                });

        if (employeesList.length === 0) throw new Error("No employees found.");

        const employeeIds = employeesList.map((e) => e.id);

        // Build per-employee rest day set for O(1) lookup
        const empRestDays = new Map<string, Set<number>>();
        for (const emp of employeesList) {
            const restDays: number[] = (emp.restDays as number[] | null) ?? [0];
            empRestDays.set(emp.id, new Set(restDays));
        }

        // ── 2. Generate all dates in range ────────────────────────────────────
        const allDates = eachDayOfInterval({
            start: parseISO(startDate),
            end: parseISO(endDate),
        }).map((d) => format(d, "yyyy-MM-dd"));

        // ── 3. Batch-fetch all existing records and punches in the range ──────
        const existingRecords = await db
            .select({
                id: attendance.id,
                employeeId: attendance.employeeId,
                date: attendance.date,
                status: attendance.status,
            })
            .from(attendance)
            .where(
                and(
                    inArray(attendance.employeeId, employeeIds),
                    gte(attendance.date, startDate),
                    lte(attendance.date, endDate),
                ),
            );

        const existingPunches = await db
            .select({
                employeeId: attendancePunches.employeeId,
                attendanceDate: attendancePunches.attendanceDate,
            })
            .from(attendancePunches)
            .where(
                and(
                    inArray(attendancePunches.employeeId, employeeIds),
                    gte(attendancePunches.attendanceDate, startDate),
                    lte(attendancePunches.attendanceDate, endDate),
                ),
            );

        // Index: "employeeId:date" → record id
        const existingIndex = new Map<string, string>();
        for (const rec of existingRecords) {
            existingIndex.set(`${rec.employeeId}:${rec.date}`, rec.id);
        }

        const punchIndex = new Set(
            existingPunches.map(
                (punch) => `${punch.employeeId}:${punch.attendanceDate}`,
            ),
        );

        // ── 4. Build insert/update batches ────────────────────────────────────
        const toInsert: typeof attendance.$inferInsert[] = [];
        const toUpdate: { id: string; data: Partial<typeof attendance.$inferInsert> }[] = [];
        const presentPunchRows: typeof attendancePunches.$inferInsert[] = [];
        const presentRecomputeTargets: Array<{
            employeeId: string;
            date: string;
        }> = [];
        const terminalUserId = context.session.user.id;

        const summary = {
            created: 0,
            updated: 0,
            skippedRestDays: 0,
            skippedExisting: 0,
            skippedPunchDays: 0,
            skippedMissingShift: 0,
        };

        for (const emp of employeesList) {
            const restDays = empRestDays.get(emp.id)!;

            for (const dateStr of allDates) {
                const dayOfWeek = parseISO(dateStr).getDay(); // 0=Sun…6=Sat

                // Skip rest days — per employee config
                if (restDays.has(dayOfWeek)) {
                    summary.skippedRestDays++;
                    continue;
                }

                const key = `${emp.id}:${dateStr}`;
                const existingId = existingIndex.get(key);

                if (template.status === "present") {
                    if (punchIndex.has(key)) {
                        summary.skippedPunchDays++;
                        continue;
                    }

                    if (!hasUsableShiftWindow(emp)) {
                        summary.skippedMissingShift++;
                        continue;
                    }

                    if (existingId && conflictStrategy === "skip") {
                        summary.skippedExisting++;
                        continue;
                    }

                    const firstShift = emp.shifts?.[0];
                    const startSeconds = parseTimeToSeconds(firstShift!.start)!;
                    const endSeconds = parseTimeToSeconds(firstShift!.end)!;
                    const checkOutDate =
                        endSeconds < startSeconds
                            ? nextDateString(dateStr)
                            : dateStr;

                    presentPunchRows.push(
                        {
                            employeeId: emp.id,
                            attendanceDate: dateStr,
                            direction: "in",
                            source: "manual",
                            terminalUserId,
                            timestamp: combinePKTDateTime(dateStr, firstShift!.start),
                            note: null,
                        },
                        {
                            employeeId: emp.id,
                            attendanceDate: dateStr,
                            direction: "out",
                            source: "manual",
                            terminalUserId,
                            timestamp: combinePKTDateTime(checkOutDate, firstShift!.end),
                            note: null,
                        },
                    );

                    presentRecomputeTargets.push({
                        employeeId: emp.id,
                        date: dateStr,
                    });

                    if (existingId) {
                        summary.updated++;
                    } else {
                        summary.created++;
                    }

                    continue;
                }

                if (existingId && conflictStrategy === "skip") {
                    summary.skippedExisting++;
                    continue;
                }
                const recordData = {
                    status: template.status,
                    checkIn: null,
                    checkOut: null,
                    dutyHours: "0.00",
                    overtimeHours: "0.00",
                    overtimeStatus: "pending",
                    leaveType:
                        template.status === "leave" ? (template.leaveType ?? null) : null,
                    leaveApprovalStatus:
                        template.status === "leave" ? "pending" : "none",
                    isApprovedLeave: false,
                    isLate: false,
                    isNightShift: false,
                    earlyDepartureStatus: "none",
                    overtimeRemarks: null,
                    entrySource: template.entrySource,
                    notes: template.notes ?? null,
                    updatedAt: new Date(),
                };

                if (existingId) {
                    // overwrite strategy
                    toUpdate.push({ id: existingId, data: recordData });
                    summary.updated++;
                } else {
                    toInsert.push({
                        id: createId(),
                        employeeId: emp.id,
                        date: dateStr,
                        ...recordData,
                    });
                    summary.created++;
                }
            }
        }

        // ── 5. Execute in transaction ─────────────────────────────────────────
        await db.transaction(async (tx) => {
            // Batch inserts — one call per 500 rows to avoid param limits
            const BATCH = 500;
            for (let i = 0; i < toInsert.length; i += BATCH) {
                const chunk = toInsert.slice(i, i + BATCH);
                if (chunk.length > 0) await tx.insert(attendance).values(chunk);
            }

            for (let i = 0; i < presentPunchRows.length; i += BATCH) {
                const chunk = presentPunchRows.slice(i, i + BATCH);
                if (chunk.length > 0) await tx.insert(attendancePunches).values(chunk);
            }

            // Updates — each needs its own WHERE clause; run in parallel
            await Promise.all(
                toUpdate.map(({ id, data }) =>
                    tx.update(attendance).set(data).where(eq(attendance.id, id)),
                ),
            );

            for (const target of presentRecomputeTargets) {
                await recomputeAttendanceRow(tx, target.employeeId, target.date, {
                    manualFieldStrategy: "reset",
                    noteOverride: template.notes ?? null,
                });
            }
        });

        return {
            success: true,
            summary,
            message: `Done — ${summary.created} created, ${summary.updated} updated, ${summary.skippedRestDays} rest days skipped, ${summary.skippedExisting} existing skipped, ${summary.skippedPunchDays} punch days skipped, ${summary.skippedMissingShift} missing-shift days skipped.`,
        };
    });

// ── Preview (no writes) ────────────────────────────────────────────────────
// Call this before showing the confirmation to give the admin a summary
// of exactly what will happen without touching the DB.

export const previewBulkAttendanceFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(bulkAttendanceSchema)
    .handler(async ({ data }) => {
        const { startDate, endDate, conflictStrategy } = data;

        const employeesList =
            data.employeeIds.length > 0
                ? await db.query.employees.findMany({
                    where: inArray(employees.id, data.employeeIds),
                })
                : await db.query.employees.findMany({
                    where: eq(employees.status, "active"),
                });

        const employeeIds = employeesList.map((e) => e.id);

        const allDates = eachDayOfInterval({
            start: parseISO(startDate),
            end: parseISO(endDate),
        }).map((d) => format(d, "yyyy-MM-dd"));

        const existingRecords = await db
            .select({ employeeId: attendance.employeeId, date: attendance.date })
            .from(attendance)
            .where(
                and(
                    inArray(attendance.employeeId, employeeIds),
                    gte(attendance.date, startDate),
                    lte(attendance.date, endDate),
                ),
            );

        const existingPunches = await db
            .select({
                employeeId: attendancePunches.employeeId,
                attendanceDate: attendancePunches.attendanceDate,
            })
            .from(attendancePunches)
            .where(
                and(
                    inArray(attendancePunches.employeeId, employeeIds),
                    gte(attendancePunches.attendanceDate, startDate),
                    lte(attendancePunches.attendanceDate, endDate),
                ),
            );

        const existingIndex = new Set(
            existingRecords.map((r) => `${r.employeeId}:${r.date}`),
        );
        const punchIndex = new Set(
            existingPunches.map(
                (punch) => `${punch.employeeId}:${punch.attendanceDate}`,
            ),
        );

        const summary = {
            totalDays: allDates.length,
            totalEmployees: employeesList.length,
            willCreate: 0,
            willUpdate: 0,
            skippedRestDays: 0,
            skippedExisting: 0,
            skippedPunchDays: 0,
            skippedMissingShift: 0,
        };

        for (const emp of employeesList) {
            const restDays: Set<number> = new Set(
                (emp.restDays as number[] | null) ?? [0],
            );

            for (const dateStr of allDates) {
                const dayOfWeek = parseISO(dateStr).getDay();
                if (restDays.has(dayOfWeek)) {
                    summary.skippedRestDays++;
                    continue;
                }

                if (data.template.status === "present") {
                    if (punchIndex.has(`${emp.id}:${dateStr}`)) {
                        summary.skippedPunchDays++;
                        continue;
                    }

                    if (!hasUsableShiftWindow(emp)) {
                        summary.skippedMissingShift++;
                        continue;
                    }
                }

                const exists = existingIndex.has(`${emp.id}:${dateStr}`);
                if (exists && conflictStrategy === "skip") {
                    summary.skippedExisting++;
                    continue;
                }
                if (exists) summary.willUpdate++;
                else summary.willCreate++;
            }
        }

        return summary;
    });

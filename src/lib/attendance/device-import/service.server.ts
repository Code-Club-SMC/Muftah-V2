import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  attendance,
  attendancePunches,
  employees,
  payrolls,
} from "@/db/schemas/hr-schema";
import {
  deviceAttendanceImports,
  deviceAttendancePersonMappings,
  deviceAttendancePunchClaims,
} from "@/db/schemas/device-attendance-schema";
import { lockEmployeePunchWrites } from "@/server-functions/hr/attendance/punch-write-lock";
import { recomputeAttendanceRow } from "../recompute-server";
import { invalidateDraftPayrollsForAttendance } from "../offline/payroll-invalidation.server";
import { parseDevicePunchReport } from "./parser.server";
import { planDeviceEmployeeRows, type DevicePlannedRow } from "./timeline";
import { lockAttendancePayrollWrites } from "./payroll.server";
import { toPKTDate } from "../time";
import {
  DEVICE_IMPORT_MAX_BYTES,
  type DeviceImportPreview,
  type DeviceImportRowPreview,
  type DevicePunchReportRow,
} from "./contracts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Import = typeof deviceAttendanceImports.$inferSelect;
type Employee = typeof employees.$inferSelect;
export type DeviceImportSelection = {
  importId: string;
  mappings?: Record<string, string>;
};
const name = (employee: Employee) =>
  `${employee.firstName} ${employee.lastName}`.trim();
const shiftDate = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

async function buildPlans(
  tx: Tx,
  batch: Import,
  selections: Record<string, string>,
  lock: boolean,
) {
  const [staff, links] = await Promise.all([
    tx.query.employees.findMany(),
    tx.query.deviceAttendancePersonMappings.findMany(),
  ]);
  const byId = new Map(staff.map((e) => [e.id, e]));
  const byCode = new Map(staff.map((e) => [e.employeeCode, e]));
  const linked = new Map(links.map((link) => [link.personId, link.employeeId]));
  const linkedPeople = new Map(
    links.map((link) => [link.employeeId, link.personId]),
  );
  const rowsByPerson = new Map<string, DevicePunchReportRow[]>();
  for (const row of batch.report.rows) {
    const group = rowsByPerson.get(row.personId) ?? [];
    group.push(row);
    rowsByPerson.set(row.personId, group);
  }
  const personIds = [...rowsByPerson.keys()];
  for (const [personId, employeeId] of Object.entries(selections)) {
    if (!rowsByPerson.has(personId) || !byId.has(employeeId))
      throw new Error("Employee mapping does not match this report.");
    if (linked.has(personId) && linked.get(personId) !== employeeId)
      throw new Error(
        `Device ID ${personId} is already linked to another employee.`,
      );
    if (
      linkedPeople.has(employeeId) &&
      linkedPeople.get(employeeId) !== personId
    )
      throw new Error("This employee already has another device Person ID.");
  }
  const resolved = new Map(
    personIds.map((id) => [
      id,
      byId.get(selections[id] ?? linked.get(id) ?? "") ?? byCode.get(id),
    ]),
  );
  const seenEmployees = new Set<string>();
  for (const [personId, employee] of resolved) {
    if (!employee) continue;
    if (
      linkedPeople.has(employee.id) &&
      linkedPeople.get(employee.id) !== personId
    )
      throw new Error("This employee already has another device Person ID.");
    if (seenEmployees.has(employee.id))
      throw new Error(
        "Two device Person IDs resolve to the same employee. Check employee mappings.",
      );
    seenEmployees.add(employee.id);
  }
  const employeeIds = [
    ...new Set([...resolved.values()].flatMap((e) => (e ? [e.id] : []))),
  ].sort();
  for (const id of employeeIds) {
    if (lock) await lockEmployeePunchWrites(tx, id);
  }
  const results = new Map<number, DeviceImportRowPreview>();
  const employeePlans: { employee: Employee; plans: DevicePlannedRow[] }[] = [];
  const now = new Date();
  for (const personId of personIds) {
    const employee = resolved.get(personId);
    const rows = rowsByPerson.get(personId)!;
    if (
      !employee ||
      employee.isSalesman ||
      employee.isDriver ||
      employee.isOrderBooker ||
      employee.status === "pending_deletion"
    ) {
      for (const row of rows)
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          personId,
          personName: row.personName,
          employeeId: employee?.id ?? null,
          employeeName: employee ? name(employee) : null,
          date: row.date,
          punchTimes: row.punches,
          status: "needs_review",
          newPunchCount: 0,
          dutyHours: null,
          messages: [
            ...row.issues,
            employee
              ? "This employee does not use standard punch attendance. HR must review this record."
              : "Link this device Person ID to an employee before importing.",
          ],
        });
      continue;
    }
    const dates = rows.flatMap((r) => (r.date ? [r.date] : [])).sort();
    if (!dates.length) {
      for (const row of rows)
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          personId,
          personName: row.personName,
          employeeId: employee.id,
          employeeName: name(employee),
          date: null,
          punchTimes: row.punches,
          status: "needs_review",
          messages: row.issues,
          newPunchCount: 0,
          dutyHours: null,
        });
      continue;
    }
    const first = shiftDate(dates[0], -1),
      last = shiftDate(dates.at(-1)!, 1);
    const claims = await tx.query.deviceAttendancePunchClaims.findMany({
      where: and(
        eq(deviceAttendancePunchClaims.employeeId, employee.id),
        gte(deviceAttendancePunchClaims.reportDate, first),
        lte(deviceAttendancePunchClaims.reportDate, last),
      ),
    });
    // HR can move a claimed punch outside the dates covered by its source report.
    const claimedDates = [
      ...new Set(claims.map((claim) => claim.attendanceDate)),
    ].sort();
    const earliest = claimedDates.length
      ? [first, claimedDates[0]].sort()[0]
      : first;
    const latest = claimedDates.length
      ? [last, claimedDates.at(-1)!].sort().at(-1)!
      : last;
    const [punches, records, lockedPayrolls] = await Promise.all([
      tx.query.attendancePunches.findMany({
        where: and(
          eq(attendancePunches.employeeId, employee.id),
          or(
            and(
              gte(
                attendancePunches.timestamp,
                new Date(`${first}T00:00:00+05:00`),
              ),
              lte(
                attendancePunches.timestamp,
                new Date(`${last}T23:59:59+05:00`),
              ),
            ),
            claimedDates.length
              ? inArray(attendancePunches.attendanceDate, claimedDates)
              : undefined,
          ),
        ),
        orderBy: [asc(attendancePunches.timestamp)],
      }),
      tx.query.attendance.findMany({
        where: and(
          eq(attendance.employeeId, employee.id),
          or(
            and(gte(attendance.date, first), lte(attendance.date, last)),
            claimedDates.length
              ? inArray(attendance.date, claimedDates)
              : undefined,
          ),
        ),
      }),
      tx.query.payrolls.findMany({
        where: and(
          lte(payrolls.startDate, latest),
          gte(payrolls.endDate, earliest),
          inArray(payrolls.status, ["approved", "paid"]),
        ),
      }),
    ]);
    const relevantDates = [
      ...new Set([
        ...dates,
        ...dates.map((d) => shiftDate(d, -1)),
        ...records.map((r) => r.date),
        ...claims.map((c) => c.attendanceDate),
      ]),
    ];
    const lockedDates = new Set(
      relevantDates.filter((date) =>
        lockedPayrolls.some((p) => p.startDate <= date && p.endDate >= date),
      ),
    );
    const safeRows = rows.map((row) =>
      row.date && row.date < employee.joiningDate
        ? {
            ...row,
            issues: [
              ...row.issues,
              "This date is before the employee's joining date.",
            ],
          }
        : row,
    );
    const plans = planDeviceEmployeeRows({
      rows: safeRows,
      existingPunches: punches,
      claims,
      attendanceRows: records,
      lockedDates,
      shifts: employee.shifts ?? [],
      now,
    });
    employeePlans.push({ employee, plans });
    for (const plan of plans)
      results.set(plan.row.rowNumber, {
        rowNumber: plan.row.rowNumber,
        personId,
        personName: plan.row.personName,
        employeeId: employee.id,
        employeeName: name(employee),
        date: plan.row.date,
        attendanceDates: plan.attendanceDates,
        punchTimes: plan.row.punches,
        status: plan.status,
        messages: plan.messages,
        newPunchCount: plan.punches.filter((p) => !p.existingPunchId).length,
        dutyHours: plan.dutyHours,
      });
  }
  return {
    employeePlans,
    resolved,
    links,
    preview: {
      importId: batch.id,
      filename: batch.filename,
      format: batch.report.format,
      status: batch.status,
      rows: [...results.values()].sort((a, b) => a.rowNumber - b.rowNumber),
      employees: staff
        .filter(
          (e) =>
            !e.isDriver &&
            !e.isSalesman &&
            !e.isOrderBooker &&
            e.status !== "pending_deletion",
        )
        .map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          name: name(e),
        })),
    } satisfies DeviceImportPreview,
  };
}

export async function uploadDeviceAttendance(
  file: File,
  actorId: string,
): Promise<DeviceImportPreview> {
  if (file.size === 0 || file.size > DEVICE_IMPORT_MAX_BYTES)
    throw new Error("Choose a CSV or Excel report up to 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const report = await parseDevicePunchReport(bytes);
  const [batch] = await db
    .insert(deviceAttendanceImports)
    .values({
      filename: file.name.slice(0, 500),
      fileSha256: createHash("sha256").update(bytes).digest("hex"),
      report,
      uploadedByUserId: actorId,
    })
    .returning();
  if (!batch) throw new Error("Unable to save this report. Please retry.");
  return previewDeviceAttendance({ importId: batch.id });
}

export async function previewDeviceAttendance(
  input: DeviceImportSelection,
): Promise<DeviceImportPreview> {
  return db.transaction(async (tx) => {
    const batch = await tx.query.deviceAttendanceImports.findFirst({
      where: eq(deviceAttendanceImports.id, input.importId),
    });
    if (!batch) throw new Error("Attendance upload not found.");
    return (await buildPlans(tx, batch, input.mappings ?? {}, false)).preview;
  });
}

export async function confirmDeviceAttendance(
  input: DeviceImportSelection,
  actorId: string,
): Promise<DeviceImportPreview> {
  return db.transaction(async (tx) => {
    await lockAttendancePayrollWrites(tx);
    const [batch] = await tx
      .select()
      .from(deviceAttendanceImports)
      .where(eq(deviceAttendanceImports.id, input.importId))
      .for("update");
    if (!batch) throw new Error("Attendance upload not found.");
    const { employeePlans, resolved, links, preview } = await buildPlans(
      tx,
      batch,
      input.mappings ?? {},
      true,
    );
    for (const [personId, employee] of resolved) {
      if (
        employee &&
        employeePlans.some((plan) => plan.employee.id === employee.id) &&
        !links.some((link) => link.personId === personId)
      ) {
        await tx.insert(deviceAttendancePersonMappings).values({
          personId,
          employeeId: employee.id,
          linkedByUserId: actorId,
        });
      }
    }
    for (const { employee, plans } of employeePlans) {
      const proposed = plans.flatMap((plan) => plan.punches);
      const added = proposed
        .filter((p) => !p.existingPunchId)
        .map((p) => ({
          id: createId(),
          employeeId: employee.id,
          timestamp: p.timestamp,
          attendanceDate: p.attendanceDate,
          direction: p.direction,
          source: "device_import" as const,
          terminalUserId: actorId,
          note: `ZKBio Zlink import: ${batch.filename}`,
        }));
      for (let offset = 0; offset < added.length; offset += 500)
        await tx
          .insert(attendancePunches)
          .values(added.slice(offset, offset + 500));
      const ids = new Map(added.map((p) => [p.timestamp.getTime(), p.id]));
      const newClaims = proposed.map((p) => ({
        importId: batch.id,
        employeeId: employee.id,
        timestamp: p.timestamp,
        reportDate: p.reportDate,
        attendanceDate: p.attendanceDate,
        direction: p.direction,
        punchId: p.existingPunchId ?? ids.get(p.timestamp.getTime())!,
      }));
      for (let offset = 0; offset < newClaims.length; offset += 500)
        await tx
          .insert(deviceAttendancePunchClaims)
          .values(newClaims.slice(offset, offset + 500));
      const affectedDates = [
        ...new Set(added.map((p) => p.attendanceDate)),
      ].sort();
      for (const date of affectedDates) {
        await recomputeAttendanceRow(tx, employee.id, date, {
          forceNightShift: added.some(
            (p) =>
              p.attendanceDate === date &&
              p.direction === "out" &&
              toPKTDate(p.timestamp) !== date,
          ),
        });
        await invalidateDraftPayrollsForAttendance(tx, {
          deviceImportId: batch.id,
          employeeId: employee.id,
          attendanceDate: date,
        });
      }
    }
    const rows = preview.rows.map((row) => ({
      ...row,
      status:
        row.status === "ready" && row.newPunchCount > 0
          ? ("imported" as const)
          : row.status,
    }));
    await tx
      .update(deviceAttendanceImports)
      .set({
        status: "completed",
        resultRows: rows,
        completedAt: new Date(),
        confirmedByUserId: actorId,
      })
      .where(eq(deviceAttendanceImports.id, batch.id));
    return { ...preview, status: "completed", rows };
  });
}

export async function listDeviceAttendanceImports() {
  const batches = await db.query.deviceAttendanceImports.findMany({
    orderBy: [desc(deviceAttendanceImports.createdAt)],
    limit: 20,
  });
  return batches.map((batch) => ({
    id: batch.id,
    filename: batch.filename,
    createdAt: batch.createdAt.toISOString(),
    status: batch.status,
    totalRows: batch.report.rows.length,
    reviewRows:
      batch.resultRows?.filter(
        (r) => r.status === "needs_review" || r.status === "blocked",
      ).length ?? 0,
  }));
}

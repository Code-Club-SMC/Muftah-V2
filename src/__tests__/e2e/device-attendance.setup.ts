import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  account,
  user,
  appRoles,
  appPermissions,
  appRolePermissions,
  userRoleAssignments,
} from "@/db";
import { employees } from "@/db/schemas/hr-schema";
import { parseDevicePunchReport } from "@/lib/attendance/device-import/parser.server";
import { PERMISSION_DEFINITIONS } from "@/lib/rbac";

// This seeds only the explicitly requested local browser-test data. It does not
// create attendance; the real authenticated browser must upload every punch.
async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert(
    ["localhost", "127.0.0.1"].includes(databaseUrl.hostname),
    "Browser setup requires local PostgreSQL",
  );
  assert.equal(databaseUrl.port, "5433");
  assert.equal(databaseUrl.pathname, "/main");
  const sourcePath = resolve(
    process.argv[2] ?? "docs/Total Punches(20261001-20261014).csv",
  );
  const directory = resolve(
    process.env.ATTENDANCE_BROWSER_ARTIFACTS ?? ".tmp/attendance-browser",
  );
  const bytes = await readFile(sourcePath);
  const report = await parseDevicePunchReport(bytes);
  assert.equal(report.rows.length, 52);
  assert.equal(
    report.rows.reduce((sum, row) => sum + row.punches.length, 0),
    138,
  );
  assert.deepEqual(
    report.rows.flatMap((row) => row.issues),
    [],
  );
  const people = new Map(report.rows.map((row) => [row.personId, row]));
  assert.equal(people.size, 6);
  const firstDate = report.rows
    .flatMap((row) => (row.date ? [row.date] : []))
    .sort()[0];
  const email = "attendance-browser-test@titan.test";
  const password = randomBytes(32).toString("base64url");
  const passwordHash = await hashPassword(password);
  const seeded = await db.transaction(async (tx) => {
    const result = [];
    for (const person of people.values()) {
      const parts = person.personName.trim().split(/\s+/);
      await tx
        .insert(employees)
        .values({
          employeeCode: person.personId,
          firstName: parts[0],
          lastName: parts.slice(1).join(" "),
          department: person.department || null,
          designation: "Device attendance test employee",
          joiningDate: firstDate,
          standardDutyHours: 8,
          shifts: [],
          basicSalary: "0",
        })
        .onConflictDoNothing({ target: employees.employeeCode });
      const employee = await tx.query.employees.findFirst({
        where: eq(employees.employeeCode, person.personId),
      });
      assert(employee, `Employee ${person.personId} was not seeded`);
      assert.equal(
        `${employee.firstName} ${employee.lastName}`.trim(),
        person.personName.trim(),
        "Existing employee differs from the supplied report",
      );
      result.push({
        id: employee.id,
        employeeCode: employee.employeeCode,
        name: person.personName,
      });
    }
    const existingUser = await tx.query.user.findFirst({
      where: eq(user.email, email),
    });
    if (existingUser)
      assert.equal(existingUser.name, "Attendance browser test HR");
    const userId = existingUser?.id ?? randomUUID();
    if (existingUser)
      await tx
        .update(user)
        .set({ banned: false, banReason: null })
        .where(eq(user.id, userId));
    else
      await tx.insert(user).values({
        id: userId,
        email,
        name: "Attendance browser test HR",
        emailVerified: true,
        role: "operator",
      });
    const credential = await tx.query.account.findFirst({
      where: and(
        eq(account.userId, userId),
        eq(account.providerId, "credential"),
      ),
    });
    if (credential)
      await tx
        .update(account)
        .set({ accountId: userId, password: passwordHash })
        .where(eq(account.id, credential.id));
    else
      await tx.insert(account).values({
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: passwordHash,
      });
    await tx
      .insert(appRoles)
      .values({
        slug: "attendance-browser-test",
        name: "Attendance browser test HR",
        defaultLandingPath: "/hr/attendance",
      })
      .onConflictDoNothing({ target: appRoles.slug });
    const role = await tx.query.appRoles.findFirst({
      where: eq(appRoles.slug, "attendance-browser-test"),
    });
    assert(role);
    assert.equal(role.name, "Attendance browser test HR");
    for (const key of ["hr.view", "hr.manage"]) {
      const definition = PERMISSION_DEFINITIONS.find(
        (permission) => permission.key === key,
      );
      assert(definition);
      await tx
        .insert(appPermissions)
        .values(definition)
        .onConflictDoNothing({ target: appPermissions.key });
      const permission = await tx.query.appPermissions.findFirst({
        where: eq(appPermissions.key, key),
      });
      assert(permission);
      await tx
        .insert(appRolePermissions)
        .values({ roleId: role.id, permissionId: permission.id })
        .onConflictDoNothing();
    }
    await tx
      .insert(userRoleAssignments)
      .values({ userId, roleId: role.id })
      .onConflictDoUpdate({
        target: userRoleAssignments.userId,
        set: { roleId: role.id },
      });
    return { employees: result, userId };
  });
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "credentials.json"),
    JSON.stringify({ email, password, userId: seeded.userId }),
    { mode: 0o600 },
  );
  const manifest = {
    sourcePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    format: report.format,
    rows: report.rows.length,
    punches: 138,
    employees: seeded.employees,
  };
  await writeFile(
    resolve(directory, "seed-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    JSON.stringify({
      seededEmployees: seeded.employees.length,
      reportRows: manifest.rows,
      reportPunches: manifest.punches,
      sourceSha256: manifest.sha256,
      credentialsFile: resolve(directory, "credentials.json"),
    }),
  );
}

try {
  await main();
} finally {
  await db.$client.end();
}

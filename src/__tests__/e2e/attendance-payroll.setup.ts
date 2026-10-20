import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { ALLOWANCES, BASIC_POLICY, CONTROLLED_EMPLOYEES, CYCLE, REAL_EMPLOYEES, REAL_RESOLUTIONS, SOURCE, controlledReport, expectedBreakdown } from "./attendance-payroll.fixtures";
import { assertPayrollTestUrl } from "./attendance-payroll.safety";

async function main() {
  const url = assertPayrollTestUrl(process.env.DATABASE_URL!);
  const scenario = process.env.PAYROLL_E2E_SCENARIO;
  assert(scenario === "controlled" || scenario === "real");
  const directory = resolve(process.env.PAYROLL_E2E_DIRECTORY!);
  const { db, user, account, appRoles, appPermissions, appRolePermissions, userRoleAssignments, employees, salaryRevisions, hrPayrollSettings, nightShiftRates, wallets } = await import("@/db");
  const { PERMISSION_DEFINITIONS } = await import("@/lib/rbac");
  const { eq } = await import("drizzle-orm");
  try {
    assert.equal((await db.$client.query("select current_database() name")).rows[0].name, url.pathname.slice(1));
    const people = scenario === "real" ? REAL_EMPLOYEES : CONTROLLED_EMPLOYEES;
    const identities = [];
    await mkdir(directory, { recursive: true });
    for (const [kind, keys] of [["hr", ["hr.view", "hr.manage"]], ["viewer", ["hr.view"]]] as const) {
      const id = randomUUID();
      const email = `${kind}-${id}@payroll.test`;
      const password = randomBytes(24).toString("base64url");
      await db.insert(user).values({ id, name: `Payroll E2E ${kind}`, email, emailVerified: true, role: "operator" });
      await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: "credential", password: await hashPassword(password) });
      const [role] = await db.insert(appRoles).values({ slug: `payroll-e2e-${kind}`, name: `Payroll E2E ${kind}`, defaultLandingPath: "/hr/attendance" }).returning();
      for (const key of keys) {
        const definition = PERMISSION_DEFINITIONS.find(p => p.key === key);
        assert(definition);
        await db.insert(appPermissions).values(definition).onConflictDoNothing();
        const permission = await db.query.appPermissions.findFirst({ where: eq(appPermissions.key, key) });
        assert(permission);
        await db.insert(appRolePermissions).values({ roleId: role.id, permissionId: permission.id });
      }
      await db.insert(userRoleAssignments).values({ userId: id, roleId: role.id });
      identities.push({ kind, userId: id, email, password });
    }
    await db.insert(hrPayrollSettings).values({ id: "default", attendanceGraceMinutes: 15, basicSalaryDeductionPolicy: BASIC_POLICY });
    await db.insert(nightShiftRates).values({ year: 2026, ratePerNight: "500" });
    const seeded = [];
    for (const person of people) {
      const [firstName, ...last] = person.name.split(" ");
      const [employee] = await db.insert(employees).values({
        employeeCode: person.code, firstName, lastName: last.join(" "), designation: "Synthetic payroll E2E",
        joiningDate: CYCLE.start, standardDutyHours: 8, restDays: [0], shifts: [{ start: "09:00", end: "17:00" }],
        basicSalary: "26000", allowanceConfig: ALLOWANCES,
        compensatoryHoursBalance: person.code === "110001" || ("leaveType" in person && person.leaveType === "compensatory") ? "16" : "0",
      }).returning();
      const [revision] = await db.insert(salaryRevisions).values({ employeeId: employee.id, revisionDate: CYCLE.start, basicSalary: "26000", allowanceConfig: ALLOWANCES, reason: "Synthetic payroll E2E fixture, not real payable salary" }).returning();
      seeded.push({ ...person, id: employee.id, revisionId: revision.id, expectedBreakdown: expectedBreakdown(person) });
    }
    const walletId = randomUUID();
    await db.insert(wallets).values({ id: walletId, name: "Synthetic payroll E2E wallet", type: "cash", balance: "1000000" });
    const sourcePath = scenario === "real" ? resolve(SOURCE.path) : resolve(directory, "controlled-punches.csv");
    if (scenario === "controlled") await writeFile(sourcePath, controlledReport());
    const sha256 = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
    if (scenario === "real") assert.equal(sha256, SOURCE.sha256);
    await writeFile(resolve(directory, "credentials.json"), JSON.stringify(identities), { mode: 0o600 });
    const sourceRows = scenario === "real" ? JSON.parse(await readFile("src/__tests__/fixtures/attendance-payroll-original.json", "utf8")).rows : [];
    const manifest = { scenario, database: url.pathname.slice(1), cycle: CYCLE, sourcePath, sha256, sourceRows, employees: seeded, resolutions: scenario === "real" ? REAL_RESOLUTIONS : [], walletId, actors: identities.map(({ kind, userId }) => ({ kind, userId })) };
    await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ scenario, database: manifest.database, employees: seeded.length, sha256 }));
  } finally { await db.$client.end(); }
}
await main();

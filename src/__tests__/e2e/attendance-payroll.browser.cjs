const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.ATTENDANCE_BROWSER_MODULE || "playwright");
const { Pool } = require("pg");

const directory = path.resolve(process.env.PAYROLL_E2E_DIRECTORY);
const evidence = path.resolve(process.env.PAYROLL_E2E_EVIDENCE);
const baseUrl = process.env.PAYROLL_E2E_URL;
const databaseUrl = new URL(process.env.DATABASE_URL);
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname));
assert.equal(databaseUrl.port, "5433");
for (const [key, value] of databaseUrl.searchParams) {
  assert(["sslmode", "application_name"].includes(key), "Connection query overrides are forbidden");
  if (key === "sslmode") assert.equal(value, "disable");
}
assert(/^\/titan_payroll_(e2e|real)_[a-z0-9]+_test$/.test(databaseUrl.pathname));
const pool = new Pool({ connectionString: databaseUrl.toString() });
const report = { tier: "browser", startedAt: new Date().toISOString(), checks: [], pageErrors: [], consoleErrors: [], inspectionErrors: [], failedResponses: [], passed: false };
let browser, context, page, manifest, identities;
let decodeResponse;
const previews = new Map();
const mutationRequests = new Map();
const save = () => fs.writeFile(path.join(evidence, "browser-results.json"), JSON.stringify(report, null, 2));
const screenshot = async name => page.screenshot({ path: path.join(evidence, name + ".png"), fullPage: true });
const q = async (sql, parameters = []) => (await pool.query(sql, parameters)).rows;
async function eventually(read, check, message, timeout = 20000) {
  const until = Date.now() + timeout;
  let result;
  do { result = await read(); if (check(result)) return result; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < until);
  assert.fail(message + ": " + JSON.stringify(result));
}
async function step(name, caseIds, run) {
  console.log("START " + name);
  try {
    const actual = await run();
    report.checks.push({ name, caseIds, passed: true, actual }); await save();
    console.log("PASS " + name);
  } catch (error) { report.checks.push({ name, caseIds, passed: false, error: error.message }); await save(); throw error; }
}
async function login(target, identity) {
  await target.goto(baseUrl + "/login");
  await target.locator('input[name="email"]').fill(identity.email);
  await target.locator('input[name="password"]').fill(identity.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.waitForURL(url => !url.pathname.includes("login"));
  await target.goto(baseUrl + "/hr/attendance");
}
async function mutate(label, action, requireSuccess = true) {
  const [response] = await Promise.all([
    page.waitForResponse(r => {
      const url = new URL(r.url());
      if (!url.pathname.includes("_serverFn")) return false;
      if (r.request().method() === "POST") return !["leave-decision", "overtime-decision", "save-payslip"].includes(label);
      const payload = url.searchParams.get("payload") || "";
      if (label === "punch-correction") return payload.includes('"punchId"') && payload.includes('"newTimestamp"');
      if (label === "bulk-attendance") return payload.includes('"template"') && payload.includes('"conflictStrategy"');
      if (label === "save-payslip") return payload.includes('"deductionConfig"');
      if (["leave-decision", "overtime-decision"].includes(label)) return payload.includes('"id"') && payload.includes('"status"');
      return false;
    }),
    action(),
  ]);
  if (requireSuccess) assert.equal(response.status(), 200, label + " transport failed");
  const request = response.request();
  mutationRequests.set(label, { url: request.url(), method: request.method(), body: request.postDataBuffer(), contentType: request.headers()["content-type"] });
  return response;
}
async function closeDialog(name) {
  const dialog = page.getByRole("dialog", { name, exact: true });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function openImport() {
  await page.getByRole("button", { name: "Import device report", exact: true }).click();
  await page.getByRole("dialog", { name: "Device attendance import", exact: true }).waitFor();
}
async function upload(expectedNew) {
  await page.getByLabel("Device report", { exact: true }).setInputFiles(manifest.sourcePath);
  await mutate("import", () => page.getByRole("button", { name: "Upload and preview", exact: true }).click());
  const confirm = page.getByRole("button", { name: `Import ${expectedNew} new punches`, exact: true });
  await confirm.waitFor();
  const imports = await q("SELECT id, report FROM device_attendance_imports ORDER BY created_at DESC LIMIT 1");
  assert(imports.length);
  if (expectedNew) {
    await mutate("confirm-import", () => confirm.click());
    await page.getByText("Import saved", { exact: true }).waitFor();
  } else assert(await confirm.isDisabled(), "A repeated source must report zero new punches with confirmation disabled");
  return imports[0];
}
async function assertOriginalSource() {
  const expected = manifest.sourceRows.flatMap(row => row.times.map(time => row.code + "|" + new Date(row.date + "T" + time + ":00+05:00").toISOString())).sort();
  const actual = await q("SELECT e.employee_code, p.timestamp FROM attendance_punches p JOIN employees e ON e.id=p.employee_id WHERE p.source='device_import'");
  assert.deepEqual(actual.map(row => row.employee_code + "|" + row.timestamp.toISOString()).sort(), expected);
  assert.equal(Number((await q("SELECT count(*)::int n FROM device_attendance_punch_claims"))[0].n), 138);
}
async function reviewRow(rowNumber) {
  const target = page.getByRole("button", { name: `Review attendance row ${rowNumber}`, exact: true });
  // A saved HR decision refreshes the preview and can reset pagination.
  const previous = page.getByRole("button", { name: "Previous rows", exact: true });
  while (!(await target.count()) && await previous.isEnabled()) await previous.click();
  for (let i = 0; !(await target.count()) && i < 10; i++) {
    await page.getByRole("button", { name: "Next rows", exact: true }).click();
  }
  await target.click();
  const editor = page.getByRole("dialog", { name: "Attendance Management", exact: true });
  await editor.waitFor();
  return editor;
}
async function resolveRow(rowNumber, decision) {
  const editor = await reviewRow(rowNumber);
  await editor.locator(`#status-option-${decision.status}`).click();
  if (decision.status === "leave") {
    await editor.getByRole("combobox", { name: "Leave type", exact: true }).click();
    const labels = { annual: "Annual Leave", sick: "Sick Leave", special: "Special Leave", compensatory: "Compensatory (Comp Off)" };
    const options = await page.getByRole("option").allTextContents();
    assert.deepEqual(options.map(s => s.trim()).sort(), Object.values(labels).sort(), "Exactly four leave types must be offered");
    await page.getByRole("option", { name: labels[decision.leaveType], exact: true }).click();
    if (decision.compHours) await editor.getByPlaceholder("e.g. 8 for full day", { exact: true }).fill(String(decision.compHours));
  }
  await editor.getByPlaceholder("Add any specific observations, corrections, or context...", { exact: true }).fill("Synthetic payroll E2E HR decision; not actual entitlement or device evidence");
  await mutate("attendance", () => editor.getByRole("button", { name: "Save Attendance Record", exact: true }).click());
  await editor.waitFor({ state: "hidden" });
  const employee = manifest.employees.find(e => e.code === decision.code);
  const [record] = await eventually(() => q("SELECT * FROM attendance WHERE employee_id=$1 AND date=$2", [employee.id, decision.date]), rows => rows[0]?.status === decision.status, "Attendance resolution was not persisted");
  if (decision.status === "leave") {
    assert.equal(record.leave_type, decision.leaveType); assert.equal(record.leave_approval_status, "pending"); assert.equal(record.is_approved_leave, false);
    assert.equal(Number(record.compensatory_hours_used), decision.compHours || 0);
  }
  return record;
}
async function chooseDate(trigger, iso) {
  await trigger.click();
  const calendar = page.locator('[data-slot="calendar"]').last();
  const target = new Date(iso + "T00:00:00Z");
  const longMonth = target.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  for (let i = 0; i < 36; i++) {
    if ((await calendar.innerText()).includes(longMonth)) break;
    // Fixtures precede runtime; calendar opens at the actual current month.
    await calendar.getByRole("button", { name: /previous month/i }).click();
  }
  const monthName = target.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const button = calendar.getByRole("button", { name: new RegExp(`${monthName}\\s+${target.getUTCDate()}(?:st|nd|rd|th)?,?\\s+${target.getUTCFullYear()}`) });
  await button.click();
}
async function supplementRealDates() {
  await page.getByRole("button", { name: /Bulk Mark/ }).click();
  const bulk = page.getByRole("dialog", { name: "Bulk Mark Attendance", exact: true });
  await chooseDate(bulk.getByRole("button", { name: "Start date", exact: true }), "2026-09-16");
  await chooseDate(bulk.getByRole("button", { name: "End date", exact: true }), "2026-10-15");
  await bulk.getByPlaceholder("e.g. Public holiday, Office closed", { exact: true }).fill("Synthetic payroll E2E baseline; not device evidence");
  const before = (await q("SELECT count(*)::int n FROM attendance"))[0].n;
  assert.equal(before, 52);
  await bulk.getByRole("button", { name: "Apply Bulk Mark", exact: true }).click();
  await mutate("bulk-attendance", () => page.getByRole("alertdialog").getByRole("button", { name: "Confirm & Apply", exact: true }).click());
  await bulk.waitFor({ state: "hidden" });
  const rows = await eventually(() => q("SELECT count(*)::int n FROM attendance"), r => r[0].n === 166, "114 supplemental dates missing");
  assert.equal(rows[0].n, 166);
  for (const employee of manifest.employees) {
    const [supplemental] = await q("SELECT count(*)::int n FROM attendance WHERE employee_id=$1 AND notes=$2", [employee.id, "Synthetic payroll E2E baseline; not device evidence"]);
    assert.equal(supplemental.n, employee.supplemental, "Supplemental working dates " + employee.code);
  }
}
async function approveLeave(employee, decision = "approved") {
  await page.goto(baseUrl + "/hr/approvals");
  await page.getByRole("tab", { name: /Leave/ }).click();
  await page.getByPlaceholder("Search by employee name...").fill(employee.name);
  const row = page.getByRole("row").filter({ hasText: employee.code });
  await mutate("leave-decision", () => row.getByTitle(decision === "approved" ? "Approve Leave (no deduction)" : "Reject Leave (deduction applies)").click());
  await eventually(() => q("SELECT leave_approval_status, is_approved_leave FROM attendance WHERE employee_id=$1 AND status='leave'", [employee.id]), r => r.length && r.every(e => e.leave_approval_status === decision), "Leave decision missing");
}
async function replayMutation(label, targetContext = context) {
  const request = mutationRequests.get(label);
  assert(request, "Missing captured application mutation " + label);
  const response = await targetContext.request.fetch(request.url, {
    method: request.method,
    headers: { ...(request.contentType ? { "content-type": request.contentType } : {}), "x-tsr-serverFn": "true", origin: baseUrl },
    ...(request.body ? { data: request.body } : {}),
  });
  return response;
}
async function leaveState(employee) {
  const [state] = await q("SELECT a.status,a.leave_type,a.leave_approval_status,a.is_approved_leave,a.duty_hours,a.compensatory_hours_used,e.annual_leave_balance,e.sick_leave_balance,e.compensatory_hours_balance FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.employee_id=$1 AND a.status='leave'", [employee.id]);
  return state;
}
async function resetLeave(employee) {
  await page.goto(baseUrl + "/hr/approvals");
  await page.getByRole("tab", { name: /Leave/ }).click();
  await page.getByRole("tab", { name: "All History", exact: true }).click();
  await page.getByPlaceholder("Search by employee name...").fill(employee.name);
  const row = page.getByRole("row").filter({ hasText: employee.code });
  await mutate("leave-decision", () => row.getByRole("button", { name: "Reset", exact: true }).click());
  await eventually(() => leaveState(employee), value => value?.leave_approval_status === "pending", "Leave reset missing");
}
async function inspectProvisional(employee, expectedNet, label) {
  const sheet = await salary(employee, false);
  const calculation = await eventually(async () => previews.get(employee.id), value => value?.netSalary === expectedNet, label + " provisional preview");
  assert.equal(calculation.daysUnapprovedLeave, 1);
  assert.equal(calculation.daysLeave, 0);
  const expected = structuredClone(employee.expectedBreakdown);
  if (employee.leaveType === "compensatory") {
    expected.componentDeductions = { basicSalary: 0, houseRent: 0, utilities: 0, conveyance: 100, mobile: 0, bikeMaintenance: 0, technical: 0, special: 0 };
    expected.deductionBreakdownByOccasion = { absent: 0, undertime: 0, specialLeave: 0, annualLeave: 0, sickLeave: 0, unapprovedLeave: 100, notEmployed: 0 };
  }
  assert.deepEqual(calculation.componentDeductions, expected.componentDeductions);
  assert.deepEqual(calculation.deductionBreakdownByOccasion, expected.deductionBreakdownByOccasion);
  await screenshot(label + "-" + employee.code);
  await closeDialog("Salary Calculation");
  return { net: calculation.netSalary, unpaidLeave: calculation.daysUnapprovedLeave, components: calculation.componentDeductions, occasions: calculation.deductionBreakdownByOccasion };
}
async function decisionRoundTrip(employee) {
  const pendingNet = employee.leaveType === "compensatory" ? 42800 : employee.net;
  const pending = await inspectProvisional(employee, pendingNet, "leave-pending");
  await approveLeave(employee);
  const approved = await leaveState(employee);
  assert.equal(approved.is_approved_leave, true);
  assert.equal((await replayMutation("leave-decision")).status(), 200);
  assert.deepEqual(await leaveState(employee), approved, "Repeated approval changes no leave balance");
  await screenshot("leave-approved-" + employee.code);
  await resetLeave(employee);
  // A reset exposes the same real approval-screen row's Reject action.
  const row = page.getByRole("row").filter({ hasText: employee.code });
  await mutate("leave-decision", () => row.getByTitle("Reject Leave (deduction applies)").click());
  await eventually(() => leaveState(employee), value => value?.leave_approval_status === "rejected", "Leave rejection missing");
  const rejected = await leaveState(employee);
  assert.equal(rejected.status, "leave"); assert.equal(rejected.is_approved_leave, false);
  if (employee.compHours) { assert.equal(Number(rejected.compensatory_hours_used), 0); assert.equal(Number(rejected.compensatory_hours_balance), 16); }
  assert.equal((await replayMutation("leave-decision")).status(), 200);
  assert.deepEqual(await leaveState(employee), rejected, "Repeated rejection changes no leave balance");
  const provisional = await inspectProvisional(employee, pendingNet, "leave-rejected");
  await resetLeave(employee);
  if (employee.compHours) {
    await page.goto(baseUrl + "/hr/attendance"); await openImport(); await upload(0);
    const index = manifest.employees.findIndex(person => person.code === employee.code);
    await resolveRow(2 + index * 26 + 13, { code: employee.code, date: "2026-10-01", status: "leave", leaveType: employee.leaveType, compHours: employee.compHours });
    await closeDialog("Device attendance import");
  }
  await approveLeave(employee);
  return { pending, approved, rejected, rejectedPreview: provisional, restored: await leaveState(employee) };
}
async function correctOutPunch(employee, time, reason) {
  await page.goto(baseUrl + "/hr/attendance"); await openImport(); await upload(0);
  const index = manifest.employees.findIndex(person => person.code === employee.code);
  const editor = await reviewRow(2 + index * 26 + 13);
  await editor.getByRole("status").filter({ hasText: "Loading punch records" }).waitFor({ state: "hidden" });
  const [out] = await q("SELECT p.id,c.id claim_id FROM attendance_punches p JOIN device_attendance_punch_claims c ON c.punch_id=p.id WHERE p.employee_id=$1 AND p.attendance_date='2026-10-01' AND p.direction='out'", [employee.id]);
  assert(out);
  await editor.getByTitle("Correct punch time", { exact: true }).nth(1).click();
  const saveButton = editor.getByRole("button", { name: "Save", exact: true });
  assert(await saveButton.isDisabled(), "An imported punch correction requires a reason");
  await editor.locator('input[type="datetime-local"]').last().fill("2026-10-01T" + time);
  const reasonInput = editor.getByPlaceholder("Required, e.g. supervisor verified wrong time.", { exact: true });
  await reasonInput.fill(reason);
  // Capture the visible inline editor without resizing a full-page nested sheet.
  await page.screenshot({ path: path.join(evidence, (time === "17:00" ? "hr-correction" : "hr-correction-restore") + ".png"), fullPage: false });
  assert.equal(await reasonInput.inputValue(), reason, "Correction editor must retain its entered reason before save");
  await mutate("punch-correction", () => saveButton.click());
  await reasonInput.waitFor({ state: "hidden" });
  await closeDialog("Attendance Management"); await closeDialog("Device attendance import");
  const [claim] = await q("SELECT c.punch_id,c.timestamp raw_timestamp,p.timestamp actual_timestamp FROM device_attendance_punch_claims c JOIN attendance_punches p ON p.id=c.punch_id WHERE c.id=$1", [out.claim_id]);
  assert(claim, "Raw claim must survive correction and follow the replacement punch");
  assert.notEqual(claim.punch_id, out.id, "Correction replaces the punch while retaining the raw claim");
  assert.equal(claim.raw_timestamp.toISOString(), new Date("2026-10-01T15:00:00+05:00").toISOString());
  assert.equal(claim.actual_timestamp.toISOString(), new Date("2026-10-01T" + time + ":00+05:00").toISOString());
  const audit = await q("SELECT original_punch_id,reason FROM attendance_punch_correction_audit WHERE original_punch_id=$1 AND reason=$2", [out.id, reason]);
  assert.equal(audit.length, 1);
  return { punchId: out.id, raw: claim.raw_timestamp.toISOString(), actual: claim.actual_timestamp.toISOString(), reason };
}
async function salary(employee, shouldSave = true) {
  previews.delete(employee.id);
  await page.goto(baseUrl + "/hr/payroll");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "October 2026", exact: true }).click();
  await page.locator("tbody tr").first().waitFor({ state: "visible" });
  // Dashboard search is local to the current page. Paginate until the fixture is visible.
  for (let i = 0; i < 10; i++) {
    const row = page.getByRole("row").filter({ hasText: employee.code });
    if (await row.count()) {
      await row.getByRole("button", { name: /Process|Revise|Calculate/ }).click(); break;
    }
    const before = await page.locator("tbody tr td").first().textContent();
    const next = page.getByRole("button", { name: "Next", exact: true });
    assert(await next.isEnabled(), "Employee missing from payroll pages: " + employee.code);
    await next.click();
    await eventually(() => page.locator("tbody tr td").first().textContent(), value => value && value !== before, "Payroll page did not finish changing");
  }
  const sheet = page.getByRole("dialog", { name: "Salary Calculation", exact: true });
  await sheet.waitFor();
  if (!shouldSave) return sheet;
  await sheet.getByRole("button", { name: "Save Draft Slip", exact: true }).waitFor();
  const calculation = await eventually(async () => previews.get(employee.id), value => value?.netSalary === employee.net, "Salary preview response missing or incorrect");
  for (const [key, expected] of Object.entries(employee.expectedBreakdown)) assert.deepEqual(calculation[key], expected, employee.code + " " + key);
  assert.equal(calculation.totalWorkingDays, 26);
  assert.equal(calculation.unmarkedDays, 0);
  assert.equal(calculation.totalDeductions, employee.deductions);
  await screenshot(`salary-${employee.code}`);
  const previewText = await sheet.innerText();
  assert(previewText.includes(employee.net.toLocaleString("en-US")), `Expected salary ${employee.net} missing in preview`);
  await mutate("save-payslip", () => sheet.getByRole("button", { name: "Save Draft Slip", exact: true }).click());
  await sheet.waitFor({ state: "hidden" });
  const [slip] = await eventually(() => q("SELECT * FROM payslips WHERE employee_id=$1", [employee.id]), r => r.length === 1, "Draft payslip not saved");
  assert.equal(Number(slip.net_salary), employee.net);
  assert.equal(Number(slip.total_deductions), employee.deductions);
  assert.equal(Number(slip.basic_salary), 26000);
  assert.equal(slip.salary_revision_id, employee.revisionId);
  assert.equal(Number(slip.gross_salary), 42900 + (employee.overtime ? 250 : 0));
  await page.reload();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "October 2026", exact: true }).click();
  await page.goto(baseUrl + "/hr/payroll/employee/" + employee.id);
  const historyRow = page.getByRole("row").filter({ hasText: "October 2026" });
  assert((await historyRow.innerText()).includes(employee.net.toLocaleString("en-US")));
  await historyRow.getByRole("button").first().click();
  const display = page.getByRole("dialog", { name: "Payslip - October 2026", exact: true });
  await display.waitFor();
  const displayNet = display.getByRole("cell", { name: "Net Pay", exact: true }).locator("..").locator("td").nth(1);
  assert.equal(Number((await displayNet.innerText()).replaceAll(",", "")), employee.net, "Displayed Net Pay cell");
  await screenshot(`payslip-${employee.code}`);
  const [printPage] = await Promise.all([
    context.waitForEvent("page"),
    display.getByRole("button", { name: "Print / Save PDF", exact: true }).click(),
  ]);
  await printPage.waitForLoadState("domcontentloaded");
  const printedNet = printPage.getByRole("cell", { name: "Net Pay", exact: true }).locator("..").locator("td").nth(1);
  assert.equal(Number((await printedNet.innerText()).replaceAll(",", "")), employee.net, "Printed Net Pay cell");
  await printPage.pdf({ path: path.join(evidence, `payslip-${employee.code}.pdf`), printBackground: true });
  await printPage.close();
  return { employee: employee.code, expectedNet: employee.net, actualNet: slip.net_salary, gross: slip.gross_salary, deductions: slip.total_deductions, salaryRevision: slip.salary_revision_id, expectedBreakdown: employee.expectedBreakdown, actualBreakdown: { standardBreakdown: calculation.standardBreakdown, componentDeductions: calculation.componentDeductions, deductionBreakdownByOccasion: calculation.deductionBreakdownByOccasion } };
}

async function main() {
  const { fromCrossJSON } = await import("seroval");
  const { getDefaultSerovalPlugins } = await import("@tanstack/start-client-core");
  decodeResponse = value => fromCrossJSON(value, { plugins: getDefaultSerovalPlugins() });
  manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
  identities = JSON.parse(await fs.readFile(path.join(directory, "credentials.json"), "utf8"));
  assert.equal(databaseUrl.pathname, "/" + manifest.database);
  assert.equal((await q("SELECT current_database() name"))[0].name, manifest.database);
  report.database = manifest.database; report.scenario = manifest.scenario; report.sourceSha256 = manifest.sha256; report.cycle = manifest.cycle;
  browser = await chromium.launch({ headless: true, executablePath: process.env.ATTENDANCE_BROWSER_CHROME, args: ["--no-sandbox"] });
  report.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: "Asia/Karachi", locale: "en-PK" });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) report.failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on("response", async response => {
    if (!new URL(response.url()).pathname.includes("_serverFn") || !(response.headers()["content-type"] || "").includes("application/json")) return;
    try {
      const text = await response.text();
      if (!text.includes("componentDeductions")) return;
      const decoded = decodeResponse(JSON.parse(text));
      const value = decoded.result ?? decoded;
      if (value.componentDeductions && value.employeeId) previews.set(value.employeeId, value);
    } catch (error) { report.inspectionErrors.push(error.message); }
  });
  await step("Real Better Auth sign-in and HR route", [], async () => {
    await login(page, identities.find(e => e.kind === "hr"));
    // Traces begin after authentication so credentials never enter evidence.
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await screenshot("authenticated-attendance");
  });
  const real = manifest.scenario === "real";
  let original;
  await step("Upload source and independently inspect PostgreSQL", [], async () => {
    await openImport();
    const expectedPunches = real ? 138 : 574;
    original = await upload(expectedPunches);
    const [counts] = await q("SELECT (SELECT count(*)::int FROM attendance_punches) punches,(SELECT count(*)::int FROM device_attendance_punch_claims) claims,(SELECT count(*)::int FROM attendance) attendance");
    assert.equal(counts.punches, expectedPunches); assert.equal(counts.claims, expectedPunches); assert.equal(counts.attendance, real ? 52 : 286);
    if (real) {
      assert.equal(manifest.sourceRows.filter(row => row.needsReview).length, 12);
      const [saved] = await q("SELECT result_rows FROM device_attendance_imports WHERE id=$1", [original.id]);
      const actualReview = saved.result_rows.filter(row => row.status === "needs_review");
      assert.equal(actualReview.length, 12, "Actual imported review rows");
      assert.deepEqual(actualReview.map(row => ({ row: row.rowNumber, code: row.personId, date: row.date })), manifest.sourceRows.filter(row => row.needsReview).map(({ row, code, date }) => ({ row, code, date })));
      assert(actualReview.every(row => row.messages.length > 0), "Each review row must expose a reason");
      report.sourceReviewRows = actualReview.map(({ rowNumber, personId, date, messages }) => ({ rowNumber, personId, date, messages }));
      await page.getByText("12 rows need HR review", { exact: true }).waitFor();
      await assertOriginalSource();
      for (const row of manifest.sourceRows) {
        const [attendance] = await q("SELECT a.duty_hours FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE e.employee_code=$1 AND a.date=$2", [row.code, row.date]);
        assert.equal(Number(attendance.duty_hours), Number(row.completedHours), "Completed intervals " + row.code + " " + row.date);
      }
    }
    await screenshot("source-preview"); return counts;
  });
  if (real) {
    await closeDialog("Device attendance import");
    await step("Unresolved historical source blocks salary", ["A07"], async () => {
      const sheet = await salary(manifest.employees.find(e => e.code === "112009"), false);
      const response = await mutate("save-payslip", () => sheet.getByRole("button", { name: "Save Draft Slip", exact: true }).click(), false);
      assert(/needs HR review/.test(await response.text()), "The actual save request must refuse unresolved historical punches");
      await page.getByText(/Attendance on .* needs HR review/).waitFor();
      assert.equal((await q("SELECT count(*)::int n FROM payslips"))[0].n, 0);
      assert.equal(Number((await q("SELECT balance FROM wallets WHERE id=$1", [manifest.walletId]))[0].balance), 1000000);
      await screenshot("unresolved-payroll-block");
    });
    await page.goto(baseUrl + "/hr/attendance");
    await step("Create 114 supplemental working dates through bulk HR action", [], supplementRealDates);
    await openImport(); await upload(0);
    for (const decision of manifest.resolutions) await step(`Resolve source row ${decision.row}`, [], () => resolveRow(decision.row, decision));
  } else {
    for (const [index, employee] of manifest.employees.entries()) {
      if (employee.leaveType || employee.status === "absent") {
        await step(`Submit ${employee.code} attendance decision`, [], () => resolveRow(2 + index * 26 + 13, { code: employee.code, date: "2026-10-01", status: employee.leaveType ? "leave" : "absent", leaveType: employee.leaveType, compHours: employee.compHours }));
      }
    }
  }
  await closeDialog("Device attendance import");
  for (const employee of manifest.employees) {
    const leaves = await q("SELECT leave_type FROM attendance WHERE employee_id=$1 AND status='leave'", [employee.id]);
    if (leaves.length) {
      if (!real && employee.code !== "E2E06") await step(`Exercise pending, approved, rejected and repeated ${employee.leaveType}`, [], () => decisionRoundTrip(employee));
      else await step(`Approve ${employee.code} ${leaves[0].leave_type}`, [], async () => { await approveLeave(employee); await screenshot(`leave-approved-${employee.code}`); });
    }
  }
  if (real) await step("Reject automatically suggested rest-day overtime without changing source duty", ["A05", "P03"], async () => {
    const expected = manifest.sourceRows.filter(row => !row.needsReview && new Date(row.date + "T00:00:00Z").getUTCDay() === 0);
    assert.equal(expected.length, 7);
    const pending = await q("SELECT a.id,e.employee_code code,a.date::text date,a.duty_hours,a.overtime_hours FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.overtime_status='pending' AND a.overtime_hours::numeric>0 ORDER BY e.employee_code,a.date");
    const normalized = rows => rows.map(row => ({ code: row.code, date: row.date, hours: Number(row.overtime_hours ?? row.completedHours) })).sort((a, b) => (a.code + a.date).localeCompare(b.code + b.date));
    assert.deepEqual(normalized(pending), normalized(expected), "Only original completed rest-day intervals create these pending suggestions");
    await page.goto(baseUrl + "/hr/approvals");
    await page.getByRole("tab", { name: /Overtime/ }).click();
    for (const item of pending) {
      const displayDate = item.date.slice(8) + " Oct 2026";
      const row = page.getByRole("row").filter({ hasText: item.code }).filter({ hasText: displayDate });
      await row.getByTitle("Reject OT", { exact: true }).click();
      await mutate("overtime-decision", () => page.getByRole("alertdialog", { name: "Reject overtime?", exact: true }).getByRole("button", { name: "Reject", exact: true }).click());
      await eventually(() => q("SELECT overtime_status,duty_hours,overtime_hours FROM attendance WHERE id=$1", [item.id]), rows => rows[0]?.overtime_status === "rejected", "Rest-day overtime rejection missing");
      const [stored] = await q("SELECT duty_hours,overtime_hours FROM attendance WHERE id=$1", [item.id]);
      assert.equal(stored.duty_hours, item.duty_hours); assert.equal(stored.overtime_hours, item.overtime_hours);
    }
    await assertOriginalSource();
    await screenshot("rest-day-overtime-rejected");
    return { decisions: normalized(pending).map(item => ({ ...item, status: "rejected" })), cashOvertime: 0 };
  });
  if (real) await step("Source replay preserves all explicit HR decisions", [], async () => {
    const before = await q("SELECT id,status,leave_type,leave_approval_status,is_approved_leave,compensatory_hours_used,overtime_status,overtime_hours FROM attendance ORDER BY id");
    await page.goto(baseUrl + "/hr/attendance"); await openImport(); await upload(0); await closeDialog("Device attendance import");
    assert.deepEqual(await q("SELECT id,status,leave_type,leave_approval_status,is_approved_leave,compensatory_hours_used,overtime_status,overtime_hours FROM attendance ORDER BY id"), before);
    await assertOriginalSource();
  });
  // Actual overtime requests are created in the editor, then approved in the existing approval screen.
  const overtimeEmployee = manifest.employees.find(e => e.overtime);
  if (overtimeEmployee) {
    await step("Request and approve two cash overtime hours", [], async () => {
      await page.goto(baseUrl + "/hr/attendance"); await openImport(); await upload(0);
      const index = manifest.employees.indexOf(overtimeEmployee);
      const editor = await reviewRow(2 + index * 26 + 13);
      await editor.getByPlaceholder(/Describe why overtime/).fill("Synthetic payroll E2E actual two-hour overtime request");
      await mutate("overtime-request", () => editor.getByRole("button", { name: "Save Attendance Record", exact: true }).click());
      await editor.waitFor({ state: "hidden" });
      await page.goto(baseUrl + "/hr/approvals");
      await page.getByRole("tab", { name: /Overtime/ }).click();
      const row = page.getByRole("row").filter({ hasText: overtimeEmployee.code });
      await row.getByTitle("Approve OT", { exact: true }).click();
      await mutate("overtime-decision", () => page.getByRole("alertdialog", { name: "Approve overtime?", exact: true }).getByRole("button", { name: "Approve", exact: true }).click());
      await eventually(() => q("SELECT overtime_status FROM attendance WHERE employee_id=$1 AND date='2026-10-01'", [overtimeEmployee.id]), r => r[0]?.overtime_status === "approved", "Overtime approval missing");
    });
  }
  const salaries = [];
  for (const employee of manifest.employees) await step(`Preview, save and reload ${employee.code}`, [], async () => { const result = await salary(employee); salaries.push(result); return result; });
  if (!real) await step("HR correction recalculates salary and source reupload preserves correction", ["A09"], async () => {
    const employee = manifest.employees.find(person => person.code === "E2E09");
    const corrected = { ...employee, net: 42900, deductions: 0, expectedBreakdown: manifest.employees.find(person => person.code === "E2E01").expectedBreakdown };
    const changed = await correctOutPunch(employee, "17:00", "Synthetic payroll E2E: supervisor verified complete eight-hour day");
    const newSalary = await salary(corrected);
    await page.goto(baseUrl + "/hr/attendance"); await openImport(); await upload(0); await closeDialog("Device attendance import");
    const [preserved] = await q("SELECT a.duty_hours,p.net_salary FROM attendance a JOIN payslips p ON p.employee_id=a.employee_id WHERE a.employee_id=$1 AND a.date='2026-10-01'", [employee.id]);
    assert.equal(Number(preserved.duty_hours), 8); assert.equal(Number(preserved.net_salary), 42900);
    const restored = await correctOutPunch(employee, "15:00", "Synthetic payroll E2E: restore original six-hour test fixture after correction verification");
    await salary(employee);
    return { beforeNet: 42650, afterNet: newSalary.actualNet, sourceReplayNet: preserved.net_salary, finalFixtureNet: 42650, changed, restored };
  });
  if (real) await step("Source replay preserves saved salary drafts", [], async () => {
    const before = await q("SELECT id,employee_id,gross_salary,total_deductions,net_salary FROM payslips ORDER BY id");
    await page.goto(baseUrl + "/hr/attendance"); await openImport(); await upload(0); await closeDialog("Device attendance import");
    assert.deepEqual(await q("SELECT id,employee_id,gross_salary,total_deductions,net_salary FROM payslips ORDER BY id"), before);
    await assertOriginalSource();
  });
  await step("Reconcile saved salary totals and test wallet", real ? ["REAL_FILE"] : ["A01", "A02", "A03", "A04", "A13", "L01", "L02", "L03", "L04", "L11", "P01"], async () => {
    const [totals] = await q("SELECT sum(gross_salary)::text gross,sum(total_deductions)::text deductions,sum(net_salary)::text net FROM payslips");
    if (real) { assert.equal(Number(totals.gross), 257400); assert.equal(Number(totals.deductions), 13071); assert.equal(Number(totals.net), 244329); }
    assert.equal(Number((await q("SELECT balance FROM wallets WHERE id=$1", [manifest.walletId]))[0].balance), 1000000);
    assert.equal(report.pageErrors.length, 0); return { ...totals, salaries };
  });
  await step("Viewer is refused actual mutation requests", ["P08"], async () => {
    const viewerContext = await browser.newContext({ timezoneId: "Asia/Karachi" });
    try {
      const viewerPage = await viewerContext.newPage(); await login(viewerPage, identities.find(e => e.kind === "viewer"));
      const snapshot = () => q("SELECT (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM attendance a) attendance,(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM employees e) employees,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payslips p) payslips,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payrolls p) payrolls,(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM wallets w) wallets,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM attendance_punches p) punches,(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM device_attendance_punch_claims c) claims,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM attendance_punch_correction_audit a) correction_audit,(SELECT count(*) FROM transactions) transactions,(SELECT count(*) FROM device_attendance_imports) imports");
      const before = await snapshot();
      const required = ["confirm-import", "attendance", "leave-decision", "save-payslip", ...(real ? [] : ["overtime-decision", "punch-correction"])];
      for (const name of required) {
        const request = mutationRequests.get(name); assert(request, "Missing actual request for " + name);
        const response = await viewerContext.request.fetch(request.url, { method: request.method, headers: { ...(request.contentType ? { "content-type": request.contentType } : {}), "x-tsr-serverFn": "true", origin: baseUrl }, ...(request.body ? { data: request.body } : {}) });
        const text = await response.text();
        assert(/Missing required permission:\s*hr\.manage|\bFORBIDDEN\b/.test(text), `${name} did not return the required permission refusal: HTTP ${response.status()}`);
        assert.deepEqual(await snapshot(), before, `${name} changed state for the viewer`);
      }
    } finally { await viewerContext.close(); }
  });
  report.passed = true;
}
main().catch(async error => { report.error = error.stack; process.exitCode = 1; console.error(error); try { await screenshot("failure"); } catch {} }).finally(async () => {
  try {
    if (context) {
      const rawTrace = path.join(directory, "trace.raw.zip");
      try {
        await context.tracing.stop({ path: rawTrace });
        execFileSync("python3", ["src/__tests__/e2e/attendance-payroll.trace.py", rawTrace, path.join(evidence, "trace.zip")]);
      } finally { await fs.unlink(rawTrace).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      report.tracePrivacy = "Actions, snapshots and images retained; authenticated network traffic and non-image response resources excluded.";
    }
  } catch (error) { report.traceError = error.message; report.passed = false; process.exitCode = 1; }
  await browser?.close(); await pool.end(); report.finishedAt = new Date().toISOString(); await save();
});

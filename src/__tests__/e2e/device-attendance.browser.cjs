// Run after device-attendance.setup.ts. Playwright may be installed outside this
// repository: set ATTENDANCE_BROWSER_MODULE to its absolute module directory.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const { chromium } = require(
  process.env.ATTENDANCE_BROWSER_MODULE || "playwright",
);

const fixtureDirectory =
  process.env.ATTENDANCE_BROWSER_FIXTURES || ".tmp/attendance-browser";
const baseUrl = process.env.ATTENDANCE_BROWSER_URL || "http://localhost:3100";
const evidenceRoot = path.resolve(
  "docs/superpowers/reviews/attendance-browser",
);
const runDirectory = path.join(
  evidenceRoot,
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  failedResponses: [],
  requests: [],
  screenshots: [],
  passed: false,
};
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
let browser;
let page;
let context;
let tracing = false;
let credentials;
let manifest;
let originalImport;
let correction;
const requestStarts = new WeakMap();
const employeeIds = () => manifest.employees.map((employee) => employee.id);
const screenshot = async (name) => {
  await page.screenshot({
    path: path.join(runDirectory, name + ".png"),
    fullPage: true,
  });
  report.screenshots.push(name + ".png");
};
const writeReport = () =>
  fs.writeFile(
    path.join(runDirectory, "results.json"),
    JSON.stringify(report, null, 2),
  );
async function step(name, run) {
  console.log("START " + name);
  const value = await run();
  report.checks.push({ name, passed: true, ...(value || {}) });
  await writeReport();
  console.log("PASS " + name + " " + JSON.stringify(value || {}));
  return value;
}
async function counts() {
  const result = await pool.query(
    "SELECT (SELECT count(*)::int FROM attendance_punches WHERE employee_id=ANY($1::text[])) AS punches, " +
      "(SELECT count(*)::int FROM device_attendance_punch_claims WHERE employee_id=ANY($1::text[])) AS claims, " +
      "(SELECT count(*)::int FROM attendance WHERE employee_id=ANY($1::text[])) AS attendance, " +
      "(SELECT count(*)::int FROM attendance WHERE employee_id=ANY($1::text[]) AND status<>'present') AS non_present",
    [employeeIds()],
  );
  return result.rows[0];
}
async function openImport() {
  await page
    .getByRole("button", { name: "Import device report", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Device attendance import", exact: true })
    .waitFor();
}
async function upload(expectedNew) {
  const previous = await pool.query(
    "SELECT id FROM device_attendance_imports WHERE uploaded_by_user_id=$1 ORDER BY created_at DESC LIMIT 1",
    [credentials.userId],
  );
  await page
    .getByLabel("Device report", { exact: true })
    .setInputFiles(manifest.sourcePath);
  const uploadButton = page.getByRole("button", {
    name: "Upload and preview",
    exact: true,
  });
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes("_serverFn") &&
        response.request().method() === "POST" &&
        (response.request().headers()["content-type"] || "").includes(
          "multipart/form-data",
        ),
    ),
    uploadButton.click(),
  ]);
  assert.equal(response.status(), 200, "The new file upload RPC must succeed");
  // A previous preview remains visible during a repeated upload. Wait until
  // this mutation settles before inspecting its replacement preview or row.
  await uploadButton.click({ trial: true });
  await Promise.race([
    page.getByRole("region", { name: "Report preview" }).waitFor(),
    page
      .getByRole("alert")
      .filter({ hasText: "Action failed" })
      .waitFor()
      .then(async () => {
        throw new Error(
          await page
            .getByRole("alert")
            .filter({ hasText: "Action failed" })
            .innerText(),
        );
      }),
  ]);
  const button = page.getByRole("button", {
    name: "Import " + expectedNew + " new punches",
    exact: true,
  });
  await button.waitFor();
  const result = await pool.query(
    "SELECT * FROM device_attendance_imports WHERE uploaded_by_user_id=$1 ORDER BY created_at DESC LIMIT 1",
    [credentials.userId],
  );
  assert.notEqual(
    result.rows[0]?.id,
    previous.rows[0]?.id,
    "Every upload must create a new persisted source report",
  );
  assert.equal(
    await page.getByRole("alert").filter({ hasText: "Action failed" }).count(),
    0,
    "The completed upload must not leave an application error",
  );
  assert.equal(result.rows[0].file_sha256, manifest.sha256);
  assert.equal(result.rows[0].report.format, "xlsx");
  assert.equal(result.rows[0].report.rows.length, 52);
  return { button, batch: result.rows[0] };
}
async function closeDialog(name) {
  const dialog = page.getByRole("dialog", { name, exact: true });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function reviewRow(rowNumber) {
  const button = page.getByRole("button", {
    name: "Review attendance row " + rowNumber,
    exact: true,
  });
  if (!(await button.count())) {
    await page.getByRole("button", { name: "Next rows", exact: true }).click();
  }
  await button.click();
  const editor = page.getByRole("dialog", {
    name: "Attendance Management",
    exact: true,
  });
  await editor.waitFor();
  await editor.getByTitle("Correct punch time").first().waitFor();
  return editor;
}
async function changeTime(editor, value, reason) {
  await editor.getByTitle("Correct punch time").first().click();
  const save = editor.getByRole("button", { name: "Save", exact: true });
  assert(
    await save.isDisabled(),
    "Imported-origin corrections must require a reason",
  );
  await editor.locator('input[type="datetime-local"]').nth(1).fill(value);
  const reasonInput = editor.getByPlaceholder(
    "Required, e.g. supervisor verified wrong time.",
    { exact: true },
  );
  await reasonInput.fill(reason);
  await save.click();
  await reasonInput.waitFor({ state: "hidden" });
}
async function assertOriginalTimestamps() {
  const expected = originalImport.report.rows
    .flatMap((row) =>
      row.punches.map(
        (time) =>
          row.personId +
          "|" +
          new Date(row.date + "T" + time + ":00+05:00").toISOString(),
      ),
    )
    .sort();
  const actual = await pool.query(
    "SELECT e.employee_code, p.timestamp FROM attendance_punches p JOIN employees e ON e.id=p.employee_id WHERE p.employee_id=ANY($1::text[])",
    [employeeIds()],
  );
  assert.deepEqual(
    actual.rows
      .map((row) => row.employee_code + "|" + row.timestamp.toISOString())
      .sort(),
    expected,
  );
}

async function main() {
  const url = new URL(baseUrl);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.pathname, "/main");
  await fs.mkdir(runDirectory, { recursive: true });
  credentials = JSON.parse(
    await fs.readFile(path.join(fixtureDirectory, "credentials.json"), "utf8"),
  );
  manifest = JSON.parse(
    await fs.readFile(
      path.join(fixtureDirectory, "seed-manifest.json"),
      "utf8",
    ),
  );
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(manifest.sourcePath))
      .digest("hex"),
    manifest.sha256,
  );
  report.source = {
    filename: path.basename(manifest.sourcePath),
    sha256: manifest.sha256,
    rows: 52,
    punches: 138,
    employees: 6,
  };
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ATTENDANCE_BROWSER_CHROME
      ? { executablePath: process.env.ATTENDANCE_BROWSER_CHROME }
      : {}),
    args: ["--no-sandbox"],
  });
  report.browser = browser.version();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: "Asia/Karachi",
    locale: "en-PK",
  });
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      console.log(
        "NAV " +
          frame.url().replace(/([?&]password=)[^&\s"]+/g, "$1[REDACTED]"),
      );
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    requestStarts.set(request, new Date().toISOString());
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.includes("_serverFn") || pathname.startsWith("/api/auth/")) {
      report.requests.push({
        method: response.request().method(),
        pathname,
        status: response.status(),
        startedAt: requestStarts.get(response.request()),
        responseAt: new Date().toISOString(),
      });
      if (response.status() >= 400)
        report.failedResponses.push({ pathname, status: response.status() });
    }
  });
  await step("Real login and HR-only access", async () => {
    const serverOnlyContext = await browser.newContext({
      javaScriptEnabled: false,
    });
    try {
      const serverOnlyPage = await serverOnlyContext.newPage();
      const response = await serverOnlyPage.goto(baseUrl + "/login", {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      assert.equal(response?.status(), 200, "The SSR login page must render");
      assert(await serverOnlyPage.locator('input[name="email"]').isDisabled());
      assert(
        await serverOnlyPage.locator('input[name="password"]').isDisabled(),
      );
      assert(
        await serverOnlyPage
          .getByRole("button", { name: "Sign in", exact: true })
          .isDisabled(),
      );
      assert.equal(
        await serverOnlyPage.locator("form").getAttribute("method"),
        "post",
      );
    } finally {
      await serverOnlyContext.close();
    }
    await page.goto(baseUrl + "/hr/attendance", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 120000,
    });
    await page.locator('input[name="email"]').fill(credentials.email);
    await page.locator('input[name="password"]').fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/hr/attendance", {
      timeout: 120000,
    });
    await page
      .getByRole("button", { name: "Import device report", exact: true })
      .waitFor();
    // Start tracing after password submission. The test login is revoked at end.
    await context.tracing.start({ screenshots: true, snapshots: true });
    tracing = true;
    await screenshot("01-seeded-employees");
    report.initialDatabase = await counts();
    assert(
      [0, 138].includes(report.initialDatabase.punches),
      "Unexpected existing fixture punches",
    );
    return { initialDatabase: report.initialDatabase };
  });
  await step(
    "Upload the exact HR file and preview without inserting punches",
    async () => {
      await openImport();
      const expectedNew = report.initialDatabase.punches === 0 ? 138 : 0;
      const staged = await upload(expectedNew);
      originalImport = staged.batch;
      assert.equal((await counts()).punches, report.initialDatabase.punches);
      assert.equal(
        await page.getByRole("row").count(),
        51,
        "First preview page must show 50 report rows plus its header",
      );
      await screenshot("02-real-file-preview");
      await page
        .getByRole("button", { name: "Next rows", exact: true })
        .click();
      assert.equal(
        await page.getByRole("row").count(),
        3,
        "Second preview page must show the last two rows",
      );
      await screenshot("03-preview-last-rows");
      await page
        .getByRole("button", { name: "Previous rows", exact: true })
        .click();
      return {
        formatDetectedFromBytes: "xlsx",
        expectedNewPunches: expectedNew,
        sourceHashVerified: true,
      };
    },
  );
  await step("Confirm through the browser and verify PostgreSQL", async () => {
    if (report.initialDatabase.punches === 0) {
      await page
        .getByRole("button", { name: "Import 138 new punches", exact: true })
        .click();
      await page.getByText("Import saved", { exact: true }).waitFor();
    }
    const remaining = page.getByRole("button", {
      name: "Import 0 new punches",
      exact: true,
    });
    await remaining.waitFor();
    assert(await remaining.isDisabled());
    const current = await counts();
    assert.equal(current.punches, 138);
    assert.equal(current.claims, 138);
    assert.equal(current.non_present, 0);
    await assertOriginalTimestamps();
    if (report.initialDatabase.punches !== 0) {
      const saved = await pool.query(
        "SELECT * FROM device_attendance_imports WHERE uploaded_by_user_id=$1 AND file_sha256=$2 AND status='completed' ORDER BY created_at LIMIT 1",
        [credentials.userId, manifest.sha256],
      );
      assert(
        saved.rows[0],
        "Existing fixture punches require their saved completed source import",
      );
      originalImport = saved.rows[0];
    }
    const invalidHours = await pool.query(
      "WITH ordered AS (SELECT employee_id, attendance_date, direction, timestamp, lag(direction) OVER w AS previous_direction, lag(timestamp) OVER w AS previous_time FROM attendance_punches WHERE employee_id=ANY($1::text[]) WINDOW w AS (PARTITION BY employee_id, attendance_date ORDER BY timestamp)), totals AS (SELECT employee_id, attendance_date, round(COALESCE(sum(EXTRACT(epoch FROM timestamp-previous_time)/3600) FILTER (WHERE direction='out' AND previous_direction='in'),0),2) AS hours FROM ordered GROUP BY employee_id,attendance_date) SELECT t.employee_id,t.attendance_date,a.duty_hours,t.hours FROM totals t LEFT JOIN attendance a ON t.employee_id=a.employee_id AND t.attendance_date=a.date WHERE a.id IS NULL OR a.duty_hours::numeric<>t.hours",
      [employeeIds()],
    );
    assert.deepEqual(
      invalidHours.rows,
      [],
      "Every logical punch day must have attendance with the completed interval total",
    );
    const logicalDays = await pool.query(
      "SELECT count(*)::int AS count FROM (SELECT DISTINCT employee_id,attendance_date FROM attendance_punches WHERE employee_id=ANY($1::text[])) days",
      [employeeIds()],
    );
    assert.equal(
      current.attendance,
      logicalDays.rows[0].count,
      "The import must create exactly the logical punch days",
    );
    const [batch] = (
      await pool.query("SELECT * FROM device_attendance_imports WHERE id=$1", [
        originalImport.id,
      ])
    ).rows;
    originalImport = batch;
    assert.equal(batch.status, "completed");
    report.importedDatabase = current;
    const reviewRows = batch.result_rows.filter(
      (row) => row.status === "needs_review",
    );
    report.reviewRows = reviewRows.map((row) => ({
      rowNumber: row.rowNumber,
      employeeId: row.employeeId,
      date: row.date,
      messages: row.messages,
    }));
    await screenshot("04-import-confirmed");
    return {
      database: current,
      historicalReviewRows: reviewRows.length,
      independentlyRecomputedHoursMatch: true,
    };
  });
  await step(
    "Reopen the saved upload and upload the original file again",
    async () => {
      await closeDialog("Device attendance import");
      await page.reload({ waitUntil: "domcontentloaded" });
      await openImport();
      await page
        .getByRole("button", {
          name: "Open upload " + report.source.filename,
          exact: true,
        })
        .filter({ hasText: "Review import" })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Import 0 new punches", exact: true })
        .waitFor();
      const repeated = await upload(0);
      assert(await repeated.button.isDisabled());
      assert.deepEqual(await counts(), report.importedDatabase);
      await screenshot("05-repeat-upload-no-duplicates");
      return { addedPunches: 0, claims: 138 };
    },
  );
  await step(
    "Open a flagged day in the existing editor and correct an imported punch",
    async () => {
      const candidates = originalImport.result_rows.filter(
        (row) => row.status === "needs_review",
      );
      for (const row of candidates) {
        const punches = (
          await pool.query(
            "SELECT * FROM attendance_punches WHERE employee_id=$1 AND attendance_date=$2 ORDER BY timestamp",
            [row.employeeId, row.date],
          )
        ).rows;
        if (punches.length === 1 && punches[0].direction === "in") {
          correction = { row, original: punches[0] };
          break;
        }
      }
      assert(
        correction,
        "The real file should contain a historical missing-checkout review case",
      );
      correction.previousAuditIds = (
        await pool.query(
          "SELECT id FROM attendance_punch_correction_audit WHERE changed_by_user_id=$1",
          [credentials.userId],
        )
      ).rows.map((row) => row.id);
      const editor = await reviewRow(correction.row.rowNumber);
      await screenshot("06-existing-hr-editor");
      const originalDate = new Date(correction.original.timestamp);
      correction.originalLocal = new Date(originalDate.getTime() + 5 * 3600000)
        .toISOString()
        .slice(0, 16);
      correction.changed = new Date(originalDate.getTime() + 60000);
      const changedLocal = new Date(correction.changed.getTime() + 5 * 3600000)
        .toISOString()
        .slice(0, 16);
      await changeTime(
        editor,
        changedLocal,
        "Headless browser verification of HR correction",
      );
      await closeDialog("Attendance Management");
      await upload(0);
      const raw = await pool.query(
        "SELECT id FROM attendance_punches WHERE employee_id=$1 AND timestamp=$2",
        [correction.row.employeeId, originalDate],
      );
      assert.equal(
        raw.rowCount,
        0,
        "Reupload must not restore the original timestamp",
      );
      const claim = (
        await pool.query(
          "SELECT c.timestamp AS original_timestamp,p.id AS corrected_id,p.timestamp AS corrected_timestamp FROM device_attendance_punch_claims c JOIN attendance_punches p ON p.id=c.punch_id WHERE c.employee_id=$1 AND c.timestamp=$2",
          [correction.row.employeeId, originalDate],
        )
      ).rows[0];
      assert(claim);
      correction.changedPunchId = claim.corrected_id;
      assert.equal(
        claim.corrected_timestamp.toISOString(),
        correction.changed.toISOString(),
      );
      await screenshot("07-correction-preserved-on-reupload");
      return {
        employeeId: correction.row.employeeId,
        attendanceDate: correction.row.date,
        originalClaimRetained: true,
        correctedTimePreserved: true,
      };
    },
  );
  await step(
    "Restore the real timestamp through HR with a second required audit reason",
    async () => {
      const editor = await reviewRow(correction.row.rowNumber);
      await changeTime(
        editor,
        correction.originalLocal,
        "Restore supplied timestamp after browser verification",
      );
      await closeDialog("Attendance Management");
      await assertOriginalTimestamps();
      const audits = await pool.query(
        "SELECT action,reason,original_punch_id,old_values FROM attendance_punch_correction_audit WHERE changed_by_user_id=$1 AND NOT(id=ANY($2::text[])) ORDER BY changed_at",
        [credentials.userId, correction.previousAuditIds],
      );
      assert.equal(
        audits.rows.length,
        2,
        "This run must create two audit events",
      );
      assert.deepEqual(
        audits.rows.map((row) => row.action),
        ["correct", "correct"],
      );
      assert.deepEqual(
        audits.rows.map((row) => row.reason),
        [
          "Headless browser verification of HR correction",
          "Restore supplied timestamp after browser verification",
        ],
      );
      assert.deepEqual(
        audits.rows.map((row) => row.original_punch_id),
        [correction.original.id, correction.changedPunchId],
      );
      for (const audit of audits.rows) {
        assert.equal(audit.old_values.attendanceDate, correction.row.date);
      }
      return {
        correctionAudits: audits.rows.length,
        allOriginalFileTimestampsRestored: true,
      };
    },
  );
  await step("Render the import on a mobile viewport", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const drawer = page.locator('[data-slot="drawer-content"]');
    await drawer.waitFor();
    await page.getByRole("button", { name: "Next rows", exact: true }).click();
    await page
      .getByRole("button", { name: "Previous rows", exact: true })
      .click();
    const width = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    report.mobileLayout = width;
    assert(
      width.document <= width.viewport + 1,
      "The import must not overflow the mobile document",
    );
    await page
      .getByLabel("Device report", { exact: true })
      .scrollIntoViewIfNeeded();
    assert(await page.getByLabel("Device report", { exact: true }).isVisible());
    await screenshot("08-mobile-import");
    return width;
  });
  assert.deepEqual(
    report.pageErrors,
    [],
    "The browser encountered uncaught JavaScript errors",
  );
  assert.deepEqual(
    report.failedResponses,
    [],
    "Authenticated app requests failed",
  );
  const finalCounts = await counts();
  assert.equal(finalCounts.punches, 138);
  assert.equal(finalCounts.claims, 138);
  report.finalDatabase = finalCounts;
  await context.tracing.stop({ path: path.join(runDirectory, "trace.zip") });
  tracing = false;
  // Preserve uploader/audit FKs, but revoke this test-only identity after use.
  await pool.query("DELETE FROM session WHERE user_id=$1", [
    credentials.userId,
  ]);
  await pool.query(
    "UPDATE public.user SET banned=true,ban_reason=$1 WHERE id=$2 AND email=$3",
    ["Local headless test completed", credentials.userId, credentials.email],
  );
  report.testLoginRevoked = true;
  report.passed = true;
}

(async () => {
  try {
    await main();
  } catch (error) {
    const safeMessage = String(error.message).replace(
      /([?&]password=)[^&\s"]+/g,
      "$1[REDACTED]",
    );
    console.error(safeMessage);
    report.failure = {
      message: safeMessage,
      stack: String(error.stack).replace(
        /([?&]password=)[^&\s"]+/g,
        "$1[REDACTED]",
      ),
      url: page?.url().replace(/([?&]password=)[^&\s"]+/g, "$1[REDACTED]"),
    };
    if (page && !page.isClosed()) {
      await screenshot("failure").catch(() => {});
      report.failure.visibleText = (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 12000);
    }
    process.exitCode = 1;
  } finally {
    if (tracing)
      await context.tracing
        .stop({ path: path.join(runDirectory, "trace.zip") })
        .catch(() => {});
    await browser?.close();
    await pool.end();
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(runDirectory, { recursive: true });
    await writeReport();
    console.log("BROWSER_REPORT " + path.join(runDirectory, "results.json"));
  }
})();

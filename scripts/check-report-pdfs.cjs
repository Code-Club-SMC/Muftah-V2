// Optional QA tool. Requires a local Playwright installation and Chrome, not app dependencies.
// REPORT_BROWSER_MODULE=/path/to/playwright node scripts/check-report-pdfs.cjs /tmp/report-fixtures
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.REPORT_BROWSER_MODULE || "playwright");

async function main() {
  const directory = path.resolve(
    process.argv[2] || "/tmp/titan-report-fixtures",
  );
  if (!fs.existsSync(path.join(directory, "report-app.css")))
    throw new Error(
      "Missing report-app.css. Copy the current production styles before inspecting PDFs.",
    );
  const browser = await chromium.launch({
    executablePath: process.env.REPORT_CHROME || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const results = { browser: browser.version(), reports: [] };
  try {
    for (const file of fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".html"))
      .sort()) {
      const page = await browser.newPage({
        viewport: { width: 1047, height: 720 },
      });
      await page.goto(pathToFileURL(path.join(directory, file)).href);
      await page.emulateMedia({ media: "print" });
      await page.evaluate(() => document.fonts.ready);
      if (
        !(await page.evaluate(() =>
          [...document.styleSheets].some((sheet) =>
            sheet.href?.endsWith("report-app.css"),
          ),
        ))
      )
        throw new Error(`App stylesheet failed to load: ${file}`);
      const checks = await page.evaluate(() => {
        const visible = (node) =>
          node.getBoundingClientRect().width > 0 &&
          node.getBoundingClientRect().height > 0;
        const cells = [...document.querySelectorAll("th, td")].filter(visible);
        const numericCells = cells.filter(
          (node) =>
            node.classList.contains("text-right") ||
            node.dataset.reportNumeric === "true",
        );
        return {
          bodyWidth: document.body.scrollWidth,
          viewportWidth: innerWidth,
          rows: [...document.querySelectorAll("tbody tr")].filter(visible)
            .length,
          smallestTableFontPt: cells.length
            ? Math.min(
                ...cells.map(
                  (node) => parseFloat(getComputedStyle(node).fontSize) * 0.75,
                ),
              )
            : null,
          misalignedNumericCells: numericCells.filter(
            (node) => getComputedStyle(node).textAlign !== "right",
          ).length,
          overflowingCells: cells
            .filter((node) => node.scrollWidth > node.clientWidth + 2)
            .map((node) => node.textContent.slice(0, 100)),
          recordIds: [
            ...new Set(document.body.innerText.match(/ROW-\d{3}/g) || []),
          ],
          warningVisible: [...document.querySelectorAll('[role="alert"]')].some(
            (node) =>
              visible(node) &&
              /incomplete|unposted|waiting to be posted/i.test(
                node.textContent,
              ),
          ),
        };
      });
      await page.pdf({
        path: path.join(directory, file.replace(/\.html$/, ".pdf")),
        preferCSSPageSize: true,
        printBackground: true,
      });
      results.reports.push({ file, ...checks });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(directory, "browser-checks.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${results.browser}: generated ${results.reports.length} PDFs in ${directory}`,
  );
  const failures = results.reports.filter(
    (report) =>
      report.bodyWidth > report.viewportWidth + 2 ||
      (report.smallestTableFontPt !== null && report.smallestTableFontPt < 9) ||
      report.misalignedNumericCells ||
      report.overflowingCells.length ||
      report.recordIds.length !==
        Number(report.file.match(/-(\d+)\.html$/)?.[1]),
  );
  if (failures.length) {
    console.error(
      "Layout checks need attention:",
      failures.map((report) => report.file).join(", "),
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

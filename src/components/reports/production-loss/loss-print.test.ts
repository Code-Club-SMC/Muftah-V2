import { describe, expect, it } from "vitest";
import type { LossPrintData } from "@/server-functions/reports/production-loss-fn";
import { productionLossPrintHtml } from "./loss-print";

const data: LossPrintData = {
  tab: "batch", dateFrom: "2026-10-01", dateTo: "2026-10-29", filtersText: "Product All · Formula All · Reason All",
  summary: [{ label: "Loss cost", value: "Rs 33,115" }],
  columns: [
    { key: "date", label: "Date", numeric: false, percent: false },
    { key: "percent", label: "Loss %", numeric: true, percent: true },
    { key: "reason", label: "Reason", numeric: false, percent: false },
  ],
  rows: [
    { over: true, cells: ["12 Oct 2026", "20.0%", 'Spill · "<seal>"'] },
    { over: false, cells: ["13 Oct 2026", "2.0%", "Moisture loss"] },
  ],
  totals: ["Total", "8.0%", ""],
};
const html = productionLossPrintHtml(data, new Date("2026-10-29T10:40:00Z"), "https://erp.test");

describe("production loss print", () => {
  it("prints A4 landscape with repeating headers and unsplit rows", () => {
    expect(html).toContain("@page { size: A4 landscape;");
    expect(html).toContain("thead { display: table-header-group; }");
    expect(html).toContain("tr { break-inside: avoid; }");
    expect(html).toContain("counter(page)");
  });
  it("repeats the print time in every page footer", () => {
    expect(html).toMatch(/@bottom-left \{ content: "Printed [^"]+"/);
  });
  it("has the title, range, filters, summary and logo", () => {
    expect(html).toContain("Production Loss Report · Batch loss");
    expect(html).toContain("1 Oct – 29 Oct 2026");
    expect(html).toContain("Filters: Product All · Formula All · Reason All");
    expect(html).toContain("Rs 33,115");
    expect(html).toContain('src="https://erp.test/company-logo.svg"');
  });
  it("escapes cell text", () => {
    expect(html).toContain("Spill · &quot;&lt;seal&gt;&quot;");
    expect(html).not.toContain("<seal>");
  });
  it("marks over-limit rows bold red with a triangle before the loss %", () => {
    expect(html).toMatch(/<tr class="over">[\s\S]*?<td class="num">▲20\.0%<\/td>/);
    expect(html).not.toContain("▲2.0%");
  });
  it("ends the table with a total row and has signature lines", () => {
    expect(html).toMatch(/<tfoot><tr class="total"><td>Total<\/td><td class="num">8\.0%<\/td><td><\/td><\/tr><\/tfoot>/);
    for (const text of ["Prepared by", "Approved by (name and signature)", "Date"]) expect(html).toContain(text);
  });
});

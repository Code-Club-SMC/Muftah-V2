import { readFile } from "node:fs/promises";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { parseDevicePunchReport } from "./parser.server";

const HEADERS = [
  "Person ID",
  "Person Name",
  "Department",
  "Date",
  "Weekday",
  "No. of Punch(s)",
  "Punch Records",
];
const encode = (value: string) => new TextEncoder().encode(value);
const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const textCell = (ref: string, value: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
const numberCell = (ref: string, value: number) =>
  `<c r="${ref}"><v>${value}</v></c>`;
const headerRow = `<row r="1">${HEADERS.map((value, index) => textCell(`${String.fromCharCode(65 + index)}1`, value)).join("")}</row>`;
const standardCells = () => [
  textCell("A2", "00112"),
  textCell("B2", "Worker"),
  textCell("C2", "Factory"),
  numberCell("D2", 46296),
  textCell("E2", "Thu"),
  numberCell("F2", 1),
  numberCell("G2", 0.2736111111111112),
];

async function workbook(
  input: {
    cells?: string[];
    date1904?: boolean;
    worksheet?: string;
    extras?: Record<string, string>;
  } = {},
) {
  const parts = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${input.date1904 ? 1 : 0}"/><sheets><sheet name="Total Punches" sheetId="1" r:id="report"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="report" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/report.xml"/></Relationships>',
    "xl/worksheets/report.xml":
      input.worksheet ??
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${headerRow}<row r="2">${(input.cells ?? standardCells()).join("")}</row></sheetData></worksheet>`,
    ...input.extras,
  };
  const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const [name, xml] of Object.entries(parts))
    await zip.add(name, new TextReader(xml));
  return zip.close();
}

function csv(...rows: string[]) {
  return encode([HEADERS.join(","), ...rows].join("\r\n"));
}

describe("device Total Punches parser", () => {
  it("accepts a sparse XLSX zero-punch row with the blank final cell omitted", async () => {
    const cells = standardCells().slice(0, 6);
    cells[5] = numberCell("F2", 0);
    const result = await parseDevicePunchReport(await workbook({ cells }));
    expect(result.rows[0]).toMatchObject({
      punches: [],
      reportedCount: 0,
      issues: [],
    });
  });
  it("sniffs the exact client workbook despite its original .csv name", async () => {
    // Exact client bytes copied from docs/Total Punches(20261001-20261014).csv.
    const bytes = await readFile(
      "src/__tests__/fixtures/device-attendance/total-punches.xlsx",
    );
    const result = await parseDevicePunchReport(bytes);
    expect(result.format).toBe("xlsx");
    expect(result.rows).toHaveLength(52);
    expect(result.rows.reduce((n, row) => n + row.punches.length, 0)).toBe(138);
    expect(new Set(result.rows.map((row) => row.personId)).size).toBe(6);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 3,
      personId: "112009",
      date: "2026-10-01",
      punches: ["07:29", "17:48"],
      issues: [],
    });
    expect(result.rows.find((row) => row.rowNumber === 9)?.punches).toEqual([
      "06:34",
    ]);
    expect(result.rows.flatMap((row) => row.issues)).toEqual([]);
  });

  it("reads BOM CSV, title rows, quoted punch lists, escaped quotes, and embedded newlines", async () => {
    const result = await parseDevicePunchReport(
      encode(
        "\ufeffTotal Punches\r\n" +
          HEADERS.join(",") +
          '\r\n00112,"Worker, ""A""\nTeam",Factory,2026-10-01,Thu,4,"07:30, 12:00, 13:00, 17:45"\r\n',
      ),
    );
    expect(result.format).toBe("csv");
    expect(result.rows).toEqual([
      {
        rowNumber: 3,
        personId: "00112",
        personName: 'Worker, "A"\nTeam',
        department: "Factory",
        date: "2026-10-01",
        reportedCount: 4,
        punches: ["07:30", "12:00", "13:00", "17:45"],
        issues: [],
      },
    ]);
  });

  it("preserves text IDs and decodes numeric Excel date and minute fractions", async () => {
    const result = await parseDevicePunchReport(await workbook());
    expect(result.rows[0]).toMatchObject({
      personId: "00112",
      date: "2026-10-01",
      punches: ["06:34"],
      issues: [],
    });
  });

  it("supports the 1904 date system including its day zero", async () => {
    const cells = standardCells();
    cells[3] = numberCell("D2", 0);
    const result = await parseDevicePunchReport(
      await workbook({ cells, date1904: true }),
    );
    expect(result.rows[0].date).toBe("1904-01-01");
    expect(result.rows[0].issues).toEqual([]);
  });

  it("decodes rich shared strings and skips phonetic annotations", async () => {
    const cells = standardCells();
    cells[0] = '<c r="A2" t="s"><v>0</v></c>';
    const result = await parseDevicePunchReport(
      await workbook({
        cells,
        extras: {
          "xl/sharedStrings.xml":
            "<sst><si><r><t>001</t></r><r><t>12</t></r><rPh><t>annotation</t></rPh></si></sst>",
        },
      }),
    );
    expect(result.rows[0]).toMatchObject({ personId: "00112", issues: [] });
  });

  it("reports malformed numeric cell literals without accepting JavaScript number syntax", async () => {
    const cells = standardCells();
    cells[3] = '<c r="D2"><v>0xB4D8</v></c>';
    cells[6] = '<c r="G2"><v>0x0</v></c>';
    const row = (await parseDevicePunchReport(await workbook({ cells })))
      .rows[0];
    expect(row.date).toBeNull();
    expect(row.punches).toEqual([]);
    expect(row.issues.join(" ")).toMatch(/date/);
    expect(row.issues.join(" ")).toMatch(/time/);
  });

  it.each([
    [59, "1900-02-28"],
    [61, "1900-03-01"],
  ])(
    "decodes real dates around Excel's phantom leap day %i",
    async (serial, date) => {
      const cells = standardCells();
      cells[3] = numberCell("D2", serial as number);
      expect(
        (await parseDevicePunchReport(await workbook({ cells }))).rows[0].date,
      ).toBe(date);
    },
  );

  it.each([60, -1, 46296.5, Number.MAX_VALUE])(
    "reports invalid Excel serial %s as a row issue",
    async (serial) => {
      const cells = standardCells();
      cells[3] = numberCell("D2", serial);
      const row = (await parseDevicePunchReport(await workbook({ cells })))
        .rows[0];
      expect(row.date).toBeNull();
      expect(row.issues.join(" ")).toMatch(/date/i);
    },
  );

  it("keeps invalid rows visible with date, time, count and missing-ID issues", async () => {
    const result = await parseDevicePunchReport(
      csv(',Worker,Factory,2026-02-30,Mon,3,"07:30, 24:00, junk"'),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].date).toBeNull();
    expect(result.rows[0].issues.join(" ")).toMatch(/person id/i);
    expect(result.rows[0].issues.join(" ")).toMatch(/date/i);
    expect(result.rows[0].issues.join(" ")).toMatch(/time|punch/i);
    expect(result.rows[0].issues.join(" ")).toMatch(/count/i);
  });

  it("flags both duplicate person/day rows and duplicate or unordered times", async () => {
    const result = await parseDevicePunchReport(
      csv(
        '1,Worker,Factory,2026-10-01,Thu,3,"09:00, 08:00, 08:00"',
        "1,Worker,Factory,2026-10-01,Thu,1,17:00",
      ),
    );
    expect(
      result.rows.every((row) =>
        /duplicate.*date|duplicate.*day/i.test(row.issues.join(" ")),
      ),
    ).toBe(true);
    expect(result.rows[0].issues.join(" ")).toMatch(
      /duplicate.*punch|duplicate.*time/i,
    );
    expect(result.rows[0].issues.join(" ")).toMatch(/order/i);
  });

  it.each(["2026-2-01", "01/10/2026", "2026-13-01", "0000-01-01"])(
    "rejects noncanonical or invalid date %s",
    async (date) => {
      const result = await parseDevicePunchReport(
        csv(`1,Worker,Factory,${date},Thu,1,07:30`),
      );
      expect(result.rows[0].date).toBeNull();
      expect(result.rows[0].issues.join(" ")).toMatch(/date/i);
    },
  );

  it.each(["7:30", "12:60", "12:30:01", "12:30:00", "0.5"])(
    "rejects non-minute CSV time %s",
    async (time) => {
      const result = await parseDevicePunchReport(
        csv(`1,Worker,Factory,2026-10-01,Thu,1,${time}`),
      );
      expect(result.rows[0].issues.join(" ")).toMatch(/time|punch/i);
    },
  );

  it.each([1, -0.1, 0.5000115740740741])(
    "does not wrap or truncate invalid numeric time %s",
    async (time) => {
      const cells = standardCells();
      cells[6] = numberCell("G2", time);
      const result = await parseDevicePunchReport(await workbook({ cells }));
      expect(result.rows[0].issues.join(" ")).toMatch(/time|punch/i);
    },
  );

  it("rejects actual worksheet formulas regardless of cached result", async () => {
    const cells = standardCells();
    cells[6] = '<c r="G2"><f>1/2</f><v>0.5</v></c>';
    await expect(
      parseDevicePunchReport(await workbook({ cells })),
    ).rejects.toThrow(/formula/i);
  });

  it.each(["=HYPERLINK(1)", "+SUM(A1)", "-1+2", "@SUM(A1)"])(
    "blocks CSV formula input %s",
    async (formula) => {
      const result = await parseDevicePunchReport(
        csv(`1,${formula},Factory,2026-10-01,Thu,1,07:30`),
      );
      expect(result.rows[0].issues.join(" ")).toMatch(/formula/i);
    },
  );

  it("reports inconsistent or invalid counts and malformed row widths", async () => {
    const result = await parseDevicePunchReport(
      csv(
        "1,Worker,Factory,2026-10-01,Thu,2,07:30",
        "2,Worker,Factory,2026-10-01,Thu,-1,07:30",
        "3,Worker,Factory,2026-10-01,Thu,1,07:30,unexpected",
      ),
    );
    expect(result.rows[0].issues.join(" ")).toMatch(/count/i);
    expect(result.rows[1].reportedCount).toBeNull();
    expect(result.rows[1].issues.join(" ")).toMatch(/count/i);
    expect(result.rows[2].issues.join(" ")).toMatch(/column|field/i);
  });

  it.each(['"unterminated', '1,"Worker"oops,Factory,2026-10-01,Thu,1,07:30'])(
    "rejects structurally invalid CSV",
    async (row) => {
      await expect(parseDevicePunchReport(csv(row))).rejects.toThrow(/CSV/i);
    },
  );

  it("rejects unsupported content, missing headers, empty reports and invalid UTF-8", async () => {
    await expect(parseDevicePunchReport(new Uint8Array())).rejects.toThrow(
      /empty|size/i,
    );
    await expect(
      parseDevicePunchReport(encode("<html>report</html>")),
    ).rejects.toThrow(/header|format|CSV/i);
    await expect(parseDevicePunchReport(csv())).rejects.toThrow(/data|rows/i);
    await expect(
      parseDevicePunchReport(new Uint8Array([0xff, 0xfe])),
    ).rejects.toThrow(/UTF-8|format/i);
    await expect(
      parseDevicePunchReport(encode("PK\u0003\u0004garbage")),
    ).rejects.toThrow(/XLSX/i);
  });

  it("enforces 10 MiB, 20,000 data rows, field lengths, and worksheet bounds", async () => {
    await expect(
      parseDevicePunchReport(new Uint8Array(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow(/size|large/i);
    await expect(
      parseDevicePunchReport(
        csv(
          ...Array.from(
            { length: 20_001 },
            (_, i) => `${i},Worker,Factory,2026-10-01,Thu,1,07:30`,
          ),
        ),
      ),
    ).rejects.toThrow(/rows/i);
    await expect(
      parseDevicePunchReport(
        csv(`1,${"x".repeat(4097)},Factory,2026-10-01,Thu,1,07:30`),
      ),
    ).rejects.toThrow(/cell|field|long/i);
    await expect(
      parseDevicePunchReport(
        await workbook({
          worksheet: `<worksheet><sheetData>${headerRow}<row r="1000000">${textCell("A1000000", "1")}</row></sheetData></worksheet>`,
        }),
      ),
    ).rejects.toThrow(/row|bound/i);
  });

  it("accepts exactly 20,000 daily records", async () => {
    const result = await parseDevicePunchReport(
      csv(
        ...Array.from(
          { length: 20_000 },
          (_, i) => `${i},Worker,Factory,2026-10-01,Thu,1,07:30`,
        ),
      ),
    );
    expect(result.rows).toHaveLength(20_000);
    expect(result.rows.at(-1)?.issues).toEqual([]);
  });

  it("rejects invalid shared-string indices and duplicate worksheet cell references", async () => {
    const cells = standardCells();
    cells[0] = '<c r="A2" t="s"><v>7</v></c>';
    await expect(
      parseDevicePunchReport(await workbook({ cells })),
    ).rejects.toThrow(/shared string/i);
    await expect(
      parseDevicePunchReport(
        await workbook({
          cells: [...standardCells(), textCell("A2", "other")],
        }),
      ),
    ).rejects.toThrow(/duplicate cell/i);
  });

  it("uses the shared package guard and rejects malicious XML", async () => {
    await expect(
      parseDevicePunchReport(
        await workbook({ extras: { "xl/vbaProject.bin": "bad" } }),
      ),
    ).rejects.toThrow(/forbidden/i);
    await expect(
      parseDevicePunchReport(
        await workbook({
          extras: {
            "xl/_rels/sheet.xml.rels":
              '<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>',
          },
        }),
      ),
    ).rejects.toThrow(/external/i);
    await expect(
      parseDevicePunchReport(
        await workbook({
          worksheet:
            '<!DOCTYPE worksheet [<!ENTITY x "bad">]><worksheet>&x;</worksheet>',
        }),
      ),
    ).rejects.toThrow(/document type|XML/i);
  });
});

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OFFLINE_TEMPLATE_VERSION,
  OFFLINE_WORKBOOK_ROW_CAPACITY,
} from "./constants";
import { createRecordToken } from "./signing.server";
import { buildOfflineAttendanceWorkbook } from "./workbook-template.server";
import { parseOfflineAttendanceWorkbook } from "./workbook-parser.server";

const TEST_KEY = Buffer.alloc(32, 13).toString("base64");
const BASE_INPUT = {
  workbookId: "wb-parse",
  operatorUserId: "operator-parse",
  operatorName: "Parser Operator",
  templateVersion: OFFLINE_TEMPLATE_VERSION,
  rowCapacity: OFFLINE_WORKBOOK_ROW_CAPACITY,
  signingVersion: 1,
  issuedAt: "2026-08-03T10:00:00.000Z",
};

type PartMutator = (parts: Map<string, string>) => void;

function inlineCell(ref: string, style: number, value: string) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function numericCell(ref: string, style: number, value: number) {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function excelDateSerial(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000 + 25_569);
}

async function readParts(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    const parts = new Map<string, string>();
    for (const entry of entries) {
      if (entry.directory) continue;
      const data = await entry.getData(new Uint8ArrayWriter());
      parts.set(entry.filename, new TextDecoder().decode(data));
    }
    return parts;
  } finally {
    await reader.close().catch(() => undefined);
  }
}

async function rewriteWorkbook(bytes: Uint8Array, mutator: PartMutator) {
  const parts = await readParts(bytes);
  mutator(parts);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, content] of parts) {
    await writer.add(name, new TextReader(content));
  }
  return await writer.close();
}

function replaceCell(xml: string, ref: string, replacement: string) {
  const pattern = new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>.*?</c>`);
  if (!pattern.test(xml)) throw new Error(`Missing cell ${ref}`);
  return xml.replace(pattern, replacement);
}

function fillRow(
  xml: string,
  values: {
    row?: number;
    employeeCode?: string;
    date?: string;
    time?: string;
    direction?: string;
    note?: string;
    numericDate?: number;
    numericTime?: number;
  },
) {
  const row = values.row ?? 2;
  let next = xml;
  if (values.employeeCode !== undefined) {
    next = replaceCell(next, `A${row}`, inlineCell(`A${row}`, 1, values.employeeCode));
  }
  if (values.numericDate !== undefined) {
    next = replaceCell(next, `B${row}`, numericCell(`B${row}`, 2, values.numericDate));
  } else if (values.date !== undefined) {
    next = replaceCell(next, `B${row}`, inlineCell(`B${row}`, 2, values.date));
  }
  if (values.numericTime !== undefined) {
    next = replaceCell(next, `C${row}`, numericCell(`C${row}`, 3, values.numericTime));
  } else if (values.time !== undefined) {
    next = replaceCell(next, `C${row}`, inlineCell(`C${row}`, 3, values.time));
  }
  if (values.direction !== undefined) {
    next = replaceCell(next, `D${row}`, inlineCell(`D${row}`, 1, values.direction));
  }
  if (values.note !== undefined) {
    next = replaceCell(next, `E${row}`, inlineCell(`E${row}`, 1, values.note));
  }
  return next;
}

describe("offline attendance workbook parser", () => {
  const originalEnvironment = {
    enabled: process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED,
    keys: process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS,
    activeVersion: process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION,
  };
  let baseBytes: Uint8Array;

  beforeAll(async () => {
    process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED = "true";
    process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS = JSON.stringify({
      "1": TEST_KEY,
    });
    process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION = "1";
    baseBytes = await buildOfflineAttendanceWorkbook(BASE_INPUT);
  });

  afterAll(() => {
    if (originalEnvironment.enabled === undefined) {
      delete process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED;
    } else {
      process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED =
        originalEnvironment.enabled;
    }

    if (originalEnvironment.keys === undefined) {
      delete process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS;
    } else {
      process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS = originalEnvironment.keys;
    }

    if (originalEnvironment.activeVersion === undefined) {
      delete process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION;
    } else {
      process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION =
        originalEnvironment.activeVersion;
    }
  });

  it("parses a generated workbook and ignores blank prepared rows", async () => {
    const parsed = await parseOfflineAttendanceWorkbook(baseBytes);
    expect(parsed.manifest).toMatchObject({
      workbookId: BASE_INPUT.workbookId,
      operatorUserId: BASE_INPUT.operatorUserId,
      rowCapacity: OFFLINE_WORKBOOK_ROW_CAPACITY,
    });
    expect(parsed.fileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.rows).toEqual([]);
  });

  it("parses valid literal rows", async () => {
    const bytes = await rewriteWorkbook(baseBytes, (parts) => {
      parts.set(
        "xl/worksheets/sheet2.xml",
        fillRow(parts.get("xl/worksheets/sheet2.xml") ?? "", {
          employeeCode: "EMP-001",
          date: "2026-08-03",
          time: "08:05",
          direction: "IN",
          note: "Line started",
        }),
      );
    });

    const parsed = await parseOfflineAttendanceWorkbook(bytes);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      worksheetRowNumber: 2,
      rawEmployeeCode: "EMP-001",
      rawDate: "2026-08-03",
      rawTime: "08:05",
      rawDirection: "IN",
      rawNote: "Line started",
      normalizedTimestamp: "2026-08-03T08:05:00+05:00",
      parseIssues: [],
    });
  });

  it("keeps partially filled rows as invalid attempts", async () => {
    const bytes = await rewriteWorkbook(baseBytes, (parts) => {
      parts.set(
        "xl/worksheets/sheet2.xml",
        fillRow(parts.get("xl/worksheets/sheet2.xml") ?? "", {
          employeeCode: "EMP-002",
        }),
      );
    });

    const parsed = await parseOfflineAttendanceWorkbook(bytes);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].parseIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing_date", "missing_time", "missing_direction"]),
    );
  });

  it("normalizes Excel numeric date and time values", async () => {
    const bytes = await rewriteWorkbook(baseBytes, (parts) => {
      parts.set(
        "xl/worksheets/sheet2.xml",
        fillRow(parts.get("xl/worksheets/sheet2.xml") ?? "", {
          employeeCode: "EMP-003",
          numericDate: excelDateSerial("2026-08-03"),
          numericTime: 8 / 24 + 5 / 1440,
          direction: "OUT",
        }),
      );
    });

    const parsed = await parseOfflineAttendanceWorkbook(bytes);
    expect(parsed.rows[0]).toMatchObject({
      rawDate: String(excelDateSerial("2026-08-03")),
      rawTime: String(8 / 24 + 5 / 1440),
      normalizedTimestamp: "2026-08-03T08:05:00+05:00",
    });
  });

  it.each([
    ["invalid_time", { time: "08:05:30" }],
    ["invalid_time", { time: "8:05 AM" }],
    ["future_date", { date: "2099-01-01" }],
    ["note_too_long", { note: "x".repeat(501) }],
    ["invalid_direction", { direction: "SIDEWAYS" }],
  ])("captures row issue %s", async (issueCode, override) => {
    const bytes = await rewriteWorkbook(baseBytes, (parts) => {
      parts.set(
        "xl/worksheets/sheet2.xml",
        fillRow(parts.get("xl/worksheets/sheet2.xml") ?? "", {
          employeeCode: "EMP-004",
          date: "2026-08-03",
          time: "08:05",
          direction: "IN",
          ...override,
        }),
      );
    });

    const parsed = await parseOfflineAttendanceWorkbook(bytes);
    expect(parsed.rows[0].parseIssues.map((issue) => issue.code)).toContain(
      issueCode,
    );
  });

  it.each([
    ["changed headers", (xml: string) => xml.replace("Employee Code", "Employee")],
    ["formula cells", (xml: string) => replaceCell(xml, "A2", '<c r="A2" s="1"><f>1+1</f><v>EMP-001</v></c>')],
    ["hyperlinks", (xml: string) => xml.replace("</worksheet>", '<hyperlinks><hyperlink ref="A2" location="A1"/></hyperlinks></worksheet>')],
  ])("rejects unsafe worksheet content: %s", async (_name, mutate) => {
    const bytes = await rewriteWorkbook(baseBytes, (parts) => {
      parts.set("xl/worksheets/sheet2.xml", mutate(parts.get("xl/worksheets/sheet2.xml") ?? ""));
    });

    await expect(parseOfflineAttendanceWorkbook(bytes)).rejects.toThrow();
  });

  it("rejects changed sheet order or names", async () => {
    const bytes = await rewriteWorkbook(baseBytes, (parts) => {
      parts.set(
        "xl/workbook.xml",
        (parts.get("xl/workbook.xml") ?? "").replace('name="Attendance"', 'name="Data"'),
      );
    });

    await expect(parseOfflineAttendanceWorkbook(bytes)).rejects.toThrow(
      "Workbook sheets do not match",
    );
  });

  it("rejects invalid manifest signatures and moved tokens", async () => {
    const badSignature = await rewriteWorkbook(baseBytes, (parts) => {
      parts.set(
        "xl/worksheets/sheet3.xml",
        (parts.get("xl/worksheets/sheet3.xml") ?? "").replace(
          /<c r="B9"[^>]*><is><t>[^<]+<\/t><\/is><\/c>/,
          inlineCell("B9", 4, "bad-signature"),
        ),
      );
    });
    await expect(parseOfflineAttendanceWorkbook(badSignature)).rejects.toThrow(
      "Invalid workbook manifest signature",
    );

    const movedToken = await rewriteWorkbook(baseBytes, (parts) => {
      const wrongToken = createRecordToken({
        workbookId: BASE_INPUT.workbookId,
        operatorUserId: BASE_INPUT.operatorUserId,
        templateVersion: BASE_INPUT.templateVersion,
        signingVersion: BASE_INPUT.signingVersion,
        rowNumber: 3,
      });
      parts.set(
        "xl/worksheets/sheet2.xml",
        replaceCell(parts.get("xl/worksheets/sheet2.xml") ?? "", "G2", inlineCell("G2", 4, wrongToken)),
      );
    });
    await expect(parseOfflineAttendanceWorkbook(movedToken)).rejects.toThrow(
      "Invalid record token",
    );
  });

  it("rejects wrong operator tokens and rows beyond capacity", async () => {
    const wrongOperator = await rewriteWorkbook(baseBytes, (parts) => {
      const wrongToken = createRecordToken({
        workbookId: BASE_INPUT.workbookId,
        operatorUserId: "other-operator",
        templateVersion: BASE_INPUT.templateVersion,
        signingVersion: BASE_INPUT.signingVersion,
        rowNumber: 2,
      });
      parts.set(
        "xl/worksheets/sheet2.xml",
        replaceCell(parts.get("xl/worksheets/sheet2.xml") ?? "", "G2", inlineCell("G2", 4, wrongToken)),
      );
    });
    await expect(parseOfflineAttendanceWorkbook(wrongOperator)).rejects.toThrow(
      "Invalid record token",
    );

    const tooManyRows = await rewriteWorkbook(baseBytes, (parts) => {
      const rowNumber = OFFLINE_WORKBOOK_ROW_CAPACITY + 2;
      const token = createRecordToken({
        workbookId: BASE_INPUT.workbookId,
        operatorUserId: BASE_INPUT.operatorUserId,
        templateVersion: BASE_INPUT.templateVersion,
        signingVersion: BASE_INPUT.signingVersion,
        rowNumber,
      });
      const extraRow = `<row r="${rowNumber}">${inlineCell(`A${rowNumber}`, 1, "EMP-999")}${inlineCell(`B${rowNumber}`, 2, "2026-08-03")}${inlineCell(`C${rowNumber}`, 3, "08:05")}${inlineCell(`D${rowNumber}`, 1, "IN")}${inlineCell(`G${rowNumber}`, 4, token)}</row>`;
      parts.set(
        "xl/worksheets/sheet2.xml",
        (parts.get("xl/worksheets/sheet2.xml") ?? "").replace("</sheetData>", `${extraRow}</sheetData>`),
      );
    });
    await expect(parseOfflineAttendanceWorkbook(tooManyRows)).rejects.toThrow(
      "too many used rows",
    );
  });
});

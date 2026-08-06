import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OFFLINE_WORKBOOK_ROW_CAPACITY,
  OFFLINE_TEMPLATE_VERSION,
} from "./constants";
import { inspectXlsxPackage } from "./ooxml-guard.server";
import {
  buildOfflineAttendanceWorkbook,
  OFFLINE_ATTENDANCE_HEADERS,
} from "./workbook-template.server";
import { signWorkbookManifest, verifyRecordToken } from "./signing.server";

const TEST_KEY = Buffer.alloc(32, 11).toString("base64");

async function readWorkbookParts(bytes: Uint8Array) {
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

function inlineValue(xml: string, cell: string) {
  const match = xml.match(
    new RegExp(`<c r="${cell}"[^>]*><is><t>([^<]*)</t></is></c>`),
  );
  return match?.[1] ?? null;
}

function manifestFromSystemSheet(xml: string) {
  const rows = new Map<string, string>();
  for (let row = 2; row <= 9; row += 1) {
    const key = inlineValue(xml, `A${row}`);
    const value = inlineValue(xml, `B${row}`);
    if (key && value) rows.set(key, value);
  }
  return {
    format: rows.get("format"),
    workbookId: rows.get("workbookId") ?? "",
    operatorUserId: rows.get("operatorUserId") ?? "",
    templateVersion: Number(rows.get("templateVersion")),
    rowCapacity: Number(rows.get("rowCapacity")),
    signingVersion: Number(rows.get("signingVersion")),
    issuedAt: rows.get("issuedAt") ?? "",
    manifestSignature: rows.get("manifestSignature") ?? "",
  };
}

describe("offline attendance workbook template", () => {
  const originalEnvironment = {
    enabled: process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED,
    keys: process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS,
    activeVersion: process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION,
  };

  beforeEach(() => {
    process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED = "true";
    process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS = JSON.stringify({
      "1": TEST_KEY,
    });
    process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION = "1";
  });

  afterEach(() => {
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

  it("builds a guarded workbook with exact sheets, headers, and manifest", async () => {
    const bytes = await buildOfflineAttendanceWorkbook({
      workbookId: "wb-001",
      operatorUserId: "operator-001",
      operatorName: "Factory Operator",
      templateVersion: OFFLINE_TEMPLATE_VERSION,
      rowCapacity: OFFLINE_WORKBOOK_ROW_CAPACITY,
      signingVersion: 1,
      issuedAt: "2026-08-03T10:00:00.000Z",
    });

    await expect(inspectXlsxPackage(bytes)).resolves.toBeUndefined();

    const parts = await readWorkbookParts(bytes);
    const workbookXml = parts.get("xl/workbook.xml") ?? "";
    expect(workbookXml.match(/<sheet /g)).toHaveLength(3);
    expect(workbookXml).toContain('name="Instructions"');
    expect(workbookXml).toContain('name="Attendance"');
    expect(workbookXml).toContain('name="System"');
    expect(workbookXml).toContain('state="veryHidden"');

    const attendanceXml = parts.get("xl/worksheets/sheet2.xml") ?? "";
    const headers = OFFLINE_ATTENDANCE_HEADERS.map((header, index) =>
      inlineValue(attendanceXml, `${String.fromCharCode(65 + index)}1`),
    );
    expect(headers).toEqual(OFFLINE_ATTENDANCE_HEADERS.map((header) => header.header));

    const systemXml = parts.get("xl/worksheets/sheet3.xml") ?? "";
    const manifest = manifestFromSystemSheet(systemXml);
    expect(manifest).toMatchObject({
      format: "titan-offline-attendance",
      workbookId: "wb-001",
      operatorUserId: "operator-001",
      templateVersion: OFFLINE_TEMPLATE_VERSION,
      rowCapacity: OFFLINE_WORKBOOK_ROW_CAPACITY,
      signingVersion: 1,
      issuedAt: "2026-08-03T10:00:00.000Z",
    });
    expect(manifest.manifestSignature).toBe(
      signWorkbookManifest({
        format: "titan-offline-attendance",
        workbookId: "wb-001",
        operatorUserId: "operator-001",
        templateVersion: OFFLINE_TEMPLATE_VERSION,
        rowCapacity: OFFLINE_WORKBOOK_ROW_CAPACITY,
        signingVersion: 1,
        issuedAt: "2026-08-03T10:00:00.000Z",
      }),
    );
  });

  it("prepares 20,000 signed rows with unlocked input cells and hidden system cells", async () => {
    const bytes = await buildOfflineAttendanceWorkbook({
      workbookId: "wb-rows",
      operatorUserId: "operator-rows",
      operatorName: "Rows Operator",
      templateVersion: OFFLINE_TEMPLATE_VERSION,
      rowCapacity: OFFLINE_WORKBOOK_ROW_CAPACITY,
      signingVersion: 1,
      issuedAt: "2026-08-03T10:00:00.000Z",
    });
    const parts = await readWorkbookParts(bytes);
    const attendanceXml = parts.get("xl/worksheets/sheet2.xml") ?? "";
    const stylesXml = parts.get("xl/styles.xml") ?? "";

    expect(attendanceXml).toContain('<dimension ref="A1:G20001"/>');
    expect(attendanceXml.match(/<c r="G\d+" s="4" t="inlineStr">/g)).toHaveLength(
      OFFLINE_WORKBOOK_ROW_CAPACITY,
    );
    expect(attendanceXml).toContain('<c r="A2" s="1"/>');
    expect(attendanceXml).toContain('<c r="B2" s="2"/>');
    expect(attendanceXml).toContain('<c r="C2" s="3"/>');
    expect(attendanceXml).toContain('<c r="F2" s="4"><v>2</v></c>');
    expect(attendanceXml).toContain('<col min="6" max="7" width="18" hidden="1" customWidth="1"/>');

    expect(stylesXml).toContain('formatCode="yyyy-mm-dd"');
    expect(stylesXml).toContain('formatCode="hh:mm"');
    expect(stylesXml).toContain('<protection locked="0"/>');
    expect(stylesXml).toContain('<protection locked="1" hidden="1"/>');

    const firstToken = inlineValue(attendanceXml, "G2") ?? "";
    const lastToken = inlineValue(attendanceXml, "G20001") ?? "";
    expect(
      verifyRecordToken({
        workbookId: "wb-rows",
        operatorUserId: "operator-rows",
        templateVersion: OFFLINE_TEMPLATE_VERSION,
        signingVersion: 1,
        rowNumber: 2,
        token: firstToken,
      }),
    ).toBe(true);
    expect(
      verifyRecordToken({
        workbookId: "wb-rows",
        operatorUserId: "operator-rows",
        templateVersion: OFFLINE_TEMPLATE_VERSION,
        signingVersion: 1,
        rowNumber: 20_001,
        token: lastToken,
      }),
    ).toBe(true);
  });

  it("protects sheets, validates direction, and contains no formulas, links, macros, or employee list", async () => {
    const bytes = await buildOfflineAttendanceWorkbook({
      workbookId: "wb-safe",
      operatorUserId: "operator-safe",
      operatorName: "Safe Operator",
      templateVersion: OFFLINE_TEMPLATE_VERSION,
      rowCapacity: OFFLINE_WORKBOOK_ROW_CAPACITY,
      signingVersion: 1,
      issuedAt: "2026-08-03T10:00:00.000Z",
    });
    const parts = await readWorkbookParts(bytes);
    const allXml = Array.from(parts.values()).join("\n");
    const attendanceXml = parts.get("xl/worksheets/sheet2.xml") ?? "";

    expect(attendanceXml).toContain('sqref="D2:D20001"');
    expect(attendanceXml).toContain("<formula1>&quot;IN,OUT&quot;</formula1>");
    expect(attendanceXml).toContain("insertRows=\"1\"");
    expect(attendanceXml).toContain("deleteRows=\"1\"");
    expect(attendanceXml).toContain("sort=\"1\"");
    expect(allXml).not.toMatch(/<f(?:\s|>)/);
    expect(allXml).not.toMatch(/<hyperlink/i);
    expect(allXml).not.toMatch(/externalLink/i);
    expect(allXml).not.toMatch(/vbaProject/i);
    expect(allXml).not.toContain("Employee Name");
  });
});

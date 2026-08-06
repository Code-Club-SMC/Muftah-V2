import { createHash } from "node:crypto";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { SaxesParser, type SaxesTag } from "saxes";
import { nowPKTDate } from "../time";
import {
  OFFLINE_ATTENDANCE_WORKBOOK_FORMAT,
  type OfflineParseIssue,
  type ParsedOfflineRow,
  type ParsedOfflineWorkbook,
  type WorkbookManifest,
} from "./contracts";
import { OFFLINE_WORKBOOK_ROW_CAPACITY } from "./constants";
import { inspectXlsxPackage } from "./ooxml-guard.server";
import {
  hashOfflineRow,
  signWorkbookManifest,
  verifyRecordToken,
} from "./signing.server";
import { OFFLINE_ATTENDANCE_HEADERS } from "./workbook-template.server";

type ParsedCell = {
  ref: string;
  rowNumber: number;
  column: string;
  type: string | null;
  value: string;
};

type ParsedWorksheet = {
  cells: Map<string, ParsedCell>;
  rowNumbers: Set<number>;
};

type WorkbookSheet = {
  name: string;
  state: string | null;
  relationshipId: string;
};

class UnsafeOfflineWorkbookError extends Error {}

function reject(message: string): never {
  throw new UnsafeOfflineWorkbookError(message);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function attr(tag: SaxesTag, name: string) {
  for (const value of Object.values(tag.attributes)) {
    if (typeof value === "string") continue;
    if (value.local?.toLowerCase() === name.toLowerCase()) return value.value;
    if (value.name?.toLowerCase() === name.toLowerCase()) return value.value;
  }
  return null;
}

function localName(tag: SaxesTag) {
  return (tag.local ?? tag.name).toLowerCase();
}

function parseXml(xml: string, handlers: {
  onOpen?: (tag: SaxesTag) => void;
  onClose?: (tag: SaxesTag) => void;
  onText?: (text: string) => void;
}) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => reject("Workbook XML cannot contain a document type"));
  parser.on("opentag", (tag) => handlers.onOpen?.(tag));
  parser.on("closetag", (tag) => handlers.onClose?.(tag));
  parser.on("text", (text) => handlers.onText?.(text));
  parser.on("error", () => reject("Workbook XML is not valid"));
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof UnsafeOfflineWorkbookError) throw error;
    reject("Workbook XML is not valid");
  }
}

async function readXlsxParts(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: "strict",
    checkAmbiguity: true,
    maxAppendedDataSize: 0,
  });

  try {
    const entries = await reader.getEntries();
    const parts = new Map<string, string>();

    for (const entry of entries) {
      if (entry.directory) continue;
      const name = entry.filename;
      if (!name.toLowerCase().endsWith(".xml") && !name.toLowerCase().endsWith(".rels")) {
        continue;
      }
      const data = await entry.getData(new Uint8ArrayWriter());
      parts.set(name.toLowerCase(), new TextDecoder("utf-8", { fatal: true }).decode(data));
    }

    return parts;
  } catch (error) {
    if (error instanceof UnsafeOfflineWorkbookError) throw error;
    reject("Workbook XML is not valid UTF-8");
  } finally {
    await reader.close().catch(() => undefined);
  }
}

function requiredPart(parts: Map<string, string>, name: string) {
  const value = parts.get(name.toLowerCase());
  if (!value) reject(`Workbook is missing required part: ${name}`);
  return value;
}

function parseSharedStrings(parts: Map<string, string>) {
  const xml = parts.get("xl/sharedstrings.xml");
  if (!xml) return [];

  const values: string[] = [];
  let inString = false;
  let inText = false;
  let current = "";

  parseXml(xml, {
    onOpen(tag) {
      const local = localName(tag);
      if (local === "si") {
        inString = true;
        current = "";
      } else if (local === "r" && inString) {
        reject("Rich shared strings are not allowed");
      } else if (local === "t" && inString) {
        inText = true;
      }
    },
    onText(text) {
      if (inText) current += text;
    },
    onClose(tag) {
      const local = localName(tag);
      if (local === "t") inText = false;
      if (local === "si") {
        values.push(current);
        inString = false;
      }
    },
  });

  return values;
}

function parseCellRef(ref: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) reject("Worksheet contains an invalid cell reference");
  return {
    column: match[1],
    rowNumber: Number(match[2]),
  };
}

function parseWorksheet(xml: string, sharedStrings: string[]): ParsedWorksheet {
  const cells = new Map<string, ParsedCell>();
  const rowNumbers = new Set<number>();
  let currentCell: {
    ref: string;
    type: string | null;
    valueText: string;
    inlineText: string;
  } | null = null;
  let textTarget: "value" | "inline" | null = null;

  parseXml(xml, {
    onOpen(tag) {
      const local = localName(tag);
      if (local === "f") reject("Formula cells are not allowed");
      if (local === "hyperlink") reject("Worksheet hyperlinks are not allowed");
      if (local === "row") {
        const row = Number(attr(tag, "r"));
        if (Number.isSafeInteger(row)) rowNumbers.add(row);
      }
      if (local === "c") {
        const ref = attr(tag, "r");
        if (!ref) reject("Worksheet cell is missing reference");
        currentCell = {
          ref,
          type: attr(tag, "t"),
          valueText: "",
          inlineText: "",
        };
      } else if (currentCell && local === "v") {
        textTarget = "value";
      } else if (currentCell && local === "t") {
        textTarget = "inline";
      }
    },
    onText(text) {
      if (!currentCell || !textTarget) return;
      if (textTarget === "value") currentCell.valueText += text;
      if (textTarget === "inline") currentCell.inlineText += text;
    },
    onClose(tag) {
      const local = localName(tag);
      if (local === "v" || local === "t") textTarget = null;
      if (local !== "c" || !currentCell) return;

      const { column, rowNumber } = parseCellRef(currentCell.ref);
      const type = currentCell.type;
      let value = currentCell.valueText;

      if (type === "inlineStr") {
        value = currentCell.inlineText;
      } else if (type === "s") {
        const index = Number(currentCell.valueText);
        if (!Number.isSafeInteger(index) || sharedStrings[index] === undefined) {
          reject("Shared string reference is invalid");
        }
        value = sharedStrings[index];
      } else if (type && type !== "n") {
        reject("Unsupported worksheet cell type");
      }

      cells.set(currentCell.ref, {
        ref: currentCell.ref,
        rowNumber,
        column,
        type,
        value,
      });
      rowNumbers.add(rowNumber);
      currentCell = null;
    },
  });

  return { cells, rowNumbers };
}

function parseWorkbookSheets(xml: string) {
  const sheets: WorkbookSheet[] = [];
  parseXml(xml, {
    onOpen(tag) {
      if (localName(tag) !== "sheet") return;
      const name = attr(tag, "name");
      const relationshipId = attr(tag, "id");
      if (!name || !relationshipId) reject("Workbook sheet metadata is invalid");
      sheets.push({
        name,
        state: attr(tag, "state"),
        relationshipId,
      });
    },
  });
  return sheets;
}

function parseWorkbookRelationships(xml: string) {
  const relationships = new Map<string, string>();
  parseXml(xml, {
    onOpen(tag) {
      if (localName(tag) !== "relationship") return;
      const id = attr(tag, "id");
      const target = attr(tag, "target");
      if (id && target) relationships.set(id, target);
    },
  });
  return relationships;
}

function verifyExactSheets(parts: Map<string, string>) {
  const sheets = parseWorkbookSheets(requiredPart(parts, "xl/workbook.xml"));
  const relationships = parseWorkbookRelationships(
    requiredPart(parts, "xl/_rels/workbook.xml.rels"),
  );
  const expected = [
    { name: "Instructions", target: "worksheets/sheet1.xml" },
    { name: "Attendance", target: "worksheets/sheet2.xml" },
    { name: "System", target: "worksheets/sheet3.xml", state: "veryHidden" },
  ];

  if (sheets.length !== expected.length) {
    reject("Workbook sheets do not match offline attendance template");
  }

  for (const [index, sheet] of sheets.entries()) {
    const expectedSheet = expected[index];
    if (
      sheet.name !== expectedSheet.name ||
      (expectedSheet.state && sheet.state !== expectedSheet.state) ||
      relationships.get(sheet.relationshipId) !== expectedSheet.target
    ) {
      reject("Workbook sheets do not match offline attendance template");
    }
  }
}

function cellText(worksheet: ParsedWorksheet, ref: string) {
  return worksheet.cells.get(ref)?.value ?? "";
}

function readManifest(systemSheet: ParsedWorksheet): {
  manifest: WorkbookManifest;
  manifestSignature: string;
} {
  const values = new Map<string, string>();
  for (let row = 2; row <= 9; row += 1) {
    values.set(cellText(systemSheet, `A${row}`), cellText(systemSheet, `B${row}`));
  }

  const manifest: WorkbookManifest = {
    format: values.get("format") as WorkbookManifest["format"],
    workbookId: values.get("workbookId") ?? "",
    operatorUserId: values.get("operatorUserId") ?? "",
    templateVersion: Number(values.get("templateVersion")),
    rowCapacity: Number(values.get("rowCapacity")),
    signingVersion: Number(values.get("signingVersion")),
    issuedAt: values.get("issuedAt") ?? "",
  };
  const manifestSignature = values.get("manifestSignature") ?? "";

  if (
    manifest.format !== OFFLINE_ATTENDANCE_WORKBOOK_FORMAT ||
    !manifest.workbookId ||
    !manifest.operatorUserId ||
    !Number.isSafeInteger(manifest.templateVersion) ||
    !Number.isSafeInteger(manifest.rowCapacity) ||
    manifest.rowCapacity < 1 ||
    manifest.rowCapacity > OFFLINE_WORKBOOK_ROW_CAPACITY ||
    !Number.isSafeInteger(manifest.signingVersion) ||
    !manifest.issuedAt
  ) {
    reject("Workbook manifest is invalid");
  }

  if (signWorkbookManifest(manifest) !== manifestSignature) {
    reject("Invalid workbook manifest signature");
  }

  return { manifest, manifestSignature };
}

function verifyAttendanceHeaders(attendanceSheet: ParsedWorksheet) {
  const actual = OFFLINE_ATTENDANCE_HEADERS.map((_, index) =>
    cellText(attendanceSheet, `${String.fromCharCode(65 + index)}1`),
  );
  const expected = OFFLINE_ATTENDANCE_HEADERS.map((header) => header.header);
  if (actual.join("\0") !== expected.join("\0")) {
    reject("Attendance worksheet headers do not match template");
  }
}

function issue(code: string, message: string): OfflineParseIssue {
  return { code, message };
}

function isValidDateLiteral(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function excelDateToLiteral(value: number) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    return null;
  }
  const date = new Date((value - 25_569) * 86_400_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateCell(cell: ParsedCell | undefined) {
  const raw = (cell?.value ?? "").trim();
  if (!raw) return { raw, value: null, issue: issue("missing_date", "Date is required") };

  const numeric = cell?.type === null || cell?.type === "n";
  const normalized = numeric && /^-?\d+(?:\.\d+)?$/.test(raw)
    ? excelDateToLiteral(Number(raw))
    : raw;

  if (!normalized || !isValidDateLiteral(normalized)) {
    return { raw, value: null, issue: issue("invalid_date", "Date must be YYYY-MM-DD") };
  }
  if (normalized > nowPKTDate()) {
    return { raw, value: normalized, issue: issue("future_date", "Date cannot be in the future") };
  }

  return { raw, value: normalized, issue: null };
}

function normalizeTimeCell(cell: ParsedCell | undefined) {
  const raw = (cell?.value ?? "").trim();
  if (!raw) return { raw, value: null, issue: issue("missing_time", "Time is required") };

  let normalized = raw;
  const numeric = cell?.type === null || cell?.type === "n";
  if (numeric && /^-?\d+(?:\.\d+)?$/.test(raw)) {
    const minutes = Math.round(Number(raw) * 1_440);
    if (minutes >= 0 && minutes < 1_440) {
      normalized = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
  }

  const match = /^(\d{2}):(\d{2})$/.exec(normalized);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return { raw, value: null, issue: issue("invalid_time", "Time must be HH:mm") };
  }

  return { raw, value: normalized, issue: null };
}

function normalizeDirection(value: string) {
  const raw = value.trim();
  if (!raw) {
    return { raw, value: null, issue: issue("missing_direction", "Direction is required") };
  }
  const normalized = raw.toUpperCase();
  if (normalized !== "IN" && normalized !== "OUT") {
    return { raw, value: null, issue: issue("invalid_direction", "Direction must be IN or OUT") };
  }
  return { raw, value: normalized, issue: null };
}

function buildParsedRow(input: {
  worksheet: ParsedWorksheet;
  manifest: WorkbookManifest;
  rowNumber: number;
}): ParsedOfflineRow | null {
  const employeeCode = cellText(input.worksheet, `A${input.rowNumber}`).trim();
  const dateCell = input.worksheet.cells.get(`B${input.rowNumber}`);
  const timeCell = input.worksheet.cells.get(`C${input.rowNumber}`);
  const rawDirection = cellText(input.worksheet, `D${input.rowNumber}`).trim();
  const rawNote = cellText(input.worksheet, `E${input.rowNumber}`).trim();
  const recordToken = cellText(input.worksheet, `G${input.rowNumber}`).trim();

  if (!employeeCode && !cellText(input.worksheet, `B${input.rowNumber}`).trim() &&
      !cellText(input.worksheet, `C${input.rowNumber}`).trim() && !rawDirection && !rawNote) {
    return null;
  }

  const parseIssues: OfflineParseIssue[] = [];
  if (!employeeCode) {
    parseIssues.push(issue("missing_employee_code", "Employee code is required"));
  }

  const date = normalizeDateCell(dateCell);
  const time = normalizeTimeCell(timeCell);
  const direction = normalizeDirection(rawDirection);
  if (date.issue) parseIssues.push(date.issue);
  if (time.issue) parseIssues.push(time.issue);
  if (direction.issue) parseIssues.push(direction.issue);
  if (rawNote.length > 500) {
    parseIssues.push(issue("note_too_long", "Note must be 500 characters or fewer"));
  }

  const normalizedTimestamp = date.value && time.value
    ? `${date.value}T${time.value}:00+05:00`
    : null;

  return {
    worksheetRowNumber: input.rowNumber,
    recordToken,
    rawEmployeeCode: employeeCode,
    rawDate: date.raw,
    rawTime: time.raw,
    rawDirection,
    rawNote: rawNote || null,
    normalizedTimestamp,
    contentHash: hashOfflineRow({
      employeeCode,
      date: date.value ?? date.raw,
      time: time.value ?? time.raw,
      direction: direction.value ?? rawDirection,
      note: rawNote || null,
    }),
    parseIssues,
  };
}

function assertPreparedRows(worksheet: ParsedWorksheet, manifest: WorkbookManifest) {
  const lastPreparedRow = manifest.rowCapacity + 1;
  for (const rowNumber of worksheet.rowNumbers) {
    if (rowNumber > lastPreparedRow) {
      const hasUsedCell = ["A", "B", "C", "D", "E", "G"].some((column) =>
        cellText(worksheet, `${column}${rowNumber}`).trim(),
      );
      if (hasUsedCell) reject("Attendance worksheet has too many used rows");
    }
  }

  for (let rowNumber = 2; rowNumber <= lastPreparedRow; rowNumber += 1) {
    const sourceRow = cellText(worksheet, `F${rowNumber}`).trim();
    const recordToken = cellText(worksheet, `G${rowNumber}`).trim();
    if (sourceRow !== String(rowNumber)) {
      reject("Prepared row source number is invalid");
    }
    if (
      !verifyRecordToken({
        workbookId: manifest.workbookId,
        operatorUserId: manifest.operatorUserId,
        templateVersion: manifest.templateVersion,
        signingVersion: manifest.signingVersion,
        rowNumber,
        token: recordToken,
      })
    ) {
      reject("Invalid record token");
    }
  }
}

function readLiteralRows(
  worksheet: ParsedWorksheet,
  manifest: WorkbookManifest,
): ParsedOfflineRow[] {
  assertPreparedRows(worksheet, manifest);
  const rows: ParsedOfflineRow[] = [];
  for (let rowNumber = 2; rowNumber <= manifest.rowCapacity + 1; rowNumber += 1) {
    const row = buildParsedRow({ worksheet, manifest, rowNumber });
    if (row) rows.push(row);
  }
  return rows;
}

export async function parseOfflineAttendanceWorkbook(
  bytes: Uint8Array,
): Promise<ParsedOfflineWorkbook> {
  await inspectXlsxPackage(bytes);
  const parts = await readXlsxParts(bytes);
  const sharedStrings = parseSharedStrings(parts);

  verifyExactSheets(parts);

  const systemSheet = parseWorksheet(
    requiredPart(parts, "xl/worksheets/sheet3.xml"),
    sharedStrings,
  );
  const { manifest } = readManifest(systemSheet);
  const attendanceSheet = parseWorksheet(
    requiredPart(parts, "xl/worksheets/sheet2.xml"),
    sharedStrings,
  );

  verifyAttendanceHeaders(attendanceSheet);

  return {
    manifest,
    fileSha256: sha256(bytes),
    rows: readLiteralRows(attendanceSheet, manifest),
  };
}

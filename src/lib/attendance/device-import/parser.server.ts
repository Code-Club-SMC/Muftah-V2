import { posix } from "node:path";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { SaxesParser, type SaxesTag } from "saxes";
import { inspectSafeXlsxPackage } from "@/lib/offline-xlsx/ooxml-guard.server";
import {
  DEVICE_IMPORT_MAX_BYTES,
  DEVICE_IMPORT_MAX_ROWS,
  type DevicePunchReport,
  type DevicePunchReportRow,
} from "./contracts";

const HEADERS = [
  "Person ID",
  "Person Name",
  "Department",
  "Date",
  "Weekday",
  "No. of Punch(s)",
  "Punch Records",
];
const MAX_CELL_LENGTH = 4096;
const MAX_COLUMNS = 32;
const MAX_SHEET_ROWS = DEVICE_IMPORT_MAX_ROWS + 10;
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const XLSX_LIMITS = {
  maxBytes: DEVICE_IMPORT_MAX_BYTES,
  maxEntries: 512,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};
type Cell = { value: string; numeric: boolean; invalid?: string };
type SourceRow = { rowNumber: number; cells: Cell[] };
class DeviceReportError extends Error {}
function reject(message: string): never {
  throw new DeviceReportError(message);
}

function decodeUtf8(bytes: Uint8Array, format: string) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0"))
      reject(`${format} must use UTF-8 text without null bytes`);
    return text;
  } catch (error) {
    if (error instanceof DeviceReportError) throw error;
    return reject(`${format} must use valid UTF-8 encoding`);
  }
}

function parseCsv(text: string): SourceRow[] {
  const rows: SourceRow[] = [];
  let cells: Cell[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowNumber = 1;
  function pushField() {
    cells.push({ value: field, numeric: false });
    if (cells.length > MAX_COLUMNS) reject("CSV has too many columns");
    field = "";
    afterQuote = false;
  }
  function pushRow() {
    pushField();
    rows.push({ rowNumber, cells });
    if (rows.length > MAX_SHEET_ROWS) reject("Report has too many rows");
    cells = [];
  }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else if (char === "\r" || char === "\n") {
        field += char;
        if (char === "\r" && text[i + 1] === "\n") {
          field += "\n";
          i += 1;
        }
        line += 1;
      } else field += char;
    } else if (char === ",") pushField();
    else if (char === "\r" || char === "\n") {
      pushRow();
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      line += 1;
      rowNumber = line;
    } else if (char === '"' && !field && !afterQuote) quoted = true;
    else {
      if (char === '"' || afterQuote)
        reject(`CSV quoting is invalid at line ${line}`);
      field += char;
    }
    if (field.length > MAX_CELL_LENGTH) reject("CSV field is too long");
  }
  if (quoted) reject("CSV contains an unterminated quoted field");
  if (field || cells.length || afterQuote) pushRow();
  return rows;
}

function attr(tag: SaxesTag, name: string) {
  return (
    Object.values(tag.attributes).find(
      (value) => typeof value !== "string" && value.local === name,
    )?.value ?? null
  );
}
function local(tag: SaxesTag) {
  return tag.local ?? tag.name;
}

function parseXml(
  xml: string,
  root: string,
  handlers: {
    open?: (tag: SaxesTag) => void;
    close?: (tag: SaxesTag) => void;
    text?: (text: string) => void;
  },
) {
  const declaredEncoding = xml.match(
    /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i,
  )?.[1];
  if (declaredEncoding && !/^utf-?8$/i.test(declaredEncoding))
    reject("Workbook XML must use UTF-8 encoding");
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on("doctype", () =>
    reject("Workbook XML cannot contain a document type"),
  );
  parser.on("opentag", (tag) => {
    if (depth === 0 && local(tag) !== root)
      reject(`Workbook XML must contain ${root}`);
    depth += 1;
    if (depth > 64) reject("Workbook XML nesting is too deep");
    handlers.open?.(tag);
  });
  parser.on("closetag", (tag) => {
    handlers.close?.(tag);
    depth -= 1;
  });
  parser.on("text", (text) => handlers.text?.(text));
  parser.on("cdata", (text) => handlers.text?.(text));
  parser.on("error", () => reject("Workbook XML is invalid"));
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof DeviceReportError) throw error;
    reject("Workbook XML is invalid");
  }
}

function sharedStrings(xml: string | undefined) {
  if (!xml) return [];
  const values: string[] = [];
  let inString = false;
  let inText = false;
  let phonetic = false;
  let value = "";
  parseXml(xml, "sst", {
    open(tag) {
      const name = local(tag);
      if (name === "si") {
        if (inString) reject("Workbook shared strings are invalid");
        inString = true;
        value = "";
      }
      if (name === "rPh") phonetic = true;
      if (name === "t" && inString && !phonetic) inText = true;
    },
    text(text) {
      if (!inText) return;
      value += text;
      if (value.length > MAX_CELL_LENGTH) reject("Workbook cell is too long");
    },
    close(tag) {
      const name = local(tag);
      if (name === "t") inText = false;
      if (name === "rPh") phonetic = false;
      if (name === "si") {
        values.push(value);
        if (values.length > 200_000)
          reject("Workbook has too many shared strings");
        inString = false;
      }
    },
  });
  return values;
}

function parseWorksheet(xml: string, strings: string[]): SourceRow[] {
  const rows = new Map<number, SourceRow>();
  let inSheetData = false;
  let row: SourceRow | null = null;
  let cell: {
    column: number;
    type: string | null;
    value: string;
    inline: string;
  } | null = null;
  let target: "value" | "inline" | null = null;
  let phonetic = false;
  const usedColumns = new Set<number>();
  parseXml(xml, "worksheet", {
    open(tag) {
      const name = local(tag);
      if (name === "f")
        reject("Formula cells are not allowed in a device report");
      if (name === "sheetData") {
        if (inSheetData) reject("Worksheet contains nested sheet data");
        inSheetData = true;
      }
      if (name === "row") {
        const rawNumber = attr(tag, "r") ?? "";
        const rowNumber = Number(rawNumber);
        if (
          !inSheetData ||
          row ||
          !/^\d+$/.test(rawNumber) ||
          !Number.isSafeInteger(rowNumber) ||
          rowNumber < 1 ||
          rowNumber > MAX_SHEET_ROWS
        )
          reject("Worksheet row is outside report bounds");
        if (rows.has(rowNumber))
          reject("Worksheet contains duplicate row references");
        row = { rowNumber, cells: [] };
        rows.set(rowNumber, row);
        usedColumns.clear();
      }
      if (name === "c") {
        const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(attr(tag, "r") ?? "");
        if (!row || cell || !match || Number(match[2]) !== row.rowNumber)
          reject("Worksheet contains an invalid cell reference");
        const column =
          [...match[1]].reduce(
            (n, char) => n * 26 + char.charCodeAt(0) - 64,
            0,
          ) - 1;
        if (column >= MAX_COLUMNS) reject("Worksheet has too many columns");
        if (usedColumns.has(column))
          reject("Worksheet contains duplicate cell references");
        usedColumns.add(column);
        cell = { column, type: attr(tag, "t"), value: "", inline: "" };
      }
      if (name === "rPh") phonetic = true;
      if (cell && name === "v") target = "value";
      if (cell && name === "t" && !phonetic) target = "inline";
    },
    text(text) {
      if (!cell || !target) return;
      cell[target] += text;
      if (cell[target].length > MAX_CELL_LENGTH)
        reject("Workbook cell is too long");
    },
    close(tag) {
      const name = local(tag);
      if (name === "rPh") phonetic = false;
      if (name === "v" || name === "t") target = null;
      if (name === "c" && cell && row) {
        let value = cell.type === "inlineStr" ? cell.inline : cell.value;
        if (cell.type === "s") {
          const index = Number(value);
          if (
            !/^\d+$/.test(value) ||
            !Number.isSafeInteger(index) ||
            strings[index] === undefined
          )
            reject("Workbook shared string reference is invalid");
          value = strings[index];
        }
        row.cells[cell.column] = {
          value,
          numeric: cell.type === null || cell.type === "n",
          ...(cell.type &&
          !["s", "inlineStr", "str", "n", "d"].includes(cell.type)
            ? { invalid: "Unsupported spreadsheet cell type" }
            : {}),
        };
        cell = null;
      }
      if (name === "row") row = null;
      if (name === "sheetData") inSheetData = false;
    },
  });
  return [...rows.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}

async function parseXlsx(bytes: Uint8Array) {
  await inspectSafeXlsxPackage(bytes, XLSX_LIMITS);
  const zip = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: "strict",
    checkAmbiguity: true,
    maxAppendedDataSize: 0,
  });
  try {
    const entries = new Map(
      (await zip.getEntries()).map((entry) => [
        entry.filename.toLowerCase(),
        entry,
      ]),
    );
    async function part(name: string, optional = false) {
      const entry = entries.get(name.toLowerCase());
      if (!entry || entry.directory) {
        if (optional) return undefined;
        return reject(`Workbook is missing required part: ${name}`);
      }
      const data = await entry.getData(new Uint8ArrayWriter());
      if (data.byteLength > XLSX_LIMITS.maxEntryBytes)
        reject("Workbook XML entry is too large");
      return decodeUtf8(data, "Workbook XML");
    }
    const sheets: { name: string; id: string; state: string }[] = [];
    let date1904 = false;
    parseXml((await part("xl/workbook.xml"))!, "workbook", {
      open(tag) {
        if (local(tag) === "workbookPr") {
          const raw = attr(tag, "date1904") ?? "0";
          if (!["0", "1", "false", "true"].includes(raw))
            reject("Workbook date system is invalid");
          date1904 = raw === "1" || raw === "true";
        }
        if (local(tag) === "sheet") {
          sheets.push({
            name: attr(tag, "name") ?? "",
            id: attr(tag, "id") ?? "",
            state: attr(tag, "state") ?? "visible",
          });
        }
      },
    });
    const visible = sheets.filter((sheet) => sheet.state === "visible");
    const reports = visible.filter(
      (sheet) => sheet.name.trim().toLowerCase() === "total punches",
    );
    const sheet =
      reports.length === 1
        ? reports[0]
        : visible.length === 1
          ? visible[0]
          : null;
    if (!sheet?.id)
      reject("Workbook must contain one unambiguous Total Punches worksheet");
    const relations = new Map<string, string>();
    parseXml((await part("xl/_rels/workbook.xml.rels"))!, "Relationships", {
      open(tag) {
        if (local(tag) !== "Relationship") return;
        const id = attr(tag, "Id");
        if (!id || relations.has(id))
          reject("Workbook relationship IDs are invalid");
        const type = attr(tag, "Type") ?? "";
        const target = attr(tag, "Target") ?? "";
        relations.set(id, type.endsWith("/worksheet") ? target : "");
      },
    });
    const target = relations.get(sheet.id) ?? "";
    if (!target || /[\\?#]/.test(target))
      reject("Workbook worksheet relationship is invalid");
    const path = posix.normalize(
      target.startsWith("/") ? target.slice(1) : posix.join("xl", target),
    );
    if (!/^xl\/worksheets\/.+\.xml$/i.test(path))
      reject("Workbook worksheet relationship is unsafe");
    const strings = sharedStrings(await part("xl/sharedStrings.xml", true));
    return { rows: parseWorksheet((await part(path))!, strings), date1904 };
  } catch (error) {
    if (error instanceof DeviceReportError) throw error;
    reject("File is not a valid XLSX device report");
  } finally {
    await zip.close().catch(() => undefined);
  }
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function normalizedDate(cell: Cell | undefined, date1904: boolean) {
  const value = cell?.value.trim() ?? "";
  if (!cell?.numeric) return validDate(value) ? value : null;
  const serial = Number(value);
  if (
    !DECIMAL_NUMBER.test(value) ||
    !Number.isSafeInteger(serial) ||
    serial < (date1904 ? 0 : 1) ||
    serial > 2_958_465 ||
    (!date1904 && serial === 60)
  )
    return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const date = new Date(
    epoch + (serial - (!date1904 && serial > 60 ? 1 : 0)) * 86_400_000,
  );
  const result = date.toISOString().slice(0, 10);
  return validDate(result) ? result : null;
}

function normalizedPunches(cell: Cell | undefined, issues: string[]) {
  const value = cell?.value.trim() ?? "";
  if (!value) return [];
  if (cell?.numeric) {
    const fraction = Number(value);
    const minutes = Math.round(fraction * 1440);
    if (
      !DECIMAL_NUMBER.test(value) ||
      !Number.isFinite(fraction) ||
      fraction < 0 ||
      fraction >= 1 ||
      minutes >= 1440 ||
      Math.abs(fraction * 1440 - minutes) > 0.000001
    ) {
      issues.push(
        "Numeric punch time must be a valid minute fraction of one day",
      );
      return [];
    }
    return [
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    ];
  }
  const punches: string[] = [];
  for (const raw of value.split(",")) {
    const time = raw.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      issues.push(`Invalid punch time: ${time || "empty value"}. Use HH:mm`);
    else punches.push(time);
  }
  if (new Set(punches).size !== punches.length)
    issues.push("Duplicate punch times in the same day");
  if (punches.some((time, index) => index > 0 && time < punches[index - 1]))
    issues.push("Punch times must be in chronological order");
  return punches;
}

function reportRows(
  sourceRows: SourceRow[],
  date1904 = false,
  csvInput = false,
): DevicePunchReportRow[] {
  const rows: DevicePunchReportRow[] = [];
  let foundHeaders = false;
  const days = new Map<string, DevicePunchReportRow>();
  for (const source of sourceRows) {
    const values = Array.from(source.cells, (cell) => cell?.value.trim() ?? "");
    if (values.every((value) => !value)) continue;
    if (!foundHeaders) {
      if (
        values[0] === "Total Punches" &&
        values.slice(1).every((value) => !value)
      )
        continue;
      if (
        HEADERS.every((header, index) => values[index] === header) &&
        values.slice(HEADERS.length).every((value) => !value)
      ) {
        foundHeaders = true;
        continue;
      }
      reject("Report headers must match the Total Punches CSV or XLSX columns");
    }
    if (rows.length >= DEVICE_IMPORT_MAX_ROWS)
      reject("Report has more than 20,000 data rows");
    const issues: string[] = [];
    if (
      source.cells.length > HEADERS.length ||
      (csvInput && source.cells.length !== HEADERS.length)
    )
      issues.push("Row must contain exactly seven report columns");
    for (const cell of source.cells) {
      if (cell?.invalid) issues.push(cell.invalid);
      if (/^[=+@-]/.test(cell?.value.trimStart() ?? ""))
        issues.push("Formula-like input is not allowed");
    }
    const personId = values[0] ?? "";
    if (!personId) issues.push("Person ID is required");
    if (personId.length > 128)
      issues.push("Person ID must be 128 characters or fewer");
    const date = normalizedDate(source.cells[3], date1904);
    if (!date)
      issues.push("Date must be a valid YYYY-MM-DD date or Excel date serial");
    const punches = normalizedPunches(source.cells[6], issues);
    const countText = values[5] ?? "";
    const reportedCount =
      /^\d+$/.test(countText) &&
      Number.isSafeInteger(Number(countText)) &&
      Number(countText) <= 1440
        ? Number(countText)
        : null;
    if (reportedCount === null)
      issues.push("Reported punch count must be an integer from 0 to 1440");
    else if (reportedCount !== punches.length)
      issues.push(
        `Reported punch count ${reportedCount} does not match ${punches.length} valid punches`,
      );
    const row: DevicePunchReportRow = {
      rowNumber: source.rowNumber,
      personId,
      personName: values[1] ?? "",
      department: values[2] ?? "",
      date,
      punches,
      reportedCount,
      issues: [...new Set(issues)],
    };
    if (personId && date) {
      const key = `${personId}\0${date}`;
      const duplicate = days.get(key);
      if (duplicate) {
        const message = "Duplicate person/date row in report";
        if (!duplicate.issues.includes(message)) duplicate.issues.push(message);
        row.issues.push(message);
      } else days.set(key, row);
    }
    rows.push(row);
  }
  if (!foundHeaders) reject("Report is missing Total Punches headers");
  if (!rows.length) reject("Report contains no data rows");
  return rows;
}

export async function parseDevicePunchReport(
  bytes: Uint8Array,
): Promise<DevicePunchReport> {
  if (bytes.byteLength === 0 || bytes.byteLength > DEVICE_IMPORT_MAX_BYTES)
    reject("Report file size must be between 1 byte and 10 MiB");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const workbook = await parseXlsx(bytes);
    return {
      format: "xlsx",
      rows: reportRows(workbook.rows, workbook.date1904),
    };
  }
  return {
    format: "csv",
    rows: reportRows(parseCsv(decodeUtf8(bytes, "CSV")), false, true),
  };
}

import { createHash } from "node:crypto";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  OFFLINE_ATTENDANCE_WORKBOOK_FORMAT,
  type WorkbookManifest,
  type WorkbookTemplateInput,
} from "./contracts";
import {
  OFFLINE_TEMPLATE_VERSION,
  OFFLINE_WORKBOOK_ROW_CAPACITY,
} from "./constants";
import { createRecordToken, signWorkbookManifest } from "./signing.server";

export const OFFLINE_ATTENDANCE_HEADERS = [
  { header: "Employee Code", key: "employeeCode", width: 20 },
  { header: "Date (YYYY-MM-DD)", key: "date", width: 20 },
  { header: "Time (HH:mm)", key: "time", width: 16 },
  { header: "Direction", key: "direction", width: 14 },
  { header: "Note", key: "note", width: 45 },
  { header: "_Source Row", key: "sourceRow", width: 18, hidden: true },
  { header: "_Record Token", key: "recordToken", width: 18, hidden: true },
] as const;

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function inlineStringCell(ref: string, value: string, styleId: number) {
  if (value === "") return `<c r="${ref}" s="${styleId}"/>`;
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number, styleId: number) {
  return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`;
}

function deriveProtectionPassword(manifestSignature: string) {
  return createHash("sha256")
    .update(manifestSignature, "utf8")
    .digest("hex")
    .slice(0, 4)
    .toUpperCase();
}

function sheetProtection(password: string) {
  return [
    `<sheetProtection password="${password}" sheet="1" objects="1" scenarios="1"`,
    'formatCells="1" formatColumns="1" formatRows="1"',
    'insertColumns="1" insertRows="1" insertHyperlinks="1"',
    'deleteColumns="1" deleteRows="1" sort="1" autoFilter="1" pivotTables="1"/>',
  ].join(" ");
}

function buildContentTypesXml() {
  return `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function buildRootRelationshipsXml() {
  return `${XML_DECLARATION}
<Relationships xmlns="${PACKAGE_REL_NS}">
  <Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildWorkbookRelationshipsXml() {
  return `${XML_DECLARATION}
<Relationships xmlns="${PACKAGE_REL_NS}">
  <Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="${REL_NS}/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="${REL_NS}/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildWorkbookXml() {
  return `${XML_DECLARATION}
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
  <workbookPr date1904="0"/>
  <sheets>
    <sheet name="Instructions" sheetId="1" r:id="rId1"/>
    <sheet name="Attendance" sheetId="2" r:id="rId2"/>
    <sheet name="System" sheetId="3" state="veryHidden" r:id="rId3"/>
  </sheets>
</workbook>`;
}

function buildStylesXml() {
  return `${XML_DECLARATION}
<styleSheet xmlns="${MAIN_NS}">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
    <numFmt numFmtId="165" formatCode="hh:mm"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="0"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="1" hidden="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function buildCorePropsXml(input: WorkbookTemplateInput) {
  const issuedAt = escapeXml(input.issuedAt);
  return `${XML_DECLARATION}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Titan Offline Attendance Workbook</dc:title>
  <dc:creator>Titan ERP</dc:creator>
  <cp:lastModifiedBy>Titan ERP</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${issuedAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${issuedAt}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppPropsXml() {
  return `${XML_DECLARATION}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Titan ERP</Application>
  <DocSecurity>1</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>3</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="3" baseType="lpstr"><vt:lpstr>Instructions</vt:lpstr><vt:lpstr>Attendance</vt:lpstr><vt:lpstr>System</vt:lpstr></vt:vector></TitlesOfParts>
</Properties>`;
}

function buildInstructionsSheetXml(input: WorkbookTemplateInput, password: string) {
  const rows = [
    ["Titan Offline Attendance Workbook", ""],
    ["Assigned Operator", input.operatorName],
    ["Workbook ID", input.workbookId],
    ["Use", "Enter only employee code, date, time, direction, and optional note."],
    ["Direction", "Use IN or OUT only."],
    ["Important", "Do not edit hidden columns or sheet names."],
  ];

  const sheetRows = rows
    .map((row, index) => {
      const rowNumber = index + 1;
      const labelStyle = rowNumber === 1 ? 5 : 0;
      return `<row r="${rowNumber}">${inlineStringCell(`A${rowNumber}`, row[0], labelStyle)}${inlineStringCell(`B${rowNumber}`, row[1], 0)}</row>`;
    })
    .join("");

  return `${XML_DECLARATION}
<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
  <dimension ref="A1:B6"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="70" customWidth="1"/></cols>
  <sheetData>${sheetRows}</sheetData>
  ${sheetProtection(password)}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildAttendanceHeaderRow() {
  const cells = OFFLINE_ATTENDANCE_HEADERS.map((column, index) =>
    inlineStringCell(`${String.fromCharCode(65 + index)}1`, column.header, 5),
  ).join("");
  return `<row r="1" spans="1:7">${cells}</row>`;
}

function buildAttendanceDataRow(input: {
  manifest: WorkbookManifest;
  rowNumber: number;
}) {
  const token = createRecordToken({
    workbookId: input.manifest.workbookId,
    operatorUserId: input.manifest.operatorUserId,
    templateVersion: input.manifest.templateVersion,
    signingVersion: input.manifest.signingVersion,
    rowNumber: input.rowNumber,
  });

  return [
    `<row r="${input.rowNumber}" spans="1:7">`,
    inlineStringCell(`A${input.rowNumber}`, "", 1),
    inlineStringCell(`B${input.rowNumber}`, "", 2),
    inlineStringCell(`C${input.rowNumber}`, "", 3),
    inlineStringCell(`D${input.rowNumber}`, "", 1),
    inlineStringCell(`E${input.rowNumber}`, "", 1),
    numberCell(`F${input.rowNumber}`, input.rowNumber, 4),
    inlineStringCell(`G${input.rowNumber}`, token, 4),
    "</row>",
  ].join("");
}

function buildAttendanceSheetXml(input: {
  manifest: WorkbookManifest;
  password: string;
}) {
  const rows = [buildAttendanceHeaderRow()];
  for (
    let rowNumber = 2;
    rowNumber <= input.manifest.rowCapacity + 1;
    rowNumber += 1
  ) {
    rows.push(buildAttendanceDataRow({ manifest: input.manifest, rowNumber }));
  }

  const lastRow = input.manifest.rowCapacity + 1;
  return `${XML_DECLARATION}
<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
  <dimension ref="A1:G${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="20" customWidth="1"/>
    <col min="2" max="2" width="20" customWidth="1"/>
    <col min="3" max="3" width="16" customWidth="1"/>
    <col min="4" max="4" width="14" customWidth="1"/>
    <col min="5" max="5" width="45" customWidth="1"/>
    <col min="6" max="7" width="18" hidden="1" customWidth="1"/>
  </cols>
  <sheetData>${rows.join("")}</sheetData>
  ${sheetProtection(input.password)}
  <dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="D2:D${lastRow}"><formula1>&quot;IN,OUT&quot;</formula1></dataValidation></dataValidations>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildSystemSheetXml(input: {
  manifest: WorkbookManifest;
  manifestSignature: string;
  password: string;
}) {
  const rows = [
    ["Key", "Value"],
    ["format", input.manifest.format],
    ["workbookId", input.manifest.workbookId],
    ["operatorUserId", input.manifest.operatorUserId],
    ["templateVersion", String(input.manifest.templateVersion)],
    ["rowCapacity", String(input.manifest.rowCapacity)],
    ["signingVersion", String(input.manifest.signingVersion)],
    ["issuedAt", input.manifest.issuedAt],
    ["manifestSignature", input.manifestSignature],
  ];

  const sheetRows = rows
    .map((row, index) => {
      const rowNumber = index + 1;
      const styleId = rowNumber === 1 ? 5 : 4;
      return `<row r="${rowNumber}">${inlineStringCell(`A${rowNumber}`, row[0], styleId)}${inlineStringCell(`B${rowNumber}`, row[1], styleId)}</row>`;
    })
    .join("");

  return `${XML_DECLARATION}
<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
  <dimension ref="A1:B9"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="2" width="42" hidden="1" customWidth="1"/></cols>
  <sheetData>${sheetRows}</sheetData>
  ${sheetProtection(input.password)}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function assertWorkbookInput(input: WorkbookTemplateInput) {
  if (input.templateVersion !== OFFLINE_TEMPLATE_VERSION) {
    throw new Error("Unsupported offline attendance template version");
  }
  if (
    !Number.isSafeInteger(input.rowCapacity) ||
    input.rowCapacity < 1 ||
    input.rowCapacity > OFFLINE_WORKBOOK_ROW_CAPACITY
  ) {
    throw new Error("Offline attendance row capacity is not allowed");
  }
  if (!Number.isSafeInteger(input.signingVersion) || input.signingVersion < 1) {
    throw new Error("Offline attendance signing version is not allowed");
  }
}

async function addXml(
  writer: ZipWriter<Uint8Array<ArrayBuffer>>,
  name: string,
  xml: string,
) {
  await writer.add(name, new TextReader(xml));
}

export async function buildOfflineAttendanceWorkbook(
  input: WorkbookTemplateInput,
): Promise<Uint8Array> {
  assertWorkbookInput(input);

  const manifest: WorkbookManifest = {
    format: OFFLINE_ATTENDANCE_WORKBOOK_FORMAT,
    workbookId: input.workbookId,
    operatorUserId: input.operatorUserId,
    templateVersion: input.templateVersion,
    rowCapacity: input.rowCapacity,
    signingVersion: input.signingVersion,
    issuedAt: input.issuedAt,
  };
  const manifestSignature = signWorkbookManifest(manifest);
  const password = deriveProtectionPassword(manifestSignature);
  const writer = new ZipWriter(new Uint8ArrayWriter());

  await addXml(writer, "[Content_Types].xml", buildContentTypesXml());
  await addXml(writer, "_rels/.rels", buildRootRelationshipsXml());
  await addXml(writer, "docProps/core.xml", buildCorePropsXml(input));
  await addXml(writer, "docProps/app.xml", buildAppPropsXml());
  await addXml(writer, "xl/workbook.xml", buildWorkbookXml());
  await addXml(writer, "xl/_rels/workbook.xml.rels", buildWorkbookRelationshipsXml());
  await addXml(writer, "xl/styles.xml", buildStylesXml());
  await addXml(writer, "xl/worksheets/sheet1.xml", buildInstructionsSheetXml(input, password));
  await addXml(
    writer,
    "xl/worksheets/sheet2.xml",
    buildAttendanceSheetXml({ manifest, password }),
  );
  await addXml(
    writer,
    "xl/worksheets/sheet3.xml",
    buildSystemSheetXml({ manifest, manifestSignature, password }),
  );

  return await writer.close();
}

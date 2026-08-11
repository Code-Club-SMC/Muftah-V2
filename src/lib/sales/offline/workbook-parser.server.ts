import { createHash } from "node:crypto";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { SaxesParser, type SaxesTag } from "saxes";
import { z } from "zod";
import { inspectSafeXlsxPackage } from "@/lib/offline-xlsx/ooxml-guard.server";
import { getApplicableDistributorFreeCartons } from "@/lib/sales/distributor-discount-rules";
import {
  OFFLINE_SALES_FACTORY_CODE,
  OFFLINE_SALES_INVOICE_CAPACITY,
  OFFLINE_SALES_ITEM_CAPACITY,
  OFFLINE_SALES_MAX_BYTES,
  OFFLINE_SALES_MAX_ITEMS_PER_INVOICE,
  OFFLINE_SALES_PAYMENT_CAPACITY,
  OFFLINE_SALES_TEMPLATE_VERSION,
  OFFLINE_SALES_ZIP_MAX_ENTRIES,
  OFFLINE_SALES_ZIP_MAX_ENTRY_BYTES,
  OFFLINE_SALES_ZIP_MAX_TOTAL_BYTES,
} from "./constants";
import {
  OFFLINE_SALES_WORKBOOK_FORMAT,
  type OfflineSalesManifest,
  type OfflineSalesReferenceSnapshot,
  type ParsedOfflineSalesInvoice,
  type ParsedOfflineSalesItem,
  type ParsedOfflineSalesPayment,
  type ParsedOfflineSalesWorkbook,
} from "./contracts";
import {
  hashOfflineSalesInvoice,
  hashOfflineSalesSnapshot,
  verifyOfflineSalesManifest,
  verifyOfflineSalesSlotToken,
  verifyOfflineSalesSnapshot,
} from "./signing.server";
import {
  OFFLINE_SALES_INVOICE_HEADERS,
  OFFLINE_SALES_ITEM_HEADERS,
  OFFLINE_SALES_PAYMENT_HEADERS,
} from "./workbook-template.server";

type ParsedCell = {
  ref: string;
  rowNumber: number;
  column: string;
  type: string | null;
  value: string;
  formula: string | null;
};

type ParsedWorksheet = {
  cells: Map<string, ParsedCell>;
  rowNumbers: Set<number>;
};

type ParseIssue = ParsedOfflineSalesInvoice["parseIssues"][number];

const REFERENCE_START_ROW = 600;
const REFERENCE_END_ROW = 20_000;

class UnsafeOfflineSalesWorkbookError extends Error {}

function reject(message: string): never {
  throw new UnsafeOfflineSalesWorkbookError(message);
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

function parseXml(
  xml: string,
  handlers: {
    onOpen?: (tag: SaxesTag) => void;
    onClose?: (tag: SaxesTag) => void;
    onText?: (text: string) => void;
  },
) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => reject("Workbook XML cannot contain a document type"));
  parser.on("opentag", (tag) => handlers.onOpen?.(tag));
  parser.on("closetag", (tag) => handlers.onClose?.(tag));
  parser.on("text", (value) => handlers.onText?.(value));
  parser.on("error", () => reject("Workbook XML is not valid"));
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof UnsafeOfflineSalesWorkbookError) throw error;
    reject("Workbook XML is not valid");
  }
}

async function readParts(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: "strict",
    checkAmbiguity: true,
    maxAppendedDataSize: 0,
  });
  try {
    const parts = new Map<string, string>();
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      const name = entry.filename.toLowerCase();
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      const data = await entry.getData(new Uint8ArrayWriter());
      parts.set(name, new TextDecoder("utf-8", { fatal: true }).decode(data));
    }
    return parts;
  } catch (error) {
    if (error instanceof UnsafeOfflineSalesWorkbookError) throw error;
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
      } else if (local === "t" && inString) inText = true;
    },
    onText(value) {
      if (inText) current += value;
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
  return { column: match[1], rowNumber: Number(match[2]) };
}

function parseWorksheet(xml: string, sharedStrings: string[]): ParsedWorksheet {
  const cells = new Map<string, ParsedCell>();
  const rowNumbers = new Set<number>();
  let current: {
    ref: string;
    type: string | null;
    valueText: string;
    inlineText: string;
    formulaText: string;
    hasFormula: boolean;
  } | null = null;
  let target: "value" | "inline" | "formula" | null = null;
  let inInlineString = false;

  parseXml(xml, {
    onOpen(tag) {
      const local = localName(tag);
      if (local === "hyperlink") reject("Worksheet hyperlinks are not allowed");
      if (local === "row") {
        const rowNumber = Number(attr(tag, "r"));
        if (Number.isSafeInteger(rowNumber)) rowNumbers.add(rowNumber);
      }
      if (local === "c") {
        const ref = attr(tag, "r");
        if (!ref || cells.has(ref)) reject("Worksheet cell reference is invalid or repeated");
        current = {
          ref,
          type: attr(tag, "t"),
          valueText: "",
          inlineText: "",
          formulaText: "",
          hasFormula: false,
        };
      } else if (current && local === "f") {
        if (attr(tag, "t") || attr(tag, "ref") || attr(tag, "si")) {
          reject("Shared and array formulas are not allowed");
        }
        current.hasFormula = true;
        target = "formula";
      } else if (current && local === "v") target = "value";
      else if (current && local === "is") inInlineString = true;
      else if (current && local === "r" && inInlineString) {
        reject("Rich inline strings are not allowed");
      } else if (current && local === "t") target = "inline";
    },
    onText(value) {
      if (!current || !target) return;
      if (target === "value") current.valueText += value;
      if (target === "inline") current.inlineText += value;
      if (target === "formula") current.formulaText += value;
    },
    onClose(tag) {
      const local = localName(tag);
      if (local === "v" || local === "t" || local === "f") target = null;
      if (local === "is") inInlineString = false;
      if (local !== "c" || !current) return;
      const { column, rowNumber } = parseCellRef(current.ref);
      let value = current.valueText;
      if (current.type === "inlineStr") value = current.inlineText;
      else if (current.type === "s") {
        const index = Number(current.valueText);
        if (!Number.isSafeInteger(index) || sharedStrings[index] === undefined) {
          reject("Shared string reference is invalid");
        }
        value = sharedStrings[index];
      } else if (
        current.type &&
        !["n", "b", "str", "d"].includes(current.type)
      ) {
        reject("Unsupported worksheet cell type");
      }
      cells.set(current.ref, {
        ref: current.ref,
        rowNumber,
        column,
        type: current.type,
        value,
        formula: current.hasFormula ? current.formulaText : null,
      });
      rowNumbers.add(rowNumber);
      current = null;
    },
  });
  return { cells, rowNumbers };
}

function verifyExactSheets(parts: Map<string, string>) {
  const sheets: Array<{ name: string; state: string | null; id: string }> = [];
  const definedNames = new Map<string, string>();
  let currentDefinedName: { name: string; value: string } | null = null;
  parseXml(requiredPart(parts, "xl/workbook.xml"), {
    onOpen(tag) {
      if (localName(tag) === "sheet") {
        const name = attr(tag, "name");
        const id = attr(tag, "id");
        if (!name || !id) reject("Workbook sheet metadata is invalid");
        sheets.push({ name, state: attr(tag, "state"), id });
      }
      if (localName(tag) === "definedname") {
        const name = attr(tag, "name");
        if (!name || definedNames.has(name)) reject("Workbook defined name is invalid");
        currentDefinedName = { name, value: "" };
      }
    },
    onText(value) {
      if (currentDefinedName) currentDefinedName.value += value;
    },
    onClose(tag) {
      if (localName(tag) === "definedname" && currentDefinedName) {
        definedNames.set(currentDefinedName.name, currentDefinedName.value);
        currentDefinedName = null;
      }
    },
  });
  const relationships = new Map<string, string>();
  parseXml(requiredPart(parts, "xl/_rels/workbook.xml.rels"), {
    onOpen(tag) {
      if (localName(tag) !== "relationship") return;
      const id = attr(tag, "id");
      const target = attr(tag, "target");
      if (id && target) relationships.set(id, target);
    },
  });
  const expected = [
    ["Invoices", "worksheets/sheet1.xml", null],
    ["Items", "worksheets/sheet2.xml", null],
    ["Payments", "worksheets/sheet3.xml", null],
    ["Reference Data", "worksheets/sheet4.xml", "veryHidden"],
    ["Print Invoice", "worksheets/sheet5.xml", null],
  ] as const;
  if (sheets.length !== expected.length) {
    reject("Workbook sheets do not match the offline sales template");
  }
  expected.forEach(([name, target, state], index) => {
    const sheet = sheets[index];
    if (
      sheet?.name !== name ||
      relationships.get(sheet.id) !== target ||
      (state ? sheet.state !== state : Boolean(sheet.state))
    ) {
      reject("Workbook sheets do not match the offline sales template");
    }
  });
  const expectedRanges = new Map<string, string>([
    ["DistributorCodes", "'Reference Data'!$A$601:$A$20000"],
    ["DistributorIds", "'Reference Data'!$B$601:$B$20000"],
    ["ProductCodes", "'Reference Data'!$H$601:$H$20000"],
    ["ProductPacks", "'Reference Data'!$K$601:$K$20000"],
    ["DefaultCartonPrices", "'Reference Data'!$L$601:$L$20000"],
    ["ProductWacs", "'Reference Data'!$M$601:$M$20000"],
    ["DistributorRateKeys", "'Reference Data'!$Q$601:$Q$20000"],
    ["DistributorRates", "'Reference Data'!$R$601:$R$20000"],
    ["RuleCustomers", "'Reference Data'!$U$601:$U$20000"],
    ["RuleProducts", "'Reference Data'!$V$601:$V$20000"],
    ["RuleThresholds", "'Reference Data'!$W$601:$W$20000"],
    ["RuleFreeCartons", "'Reference Data'!$X$601:$X$20000"],
    ["RuleKeys", "'Reference Data'!$Z$601:$Z$20000"],
    ["OrderItemKeys", "'Reference Data'!$AK$601:$AK$20000"],
    ["OrderCartonRates", "'Reference Data'!$AL$601:$AL$20000"],
    ["_xlnm.Print_Area", "'Print Invoice'!$A$1:INDEX('Print Invoice'!$H:$H,MAX(25,IFERROR(AGGREGATE(14,6,ROW('Print Invoice'!$A$10:$A$209)/('Print Invoice'!$A$10:$A$209<>\"\"),1)+8,25)))"],
  ]);
  if (
    definedNames.size !== expectedRanges.size ||
    [...expectedRanges].some(([name, value]) => definedNames.get(name) !== value)
  ) reject("Workbook named ranges do not match the offline sales template");
}

function cell(sheet: ParsedWorksheet, ref: string) {
  return sheet.cells.get(ref);
}

function cellText(sheet: ParsedWorksheet, ref: string) {
  return cell(sheet, ref)?.value ?? "";
}

const snapshotSchema: z.ZodType<OfflineSalesReferenceSnapshot> = z.object({
  generatedAt: z.string().datetime(),
  factoryWarehouseId: z.string().min(1),
  distributors: z.array(z.object({
    id: z.string().min(1), code: z.string().min(1), name: z.string().min(1),
    outstandingAmount: z.string(), creditLimit: z.string(), creditHold: z.boolean(),
  })),
  products: z.array(z.object({
    recipeId: z.string().min(1), productId: z.string().min(1), code: z.string().min(1),
    name: z.string().min(1), packsPerCarton: z.number().int().positive(),
    distributorCartonPrice: z.string(),
    distributorPrices: z.array(z.object({ customerId: z.string(), cartonPrice: z.string() })),
    retailPricePerPack: z.string(), wacPerPack: z.string(), stockUnits: z.number().int().nonnegative(),
  })),
  discountRules: z.array(z.object({
    id: z.string(), customerId: z.string(), recipeId: z.string(),
    quantityThreshold: z.number().int().positive(), freeCartons: z.number().int().positive(),
    effectiveFrom: z.string().datetime(), effectiveTo: z.string().datetime().nullable(),
  })),
  orders: z.array(z.object({
    id: z.string(), orderBookerId: z.string(), orderBookerCode: z.string(),
    billNumber: z.number().int().positive(), shopkeeperName: z.string(),
    shopkeeperMobile: z.string().nullable(), shopkeeperAddress: z.string().nullable(),
    items: z.array(z.object({
      recipeId: z.string(), productCode: z.string(), unitType: z.string(),
      quantity: z.number().int().nonnegative(), rate: z.string(), cartonRate: z.string(),
    })),
  })),
  wallets: z.array(z.object({
    id: z.string(), code: z.string(), name: z.string(), type: z.enum(["cash", "bank"]),
  })),
});

function readSignedReference(reference: ParsedWorksheet) {
  const values = new Map<string, string>();
  const entries: Array<[string, string]> = [];
  for (let row = 2; row < REFERENCE_START_ROW; row += 1) {
    const key = cellText(reference, `A${row}`);
    const value = cellText(reference, `B${row}`);
    if (key) {
      if (values.has(key)) reject("Reference metadata contains a duplicate key");
      values.set(key, value);
      entries.push([key, value]);
    }
    else if (value) reject("Reference metadata contains an unlabelled value");
  }
  const chunkCount = Number(values.get("snapshotChunkCount"));
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 550) {
    reject("Reference snapshot chunk count is invalid");
  }
  const expectedKeys = [
    "format", "workbookId", "factoryCode", "operatorUserId",
    "templateVersion", "signingVersion", "invoiceCapacity", "itemCapacity",
    "paymentCapacity", "issuedAt", "snapshotSha256", "manifestSignature",
    "snapshotSignature", "snapshotChunkCount",
    ...Array.from({ length: chunkCount }, (_, index) => `snapshot.${index + 1}`),
  ];
  if (
    entries.length !== expectedKeys.length ||
    entries.some(([key], index) => key !== expectedKeys[index])
  ) reject("Reference metadata layout is invalid");
  const chunks: string[] = [];
  for (let index = 1; index <= chunkCount; index += 1) {
    const chunk = values.get(`snapshot.${index}`);
    if (chunk === undefined) reject("Reference snapshot is incomplete");
    chunks.push(chunk);
  }
  let rawSnapshot: unknown;
  try {
    rawSnapshot = JSON.parse(chunks.join(""));
  } catch {
    reject("Reference snapshot JSON is invalid");
  }
  const parsedSnapshot = snapshotSchema.safeParse(rawSnapshot);
  if (!parsedSnapshot.success) reject("Reference snapshot shape is invalid");
  const snapshot = parsedSnapshot.data;
  const manifest: OfflineSalesManifest = {
    format: values.get("format") as OfflineSalesManifest["format"],
    workbookId: values.get("workbookId") ?? "",
    factoryCode: values.get("factoryCode") as OfflineSalesManifest["factoryCode"],
    operatorUserId: values.get("operatorUserId") ?? "",
    templateVersion: Number(values.get("templateVersion")),
    signingVersion: Number(values.get("signingVersion")),
    invoiceCapacity: Number(values.get("invoiceCapacity")) as 500,
    itemCapacity: Number(values.get("itemCapacity")) as 10_000,
    paymentCapacity: Number(values.get("paymentCapacity")) as 2_000,
    issuedAt: values.get("issuedAt") ?? "",
    snapshotSha256: values.get("snapshotSha256") ?? "",
  };
  const manifestSignature = values.get("manifestSignature") ?? "";
  const snapshotSignature = values.get("snapshotSignature") ?? "";
  if (
    manifest.format !== OFFLINE_SALES_WORKBOOK_FORMAT ||
    manifest.factoryCode !== OFFLINE_SALES_FACTORY_CODE ||
    !manifest.workbookId || !manifest.operatorUserId ||
    manifest.templateVersion !== OFFLINE_SALES_TEMPLATE_VERSION ||
    manifest.invoiceCapacity !== OFFLINE_SALES_INVOICE_CAPACITY ||
    manifest.itemCapacity !== OFFLINE_SALES_ITEM_CAPACITY ||
    manifest.paymentCapacity !== OFFLINE_SALES_PAYMENT_CAPACITY ||
    !Number.isSafeInteger(manifest.signingVersion) || manifest.signingVersion < 1 ||
    Number.isNaN(new Date(manifest.issuedAt).getTime())
  ) reject("Offline sales manifest is invalid");
  if (
    hashOfflineSalesSnapshot(snapshot) !== manifest.snapshotSha256 ||
    !verifyOfflineSalesSnapshot(snapshot, manifest.signingVersion, snapshotSignature)
  ) reject("Reference snapshot signature is invalid");
  if (!verifyOfflineSalesManifest(manifest, manifestSignature)) {
    reject("Offline sales manifest signature is invalid");
  }
  return { manifest, manifestSignature, snapshot, snapshotSignature, metadata: values };
}

function expectedReferenceValues(input: {
  manifest: OfflineSalesManifest;
  manifestSignature: string;
  snapshot: OfflineSalesReferenceSnapshot;
  snapshotSignature: string;
  metadata: Map<string, string>;
}) {
  const expected = new Map<string, string>();
  expected.set("A1", "Key");
  expected.set("B1", "Value");
  for (const [key, value] of input.metadata) {
    const row = [...input.metadata.keys()].indexOf(key) + 2;
    expected.set(`A${row}`, key);
    expected.set(`B${row}`, value);
  }
  const headers: Record<string, string> = {
    A: "Distributor Code", B: "Distributor ID", C: "Distributor Name", D: "Outstanding", E: "Limit", F: "Hold",
    H: "Product Code", I: "Recipe ID", J: "Product Name", K: "Packs Per Carton", L: "Default Carton Price", M: "WAC Per Pack", N: "Stock Units", O: "Retail Price",
    Q: "Distributor Price Key", R: "Carton Price", U: "Rule Customer ID", V: "Rule Product Code", W: "Threshold", X: "Free Cartons", Y: "Rule ID", Z: "Rule Key",
    AA: "Order Key", AB: "Order Booker Code", AC: "Bill Number", AD: "Order ID", AE: "Shopkeeper", AF: "Mobile", AG: "Address",
    AK: "Order Item Key", AL: "Carton Rate", AM: "Unit Type", AN: "Ordered Quantity", AO: "Wallet Code", AP: "Wallet Name", AQ: "Wallet Type",
  };
  Object.entries(headers).forEach(([column, value]) => expected.set(`${column}${REFERENCE_START_ROW}`, value));
  input.snapshot.distributors.forEach((value, index) => {
    const row = REFERENCE_START_ROW + index + 1;
    [["A", value.code], ["B", value.id], ["C", value.name], ["D", value.outstandingAmount], ["E", value.creditLimit], ["F", value.creditHold ? "YES" : "NO"]].forEach(([column, text]) => expected.set(`${column}${row}`, text));
  });
  let priceRow = REFERENCE_START_ROW + 1;
  input.snapshot.products.forEach((value, index) => {
    const row = REFERENCE_START_ROW + index + 1;
    [["H", value.code], ["I", value.recipeId], ["J", value.name], ["K", String(value.packsPerCarton)], ["L", value.distributorCartonPrice], ["M", value.wacPerPack], ["N", String(value.stockUnits)], ["O", value.retailPricePerPack]].forEach(([column, text]) => expected.set(`${column}${row}`, text));
    value.distributorPrices.forEach((price) => {
      expected.set(`Q${priceRow}`, `${price.customerId}|${value.code}`);
      expected.set(`R${priceRow}`, price.cartonPrice);
      priceRow += 1;
    });
  });
  input.snapshot.discountRules.forEach((value, index) => {
    const row = REFERENCE_START_ROW + index + 1;
    [["U", value.customerId], ["V", value.recipeId], ["W", String(value.quantityThreshold)], ["X", String(value.freeCartons)], ["Y", value.id], ["Z", `${value.customerId}|${value.recipeId}|${value.quantityThreshold}`]].forEach(([column, text]) => expected.set(`${column}${row}`, text));
  });
  let itemRow = REFERENCE_START_ROW + 1;
  input.snapshot.orders.forEach((value, index) => {
    const row = REFERENCE_START_ROW + index + 1;
    [["AA", `${value.orderBookerCode}|${value.billNumber}`], ["AB", value.orderBookerCode], ["AC", String(value.billNumber)], ["AD", value.id], ["AE", value.shopkeeperName], ["AF", value.shopkeeperMobile ?? ""], ["AG", value.shopkeeperAddress ?? ""]].forEach(([column, text]) => expected.set(`${column}${row}`, text));
    value.items.forEach((item) => {
      [["AK", `${value.orderBookerCode}|${value.billNumber}|${item.productCode}`], ["AL", item.cartonRate], ["AM", item.unitType], ["AN", String(item.quantity)]].forEach(([column, text]) => expected.set(`${column}${itemRow}`, text));
      itemRow += 1;
    });
  });
  input.snapshot.wallets.forEach((value, index) => {
    const row = REFERENCE_START_ROW + index + 1;
    [["AO", value.code], ["AP", value.name], ["AQ", value.type]].forEach(([column, text]) => expected.set(`${column}${row}`, text));
  });
  return expected;
}

function assertReferenceUntampered(
  reference: ParsedWorksheet,
  expected: Map<string, string>,
) {
  for (const value of reference.cells.values()) {
    if (value.formula) reject("Reference data cannot contain formulas");
    if (value.value && expected.get(value.ref) !== value.value) {
      reject(`Protected reference value was changed at ${value.ref}`);
    }
  }
  for (const [ref, value] of expected) {
    if (value && cellText(reference, ref) !== value) {
      reject(`Protected reference value is missing at ${ref}`);
    }
  }
}

function columnIndex(column: string) {
  let value = 0;
  for (const char of column) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}

function assertBounds(sheet: ParsedWorksheet, maxColumn: number, maxRow: number, name: string) {
  for (const value of sheet.cells.values()) {
    if ((value.value || value.formula) && (columnIndex(value.column) > maxColumn || value.rowNumber > maxRow)) {
      reject(`${name} worksheet contains data outside its prepared area`);
    }
  }
}

function assertHeaders(sheet: ParsedWorksheet, headers: readonly string[], name: string) {
  const actual = headers.map((_, index) => cellText(sheet, `${String.fromCharCode(65 + index)}1`));
  if (actual.join("\0") !== headers.join("\0")) reject(`${name} worksheet headers do not match template`);
}

function invoiceLookup(row: number, column: string) {
  return `INDEX(Invoices!$${column}$2:$${column}$501,MATCH(A${row},Invoices!$D$2:$D$501,0))`;
}

function productLookup(row: number, column: string) {
  const ranges: Record<string, string> = { K: "ProductPacks", L: "DefaultCartonPrices", M: "ProductWacs" };
  return `INDEX(${ranges[column]},MATCH(B${row},ProductCodes,0))`;
}

function expectedItemFormula(row: number, column: string) {
  const saleType = invoiceLookup(row, "G");
  const distributorCode = invoiceLookup(row, "H");
  const booker = invoiceLookup(row, "I");
  const bill = invoiceLookup(row, "J");
  const customer = `INDEX(DistributorIds,MATCH(${distributorCode},DistributorCodes,0))`;
  const threshold = `AGGREGATE(14,6,RuleThresholds/((RuleCustomers=${customer})*(RuleProducts=B${row})*(RuleThresholds<=C${row})),1)`;
  const formulas: Record<string, string> = {
    F: `IF(B${row}="","",${productLookup(row, "K")})`,
    G: `IF(A${row}="","",IF(${saleType}="booked_order",IFERROR(INDEX(OrderCartonRates,MATCH(${booker}&"|"&${bill}&"|"&B${row},OrderItemKeys,0)),0),IFERROR(INDEX(DistributorRates,MATCH(${customer}&"|"&B${row},DistributorRateKeys,0)),${productLookup(row, "L")})))`,
    H: `IF(OR(A${row}="",${saleType}="booked_order"),0,IFERROR(FLOOR(C${row}/${threshold},1)*INDEX(RuleFreeCartons,MATCH(${customer}&"|"&B${row}&"|"&${threshold},RuleKeys,0)),0))`,
    I: `IF(H${row}=0,"","signed-rule")`,
    J: `IF(A${row}="","",C${row}*F${row}+D${row})`,
    K: `IF(A${row}="","",(C${row}+H${row})*F${row}+D${row})`,
    L: `IF(B${row}="","",${productLookup(row, "M")})`,
    M: `IF(A${row}="","",ROUND(C${row}*G${row}+D${row}*(G${row}/F${row}),2))`,
  };
  return formulas[column];
}

function assertFormula(cellValue: ParsedCell | undefined, expected: string, source: string) {
  if (cellValue?.formula !== expected) reject(`Protected formula was changed at ${source}`);
}

function assertFormulaContract(sheets: {
  invoices: ParsedWorksheet;
  items: ParsedWorksheet;
  payments: ParsedWorksheet;
  print: ParsedWorksheet;
}) {
  for (let row = 2; row <= 501; row += 1) {
    assertFormula(cell(sheets.invoices, `D${row}`), `IF(E${row}="","","OFF-F01-"&TEXT(E${row},"yyyymmdd")&"-"&TEXT(B${row},"000"))`, `Invoices!D${row}`);
  }
  for (let row = 2; row <= OFFLINE_SALES_ITEM_CAPACITY + 1; row += 1) {
    for (const column of ["F", "G", "H", "I", "J", "K", "L", "M"]) {
      assertFormula(cell(sheets.items, `${column}${row}`), expectedItemFormula(row, column), `Items!${column}${row}`);
    }
  }
  const printExpected = new Map<string, string>([
    ["B3", 'IFERROR(INDEX(Invoices!$E$2:$E$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),"")'],
    ["B4", 'IFERROR(IF(INDEX(Invoices!$G$2:$G$501,MATCH($B$2,Invoices!$D$2:$D$501,0))="booked_order",INDEX(\'Reference Data\'!$AE$601:$AE$20000,MATCH(INDEX(Invoices!$I$2:$I$501,MATCH($B$2,Invoices!$D$2:$D$501,0))&"|"&INDEX(Invoices!$J$2:$J$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),\'Reference Data\'!$AA$601:$AA$20000,0)),INDEX(\'Reference Data\'!$C$601:$C$20000,MATCH(INDEX(Invoices!$H$2:$H$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),\'Reference Data\'!$A$601:$A$20000,0))),"")'],
    ["H212", 'IF($B$2="","",SUMIF(Items!$A$2:$A$10001,$B$2,Items!$M$2:$M$10001))'],
    ["H214", 'IF($B$2="","",SUMIFS(Payments!$C$2:$C$2001,Payments!$A$2:$A$2001,$B$2,Payments!$B$2:$B$2001,"cash"))'],
    ["H215", 'IF($B$2="","",SUMIFS(Payments!$C$2:$C$2001,Payments!$A$2:$A$2001,$B$2,Payments!$B$2:$B$2001,"bank_transfer")+SUMIFS(Payments!$C$2:$C$2001,Payments!$A$2:$A$2001,$B$2,Payments!$B$2:$B$2001,"cheque"))'],
    ["H216", 'IF($B$2="","",H212-H214)'],
    ["A219", 'IF(IFERROR(INDEX(Invoices!$G$2:$G$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),"")="booked_order","Customer Signature","")'],
    ["F219", 'IF(IFERROR(INDEX(Invoices!$G$2:$G$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),"")="booked_order","Account Signature","")'],
  ]);
  for (let row = 10; row <= 209; row += 1) {
    const sequence = row - 9;
    for (const [column, sourceColumn] of [["A", "B"], ["D", "C"], ["E", "D"], ["F", "G"], ["G", "H"], ["H", "M"]]) {
      printExpected.set(`${column}${row}`, `IFERROR(INDEX(Items!$${sourceColumn}$2:$${sourceColumn}$10001,AGGREGATE(15,6,(ROW(Items!$A$2:$A$10001)-1)/(Items!$A$2:$A$10001=$B$2),${sequence})),"")`);
    }
  }
  for (const [ref, formula] of printExpected) assertFormula(cell(sheets.print, ref), formula, `Print Invoice!${ref}`);

  for (const [sheetName, sheet] of Object.entries(sheets)) {
    for (const value of sheet.cells.values()) {
      if (!value.formula) continue;
      const allowed = sheetName === "invoices" ? value.column === "D" && value.rowNumber >= 2 :
        sheetName === "items" ? ["F", "G", "H", "I", "J", "K", "L", "M"].includes(value.column) && value.rowNumber >= 2 :
        sheetName === "print" ? printExpected.has(value.ref) : false;
      if (!allowed) reject(`Formula is not allowed at ${sheetName}!${value.ref}`);
    }
  }
}

function issue(
  code: string,
  message: string,
  source: string,
  value?: string,
): ParseIssue {
  return { code, message, source, ...(value !== undefined ? { value } : {}) };
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}

function normalizeDate(value: ParsedCell | undefined) {
  const raw = value?.value.trim() ?? "";
  if (!raw) return null;
  if ((value?.type === null || value?.type === "n") && /^\d+(?:\.0+)?$/.test(raw)) {
    const serial = Number(raw);
    if (!Number.isSafeInteger(serial) || serial < 1) return null;
    return new Date((serial - 25_569) * 86_400_000).toISOString().slice(0, 10);
  }
  return validDate(raw) ? raw : null;
}

function normalizeTime(value: ParsedCell | undefined) {
  const raw = value?.value.trim() ?? "";
  if (!raw) return null;
  if ((value?.type === null || value?.type === "n") && /^\d+(?:\.\d+)?$/.test(raw)) {
    const minutes = Math.round(Number(raw) * 1_440);
    if (minutes < 0 || minutes >= 1_440) return null;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? raw : null;
}

function integer(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function readInvoices(
  sheet: ParsedWorksheet,
  manifest: OfflineSalesManifest,
) {
  const rows: ParsedOfflineSalesInvoice[] = [];
  const serials = new Set<number>();
  const tokens = new Set<string>();
  for (let row = 2; row <= OFFLINE_SALES_INVOICE_CAPACITY + 1; row += 1) {
    const slot = integer(cellText(sheet, `A${row}`));
    const serial = integer(cellText(sheet, `B${row}`));
    const token = cellText(sheet, `C${row}`).trim();
    if (slot !== row - 1 || serial === null || serial < 1 || !token || serials.has(serial) || tokens.has(token)) {
      reject(`Reserved invoice identity is invalid at Invoices row ${row}`);
    }
    serials.add(serial);
    tokens.add(token);
    if (!verifyOfflineSalesSlotToken({
      workbookId: manifest.workbookId, operatorUserId: manifest.operatorUserId,
      templateVersion: manifest.templateVersion, signingVersion: manifest.signingVersion,
      slotNumber: slot, reservedSerial: serial, token,
    })) reject(`Reserved invoice token is invalid at Invoices row ${row}`);

    const raw = ["E", "F", "G", "H", "I", "J", "K", "L"].map((column) => cellText(sheet, `${column}${row}`).trim());
    if (raw.every((value) => !value)) continue;
    const issues: ParseIssue[] = [];
    const saleDate = normalizeDate(cell(sheet, `E${row}`));
    const saleTime = normalizeTime(cell(sheet, `F${row}`));
    const saleType = raw[2];
    const distributorCode = raw[3] || null;
    const orderBookerCode = raw[4] || null;
    const billNumber = raw[5] ? integer(raw[5]) : null;
    const paymentDueDate = raw[6] ? normalizeDate(cell(sheet, `K${row}`)) : null;
    if (!saleDate) issues.push(issue("invalid_sale_date", "Enter a valid Sale Date", `Invoices!E${row}`, raw[0]));
    if (!saleTime) issues.push(issue("invalid_sale_time", "Enter Sale Time as HH:mm", `Invoices!F${row}`, raw[1]));
    if (saleType !== "direct_distributor" && saleType !== "booked_order") issues.push(issue("invalid_sale_type", "Choose a valid Sale Type", `Invoices!G${row}`, raw[2]));
    if (saleType === "direct_distributor" && !distributorCode) issues.push(issue("missing_distributor", "Choose a distributor", `Invoices!H${row}`, raw[3]));
    if (saleType === "direct_distributor" && (orderBookerCode || billNumber !== null)) issues.push(issue("unexpected_order", "Clear Order Booker and Bill Number for a direct sale", `Invoices!I${row}`, `${raw[4]} ${raw[5]}`.trim()));
    if (saleType === "booked_order" && (!orderBookerCode || billNumber === null || billNumber < 1)) issues.push(issue("missing_order", "Choose Order Booker and enter a valid Bill Number", `Invoices!I${row}`, `${raw[4]} ${raw[5]}`.trim()));
    if (saleType === "booked_order" && distributorCode) issues.push(issue("unexpected_distributor", "Clear Distributor for a booked order", `Invoices!H${row}`, raw[3]));
    if (raw[6] && !paymentDueDate) issues.push(issue("invalid_due_date", "Enter a valid Payment Due Date", `Invoices!K${row}`, raw[6]));
    if (raw[7].length > 500) issues.push(issue("remarks_too_long", "Shorten Remarks to 500 characters or fewer", `Invoices!L${row}`, raw[7]));
    const invoiceNumber = saleDate
      ? `OFF-F01-${saleDate.replaceAll("-", "")}-${String(serial).padStart(3, "0")}`
      : `OFF-F01-INVALID-${String(serial).padStart(3, "0")}`;
    rows.push({
      worksheetRowNumber: row, recordToken: token, invoiceNumber,
      saleDate: saleDate ?? raw[0], saleTime: saleTime ?? raw[1],
      saleType: saleType === "booked_order" ? "booked_order" : "direct_distributor",
      distributorCode, orderBookerCode, billNumber, paymentDueDate,
      remarks: raw[7] || null, invoiceAmount: 0, paidAmount: 0,
      pendingAmount: 0, outstandingAmount: 0, items: [], payments: [],
      contentHash: "", parseIssues: issues,
    });
  }
  return rows;
}

function parseQuantity(value: string) {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function attachItems(
  sheet: ParsedWorksheet,
  invoices: ParsedOfflineSalesInvoice[],
  snapshot: OfflineSalesReferenceSnapshot,
) {
  const byNumber = new Map(invoices.filter((invoice) => invoice.invoiceNumber).map((invoice) => [invoice.invoiceNumber, invoice]));
  const products = new Map(snapshot.products.map((product) => [product.code, product]));
  const distributors = new Map(snapshot.distributors.map((value) => [value.code, value]));
  const orders = new Map(snapshot.orders.map((order) => [`${order.orderBookerCode}|${order.billNumber}`, order]));
  for (let row = 2; row <= OFFLINE_SALES_ITEM_CAPACITY + 1; row += 1) {
    const values = ["A", "B", "C", "D", "E"].map((column) => cellText(sheet, `${column}${row}`).trim());
    if (values.every((value) => !value)) continue;
    const invoice = byNumber.get(values[0]);
    if (!invoice) reject(`Items row ${row} does not link to a used offline invoice`);
    const product = products.get(values[1]);
    const cartons = parseQuantity(values[2]);
    const loose = parseQuantity(values[3]);
    if (!product) invoice.parseIssues.push(issue("unknown_product", "Choose a product from Reference Data", `Items!B${row}`, values[1]));
    if (cartons === null) invoice.parseIssues.push(issue("invalid_cartons", "Enter Carton Quantity as a whole number", `Items!C${row}`, values[2]));
    if (loose === null) invoice.parseIssues.push(issue("invalid_loose_units", "Enter Loose Unit Quantity as a whole number", `Items!D${row}`, values[3]));
    if ((cartons ?? 0) + (loose ?? 0) < 1) invoice.parseIssues.push(issue("empty_item", "Enter at least one carton or loose unit", `Items!C${row}`, `${values[2]} / ${values[3]}`));
    const physical = values[4].toUpperCase();
    if (physical && physical !== "YES" && physical !== "NO") invoice.parseIssues.push(issue("invalid_stock_confirmation", "Choose YES or NO for Physical Stock Confirmed", `Items!E${row}`, values[4]));
    if (!product || cartons === null || loose === null) continue;

    let baseCartonPrice = Number(product.distributorCartonPrice);
    let freeCartons = 0;
    if (invoice.saleType === "direct_distributor") {
      const distributor = invoice.distributorCode ? distributors.get(invoice.distributorCode) : undefined;
      if (!distributor) invoice.parseIssues.push(issue("unknown_distributor", "Distributor is not in the signed workbook reference", `Invoices!H${invoice.worksheetRowNumber}`));
      const customerRate = product.distributorPrices.find((rate) => rate.customerId === distributor?.id);
      baseCartonPrice = Number(customerRate?.cartonPrice ?? product.distributorCartonPrice);
      if (distributor) {
        const resolution = getApplicableDistributorFreeCartons({
          rules: snapshot.discountRules.filter((rule) => rule.customerId === distributor.id).map((rule) => ({ ...rule, ruleType: "free_units", freeUnits: rule.freeCartons, isActive: true })),
          recipeId: product.recipeId,
          numberOfCartons: cartons,
          now: new Date(snapshot.generatedAt),
        });
        freeCartons = resolution.freeCartons;
      }
    } else {
      const order = orders.get(`${invoice.orderBookerCode}|${invoice.billNumber}`);
      const orderItem = order?.items.find((item) => item.productCode === product.code);
      if (!order) invoice.parseIssues.push(issue("unknown_order", "Booked order is not in the signed workbook reference", `Invoices!I${invoice.worksheetRowNumber}`));
      if (!orderItem) invoice.parseIssues.push(issue("product_not_in_order", "Product is not part of the booked order", `Items!B${row}`));
      baseCartonPrice = Number(orderItem?.cartonRate ?? 0);
    }
    if (!Number.isFinite(baseCartonPrice) || baseCartonPrice < 0) {
      invoice.parseIssues.push(issue("invalid_signed_price", "Signed product price is invalid", `Items!B${row}`));
      baseCartonPrice = 0;
    }
    const chargedUnits = cartons * product.packsPerCarton + loose;
    const dispatchedUnits = (cartons + freeCartons) * product.packsPerCarton + loose;
    const lineAmount = money(cartons * baseCartonPrice + loose * (baseCartonPrice / product.packsPerCarton));
    const parsed: ParsedOfflineSalesItem = {
      worksheetRowNumber: row, invoiceNumber: values[0], productCode: product.code,
      cartonQuantity: cartons, looseUnitQuantity: loose,
      packsPerCarton: product.packsPerCarton, baseCartonPrice, freeCartons,
      chargedUnits, dispatchedUnits, lineAmount,
      wacPerPack: Number(product.wacPerPack), stockUnitsSnapshot: product.stockUnits,
      physicalStockConfirmed: physical === "YES",
      sourceColumns: { invoiceNumber: `Items!A${row}`, productCode: `Items!B${row}`, cartonQuantity: `Items!C${row}`, looseUnitQuantity: `Items!D${row}`, physicalStockConfirmed: `Items!E${row}` },
    };
    invoice.items.push(parsed);
  }
  for (const invoice of invoices) {
    if (invoice.items.length === 0) invoice.parseIssues.push(issue("missing_items", "Invoice needs at least one item", `Invoices!D${invoice.worksheetRowNumber}`));
    if (invoice.items.length > OFFLINE_SALES_MAX_ITEMS_PER_INVOICE) invoice.parseIssues.push(issue("too_many_items", `Invoice cannot contain more than ${OFFLINE_SALES_MAX_ITEMS_PER_INVOICE} items`, `Invoices!D${invoice.worksheetRowNumber}`));
    const duplicates = invoice.items.filter((item, index, all) => all.findIndex((candidate) => candidate.productCode === item.productCode) !== index);
    if (duplicates.length) invoice.parseIssues.push(issue("duplicate_product", "Combine duplicate product rows into one item", `Items!B${duplicates[0].worksheetRowNumber}`));
    if (invoice.saleType === "booked_order") {
      const order = orders.get(`${invoice.orderBookerCode}|${invoice.billNumber}`);
      if (order) {
        const actual = new Map<string, number>();
        invoice.items.forEach((item) => actual.set(item.productCode, (actual.get(item.productCode) ?? 0) + item.chargedUnits));
        const expected = new Map<string, number>();
        order.items.forEach((item) => {
          const product = products.get(item.productCode);
          const units = item.unitType === "full_carton" ? item.quantity * (product?.packsPerCarton ?? 0) : item.unitType === "half_carton" ? item.quantity * (product?.packsPerCarton ?? 0) / 2 : item.quantity;
          expected.set(item.productCode, (expected.get(item.productCode) ?? 0) + units);
        });
        if ([...new Set([...actual.keys(), ...expected.keys()])].some((code) => actual.get(code) !== expected.get(code))) {
          invoice.parseIssues.push(issue("booked_order_quantity_mismatch", "Items must exactly match the booked order quantities", `Invoices!I${invoice.worksheetRowNumber}`));
        }
      }
    }
    invoice.invoiceAmount = money(invoice.items.reduce((total, item) => total + item.lineAmount, 0));
  }
}

function attachPayments(
  sheet: ParsedWorksheet,
  invoices: ParsedOfflineSalesInvoice[],
  snapshot: OfflineSalesReferenceSnapshot,
) {
  const byNumber = new Map(invoices.filter((invoice) => invoice.invoiceNumber).map((invoice) => [invoice.invoiceNumber, invoice]));
  const wallets = new Map(snapshot.wallets.map((wallet) => [wallet.code, wallet]));
  for (let row = 2; row <= OFFLINE_SALES_PAYMENT_CAPACITY + 1; row += 1) {
    const values = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((column) => cellText(sheet, `${column}${row}`).trim());
    if (values.every((value) => !value)) continue;
    const invoice = byNumber.get(values[0]);
    if (!invoice) reject(`Payments row ${row} does not link to a used offline invoice`);
    const method = values[1];
    const amount = Number(values[2]);
    const wallet = wallets.get(values[3]);
    const chequeDate = values[7] ? normalizeDate(cell(sheet, `H${row}`)) : null;
    const paymentDate = normalizeDate(cell(sheet, `I${row}`));
    if (!["cash", "bank_transfer", "cheque"].includes(method)) invoice.parseIssues.push(issue("invalid_payment_method", "Choose cash, bank transfer, or cheque", `Payments!B${row}`, values[1]));
    if (!Number.isFinite(amount) || amount <= 0) invoice.parseIssues.push(issue("invalid_payment_amount", "Enter Payment Amount greater than zero", `Payments!C${row}`, values[2]));
    if (!wallet || (method === "cash" ? wallet.type !== "cash" : wallet.type !== "bank")) invoice.parseIssues.push(issue("invalid_payment_wallet", "Choose a matching cash or bank account", `Payments!D${row}`, values[3]));
    if (method === "bank_transfer" && !values[4]) invoice.parseIssues.push(issue("missing_transfer_reference", "Enter Transfer Reference", `Payments!E${row}`, values[4]));
    if (method === "cheque" && (!values[5] || !values[6] || !chequeDate)) invoice.parseIssues.push(issue("missing_cheque_details", "Enter Cheque Bank, Number, and Date", `Payments!F${row}`, `${values[5]} / ${values[6]} / ${values[7]}`));
    if (!paymentDate) invoice.parseIssues.push(issue("invalid_payment_date", "Enter a valid Payment Date", `Payments!I${row}`, values[8]));
    if (!["cash", "bank_transfer", "cheque"].includes(method) || !Number.isFinite(amount) || amount <= 0 || !wallet || !paymentDate) continue;
    const parsed: ParsedOfflineSalesPayment = {
      worksheetRowNumber: row, invoiceNumber: values[0],
      method: method as ParsedOfflineSalesPayment["method"], amount: money(amount),
      walletCode: wallet.code, reference: values[4] || null,
      chequeBank: values[5] || null, chequeNumber: values[6] || null,
      chequeDate, paymentDate,
      sourceColumns: { invoiceNumber: `Payments!A${row}`, method: `Payments!B${row}`, amount: `Payments!C${row}`, walletCode: `Payments!D${row}`, reference: `Payments!E${row}`, chequeBank: `Payments!F${row}`, chequeNumber: `Payments!G${row}`, chequeDate: `Payments!H${row}`, paymentDate: `Payments!I${row}` },
    };
    invoice.payments.push(parsed);
  }
  for (const invoice of invoices) {
    invoice.paidAmount = money(invoice.payments.filter((payment) => payment.method === "cash").reduce((total, payment) => total + payment.amount, 0));
    invoice.pendingAmount = money(invoice.payments.filter((payment) => payment.method !== "cash").reduce((total, payment) => total + payment.amount, 0));
    invoice.outstandingAmount = money(Math.max(0, invoice.invoiceAmount - invoice.paidAmount));
    if (money(invoice.paidAmount + invoice.pendingAmount) > invoice.invoiceAmount) invoice.parseIssues.push(issue("payments_exceed_invoice", "Payments cannot exceed Invoice Total", `Invoices!D${invoice.worksheetRowNumber}`));
    if (invoice.outstandingAmount > 0 && !invoice.paymentDueDate) invoice.parseIssues.push(issue("missing_due_date", "Payment Due Date is required when an amount remains outstanding", `Invoices!K${invoice.worksheetRowNumber}`));
    invoice.contentHash = hashOfflineSalesInvoice({
      recordToken: invoice.recordToken, invoiceNumber: invoice.invoiceNumber,
      saleDate: invoice.saleDate, saleTime: invoice.saleTime, saleType: invoice.saleType,
      distributorCode: invoice.distributorCode, orderBookerCode: invoice.orderBookerCode,
      billNumber: invoice.billNumber, paymentDueDate: invoice.paymentDueDate,
      remarks: invoice.remarks, items: invoice.items, payments: invoice.payments,
      invoiceAmount: invoice.invoiceAmount, paidAmount: invoice.paidAmount,
      pendingAmount: invoice.pendingAmount, outstandingAmount: invoice.outstandingAmount,
    });
  }
}

export async function parseOfflineSalesWorkbook(
  bytes: Uint8Array,
): Promise<ParsedOfflineSalesWorkbook> {
  await inspectSafeXlsxPackage(bytes, {
    maxBytes: OFFLINE_SALES_MAX_BYTES,
    maxEntries: OFFLINE_SALES_ZIP_MAX_ENTRIES,
    maxEntryBytes: OFFLINE_SALES_ZIP_MAX_ENTRY_BYTES,
    maxTotalBytes: OFFLINE_SALES_ZIP_MAX_TOTAL_BYTES,
  });
  const parts = await readParts(bytes);
  verifyExactSheets(parts);
  const sharedStrings = parseSharedStrings(parts);
  const invoicesSheet = parseWorksheet(requiredPart(parts, "xl/worksheets/sheet1.xml"), sharedStrings);
  const itemsSheet = parseWorksheet(requiredPart(parts, "xl/worksheets/sheet2.xml"), sharedStrings);
  const paymentsSheet = parseWorksheet(requiredPart(parts, "xl/worksheets/sheet3.xml"), sharedStrings);
  const referenceSheet = parseWorksheet(requiredPart(parts, "xl/worksheets/sheet4.xml"), sharedStrings);
  const printSheet = parseWorksheet(requiredPart(parts, "xl/worksheets/sheet5.xml"), sharedStrings);
  assertBounds(invoicesSheet, 12, 501, "Invoices");
  assertBounds(itemsSheet, 13, 10_001, "Items");
  assertBounds(paymentsSheet, 9, 2_001, "Payments");
  assertBounds(referenceSheet, 43, REFERENCE_END_ROW, "Reference Data");
  assertBounds(printSheet, 8, 220, "Print Invoice");
  assertHeaders(invoicesSheet, OFFLINE_SALES_INVOICE_HEADERS, "Invoices");
  assertHeaders(itemsSheet, OFFLINE_SALES_ITEM_HEADERS, "Items");
  assertHeaders(paymentsSheet, OFFLINE_SALES_PAYMENT_HEADERS, "Payments");
  const signed = readSignedReference(referenceSheet);
  assertReferenceUntampered(referenceSheet, expectedReferenceValues(signed));
  assertFormulaContract({ invoices: invoicesSheet, items: itemsSheet, payments: paymentsSheet, print: printSheet });
  const invoices = readInvoices(invoicesSheet, signed.manifest);
  attachItems(itemsSheet, invoices, signed.snapshot);
  attachPayments(paymentsSheet, invoices, signed.snapshot);
  return {
    manifest: signed.manifest,
    manifestSignature: signed.manifestSignature,
    snapshot: signed.snapshot,
    snapshotSignature: signed.snapshotSignature,
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    invoices,
  };
}

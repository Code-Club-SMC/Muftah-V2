import { createHash } from "node:crypto";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  OFFLINE_SALES_INVOICE_CAPACITY,
  OFFLINE_SALES_ITEM_CAPACITY,
  OFFLINE_SALES_PAYMENT_CAPACITY,
  OFFLINE_SALES_TEMPLATE_VERSION,
} from "./constants";
import type { OfflineSalesWorkbookTemplateInput } from "./contracts";
import { canonicalJson } from "./signing.server";

export const OFFLINE_SALES_INVOICE_HEADERS = [
  "_Slot",
  "_Reserved Serial",
  "_Record Token",
  "Offline Invoice #",
  "Sale Date",
  "Sale Time",
  "Sale Type",
  "Distributor Code",
  "Order Booker Code",
  "Bill Number",
  "Payment Due Date",
  "Remarks",
] as const;

export const OFFLINE_SALES_ITEM_HEADERS = [
  "Invoice #",
  "Product Code",
  "Carton Quantity",
  "Loose Unit Quantity",
  "Physical Stock Confirmed",
  "_Packs Per Carton",
  "_Base Carton Price",
  "_Free Cartons",
  "_Rule ID",
  "_Charged Units",
  "_Dispatched Units",
  "_WAC Per Pack",
  "_Line Total",
] as const;

export const OFFLINE_SALES_PAYMENT_HEADERS = [
  "Invoice #",
  "Method",
  "Amount",
  "Wallet Code",
  "Transfer Reference",
  "Cheque Bank",
  "Cheque Number",
  "Cheque Date",
  "Payment Date",
] as const;

export const OFFLINE_SALES_REFERENCE_HEADERS = ["Key", "Value"] as const;

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REFERENCE_START_ROW = 600;
const REFERENCE_END_ROW = 20_000;
const SNAPSHOT_CHUNK_SIZE = 30_000;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function inline(ref: string, value: string, style = 0) {
  if (!value) return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function number(ref: string, value: number, style = 0) {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function formula(ref: string, value: string, style = 6) {
  return `<c r="${ref}" s="${style}"><f>${escapeXml(value)}</f><v></v></c>`;
}

function row(rowNumber: number, cells: string[]) {
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function headerRow(headers: readonly string[]) {
  return row(
    1,
    headers.map((header, index) => inline(`${columnName(index)}1`, header, 5)),
  );
}

function protectionPassword(signature: string) {
  return createHash("sha256").update(signature).digest("hex").slice(0, 4).toUpperCase();
}

function protection(password: string) {
  return `<sheetProtection password="${password}" sheet="1" objects="1" scenarios="1" formatCells="1" formatColumns="1" formatRows="1" insertColumns="1" insertRows="1" insertHyperlinks="1" deleteColumns="1" deleteRows="1" sort="1" autoFilter="1" pivotTables="1"/>`;
}

function worksheet(input: {
  dimension: string;
  columns: string;
  rows: string;
  protection: string;
  validations?: string;
  extras?: string;
}) {
  return `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><dimension ref="${input.dimension}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${input.columns}</cols><sheetData>${input.rows}</sheetData>${input.protection}${input.validations ?? ""}${input.extras ?? ""}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function invoiceNumberFormula(rowNumber: number) {
  return `IF(E${rowNumber}="","","OFF-F01-"&TEXT(E${rowNumber},"yyyymmdd")&"-"&TEXT(B${rowNumber},"000"))`;
}

function invoiceLookup(itemRow: number, invoiceColumn: string) {
  return `INDEX(Invoices!$${invoiceColumn}$2:$${invoiceColumn}$501,MATCH(A${itemRow},Invoices!$D$2:$D$501,0))`;
}

function productLookup(itemRow: number, resultColumn: string) {
  const ranges: Record<string, string> = {
    K: "ProductPacks",
    L: "DefaultCartonPrices",
    M: "ProductWacs",
  };
  return `INDEX(${ranges[resultColumn]},MATCH(B${itemRow},ProductCodes,0))`;
}

function basePriceFormula(itemRow: number) {
  const saleType = invoiceLookup(itemRow, "G");
  const distributorCode = invoiceLookup(itemRow, "H");
  const orderBookerCode = invoiceLookup(itemRow, "I");
  const billNumber = invoiceLookup(itemRow, "J");
  const customerId = `INDEX(DistributorIds,MATCH(${distributorCode},DistributorCodes,0))`;
  const distributorPrice = `IFERROR(INDEX(DistributorRates,MATCH(${customerId}&"|"&B${itemRow},DistributorRateKeys,0)),${productLookup(itemRow, "L")})`;
  const orderPrice = `IFERROR(INDEX(OrderCartonRates,MATCH(${orderBookerCode}&"|"&${billNumber}&"|"&B${itemRow},OrderItemKeys,0)),0)`;
  return `IF(A${itemRow}="","",IF(${saleType}="booked_order",${orderPrice},${distributorPrice}))`;
}

function freeCartonsFormula(itemRow: number) {
  const saleType = invoiceLookup(itemRow, "G");
  const distributorCode = invoiceLookup(itemRow, "H");
  const customerId = `INDEX(DistributorIds,MATCH(${distributorCode},DistributorCodes,0))`;
  const threshold = `AGGREGATE(14,6,RuleThresholds/((RuleCustomers=${customerId})*(RuleProducts=B${itemRow})*(RuleThresholds<=C${itemRow})),1)`;
  const freePerThreshold = `INDEX(RuleFreeCartons,MATCH(${customerId}&"|"&B${itemRow}&"|"&${threshold},RuleKeys,0))`;
  return `IF(OR(A${itemRow}="",${saleType}="booked_order"),0,IFERROR(FLOOR(C${itemRow}/${threshold},1)*${freePerThreshold},0))`;
}

function buildInvoicesSheet(input: OfflineSalesWorkbookTemplateInput, password: string) {
  const rows = [headerRow(OFFLINE_SALES_INVOICE_HEADERS)];
  for (let index = 0; index < input.slots.length; index += 1) {
    const rowNumber = index + 2;
    const slot = input.slots[index];
    rows.push(
      row(rowNumber, [
        number(`A${rowNumber}`, slot.slotNumber, 4),
        number(`B${rowNumber}`, slot.reservedSerial, 4),
        inline(`C${rowNumber}`, slot.recordToken, 4),
        formula(`D${rowNumber}`, invoiceNumberFormula(rowNumber)),
        inline(`E${rowNumber}`, "", 2),
        inline(`F${rowNumber}`, "", 3),
        inline(`G${rowNumber}`, "", 1),
        inline(`H${rowNumber}`, "", 1),
        inline(`I${rowNumber}`, "", 1),
        inline(`J${rowNumber}`, "", 7),
        inline(`K${rowNumber}`, "", 2),
        inline(`L${rowNumber}`, "", 1),
      ]),
    );
  }
  return worksheet({
    dimension: "A1:L501",
    columns: '<col min="1" max="3" width="18" hidden="1" customWidth="1"/><col min="4" max="4" width="28" customWidth="1"/><col min="5" max="6" width="15" customWidth="1"/><col min="7" max="11" width="22" customWidth="1"/><col min="12" max="12" width="42" customWidth="1"/>',
    rows: rows.join(""),
    protection: protection(password),
    validations: `<dataValidations count="4"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="G2:G501"><formula1>&quot;direct_distributor,booked_order&quot;</formula1></dataValidation><dataValidation type="list" allowBlank="1" sqref="H2:H501"><formula1>&apos;Reference Data&apos;!$A$${REFERENCE_START_ROW + 1}:$A$${REFERENCE_END_ROW}</formula1></dataValidation><dataValidation type="list" allowBlank="1" sqref="I2:I501"><formula1>&apos;Reference Data&apos;!$AB$${REFERENCE_START_ROW + 1}:$AB$${REFERENCE_END_ROW}</formula1></dataValidation><dataValidation type="whole" operator="between" allowBlank="1" sqref="J2:J501"><formula1>1</formula1><formula2>999999999</formula2></dataValidation></dataValidations>`,
    extras: '<autoFilter ref="D1:L501"/>',
  });
}

function buildItemsSheet(password: string) {
  const rows = [headerRow(OFFLINE_SALES_ITEM_HEADERS)];
  for (let rowNumber = 2; rowNumber <= OFFLINE_SALES_ITEM_CAPACITY + 1; rowNumber += 1) {
    rows.push(
      row(rowNumber, [
        inline(`A${rowNumber}`, "", 1),
        inline(`B${rowNumber}`, "", 1),
        inline(`C${rowNumber}`, "", 7),
        inline(`D${rowNumber}`, "", 7),
        inline(`E${rowNumber}`, "", 1),
        formula(`F${rowNumber}`, `IF(B${rowNumber}="","",${productLookup(rowNumber, "K")})`, 4),
        formula(`G${rowNumber}`, basePriceFormula(rowNumber), 4),
        formula(`H${rowNumber}`, freeCartonsFormula(rowNumber), 4),
        formula(`I${rowNumber}`, `IF(H${rowNumber}=0,"","signed-rule")`, 4),
        formula(`J${rowNumber}`, `IF(A${rowNumber}="","",C${rowNumber}*F${rowNumber}+D${rowNumber})`, 4),
        formula(`K${rowNumber}`, `IF(A${rowNumber}="","",(C${rowNumber}+H${rowNumber})*F${rowNumber}+D${rowNumber})`, 4),
        formula(`L${rowNumber}`, `IF(B${rowNumber}="","",${productLookup(rowNumber, "M")})`, 4),
        formula(`M${rowNumber}`, `IF(A${rowNumber}="","",ROUND(C${rowNumber}*G${rowNumber}+D${rowNumber}*(G${rowNumber}/F${rowNumber}),2))`, 4),
      ]),
    );
  }
  const last = OFFLINE_SALES_ITEM_CAPACITY + 1;
  return worksheet({
    dimension: `A1:M${last}`,
    columns: '<col min="1" max="2" width="28" customWidth="1"/><col min="3" max="5" width="20" customWidth="1"/><col min="6" max="13" width="18" hidden="1" customWidth="1"/>',
    rows: rows.join(""),
    protection: protection(password),
    validations: `<dataValidations count="4"><dataValidation type="list" allowBlank="1" sqref="A2:A${last}"><formula1>Invoices!$D$2:$D$501</formula1></dataValidation><dataValidation type="list" allowBlank="1" sqref="B2:B${last}"><formula1>&apos;Reference Data&apos;!$H$${REFERENCE_START_ROW + 1}:$H$${REFERENCE_END_ROW}</formula1></dataValidation><dataValidation type="whole" operator="between" allowBlank="1" sqref="C2:D${last}"><formula1>0</formula1><formula2>1000000</formula2></dataValidation><dataValidation type="list" allowBlank="1" sqref="E2:E${last}"><formula1>&quot;YES,NO&quot;</formula1></dataValidation></dataValidations>`,
    extras: `<autoFilter ref="A1:E${last}"/>`,
  });
}

function buildPaymentsSheet(password: string) {
  const rows = [headerRow(OFFLINE_SALES_PAYMENT_HEADERS)];
  for (let rowNumber = 2; rowNumber <= OFFLINE_SALES_PAYMENT_CAPACITY + 1; rowNumber += 1) {
    rows.push(
      row(rowNumber, [
        inline(`A${rowNumber}`, "", 1),
        inline(`B${rowNumber}`, "", 1),
        inline(`C${rowNumber}`, "", 7),
        inline(`D${rowNumber}`, "", 1),
        inline(`E${rowNumber}`, "", 1),
        inline(`F${rowNumber}`, "", 1),
        inline(`G${rowNumber}`, "", 1),
        inline(`H${rowNumber}`, "", 2),
        inline(`I${rowNumber}`, "", 2),
      ]),
    );
  }
  const last = OFFLINE_SALES_PAYMENT_CAPACITY + 1;
  return worksheet({
    dimension: `A1:I${last}`,
    columns: '<col min="1" max="2" width="28" customWidth="1"/><col min="3" max="3" width="18" customWidth="1"/><col min="4" max="9" width="24" customWidth="1"/>',
    rows: rows.join(""),
    protection: protection(password),
    validations: `<dataValidations count="3"><dataValidation type="list" allowBlank="1" sqref="A2:A${last}"><formula1>Invoices!$D$2:$D$501</formula1></dataValidation><dataValidation type="list" allowBlank="1" sqref="B2:B${last}"><formula1>&quot;cash,bank_transfer,cheque&quot;</formula1></dataValidation><dataValidation type="list" allowBlank="1" sqref="D2:D${last}"><formula1>&apos;Reference Data&apos;!$AO$${REFERENCE_START_ROW + 1}:$AO$${REFERENCE_END_ROW}</formula1></dataValidation></dataValidations>`,
    extras: `<autoFilter ref="A1:I${last}"/>`,
  });
}

function buildReferenceSheet(input: OfflineSalesWorkbookTemplateInput, password: string) {
  const snapshotJson = canonicalJson(input.snapshot);
  const chunks = Array.from(
    { length: Math.ceil(snapshotJson.length / SNAPSHOT_CHUNK_SIZE) },
    (_, index) => snapshotJson.slice(index * SNAPSHOT_CHUNK_SIZE, (index + 1) * SNAPSHOT_CHUNK_SIZE),
  );
  const metadata: Array<[string, string]> = [
    ["format", input.manifest.format],
    ["workbookId", input.manifest.workbookId],
    ["factoryCode", input.manifest.factoryCode],
    ["operatorUserId", input.manifest.operatorUserId],
    ["templateVersion", String(input.manifest.templateVersion)],
    ["signingVersion", String(input.manifest.signingVersion)],
    ["invoiceCapacity", String(input.manifest.invoiceCapacity)],
    ["itemCapacity", String(input.manifest.itemCapacity)],
    ["paymentCapacity", String(input.manifest.paymentCapacity)],
    ["issuedAt", input.manifest.issuedAt],
    ["snapshotSha256", input.manifest.snapshotSha256],
    ["manifestSignature", input.manifestSignature],
    ["snapshotSignature", input.snapshotSignature],
    ["snapshotChunkCount", String(chunks.length)],
    ...chunks.map((chunk, index) => [`snapshot.${index + 1}`, chunk] as [string, string]),
  ];
  if (metadata.length >= REFERENCE_START_ROW) {
    throw new Error("Offline sales snapshot metadata is too large");
  }
  const rows = new Map<number, string[]>();
  const appendCells = (rowNumber: number, cells: string[]) => {
    const existing = rows.get(rowNumber) ?? [];
    existing.push(...cells);
    rows.set(rowNumber, existing);
  };
  appendCells(
    1,
    OFFLINE_SALES_REFERENCE_HEADERS.map((header, index) =>
      inline(`${columnName(index)}1`, header, 5),
    ),
  );
  metadata.forEach(([key, value], index) => {
    appendCells(index + 2, [
      inline(`A${index + 2}`, key, 4),
      inline(`B${index + 2}`, value, 4),
    ]);
  });
  appendCells(
    REFERENCE_START_ROW,
    [
      inline(`A${REFERENCE_START_ROW}`, "Distributor Code", 5),
      inline(`B${REFERENCE_START_ROW}`, "Distributor ID", 5),
      inline(`C${REFERENCE_START_ROW}`, "Distributor Name", 5),
      inline(`D${REFERENCE_START_ROW}`, "Outstanding", 5),
      inline(`E${REFERENCE_START_ROW}`, "Limit", 5),
      inline(`F${REFERENCE_START_ROW}`, "Hold", 5),
      inline(`H${REFERENCE_START_ROW}`, "Product Code", 5),
      inline(`I${REFERENCE_START_ROW}`, "Recipe ID", 5),
      inline(`J${REFERENCE_START_ROW}`, "Product Name", 5),
      inline(`K${REFERENCE_START_ROW}`, "Packs Per Carton", 5),
      inline(`L${REFERENCE_START_ROW}`, "Default Carton Price", 5),
      inline(`M${REFERENCE_START_ROW}`, "WAC Per Pack", 5),
      inline(`N${REFERENCE_START_ROW}`, "Stock Units", 5),
      inline(`O${REFERENCE_START_ROW}`, "Retail Price", 5),
      inline(`Q${REFERENCE_START_ROW}`, "Distributor Price Key", 5),
      inline(`R${REFERENCE_START_ROW}`, "Carton Price", 5),
      inline(`U${REFERENCE_START_ROW}`, "Rule Customer ID", 5),
      inline(`V${REFERENCE_START_ROW}`, "Rule Product Code", 5),
      inline(`W${REFERENCE_START_ROW}`, "Threshold", 5),
      inline(`X${REFERENCE_START_ROW}`, "Free Cartons", 5),
      inline(`Y${REFERENCE_START_ROW}`, "Rule ID", 5),
      inline(`Z${REFERENCE_START_ROW}`, "Rule Key", 5),
      inline(`AA${REFERENCE_START_ROW}`, "Order Key", 5),
      inline(`AB${REFERENCE_START_ROW}`, "Order Booker Code", 5),
      inline(`AC${REFERENCE_START_ROW}`, "Bill Number", 5),
      inline(`AD${REFERENCE_START_ROW}`, "Order ID", 5),
      inline(`AE${REFERENCE_START_ROW}`, "Shopkeeper", 5),
      inline(`AF${REFERENCE_START_ROW}`, "Mobile", 5),
      inline(`AG${REFERENCE_START_ROW}`, "Address", 5),
      inline(`AK${REFERENCE_START_ROW}`, "Order Item Key", 5),
      inline(`AL${REFERENCE_START_ROW}`, "Carton Rate", 5),
      inline(`AM${REFERENCE_START_ROW}`, "Unit Type", 5),
      inline(`AN${REFERENCE_START_ROW}`, "Ordered Quantity", 5),
      inline(`AO${REFERENCE_START_ROW}`, "Wallet Code", 5),
      inline(`AP${REFERENCE_START_ROW}`, "Wallet Name", 5),
      inline(`AQ${REFERENCE_START_ROW}`, "Wallet Type", 5),
    ],
  );
  input.snapshot.distributors.forEach((value, index) => {
    const r = REFERENCE_START_ROW + index + 1;
    appendCells(r, [inline(`A${r}`, value.code, 4), inline(`B${r}`, value.id, 4), inline(`C${r}`, value.name, 4), inline(`D${r}`, value.outstandingAmount, 4), inline(`E${r}`, value.creditLimit, 4), inline(`F${r}`, value.creditHold ? "YES" : "NO", 4)]);
  });
  let priceRow = REFERENCE_START_ROW + 1;
  input.snapshot.products.forEach((value, index) => {
    const r = REFERENCE_START_ROW + index + 1;
    appendCells(r, [inline(`H${r}`, value.code, 4), inline(`I${r}`, value.recipeId, 4), inline(`J${r}`, value.name, 4), number(`K${r}`, value.packsPerCarton, 4), inline(`L${r}`, value.distributorCartonPrice, 4), inline(`M${r}`, value.wacPerPack, 4), number(`N${r}`, value.stockUnits, 4), inline(`O${r}`, value.retailPricePerPack, 4)]);
    value.distributorPrices.forEach((price) => {
      appendCells(priceRow, [inline(`Q${priceRow}`, `${price.customerId}|${value.code}`, 4), inline(`R${priceRow}`, price.cartonPrice, 4)]);
      priceRow += 1;
    });
  });
  input.snapshot.discountRules.forEach((value, index) => {
    const r = REFERENCE_START_ROW + index + 1;
    appendCells(r, [inline(`U${r}`, value.customerId, 4), inline(`V${r}`, value.recipeId, 4), number(`W${r}`, value.quantityThreshold, 4), number(`X${r}`, value.freeCartons, 4), inline(`Y${r}`, value.id, 4), inline(`Z${r}`, `${value.customerId}|${value.recipeId}|${value.quantityThreshold}`, 4)]);
  });
  let orderItemRow = REFERENCE_START_ROW + 1;
  input.snapshot.orders.forEach((value, index) => {
    const r = REFERENCE_START_ROW + index + 1;
    appendCells(r, [inline(`AA${r}`, `${value.orderBookerCode}|${value.billNumber}`, 4), inline(`AB${r}`, value.orderBookerCode, 4), number(`AC${r}`, value.billNumber, 4), inline(`AD${r}`, value.id, 4), inline(`AE${r}`, value.shopkeeperName, 4), inline(`AF${r}`, value.shopkeeperMobile ?? "", 4), inline(`AG${r}`, value.shopkeeperAddress ?? "", 4)]);
    value.items.forEach((item) => {
      appendCells(orderItemRow, [inline(`AK${orderItemRow}`, `${value.orderBookerCode}|${value.billNumber}|${item.productCode}`, 4), inline(`AL${orderItemRow}`, item.cartonRate, 4), inline(`AM${orderItemRow}`, item.unitType, 4), number(`AN${orderItemRow}`, item.quantity, 4)]);
      orderItemRow += 1;
    });
  });
  input.snapshot.wallets.forEach((value, index) => {
    const r = REFERENCE_START_ROW + index + 1;
    appendCells(r, [inline(`AO${r}`, value.code, 4), inline(`AP${r}`, value.name, 4), inline(`AQ${r}`, value.type, 4)]);
  });
  if (priceRow > REFERENCE_END_ROW || orderItemRow > REFERENCE_END_ROW) {
    throw new Error("Offline sales reference data exceeds workbook capacity");
  }
  return worksheet({
    dimension: `A1:AQ${Math.max(REFERENCE_START_ROW, priceRow, orderItemRow)}`,
    columns: '<col min="1" max="43" width="22" hidden="1" customWidth="1"/>',
    rows: [...rows.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rowNumber, cells]) => row(rowNumber, cells))
      .join(""),
    protection: protection(password),
  });
}

function printItemFormula(rowNumber: number, resultColumn: string) {
  const sequence = rowNumber - 9;
  return `IFERROR(INDEX(Items!$${resultColumn}$2:$${resultColumn}$10001,AGGREGATE(15,6,(ROW(Items!$A$2:$A$10001)-1)/(Items!$A$2:$A$10001=$B$2),${sequence})),"")`;
}

function buildPrintSheet(password: string) {
  const rows = [
    row(1, [inline("A1", "TITAN ERP — OFFLINE INVOICE", 9)]),
    row(2, [inline("A2", "Invoice #", 5), inline("B2", "", 1)]),
    row(3, [inline("A3", "Date", 5), formula("B3", 'IFERROR(INDEX(Invoices!$E$2:$E$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),"")')]),
    row(4, [inline("A4", "Customer", 5), formula("B4", 'IFERROR(IF(INDEX(Invoices!$G$2:$G$501,MATCH($B$2,Invoices!$D$2:$D$501,0))="booked_order",INDEX(\'Reference Data\'!$AE$601:$AE$20000,MATCH(INDEX(Invoices!$I$2:$I$501,MATCH($B$2,Invoices!$D$2:$D$501,0))&"|"&INDEX(Invoices!$J$2:$J$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),\'Reference Data\'!$AA$601:$AA$20000,0)),INDEX(\'Reference Data\'!$C$601:$C$20000,MATCH(INDEX(Invoices!$H$2:$H$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),\'Reference Data\'!$A$601:$A$20000,0))),"")')]),
    row(7, [inline("A7", "Product", 5), inline("D7", "Cartons", 5), inline("E7", "Loose", 5), inline("F7", "Rate", 5), inline("G7", "Free", 5), inline("H7", "Amount", 5)]),
  ];
  for (let r = 10; r <= 209; r += 1) {
    rows.push(row(r, [formula(`A${r}`, printItemFormula(r, "B")), formula(`D${r}`, printItemFormula(r, "C")), formula(`E${r}`, printItemFormula(r, "D")), formula(`F${r}`, printItemFormula(r, "G")), formula(`G${r}`, printItemFormula(r, "H")), formula(`H${r}`, printItemFormula(r, "M"))]));
  }
  rows.push(
    row(212, [inline("F212", "Invoice Total", 5), formula("H212", 'IF($B$2="","",SUMIF(Items!$A$2:$A$10001,$B$2,Items!$M$2:$M$10001))')]),
    row(214, [inline("F214", "Paid Amount", 5), formula("H214", 'IF($B$2="","",SUMIFS(Payments!$C$2:$C$2001,Payments!$A$2:$A$2001,$B$2,Payments!$B$2:$B$2001,"cash"))')]),
    row(215, [inline("F215", "Pending Verification", 5), formula("H215", 'IF($B$2="","",SUMIFS(Payments!$C$2:$C$2001,Payments!$A$2:$A$2001,$B$2,Payments!$B$2:$B$2001,"bank_transfer")+SUMIFS(Payments!$C$2:$C$2001,Payments!$A$2:$A$2001,$B$2,Payments!$B$2:$B$2001,"cheque"))')]),
    row(216, [inline("F216", "Outstanding Amount", 5), formula("H216", 'IF($B$2="","",H212-H214)')]),
    row(219, [formula("A219", 'IF(IFERROR(INDEX(Invoices!$G$2:$G$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),"")="booked_order","Customer Signature","")'), formula("F219", 'IF(IFERROR(INDEX(Invoices!$G$2:$G$501,MATCH($B$2,Invoices!$D$2:$D$501,0)),"")="booked_order","Account Signature","")')]),
  );
  return worksheet({
    dimension: "A1:H220",
    columns: '<col min="1" max="1" width="32" customWidth="1"/><col min="2" max="3" width="16" customWidth="1"/><col min="4" max="8" width="14" customWidth="1"/>',
    rows: rows.join(""),
    protection: protection(password),
    validations: '<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="B2"><formula1>Invoices!$D$2:$D$501</formula1></dataValidation></dataValidations>',
    extras: '<mergeCells count="2"><mergeCell ref="A1:H1"/><mergeCell ref="B4:H4"/></mergeCells><conditionalFormatting sqref="A219:H219"><cfRule type="expression" dxfId="0" priority="1"><formula>$A$219=""</formula></cfRule></conditionalFormatting><pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0" paperSize="9"/><printOptions horizontalCentered="1"/>',
  });
}

function contentTypes() {
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from({ length: 5 }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
}

function workbookXml() {
  const names = ["Invoices", "Items", "Payments", "Reference Data", "Print Invoice"];
  const ranges: Array<[string, string]> = [
    ["DistributorCodes", "$A"], ["DistributorIds", "$B"],
    ["ProductCodes", "$H"], ["ProductPacks", "$K"],
    ["DefaultCartonPrices", "$L"], ["ProductWacs", "$M"],
    ["DistributorRateKeys", "$Q"], ["DistributorRates", "$R"],
    ["RuleCustomers", "$U"], ["RuleProducts", "$V"],
    ["RuleThresholds", "$W"], ["RuleFreeCartons", "$X"],
    ["RuleKeys", "$Z"], ["OrderItemKeys", "$AK"],
    ["OrderCartonRates", "$AL"],
  ];
  const rangeNames = ranges.map(([name, column]) => `<definedName name="${name}">&apos;Reference Data&apos;!${column}$601:${column}$20000</definedName>`).join("");
  return `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><workbookPr date1904="0"/><sheets>${names.map((name, index) => `<sheet name="${name}" sheetId="${index + 1}"${name === "Reference Data" ? ' state="veryHidden"' : ""} r:id="rId${index + 1}"/>`).join("")}</sheets><definedNames>${rangeNames}<definedName name="_xlnm.Print_Area" localSheetId="4">&apos;Print Invoice&apos;!$A$1:INDEX(&apos;Print Invoice&apos;!$H:$H,MAX(25,IFERROR(AGGREGATE(14,6,ROW(&apos;Print Invoice&apos;!$A$10:$A$209)/(&apos;Print Invoice&apos;!$A$10:$A$209&lt;&gt;&quot;&quot;),1)+8,25)))</definedName></definedNames><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
}

function stylesXml() {
  return `${XML}<styleSheet xmlns="${MAIN}"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="hh:mm"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="0"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="1" hidden="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="0"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><font><color rgb="FFFFFFFF"/></font><border><left style="none"/><right style="none"/><top style="none"/><bottom style="none"/></border></dxf></dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
}

async function add(writer: ZipWriter<Uint8Array<ArrayBuffer>>, path: string, value: string) {
  await writer.add(path, new TextReader(value));
}

export async function buildOfflineSalesWorkbook(
  input: OfflineSalesWorkbookTemplateInput,
): Promise<Uint8Array> {
  if (input.manifest.templateVersion !== OFFLINE_SALES_TEMPLATE_VERSION) {
    throw new Error("Unsupported offline sales template version");
  }
  if (
    input.slots.length !== OFFLINE_SALES_INVOICE_CAPACITY ||
    input.manifest.invoiceCapacity !== OFFLINE_SALES_INVOICE_CAPACITY ||
    input.manifest.itemCapacity !== OFFLINE_SALES_ITEM_CAPACITY ||
    input.manifest.paymentCapacity !== OFFLINE_SALES_PAYMENT_CAPACITY
  ) {
    throw new Error("Offline sales workbook capacities are invalid");
  }
  const password = protectionPassword(input.manifestSignature);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await add(writer, "[Content_Types].xml", contentTypes());
  await add(writer, "_rels/.rels", `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  await add(writer, "docProps/core.xml", `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Titan Offline Sales Workbook</dc:title><dc:creator>Titan ERP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(input.manifest.issuedAt)}</dcterms:created></cp:coreProperties>`);
  await add(writer, "docProps/app.xml", `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Titan ERP</Application><DocSecurity>1</DocSecurity></Properties>`);
  await add(writer, "xl/workbook.xml", workbookXml());
  await add(writer, "xl/_rels/workbook.xml.rels", `${XML}<Relationships xmlns="${PACKAGE_REL}">${Array.from({ length: 5 }, (_, index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId6" Type="${REL}/styles" Target="styles.xml"/></Relationships>`);
  await add(writer, "xl/styles.xml", stylesXml());
  await add(writer, "xl/worksheets/sheet1.xml", buildInvoicesSheet(input, password));
  await add(writer, "xl/worksheets/sheet2.xml", buildItemsSheet(password));
  await add(writer, "xl/worksheets/sheet3.xml", buildPaymentsSheet(password));
  await add(writer, "xl/worksheets/sheet4.xml", buildReferenceSheet(input, password));
  await add(writer, "xl/worksheets/sheet5.xml", buildPrintSheet(password));
  return await writer.close();
}

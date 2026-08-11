import type { XlsxEntryMetadata } from "@/lib/offline-xlsx/contracts";
import {
  inspectSafeXlsxPackage,
  validateSafeXlsxEntryMetadata,
} from "@/lib/offline-xlsx/ooxml-guard.server";
import {
  OFFLINE_WORKBOOK_MAX_BYTES,
  OFFLINE_ZIP_MAX_ENTRIES,
  OFFLINE_ZIP_MAX_ENTRY_BYTES,
  OFFLINE_ZIP_MAX_TOTAL_BYTES,
} from "./constants";

const limits = {
  maxBytes: OFFLINE_WORKBOOK_MAX_BYTES,
  maxEntries: OFFLINE_ZIP_MAX_ENTRIES,
  maxEntryBytes: OFFLINE_ZIP_MAX_ENTRY_BYTES,
  maxTotalBytes: OFFLINE_ZIP_MAX_TOTAL_BYTES,
};

export type { XlsxEntryMetadata };

export function validateXlsxEntryMetadata(entries: ReadonlyArray<XlsxEntryMetadata>) {
  return validateSafeXlsxEntryMetadata(entries, limits);
}

export function inspectXlsxPackage(bytes: Uint8Array) {
  return inspectSafeXlsxPackage(bytes, limits);
}

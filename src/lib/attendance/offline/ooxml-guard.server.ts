import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { SaxesParser } from "saxes";
import {
  OFFLINE_WORKBOOK_MAX_BYTES,
  OFFLINE_ZIP_MAX_ENTRIES,
  OFFLINE_ZIP_MAX_ENTRY_BYTES,
  OFFLINE_ZIP_MAX_TOTAL_BYTES,
} from "./constants";

const FORBIDDEN_PATHS = ["xl/vbaproject.bin", "xl/connections.xml"] as const;

const FORBIDDEN_PREFIXES = [
  "xl/externallinks/",
  "xl/querytables/",
  "xl/embeddings/",
  "xl/activex/",
  "xl/ctrlprops/",
] as const;

const REQUIRED_PATHS = [
  "[content_types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
] as const;

export type XlsxEntryMetadata = {
  filename: string;
  uncompressedSize: number;
  encrypted?: boolean;
  zip64?: boolean;
};

class UnsafeXlsxPackageError extends Error {}

function reject(message: string): never {
  throw new UnsafeXlsxPackageError(message);
}

function normalizedEntryName(filename: string) {
  if (
    filename.startsWith("/") ||
    filename.includes("\\") ||
    /^[a-z]:\//i.test(filename)
  ) {
    reject("XLSX package contains an unsafe path");
  }

  const segments = filename.split("/");
  if (
    !filename ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    reject("XLSX package contains an unsafe path");
  }

  return filename.toLowerCase();
}

export function validateXlsxEntryMetadata(
  entries: ReadonlyArray<XlsxEntryMetadata>,
) {
  if (entries.length > OFFLINE_ZIP_MAX_ENTRIES) {
    reject("XLSX package has too many entries");
  }

  const names = new Set<string>();
  let totalSize = 0;

  for (const entry of entries) {
    const name = normalizedEntryName(entry.filename);
    if (names.has(name)) {
      reject("XLSX package contains a duplicate entry");
    }
    names.add(name);

    if (entry.encrypted) reject("Encrypted XLSX packages are not allowed");
    if (entry.zip64) reject("Zip64 XLSX packages are not allowed");

    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0
    ) {
      reject("XLSX package contains an invalid entry size");
    }
    if (entry.uncompressedSize > OFFLINE_ZIP_MAX_ENTRY_BYTES) {
      reject("XLSX package entry is too large");
    }

    totalSize += entry.uncompressedSize;
    if (totalSize > OFFLINE_ZIP_MAX_TOTAL_BYTES) {
      reject("XLSX package decompressed content is too large");
    }

    if (
      FORBIDDEN_PATHS.includes(name as (typeof FORBIDDEN_PATHS)[number]) ||
      FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      reject("XLSX package contains forbidden content");
    }
  }

  return names;
}

function inspectRelationshipXml(bytes: Uint8Array) {
  if (bytes.includes(0)) {
    reject("XLSX relationship XML must use UTF-8 encoding");
  }

  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    reject("XLSX relationship XML must use UTF-8 encoding");
  }

  const declarationEncoding = xml.match(
    /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i,
  )?.[1];
  if (declarationEncoding && !/^utf-?8$/i.test(declarationEncoding)) {
    reject("XLSX relationship XML must use UTF-8 encoding");
  }

  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    reject("XLSX relationship XML cannot contain a document type");
  });
  parser.on("opentag", (tag) => {
    if (tag.local.toLowerCase() !== "relationship") return;
    const targetMode = Object.values(tag.attributes).find(
      (attribute) => attribute.local.toLowerCase() === "targetmode",
    );
    if (targetMode?.value.toLowerCase() === "external") {
      reject("XLSX external relationships are not allowed");
    }
  });
  parser.write(xml).close();
}

export async function inspectXlsxPackage(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > OFFLINE_WORKBOOK_MAX_BYTES) {
    reject("XLSX file size is not allowed");
  }

  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: "strict",
    checkAmbiguity: true,
    maxAppendedDataSize: 0,
  });

  try {
    const entries = await reader.getEntries();
    const names = validateXlsxEntryMetadata(entries);

    for (const requiredPath of REQUIRED_PATHS) {
      if (!names.has(requiredPath)) {
        reject(
          `XLSX package is missing required workbook part: ${requiredPath}`,
        );
      }
    }

    for (const entry of entries) {
      if (entry.directory || !entry.filename.toLowerCase().endsWith(".rels")) {
        continue;
      }
      const relationshipBytes = await entry.getData(new Uint8ArrayWriter());
      inspectRelationshipXml(relationshipBytes);
    }
  } catch (error) {
    if (error instanceof UnsafeXlsxPackageError) throw error;
    throw new UnsafeXlsxPackageError("File is not a valid XLSX package");
  } finally {
    await reader.close().catch(() => undefined);
  }
}

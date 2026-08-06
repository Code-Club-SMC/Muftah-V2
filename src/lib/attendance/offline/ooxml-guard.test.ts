import {
  TextReader,
  Uint8ArrayWriter,
  ZipWriter,
  type ZipWriterAddDataOptions,
  type ZipWriterConstructorOptions,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
  inspectXlsxPackage,
  validateXlsxEntryMetadata,
} from "./ooxml-guard.server";
import {
  OFFLINE_ZIP_MAX_ENTRIES,
  OFFLINE_ZIP_MAX_ENTRY_BYTES,
  OFFLINE_ZIP_MAX_TOTAL_BYTES,
} from "./constants";

type FixtureEntry = {
  name: string;
  content: string;
  options?: ZipWriterAddDataOptions;
};

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml" />
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml" />
</Relationships>`;

const MINIMAL_ENTRIES: FixtureEntry[] = [
  {
    name: "[Content_Types].xml",
    content:
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />',
  },
  { name: "_rels/.rels", content: ROOT_RELS },
  { name: "xl/workbook.xml", content: "<workbook />" },
  { name: "xl/_rels/workbook.xml.rels", content: WORKBOOK_RELS },
];

async function makeZip(
  extraEntries: FixtureEntry[] = [],
  options?: ZipWriterConstructorOptions,
) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), options);
  for (const entry of [...MINIMAL_ENTRIES, ...extraEntries]) {
    await writer.add(entry.name, new TextReader(entry.content), entry.options);
  }
  return writer.close();
}

describe("OOXML package guard", () => {
  it("accepts a small macro-free XLSX package", async () => {
    await expect(inspectXlsxPackage(await makeZip())).resolves.toBeUndefined();
  });

  it.each([
    "xl/vbaProject.bin",
    "xl/externalLinks/externalLink1.xml",
    "xl/connections.xml",
    "xl/queryTables/query1.xml",
    "xl/embeddings/object1.bin",
    "xl/activeX/activeX1.xml",
    "xl/ctrlProps/ctrlProp1.xml",
  ])("rejects forbidden part %s", async (name) => {
    await expect(
      inspectXlsxPackage(await makeZip([{ name, content: "unsafe" }])),
    ).rejects.toThrow("forbidden content");
  });

  it("rejects external relationships", async () => {
    const bytes = await makeZip([
      {
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: `<Relationships><Relationship TargetMode="External" Target="https://example.com" /></Relationships>`,
      },
    ]);

    await expect(inspectXlsxPackage(bytes)).rejects.toThrow(
      "external relationships",
    );
  });

  it("rejects document types in relationship XML", async () => {
    const bytes = await makeZip([
      {
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: `<!DOCTYPE Relationships><Relationships />`,
      },
    ]);

    await expect(inspectXlsxPackage(bytes)).rejects.toThrow("document type");
  });

  it("rejects encrypted entries", async () => {
    const bytes = await makeZip(
      [
        {
          name: "xl/worksheets/sheet1.xml",
          content: "<worksheet />",
          options: { password: "secret" },
        },
      ],
      { password: "secret" },
    );

    await expect(inspectXlsxPackage(bytes)).rejects.toThrow(/encrypted/i);
  });

  it("rejects Zip64 archives", async () => {
    await expect(
      inspectXlsxPackage(await makeZip([], { zip64: true })),
    ).rejects.toThrow("Zip64");
  });

  it("rejects ambiguous and unsafe entry names", () => {
    expect(() =>
      validateXlsxEntryMetadata([
        { filename: "xl/workbook.xml", uncompressedSize: 1 },
        { filename: "XL/WORKBOOK.XML", uncompressedSize: 1 },
      ]),
    ).toThrow("duplicate");

    for (const filename of [
      "../evil.xml",
      "/evil.xml",
      "C:/evil.xml",
      "xl\\evil.xml",
    ]) {
      expect(() =>
        validateXlsxEntryMetadata([{ filename, uncompressedSize: 1 }]),
      ).toThrow("unsafe path");
    }
  });

  it("rejects entry-count and decompressed-size limits", () => {
    expect(() =>
      validateXlsxEntryMetadata(
        Array.from({ length: OFFLINE_ZIP_MAX_ENTRIES + 1 }, (_, index) => ({
          filename: `safe/${index}.xml`,
          uncompressedSize: 1,
        })),
      ),
    ).toThrow("too many entries");

    expect(() =>
      validateXlsxEntryMetadata([
        {
          filename: "safe/large.xml",
          uncompressedSize: OFFLINE_ZIP_MAX_ENTRY_BYTES + 1,
        },
      ]),
    ).toThrow("entry is too large");

    expect(() =>
      validateXlsxEntryMetadata([
        {
          filename: "safe/one.xml",
          uncompressedSize: Math.floor(OFFLINE_ZIP_MAX_TOTAL_BYTES / 3) + 1,
        },
        {
          filename: "safe/two.xml",
          uncompressedSize: Math.floor(OFFLINE_ZIP_MAX_TOTAL_BYTES / 3) + 1,
        },
        {
          filename: "safe/three.xml",
          uncompressedSize: Math.floor(OFFLINE_ZIP_MAX_TOTAL_BYTES / 3) + 1,
        },
      ]),
    ).toThrow("decompressed content is too large");
  });

  it("rejects invalid ZIP data and missing workbook parts", async () => {
    await expect(
      inspectXlsxPackage(new Uint8Array([1, 2, 3, 4])),
    ).rejects.toThrow("valid XLSX package");

    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("notes.txt", new TextReader("not a workbook"));
    await expect(inspectXlsxPackage(await writer.close())).rejects.toThrow(
      "required workbook part",
    );
  });
});

import { describe, expect, it } from "vitest";
import { validateSafeXlsxEntryMetadata } from "./ooxml-guard.server";

const limits = {
  maxBytes: 100,
  maxEntries: 2,
  maxEntryBytes: 10,
  maxTotalBytes: 15,
};

describe("shared XLSX metadata guard", () => {
  it("uses caller-provided limits", () => {
    expect(() =>
      validateSafeXlsxEntryMetadata(
        [
          { filename: "a.xml", uncompressedSize: 1 },
          { filename: "b.xml", uncompressedSize: 1 },
          { filename: "c.xml", uncompressedSize: 1 },
        ],
        limits,
      ),
    ).toThrow("too many entries");

    expect(() =>
      validateSafeXlsxEntryMetadata(
        [{ filename: "a.xml", uncompressedSize: 11 }],
        limits,
      ),
    ).toThrow("entry is too large");
  });

  it("rejects duplicate, traversal, macro, and oversized expanded content", () => {
    expect(() =>
      validateSafeXlsxEntryMetadata(
        [
          { filename: "A.xml", uncompressedSize: 1 },
          { filename: "a.XML", uncompressedSize: 1 },
        ],
        limits,
      ),
    ).toThrow("duplicate");
    expect(() =>
      validateSafeXlsxEntryMetadata(
        [{ filename: "../a.xml", uncompressedSize: 1 }],
        limits,
      ),
    ).toThrow("unsafe path");
    expect(() =>
      validateSafeXlsxEntryMetadata(
        [{ filename: "xl/vbaProject.bin", uncompressedSize: 1 }],
        limits,
      ),
    ).toThrow("forbidden content");
    expect(() =>
      validateSafeXlsxEntryMetadata(
        [
          { filename: "a.xml", uncompressedSize: 8 },
          { filename: "b.xml", uncompressedSize: 8 },
        ],
        limits,
      ),
    ).toThrow("decompressed content is too large");
  });
});

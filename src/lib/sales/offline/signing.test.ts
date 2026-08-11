import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  createOfflineSalesSlotToken,
  getActiveOfflineSalesSigningVersion,
  hashOfflineSalesInvoice,
  verifyOfflineSalesSlotToken,
} from "./signing.server";

const originalEnv = { ...process.env };

describe("offline sales signing", () => {
  beforeEach(() => {
    process.env.OFFLINE_SALES_IMPORT_ENABLED = "true";
    process.env.OFFLINE_SALES_ACTIVE_SIGNING_VERSION = "1";
    process.env.OFFLINE_SALES_SIGNING_KEYS = JSON.stringify({
      "1": Buffer.alloc(32, 7).toString("base64"),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses stable recursive key ordering", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(hashOfflineSalesInvoice({ b: 2, a: 1 })).toBe(
      hashOfflineSalesInvoice({ a: 1, b: 2 }),
    );
  });

  it("binds a token to workbook, operator, slot, version, and serial", () => {
    const input = {
      workbookId: "workbook-1",
      operatorUserId: "operator-1",
      templateVersion: 1,
      signingVersion: 1,
      slotNumber: 5,
      reservedSerial: 99,
    };
    const token = createOfflineSalesSlotToken(input);
    expect(createOfflineSalesSlotToken(input)).toBe(token);
    expect(verifyOfflineSalesSlotToken({ ...input, token })).toBe(true);
    expect(
      verifyOfflineSalesSlotToken({ ...input, reservedSerial: 100, token }),
    ).toBe(false);
    expect(
      verifyOfflineSalesSlotToken({ ...input, operatorUserId: "other", token }),
    ).toBe(false);
  });

  it("does not require signing secrets while disabled", () => {
    delete process.env.OFFLINE_SALES_SIGNING_KEYS;
    process.env.OFFLINE_SALES_IMPORT_ENABLED = "false";
    expect(getActiveOfflineSalesSigningVersion()).toBeNull();
  });

  it("requires a valid 32-byte active key while enabled", () => {
    delete process.env.OFFLINE_SALES_SIGNING_KEYS;
    expect(() => getActiveOfflineSalesSigningVersion()).toThrow(
      "OFFLINE_SALES_SIGNING_KEYS is required",
    );
  });
});

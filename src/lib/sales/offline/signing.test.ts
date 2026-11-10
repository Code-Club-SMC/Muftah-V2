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

  it("works with no settings, using a key derived from the auth secret", () => {
    delete process.env.OFFLINE_SALES_SIGNING_KEYS;
    delete process.env.OFFLINE_SALES_ACTIVE_SIGNING_VERSION;
    delete process.env.OFFLINE_SALES_IMPORT_ENABLED;
    process.env.BETTER_AUTH_SECRET = "a".repeat(64);
    const input = {
      workbookId: "workbook-1",
      operatorUserId: "operator-1",
      templateVersion: 1,
      signingVersion: 1,
      slotNumber: 5,
      reservedSerial: 99,
    };
    expect(getActiveOfflineSalesSigningVersion()).toBe(1);
    const token = createOfflineSalesSlotToken(input);
    expect(verifyOfflineSalesSlotToken({ ...input, token })).toBe(true);
    // A different auth secret cannot forge or verify the same token.
    process.env.BETTER_AUTH_SECRET = "b".repeat(64);
    expect(verifyOfflineSalesSlotToken({ ...input, token })).toBe(false);
    // Each signing version has its own key.
    process.env.BETTER_AUTH_SECRET = "a".repeat(64);
    expect(createOfflineSalesSlotToken({ ...input, signingVersion: 2 })).not.toBe(token);
  });

  it("needs the auth secret when deployed and no keys are set", () => {
    delete process.env.OFFLINE_SALES_SIGNING_KEYS;
    delete process.env.BETTER_AUTH_SECRET;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => getActiveOfflineSalesSigningVersion()).toThrow("BETTER_AUTH_SECRET is required");
  });

  it("lets explicit keys override the derived key", () => {
    process.env.BETTER_AUTH_SECRET = "a".repeat(64);
    const input = {
      workbookId: "w",
      operatorUserId: "o",
      templateVersion: 1,
      signingVersion: 1,
      slotNumber: 1,
      reservedSerial: 1,
    };
    const explicit = createOfflineSalesSlotToken(input);
    delete process.env.OFFLINE_SALES_SIGNING_KEYS;
    expect(createOfflineSalesSlotToken(input)).not.toBe(explicit);
  });

  it("rejects an explicit key that is not 32 bytes", () => {
    process.env.OFFLINE_SALES_SIGNING_KEYS = JSON.stringify({ "1": "short" });
    expect(() => getActiveOfflineSalesSigningVersion()).toThrow("32 bytes");
  });
});

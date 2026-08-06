import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRecordToken,
  getActiveSigningVersion,
  hashOfflineRow,
  signWorkbookManifest,
  verifyRecordToken,
} from "./signing.server";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

describe("offline workbook signing", () => {
  const originalEnvironment = {
    enabled: process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED,
    keys: process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS,
    activeVersion: process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION,
  };

  beforeEach(() => {
    process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED = "true";
    process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS = JSON.stringify({
      "1": TEST_KEY,
    });
    process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION = "1";
  });

  afterEach(() => {
    if (originalEnvironment.enabled === undefined) {
      delete process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED;
    } else {
      process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED =
        originalEnvironment.enabled;
    }

    if (originalEnvironment.keys === undefined) {
      delete process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS;
    } else {
      process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS = originalEnvironment.keys;
    }

    if (originalEnvironment.activeVersion === undefined) {
      delete process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION;
    } else {
      process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION =
        originalEnvironment.activeVersion;
    }
  });

  it("creates deterministic workbook signatures", () => {
    const manifest = {
      workbookId: "wb-1",
      operatorUserId: "operator-1",
      templateVersion: 1,
      signingVersion: 1,
      issuedAt: "2026-08-03T10:00:00.000Z",
    };

    expect(signWorkbookManifest(manifest)).toBe(signWorkbookManifest(manifest));
  });

  it("binds tokens to workbook, operator, version, and row", () => {
    const input = {
      workbookId: "wb-1",
      operatorUserId: "operator-1",
      templateVersion: 1,
      signingVersion: 1,
      rowNumber: 2,
    };
    const token = createRecordToken(input);

    expect(verifyRecordToken({ ...input, token })).toBe(true);
    expect(
      verifyRecordToken({ ...input, rowNumber: input.rowNumber + 1, token }),
    ).toBe(false);
    expect(
      verifyRecordToken({ ...input, operatorUserId: "operator-2", token }),
    ).toBe(false);
  });

  it("rejects malformed tokens without leaking comparison details", () => {
    expect(
      verifyRecordToken({
        workbookId: "wb-1",
        operatorUserId: "operator-1",
        templateVersion: 1,
        signingVersion: 1,
        rowNumber: 2,
        token: "not-a-valid-token",
      }),
    ).toBe(false);
  });

  it("normalizes row values before hashing", () => {
    expect(
      hashOfflineRow({
        employeeCode: " emp-001 ",
        date: "2026-08-03",
        time: "08:05",
        direction: "in",
        note: "  Line   started  ",
      }),
    ).toBe(
      hashOfflineRow({
        employeeCode: "EMP-001",
        date: "2026-08-03",
        time: "08:05",
        direction: "IN",
        note: "Line started",
      }),
    );
  });

  it("fails closed when enabled signing config is missing", () => {
    delete process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS;
    expect(() => getActiveSigningVersion()).toThrow(
      "OFFLINE_ATTENDANCE_SIGNING_KEYS is required",
    );
  });

  it("does not require signing config while feature is disabled", () => {
    process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED = "false";
    delete process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS;
    delete process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION;
    expect(getActiveSigningVersion()).toBeNull();
  });
});

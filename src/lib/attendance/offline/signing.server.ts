import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isOfflineAttendanceEnabled } from "./feature-flag.server";

const signingKeyringSchema = z.record(z.string(), z.string());

export type WorkbookManifest = {
  workbookId: string;
  operatorUserId: string;
  templateVersion: number;
  signingVersion: number;
  issuedAt: string;
};

export type RecordTokenInput = {
  workbookId: string;
  operatorUserId: string;
  templateVersion: number;
  signingVersion: number;
  rowNumber: number;
};

export type OfflineRowHashInput = {
  employeeCode: string;
  date: string;
  time: string;
  direction: string;
  note?: string | null;
};

function canonical(parts: ReadonlyArray<string | number>) {
  return parts.map(String).join("\0");
}

function parseSigningKeyring() {
  const value = process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS;
  if (!value) {
    throw new Error("OFFLINE_ATTENDANCE_SIGNING_KEYS is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("OFFLINE_ATTENDANCE_SIGNING_KEYS must be valid JSON");
  }

  return signingKeyringSchema.parse(parsed);
}

function signingKey(version: number) {
  const encoded = parseSigningKeyring()[String(version)];
  if (!encoded) {
    throw new Error("Offline attendance signing version is unavailable");
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error(
      "Offline attendance signing key must be base64 for 32 bytes",
    );
  }

  return key;
}

function hmac(
  version: number,
  domain: string,
  values: ReadonlyArray<string | number>,
) {
  return createHmac("sha256", signingKey(version))
    .update(canonical([domain, ...values]), "utf8")
    .digest("base64url");
}

export function getActiveSigningVersion(): number | null {
  if (!isOfflineAttendanceEnabled()) return null;

  const rawVersion = process.env.OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION;
  if (!rawVersion) {
    throw new Error("OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION is required");
  }

  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      "OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION must be a positive integer",
    );
  }

  signingKey(version);
  return version;
}

export function signWorkbookManifest(input: WorkbookManifest) {
  return hmac(input.signingVersion, "offline-workbook-manifest-v1", [
    input.workbookId,
    input.operatorUserId,
    input.templateVersion,
    input.signingVersion,
    input.issuedAt,
  ]);
}

export function createRecordToken(input: RecordTokenInput) {
  return hmac(input.signingVersion, "offline-attendance-record-v1", [
    input.workbookId,
    input.operatorUserId,
    input.templateVersion,
    input.signingVersion,
    input.rowNumber,
  ]);
}

export function verifyRecordToken(input: RecordTokenInput & { token: string }) {
  const { token, ...record } = input;
  const expected = Buffer.from(createRecordToken(record), "utf8");
  const actual = Buffer.from(token, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function hashOfflineRow(input: OfflineRowHashInput) {
  const normalized = canonical([
    normalizeText(input.employeeCode).toUpperCase(),
    normalizeText(input.date),
    normalizeText(input.time),
    normalizeText(input.direction).toUpperCase(),
    normalizeText(input.note),
  ]);

  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

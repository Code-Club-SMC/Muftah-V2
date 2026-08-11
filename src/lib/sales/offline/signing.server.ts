import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { OfflineSalesManifest, OfflineSalesReferenceSnapshot } from "./contracts";
import { isOfflineSalesEnabled } from "./feature-flag.server";

const keyringSchema = z.record(z.string(), z.string());

export type OfflineSalesSlotTokenInput = {
  workbookId: string;
  operatorUserId: string;
  templateVersion: number;
  signingVersion: number;
  slotNumber: number;
  reservedSerial: number;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function parseKeyring() {
  const raw = process.env.OFFLINE_SALES_SIGNING_KEYS;
  if (!raw) throw new Error("OFFLINE_SALES_SIGNING_KEYS is required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OFFLINE_SALES_SIGNING_KEYS must be valid JSON");
  }
  return keyringSchema.parse(parsed);
}

function signingKey(version: number) {
  const encoded = parseKeyring()[String(version)];
  if (!encoded) throw new Error("Offline sales signing version is unavailable");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("Offline sales signing key must be base64 for 32 bytes");
  }
  return key;
}

function hmac(version: number, domain: string, value: unknown) {
  return createHmac("sha256", signingKey(version))
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("base64url");
}

function safeEqual(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function getActiveOfflineSalesSigningVersion(): number | null {
  if (!isOfflineSalesEnabled()) return null;
  const version = Number(process.env.OFFLINE_SALES_ACTIVE_SIGNING_VERSION);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      "OFFLINE_SALES_ACTIVE_SIGNING_VERSION must be a positive integer",
    );
  }
  signingKey(version);
  return version;
}

export function hashOfflineSalesSnapshot(snapshot: OfflineSalesReferenceSnapshot) {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

export function signOfflineSalesManifest(manifest: OfflineSalesManifest) {
  return hmac(
    manifest.signingVersion,
    "titan-offline-sales-manifest-v1",
    manifest,
  );
}

export function verifyOfflineSalesManifest(
  manifest: OfflineSalesManifest,
  signature: string,
) {
  return safeEqual(signature, signOfflineSalesManifest(manifest));
}

export function signOfflineSalesSnapshot(
  snapshot: OfflineSalesReferenceSnapshot,
  signingVersion: number,
) {
  return hmac(
    signingVersion,
    "titan-offline-sales-snapshot-v1",
    snapshot,
  );
}

export function verifyOfflineSalesSnapshot(
  snapshot: OfflineSalesReferenceSnapshot,
  signingVersion: number,
  signature: string,
) {
  return safeEqual(signature, signOfflineSalesSnapshot(snapshot, signingVersion));
}

export function createOfflineSalesSlotToken(input: OfflineSalesSlotTokenInput) {
  return hmac(input.signingVersion, "titan-offline-sales-slot-v1", input);
}

export function verifyOfflineSalesSlotToken(
  input: OfflineSalesSlotTokenInput & { token: string },
) {
  const { token, ...slot } = input;
  return safeEqual(token, createOfflineSalesSlotToken(slot));
}

export function hashOfflineSalesInvoice(input: unknown) {
  return createHash("sha256")
    .update(`titan-offline-sales-invoice-v1\0${canonicalJson(input)}`, "utf8")
    .digest("hex");
}

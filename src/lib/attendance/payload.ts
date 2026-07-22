export type ParsedPayload =
  | {
      ok: true;
      employeeId: string | null;
      employeeCode: string;
      source: "qr_json" | "barcode";
    }
  | { ok: false; reason: "invalid_payload" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseQrPayload(raw: string): ParsedPayload {
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(trimmed)) {
    return {
      ok: true,
      employeeId: null,
      employeeCode: trimmed,
      source: "barcode",
    };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);

    if (
      !isRecord(parsed) ||
      parsed.type !== "TITAN_EMPLOYEE" ||
      parsed.v !== 1 ||
      !nonEmptyString(parsed.id) ||
      !nonEmptyString(parsed.code)
    ) {
      return { ok: false, reason: "invalid_payload" };
    }

    return {
      ok: true,
      employeeId: parsed.id.trim(),
      employeeCode: parsed.code.trim(),
      source: "qr_json",
    };
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
}

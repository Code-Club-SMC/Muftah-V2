import { describe, expect, it } from "vitest";
import { parseQrPayload } from "./payload";

describe("parseQrPayload", () => {
  it("accepts a valid employee QR payload", () => {
    const raw = JSON.stringify({
      type: "TITAN_EMPLOYEE",
      id: "emp_123",
      code: "EMP-0001",
      v: 1,
    });

    expect(parseQrPayload(raw)).toEqual({
      ok: true,
      employeeId: "emp_123",
      employeeCode: "EMP-0001",
      source: "qr_json",
    });
  });

  it("accepts a plain employee code from a barcode scan", () => {
    expect(parseQrPayload("MCL-02547")).toEqual({
      ok: true,
      employeeId: null,
      employeeCode: "MCL-02547",
      source: "barcode",
    });
  });

  it("rejects wrong type, wrong version, and missing identifiers", () => {
    expect(parseQrPayload(JSON.stringify({ type: "OTHER", id: "emp", code: "EMP", v: 1 }))).toEqual({
      ok: false,
      reason: "invalid_payload",
    });
    expect(parseQrPayload(JSON.stringify({ type: "TITAN_EMPLOYEE", id: "emp", code: "EMP", v: 2 }))).toEqual({
      ok: false,
      reason: "invalid_payload",
    });
    expect(parseQrPayload(JSON.stringify({ type: "TITAN_EMPLOYEE", code: "EMP", v: 1 }))).toEqual({
      ok: false,
      reason: "invalid_payload",
    });
  });

  it("rejects invalid barcode text and non-card JSON", () => {
    expect(parseQrPayload("bad code with spaces")).toEqual({
      ok: false,
      reason: "invalid_payload",
    });
  });
});

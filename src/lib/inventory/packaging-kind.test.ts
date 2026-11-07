import { describe, expect, it } from "vitest";
import { PACKAGING_KINDS, packagingKindLabel } from "./packaging-kind";

describe("packaging kind labels", () => {
  it.each([
    ["primary", "bottle", "Bottle"], ["master", "bucket", "Bucket"],
    ["primary", "jerry_can", "Jerry can"], ["master", "carton", "Carton"],
    ["primary", null, "Primary packaging"], ["master", undefined, "Master packaging"],
    ["sticker", null, "Sticker"], ["extra", null, "Extra packaging"],
  ] as const)("labels %s / %s without guessing", (type, packagingKind, label) => {
    expect(packagingKindLabel({ type, packagingKind })).toBe(label);
  });
  it("has a readable label for every allowed kind", () => {
    expect(PACKAGING_KINDS).toHaveLength(10);
    for (const packagingKind of PACKAGING_KINDS)
      expect(packagingKindLabel({ type: "master", packagingKind })).not.toMatch(/_|packaging/);
  });
});

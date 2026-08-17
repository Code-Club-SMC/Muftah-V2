import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sha256(path: string) {
  return createHash("sha256")
    .update(readFileSync(resolve(process.cwd(), path)))
    .digest("hex");
}

describe("invoice print layout preservation", () => {
  it("preserves the distributor invoice source exactly", () => {
    expect(sha256("src/components/sales/distributor-invoice.tsx")).toBe(
      "02a818c3b3744e15fd86091f51a2fdca3ad89c0599a69167340441a8807c46c2",
    );
  });

  it("preserves the retailer invoice and existing signatures exactly", () => {
    expect(sha256("src/components/sales/retailer-invoice.tsx")).toBe(
      "48c4dce31af76481ba0b8a252130e04e9002d18fd36bba54739db55b33957e01",
    );
  });
});

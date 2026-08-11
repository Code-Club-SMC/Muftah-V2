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
      "a7bd30681352e5feff55a62e207b9850a0b56e5b2d0f819486629eabbf8dde79",
    );
  });

  it("preserves the retailer invoice and existing signatures exactly", () => {
    expect(sha256("src/components/sales/retailer-invoice.tsx")).toBe(
      "97800f9654ab58ac882fc2e1629d7417e0797372cbd6b39970b695b2af870d25",
    );
  });
});

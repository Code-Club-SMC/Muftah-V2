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
      "783941f4a51400e8bfa5cdcced541c92cef7d6ed52c5120309a15454409c5752",
    );
  });

  it("preserves the retailer invoice and existing signatures exactly", () => {
    expect(sha256("src/components/sales/retailer-invoice.tsx")).toBe(
      "bbae4fc85390a973023579d39ba54b3db07ad2a8dde575a6b9d576110a630805",
    );
  });
});

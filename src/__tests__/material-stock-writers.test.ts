// src/__tests__/material-stock-writers.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const ALLOWED = new Set([
  "src/lib/inventory/material-lots.server.ts",
  // Removed from this list in Task 12, once purchase edit and delete use lots.
  "src/server-functions/suppliers/update-purchase-record-fn.ts",
  "src/server-functions/suppliers/delete-purchase-record-fn.ts",
]);
const WRITE = /\.(insert|update|delete)\(\s*(materialStock|materialLotStock|materialLotMovements)\b/;

describe("material stock writers", () => {
  it("only the lot module changes material stock", () => {
    const offenders = [...files("src/server-functions"), ...files("src/lib")]
      .filter((path) => !path.includes("__tests__") && !path.endsWith(".test.ts"))
      .filter((path) => !ALLOWED.has(path.replaceAll("\\", "/")) && WRITE.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});

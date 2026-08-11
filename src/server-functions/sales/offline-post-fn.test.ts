import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/server-functions/sales/offline-post-fn.ts"), "utf8");

describe("offline sales posting server boundary", () => {
  it("requires feature flag, posting permission, and authenticated actor", () => {
    expect(source).toContain("requireOfflineSalesPostMiddleware");
    expect(source).toContain("requireOfflineSalesEnabled");
    expect(source).toContain("context.session.user.id");
    expect(source).toContain("postOfflineSalesBatch");
  });
});

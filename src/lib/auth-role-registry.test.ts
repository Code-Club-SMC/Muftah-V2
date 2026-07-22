import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("better auth role registry", () => {
  it("registers attendance-terminal and order-booker roles on both server and client", () => {
    const serverSource = readFileSync(
      resolve(process.cwd(), "src/lib/auth.ts"),
      "utf8",
    );
    const clientSource = readFileSync(
      resolve(process.cwd(), "src/lib/auth-client.ts"),
      "utf8",
    );

    for (const source of [serverSource, clientSource]) {
      expect(source).toContain('"attendance-terminal": attendanceTerminal');
      expect(source).toContain('"order-booker": orderBooker');
    }
  });
});

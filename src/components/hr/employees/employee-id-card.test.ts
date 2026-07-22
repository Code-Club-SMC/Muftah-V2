import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/components/hr/employees/employee-id-card.tsx"),
  "utf8",
);

describe("EmployeeIDCard source safeguards", () => {
  it("uses a Code 128 barcode instead of a QR code", () => {
    expect(SOURCE).toContain("CODE_128_B_PATTERNS");
    expect(SOURCE).toContain("BarcodeSvg");
    expect(SOURCE).toContain("employee.employeeCode");
    expect(SOURCE).not.toContain("QRCodeSVG");
    expect(SOURCE).not.toContain("qrcode.react");
  });

  it("prints at CR80 portrait dimensions", () => {
    expect(SOURCE).toContain("widthMm: 54");
    expect(SOURCE).toContain("heightMm: 85.6");
    expect(SOURCE).toContain("CR80 employee card");
  });
});

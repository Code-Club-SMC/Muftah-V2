import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TABLE_SOURCE = readFileSync(
  resolve("src/components/hr/attendance/attendance-list-table.tsx"),
  "utf8",
);
const ADD_FORM_SOURCE = readFileSync(
  resolve("src/components/hr/employees/add-employee-form.tsx"),
  "utf8",
);
const EDIT_FORM_SOURCE = readFileSync(
  resolve("src/components/hr/employees/edit-employee-form.tsx"),
  "utf8",
);

describe("Salesman tab in attendance table", () => {
  it("filters standardData to exclude both order bookers and salesmen", () => {
    expect(TABLE_SOURCE).toContain("!e.isOrderBooker && !e.isSalesman");
  });

  it("filters salesmanData for isSalesman", () => {
    expect(TABLE_SOURCE).toContain("const salesmanData = data.filter((e) => e.isSalesman)");
  });

  it("renders the Salesmen tab trigger", () => {
    expect(TABLE_SOURCE).toContain('value="salesmen"');
    expect(TABLE_SOURCE).toContain("Salesmen");
  });

  it("updates employee form descriptions for salesman", () => {
    expect(ADD_FORM_SOURCE).not.toContain("Creates a linked salesman record. Excluded from attendance.");
    expect(ADD_FORM_SOURCE).toContain("Creates a linked salesman record. Attendance is tracked from deliveries and recoveries.");
    expect(EDIT_FORM_SOURCE).not.toContain("Creates a linked salesman record. Excluded from attendance.");
    expect(EDIT_FORM_SOURCE).toContain("Creates a linked salesman record. Attendance is tracked from deliveries and recoveries.");
  });
});

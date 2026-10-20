import { describe, expect, it } from "vitest";
import { assertLocalPayrollPostgresUrl, assertPayrollTestUrl } from "./attendance-payroll.safety";

describe("payroll acceptance database ownership", () => {
  it.each(["main", "postgres", "arbitrary_test", "titan_payroll_e2e_run", "titan_payroll_e2e_bad-name_test"])("refuses unowned database %s", name => {
    expect(() => assertPayrollTestUrl(`postgresql://postgres@localhost:5433/${name}`)).toThrow();
  });
  it.each(["example.com:5433", "localhost:5432", "127.0.0.1:5432"])("refuses unsafe endpoint %s", host => {
    expect(() => assertPayrollTestUrl(`postgresql://postgres@${host}/titan_payroll_e2e_run_test`)).toThrow();
  });
  it.each(["e2e", "real"])("accepts an owned local %s database", kind => {
    expect(assertPayrollTestUrl(`postgresql://postgres@localhost:5433/titan_payroll_${kind}_abc123_test`).pathname).toMatch(/_test$/);
  });
  it.each(["host=example.com", "port=5432", "database=main", "dbname=main", "user=external", "ssl=true", "%68ost=example.com"])("refuses pg connection query override %s", query => {
    expect(() => assertPayrollTestUrl(`postgresql://postgres@localhost:5433/titan_payroll_e2e_abc_test?${query}`)).toThrow();
    expect(() => assertLocalPayrollPostgresUrl(`postgresql://postgres@localhost:5433/postgres?${query}`)).toThrow();
  });
});

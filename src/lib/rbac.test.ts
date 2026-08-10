import { describe, expect, it } from "vitest";
import {
  PERMISSION_KEYS,
  SYSTEM_ROLE_SEEDS,
  LANDING_PATH_OPTIONS,
  canAccessPath,
  getFirstAccessiblePath,
} from "./rbac";

describe("rbac route rules", () => {
  it("checks specific sales routes before the generic sales matcher", () => {
    expect(canAccessPath("/sales/orders", ["sales.view"])).toBe(false);
    expect(canAccessPath("/sales/orders", ["sales.orders.view"])).toBe(true);
    expect(canAccessPath("/sales/recovery", ["sales.view"])).toBe(false);
    expect(canAccessPath("/sales/recovery", ["sales.recovery.view"])).toBe(true);
    expect(canAccessPath("/sales/people", ["sales.view"])).toBe(false);
    expect(canAccessPath("/sales/people", ["sales.people.view"])).toBe(true);
  });

  it("surfaces order booker as a first-class landing path", () => {
    expect(LANDING_PATH_OPTIONS).toContain("/order-booker");
    expect(canAccessPath("/order-booker", ["order-booker.view"])).toBe(true);
    expect(getFirstAccessiblePath(["order-booker.view"])).toBe("/order-booker");
  });

  it("locks attendance terminal to the dedicated scan permission", () => {
    expect(LANDING_PATH_OPTIONS).toContain("/attendance/scan");
    expect(canAccessPath("/attendance/scan", ["attendance_terminal.scan"])).toBe(
      true,
    );
    expect(canAccessPath("/attendance/scan", ["hr.view"])).toBe(false);
    expect(getFirstAccessiblePath(["attendance_terminal.scan"])).toBe(
      "/attendance/scan",
    );
  });

  it("locks offline attendance tools to offline attendance permission", () => {
    expect(PERMISSION_KEYS).toEqual(
      expect.arrayContaining([
        "attendance.offline.view",
        "attendance.offline.workbooks.manage",
        "attendance.offline.upload",
        "attendance.offline.outage.confirm",
        "attendance.offline.import.review",
        "attendance.offline.audit.view",
      ]),
    );

    const adminSeed = SYSTEM_ROLE_SEEDS.find((role) => role.slug === "admin");
    expect(adminSeed?.permissionKeys).toEqual(
      expect.arrayContaining([
        "attendance.offline.view",
        "attendance.offline.workbooks.manage",
        "attendance.offline.upload",
        "attendance.offline.outage.confirm",
        "attendance.offline.import.review",
        "attendance.offline.audit.view",
      ]),
    );

    expect(
      canAccessPath("/hr/attendance/offline", ["attendance.offline.view"]),
    ).toBe(true);
    expect(canAccessPath("/hr/attendance/offline", ["hr.view"])).toBe(false);
    expect(canAccessPath("/hr/attendance", ["hr.view"])).toBe(true);
  });

  it("gives payment verification and reversal only to approved finance roles", () => {
    expect(PERMISSION_KEYS).toEqual(
      expect.arrayContaining([
        "finance.payments.verify",
        "finance.payments.reverse",
      ]),
    );

    for (const roleSlug of ["admin", "finance-manager"] as const) {
      const role = SYSTEM_ROLE_SEEDS.find((seed) => seed.slug === roleSlug);
      expect(role?.permissionKeys).toEqual(
        expect.arrayContaining([
          "finance.payments.verify",
          "finance.payments.reverse",
        ]),
      );
    }

    expect(
      canAccessPath("/finance/payment-verification", [
        "finance.payments.verify",
      ]),
    ).toBe(true);
    expect(canAccessPath("/finance/payment-verification", ["finance.view"])).toBe(
      false,
    );
  });
});

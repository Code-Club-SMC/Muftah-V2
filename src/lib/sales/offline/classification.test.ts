import { describe, expect, it } from "vitest";
import {
  classifyOfflineSalesInvoice,
  type OfflineClassificationInput,
} from "./classification.server";

const ready: OfflineClassificationInput = {
  parseIssueCodes: [], identityState: "new", workbookStatus: "active",
  distributorUsable: true, productsUsable: true, walletsUsable: true,
  orderState: "not_applicable", hasStockShortage: false,
  creditHoldActive: false, creditLimitExceeded: false, staleSnapshot: false,
};

describe("offline sales live classification", () => {
  it("uses the approved outcome precedence", () => {
    expect(classifyOfflineSalesInvoice(ready).status).toBe("ready");
    expect(classifyOfflineSalesInvoice({ ...ready, hasStockShortage: true })).toEqual({ status: "warning", issueCodes: ["stock_shortage"] });
    expect(classifyOfflineSalesInvoice({ ...ready, identityState: "same" }).status).toBe("duplicate");
    expect(classifyOfflineSalesInvoice({ ...ready, parseIssueCodes: ["missing_items"] }).status).toBe("invalid");
    expect(classifyOfflineSalesInvoice({ ...ready, walletsUsable: false }).status).toBe("needs_review");
  });

  it("does not let warnings hide a reference conflict", () => {
    const result = classifyOfflineSalesInvoice({
      ...ready,
      hasStockShortage: true,
      orderState: "already_invoiced",
    });
    expect(result).toEqual({
      status: "needs_review",
      issueCodes: ["order_already_invoiced"],
    });
  });

  it("makes force-retired workbooks reviewer-visible", () => {
    expect(classifyOfflineSalesInvoice({ ...ready, workbookStatus: "force_retired" })).toEqual({
      status: "warning",
      issueCodes: ["force_retired_workbook"],
    });
  });
});

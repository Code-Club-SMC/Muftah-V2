import { describe, expect, it } from "vitest";
import { planPurchaseRefund } from "@/lib/suppliers/purchase-refund";

const wallets = new Set(["cash", "bank"]);

describe("planPurchaseRefund", () => {
  it("gives everything back to the wallet that paid when nothing is chosen", () => {
    // Paid at purchase time: the wallet is only saved as the method.
    const plan = planPurchaseRefund({ payments: [{ amount: "7000", walletId: null, method: "cash" }], walletIds: wallets });
    expect(plan.paid.toString()).toBe("7000");
    expect(plan.refund.toString()).toBe("7000");
    expect(plan.refundWalletId).toBe("cash");
    expect(plan.loss.toString()).toBe("0");
  });

  it("defaults to the wallet that paid the most when two wallets paid", () => {
    const plan = planPurchaseRefund({
      payments: [
        { amount: "2000", walletId: "bank", method: "bank" },
        { amount: "5000", walletId: null, method: "cash" },
      ],
      walletIds: wallets,
    });
    expect(plan.paid.toString()).toBe("7000");
    expect(plan.defaultWalletId).toBe("cash");
  });

  it("keeps what is not given back as a loss", () => {
    const plan = planPurchaseRefund({
      payments: [{ amount: "7000", walletId: "cash", method: "cash" }],
      walletIds: wallets,
      refundWalletId: "bank",
      refundAmount: "6500",
    });
    expect(plan.refundWalletId).toBe("bank");
    expect(plan.refund.toString()).toBe("6500");
    expect(plan.loss.toString()).toBe("500");
  });

  it("needs no wallet when nothing was paid from one", () => {
    const plan = planPurchaseRefund({ payments: [{ amount: "3500", walletId: "pay_later", method: "pay_later" }], walletIds: wallets });
    expect(plan.paid.toString()).toBe("0");
    expect(plan.refundWalletId).toBeNull();
    expect(plan.moved).toEqual([]);
  });

  it("refuses more than was paid, odd amounts and unknown wallets", () => {
    const payments = [{ amount: "7000", walletId: "cash", method: "cash" }];
    expect(() => planPurchaseRefund({ payments, walletIds: wallets, refundAmount: "7000.01" })).toThrow("more than what was paid");
    expect(() => planPurchaseRefund({ payments, walletIds: wallets, refundAmount: "-5" })).toThrow("must be a number");
    expect(() => planPurchaseRefund({ payments, walletIds: wallets, refundAmount: "10.123" })).toThrow("must be a number");
    expect(() => planPurchaseRefund({ payments, walletIds: wallets, refundWalletId: "ghost", refundAmount: "100" })).toThrow("Pick the wallet");
  });
});

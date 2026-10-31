import { describe, expect, it } from "vitest";
import { amountInWords } from "./amount-in-words";

describe("amountInWords", () => {
  it.each([
    [0, "Zero Rupees Only"],
    [5, "Five Rupees Only"],
    [15, "Fifteen Rupees Only"],
    [85000, "Eighty Five Thousand Rupees Only"],
    [125000, "One Lakh Twenty Five Thousand Rupees Only"],
    [12500000, "One Crore Twenty Five Lakh Rupees Only"],
    [1050.5, "One Thousand Fifty Rupees and Fifty Paisa Only"],
    [0.75, "Seventy Five Paisa Only"],
    [1999.999, "Two Thousand Rupees Only"],
  ])("writes %s as %s", (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });

  it("returns an empty string for negative or invalid amounts", () => {
    expect(amountInWords(-5)).toBe("");
    expect(amountInWords(Number.NaN)).toBe("");
  });
});

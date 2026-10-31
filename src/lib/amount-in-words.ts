const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function convert(num: number): string {
  if (num === 0) return "";
  if (num < 20) return ONES[num];
  if (num < 100) return TENS[Math.floor(num / 10)] + (num % 10 !== 0 ? " " + ONES[num % 10] : "");
  if (num < 1_000) return ONES[Math.floor(num / 100)] + " Hundred" + (num % 100 !== 0 ? " " + convert(num % 100) : "");
  if (num < 1_00_000) return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 !== 0 ? " " + convert(num % 1000) : "");
  if (num < 1_00_00_000) return convert(Math.floor(num / 1_00_000)) + " Lakh" + (num % 1_00_000 !== 0 ? " " + convert(num % 1_00_000) : "");
  return convert(Math.floor(num / 1_00_00_000)) + " Crore" + (num % 1_00_00_000 !== 0 ? " " + convert(num % 1_00_00_000) : "");
}

/** "One Lakh Twenty Five Thousand Rupees Only", using the Pakistani Lakh/Crore grouping. */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  // Work in whole paisa so 1999.999 rounds to 2000 instead of "1999 Rupees and 100 Paisa".
  const totalPaisa = Math.round(amount * 100);
  const rupees = Math.floor(totalPaisa / 100);
  const paisa = totalPaisa % 100;
  if (rupees === 0 && paisa === 0) return "Zero Rupees Only";

  const parts: string[] = [];
  if (rupees > 0) parts.push(`${convert(rupees)} Rupees`);
  if (paisa > 0) parts.push(`${convert(paisa)} Paisa`);
  return `${parts.join(" and ")} Only`;
}

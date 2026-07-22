/**
 * Formats numbers using Pakistani/Indian numbering system
 * 10K = 10,000
 * 1L = 100,000 (1 Lac)
 * 10L = 1,000,000 (10 Lacs)
 * 1Cr = 10,000,000 (1 Crore)
 */
export function formatPakistaniNumber(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(num)) return "0";
  if (num === 0) return "0";

  const absNum = Math.abs(num);

  // Crore (1,00,00,000)
  if (absNum >= 10000000) {
    const crores = (num / 10000000).toFixed(2).replace(/\.?0+$/, "");
    return `${crores}Cr`;
  }

  // Lac (1,00,000)
  if (absNum >= 100000) {
    const lacs = (num / 100000).toFixed(2).replace(/\.?0+$/, "");
    return `${lacs}L`;
  }

  // Thousand (1,000)
  if (absNum >= 1000) {
    const thousands = (num / 1000).toFixed(2).replace(/\.?0+$/, "");
    return `${thousands}K`;
  }

  return num.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Formats currency in Pakistani Rupees (PKR)
 * Returns compact format like "1.2L PKR", "50K PKR", etc.
 */
export function formatPKR(value: number | string, useCompact = true): string {
  const num = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(num)) return "0 PKR";

  if (useCompact) {
    return `${formatPakistaniNumber(num)} PKR`;
  }

  // Standard formatting with thousand separators
  return `${num.toLocaleString("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatPKRPrecise(
  value: number | string,
  decimals = 2,
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(num)) return "PKR 0.00";

  return `${num.toLocaleString("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Formats a number with thousand separators for reports.
 * 10000 => "10,000"
 * 10000.5 => "10,000.50"
 * 5000.000 => "5,000" (trims trailing zeros)
 */
export function formatNumber(value: number | string, decimals = 0): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";

  const hasDecimals = num % 1 !== 0;
  const d = hasDecimals && decimals === 0 ? 2 : decimals;

  return num.toLocaleString("en-PK", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/**
 * Formats a quantity with its unit for reports.
 * 10000, "kg" => "10,000 kg"
 */
export function formatQuantity(value: number | string, unit?: string): string {
  const numStr = formatNumber(value);
  return unit ? `${numStr} ${unit}` : numStr;
}

/**
 * Parses Pakistani formatted number back to decimal
 * "1.5K" => 1500
 * "2L" => 200000
 * "1.5Cr" => 15000000
 */
export function parsePakistaniNumber(value: string): number {
  const cleaned = value.trim().toUpperCase();

  if (cleaned.endsWith("CR")) {
    return parseFloat(cleaned.slice(0, -2)) * 10000000;
  }
  if (cleaned.endsWith("L")) {
    return parseFloat(cleaned.slice(0, -1)) * 100000;
  }
  if (cleaned.endsWith("K")) {
    return parseFloat(cleaned.slice(0, -1)) * 1000;
  }

  return parseFloat(cleaned);
}

/**
 * Formats a number with proper thousand separators (Indian system)
 * 1000000 => "10,00,000"
 */
export function formatIndianStyle(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(num)) return "0";

  const parts = Math.floor(Math.abs(num)).toString().split("");
  const isNegative = num < 0;

  const formatted: string[] = [];

  // Process from right to left
  for (let i = parts.length - 1; i >= 0; i--) {
    const idx = parts.length - 1 - i;

    if (idx > 0 && idx % 2 === 0 && i !== parts.length - 1) {
      formatted.unshift(",");
    }

    formatted.unshift(parts[i]);
  }

  const result = formatted.join("");
  return isNegative ? `-${result}` : result;
}

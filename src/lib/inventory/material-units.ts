// Shoppers measured in KG are counted in kg everywhere. Every other packaging item is in pieces.
export const packagingUnit = (material?: { measuredInKg?: boolean | null } | null) => (material?.measuredInKg ? "kg" : "pcs");

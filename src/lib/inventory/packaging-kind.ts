export const PACKAGING_KINDS = ["bottle", "jerry_can", "sachet", "pouch", "shopper",
  "carton", "bucket", "cap", "sticker", "other"] as const;

export type PackagingKind = typeof PACKAGING_KINDS[number];

export const PACKAGING_KIND_LABELS: Record<PackagingKind, string> = {
  bottle: "Bottle", jerry_can: "Jerry can", sachet: "Sachet", pouch: "Pouch",
  shopper: "Shopper", carton: "Carton", bucket: "Bucket", cap: "Cap",
  sticker: "Sticker", other: "Other",
};

export function packagingKindLabel(material: { packagingKind?: PackagingKind | null; type: string }): string {
  if (material.packagingKind) return PACKAGING_KIND_LABELS[material.packagingKind];
  switch (material.type.toLowerCase()) {
    case "primary": return "Primary packaging";
    case "master": return "Master packaging";
    case "sticker": return "Sticker";
    case "extra": return "Extra packaging";
    default: return "Unspecified packaging";
  }
}

import Big from "big.js";
import { getFillPerContainer } from "./packaging-quantity";

export type PackingLine = {
  fullCartons: number; partialPacks: number; loosePacks: number;
  actualBulk?: string; varianceReason?: string;
};
export type PackingFormat = {
  fillAmount: string | number | null; fillUnit: string | null;
  containersPerCarton: number; usesCartons: boolean;
};

export function packingBulk(value: string, label = "Bulk quantity") {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`${label} must be a nonnegative decimal number`);
  const quantity = new Big(value);
  if (!quantity.round(3).eq(quantity) || quantity.gt("999999999.999")) {
    throw new Error(`${label} must fit three decimal places`);
  }
  return quantity.toFixed(3);
}

export function calculatePackingLine(line: PackingLine, format: PackingFormat, bulkUnit: string) {
  for (const count of [line.fullCartons, line.partialPacks, line.loosePacks]) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 2147483647) {
      throw new Error("Pack and carton counts must be nonnegative whole numbers");
    }
  }
  const capacity = format.containersPerCarton;
  if (format.usesCartons && (!Number.isInteger(capacity) || capacity <= 0)) throw new Error("Carton capacity must be positive");
  if (!format.usesCartons && (line.fullCartons || line.partialPacks)) throw new Error("This format permits outside packs only");
  if (format.usesCartons && line.partialPacks >= capacity) throw new Error("Partial carton packs must be less than carton capacity");
  const totalPacks = line.fullCartons * capacity + line.partialPacks + line.loosePacks;
  if (!Number.isSafeInteger(totalPacks) || totalPacks > 2147483647 || totalPacks <= 0) throw new Error("Enter at least one pack, within the supported count");
  const nominal = getFillPerContainer(format.fillAmount, format.fillUnit, bulkUnit).times(totalPacks);
  const nominalBulk = packingBulk(nominal.toString(), "Pack content");
  const actualBulk = line.actualBulk === undefined ? nominalBulk : packingBulk(line.actualBulk, "Actual bulk used");
  if (new Big(actualBulk).lte(0)) throw new Error("Actual bulk used must be positive");
  if (!new Big(actualBulk).eq(nominalBulk) && !line.varianceReason?.trim()) throw new Error("Give a reason for the measured fill difference");
  return { totalPacks, physicalCartons: line.fullCartons + Number(line.partialPacks > 0), nominalBulk, actualBulk };
}

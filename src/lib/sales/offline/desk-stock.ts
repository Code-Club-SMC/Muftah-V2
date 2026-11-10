import type { OfflineDeskEntry, OfflineDeskReference } from "./desk-pack";
import { formatClock } from "./desk-refresh";
import { calculateOfflineEntry } from "./entry-calculator";

const packs = (count: number) => `${count} pack${count === 1 ? "" : "s"}`;

/** `8 ctn + 4 packs`, `8 ctn`, or `5 packs` when less than a carton. */
export function formatStock(units: number, packsPerCarton: number) {
  const whole = Math.max(0, Math.floor(units));
  if (packsPerCarton > 1 && whole >= packsPerCarton) {
    const cartons = Math.floor(whole / packsPerCarton);
    const loose = whole % packsPerCarton;
    return loose > 0 ? `${cartons} ctn + ${packs(loose)}` : `${cartons} ctn`;
  }
  return packs(whole);
}

/**
 * Packs per product that other invoices on this computer will take out of the
 * factory once they are sent. A sent invoice is the office's now, and a
 * cancelled one never left, so neither counts. The invoice being changed is
 * left out so it does not compete with itself.
 */
export function allocatedUnitsByProduct(
  entries: OfflineDeskEntry[],
  reference: OfflineDeskReference,
  exceptSlot?: number,
) {
  const units = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status === "sent" || entry.status === "cancelled") continue;
    if (exceptSlot !== undefined && entry.slotNumber === exceptSlot) continue;
    for (const item of calculateOfflineEntry(entry, reference, entry.reservedSerial).items) {
      units.set(item.productCode, (units.get(item.productCode) ?? 0) + item.dispatchedUnits);
    }
  }
  return units;
}

/**
 * The note under an invoice line that asks for more than the factory floor had
 * at the last refresh. Never blocks: goods may have been made since, and the
 * office already reviews shortages.
 */
export function lineStockWarning(input: {
  dispatchedUnits: number;
  /** Packs on hand at the last refresh. Undefined when the pack was saved before stock was sent. */
  stockUnits: number | undefined;
  /** Packs already promised on other unsent invoices. */
  allocatedUnits: number;
  packsPerCarton: number;
  /** When the server built the copy, as an ISO time. */
  asOf: string;
  now: Date;
}) {
  if (input.stockUnits === undefined) return null;
  const left = Math.max(0, input.stockUnits - input.allocatedUnits);
  if (input.dispatchedUnits <= left) return null;
  const at = formatClock(new Date(input.asOf), input.now);
  const others =
    input.allocatedUnits > 0
      ? ` (${formatStock(input.allocatedUnits, input.packsPerCarton)} already on other unsent invoices)`
      : "";
  return `Only ${formatStock(left, input.packsPerCarton)} in stock as of ${at}${others}. You can still save.`;
}

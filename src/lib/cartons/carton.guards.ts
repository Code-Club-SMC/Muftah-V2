import type { CartonStatus } from "./carton.types";
import {
  CapacityExceededError,
  CartonAlreadyDispatchedError,
  CartonLockedError,
  CartonOnHoldError,
  CrossSkuError,
  InsufficientPacksError,
} from "./carton.errors";

interface CartonLike {
  id: string;
  status: string;
  currentPacks: number;
  capacity: number;
  sku: string | null | undefined;
}

export function assertCartonIsEditable(carton: CartonLike): void {
  if (["DISPATCHED", "RETIRED"].includes(carton.status)) {
    throw new CartonLockedError(
      `Carton ${carton.id} has status ${carton.status} and cannot be modified.`,
    );
  }
  if (carton.status === "ON_HOLD") {
    throw new CartonOnHoldError(
      `Carton ${carton.id} is on QC hold. Contact the Quality team to proceed.`,
    );
  }
}

export function assertNotOverCapacity(carton: CartonLike, delta: number): void {
  const available = carton.capacity - carton.currentPacks;
  if (delta > available) {
    throw new CapacityExceededError(
      `Adding ${delta} packs would exceed capacity. Available space: ${available} pack${available === 1 ? "" : "s"}.`,
    );
  }
}

export function assertNotUnderZero(carton: CartonLike, delta: number): void {
  if (carton.currentPacks + delta < 0) {
    throw new InsufficientPacksError(
      `Cannot remove ${Math.abs(delta)} packs. Current count is only ${carton.currentPacks}.`,
    );
  }
}

export function assertSameSku(cartonA: CartonLike, cartonB: CartonLike): void {
  if (cartonA.sku && cartonB.sku && cartonA.sku !== cartonB.sku) {
    throw new CrossSkuError(
      `Cannot operate across different SKUs: ${cartonA.sku} and ${cartonB.sku}.`,
    );
  }
}

export function assertNotDispatched(carton: CartonLike): void {
  if (carton.status === "DISPATCHED") {
    throw new CartonAlreadyDispatchedError(
      `Carton ${carton.id} has been dispatched and cannot be modified directly. Use the Returns flow to adjust dispatched inventory.`,
    );
  }
}

export function assertNewCapacityValid(
  carton: CartonLike,
  newCapacity: number,
): void {
  if (newCapacity < carton.currentPacks) {
    throw new CapacityExceededError(
      `New capacity (${newCapacity}) cannot be less than the current pack count (${carton.currentPacks}). Remove packs first.`,
    );
  }
}

export function deriveCartonStatus(
  packsAfter: number,
  capacity: number,
): CartonStatus {
  if (packsAfter === 0) return "ARCHIVED";
  if (packsAfter === capacity) return "COMPLETE";
  return "PARTIAL";
}

export function assertCanTopUp(carton: CartonLike, delta: number): void {
  if (carton.status === "COMPLETE") {
    throw new CapacityExceededError(
      `Carton ${carton.id} is already full (${carton.capacity}/${carton.capacity}). No room to add packs.`,
    );
  }
  assertCartonIsEditable(carton);
  assertNotOverCapacity(carton, delta);
}

export function assertCanRemove(carton: CartonLike, delta: number): void {
  assertCartonIsEditable(carton);
  assertNotUnderZero(carton, -delta);
}
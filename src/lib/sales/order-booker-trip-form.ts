import { format } from "date-fns";
import { z } from "zod";

export const ORDER_BOOKER_SHOP_TYPE_OPTIONS = [
  { value: "old", label: "Old Shop" },
  { value: "new", label: "New Shop" },
] as const;

export const ORDER_BOOKER_VEHICLE_TYPE_OPTIONS = [
  { value: "own_vehicle", label: "Own Vehicle" },
  { value: "company_vehicle", label: "Company Vehicle" },
] as const;

export type OrderBookerShopType = (typeof ORDER_BOOKER_SHOP_TYPE_OPTIONS)[number]["value"];
export type OrderBookerVehicleType = (typeof ORDER_BOOKER_VEHICLE_TYPE_OPTIONS)[number]["value"];

export interface OrderBookerTripFormValues {
  tripDate: string;
  destination: string;
  shopType: OrderBookerShopType;
  distanceKm: string | number;
  vehicleType: OrderBookerVehicleType;
  fuelCost: string | number;
  notes: string;
}

export interface NormalizedOrderBookerTripFormValues {
  tripDate: string;
  destination: string;
  shopType: OrderBookerShopType;
  distanceKm: number;
  vehicleType: OrderBookerVehicleType;
  fuelCost: number;
  notes?: string;
}

function numberFromInput(minMessage: string) {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) return 0;
    return value;
  }, z.coerce.number().finite().min(0, minMessage));
}

export const orderBookerTripFormSchema = z.object({
  tripDate: z.string().min(1, "Trip date is required"),
  destination: z.string().trim().min(1, "Destination is required"),
  shopType: z.enum(["old", "new"], "Select old shop or new shop"),
  distanceKm: numberFromInput("Distance must be 0 or more"),
  vehicleType: z.enum(["own_vehicle", "company_vehicle"]),
  fuelCost: numberFromInput("Fuel cost must be 0 or more"),
  notes: z.string().optional().default(""),
});

export function createDefaultOrderBookerTripFormValues(): OrderBookerTripFormValues {
  return {
    tripDate: format(new Date(), "yyyy-MM-dd"),
    destination: "",
    shopType: "old",
    distanceKm: "",
    vehicleType: "own_vehicle",
    fuelCost: "",
    notes: "",
  };
}

export function parseOrderBookerTripForm(
  values: OrderBookerTripFormValues,
): NormalizedOrderBookerTripFormValues {
  const parsed = orderBookerTripFormSchema.parse(values);
  const notes = parsed.notes.trim();

  return {
    tripDate: parsed.tripDate,
    destination: parsed.destination.trim(),
    shopType: parsed.shopType,
    distanceKm: parsed.distanceKm,
    vehicleType: parsed.vehicleType,
    fuelCost: parsed.vehicleType === "company_vehicle" ? 0 : parsed.fuelCost,
    notes: notes.length > 0 ? notes : undefined,
  };
}

export function getOrderBookerTripFormError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Please check the trip details";
  }
  return "Please check the trip details";
}

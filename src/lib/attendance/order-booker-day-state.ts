export const ORDER_BOOKER_TRIP_ENTRY_SOURCE = "order_booker_trip" as const;

export const ORDER_BOOKER_SHOP_TYPES = ["old", "new"] as const;

export const ORDER_BOOKER_BLOCKING_STATUSES = [
  "rest_day",
  "holiday",
  "leave",
  "absent",
] as const;

export type OrderBookerShopType = (typeof ORDER_BOOKER_SHOP_TYPES)[number];

export type AttendanceEntrySource =
  | "biometric"
  | "manual"
  | "qr_terminal"
  | typeof ORDER_BOOKER_TRIP_ENTRY_SOURCE;

export type OrderBookerBlockingStatus =
  (typeof ORDER_BOOKER_BLOCKING_STATUSES)[number];

export type OrderBookerManualStatus = "present" | "absent" | "leave" | "holiday";

export type OrderBookerDerivedStatus =
  | "pending_review"
  | "trip_present"
  | "manual_override"
  | OrderBookerBlockingStatus;

export type OrderBookerTripBlockReason =
  | OrderBookerBlockingStatus
  | "order_booker_not_linked_to_employee"
  | "employee_inactive";

export interface OrderBookerTripEligibility {
  employeeId: string;
  orderBookerId: string;
  businessDate: string;
  isRestDay: boolean;
  blockingStatus: OrderBookerBlockingStatus | null;
  hasManualAttendanceRow: boolean;
  manualStatus: OrderBookerManualStatus | null;
  existingTripCount: number;
}

export interface OrderBookerTripEligibilityResult
  extends OrderBookerTripEligibility {
  isAllowed: boolean;
  reason: OrderBookerTripBlockReason | null;
  reasonMessage: string | null;
  attendanceRowId: string | null;
  attendanceEntrySource: AttendanceEntrySource | string | null;
  employeeStatus: string | null;
  standardDutyHours: number;
}

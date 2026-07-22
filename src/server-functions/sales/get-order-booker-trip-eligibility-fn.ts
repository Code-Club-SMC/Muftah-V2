import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { requireSalesPeopleManageMiddleware } from "@/lib/middlewares";
import { resolveOrderBookerTripEligibility } from "./order-booker-trip-day-state";

export const getOrderBookerTripEligibilityFn = createServerFn()
  .middleware([requireSalesPeopleManageMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderBookerId: z.string().min(1),
        tripDate: z.string().or(z.date()),
        excludeTripId: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    return await resolveOrderBookerTripEligibility({
      tx: db,
      orderBookerId: data.orderBookerId,
      tripDate: data.tripDate,
      excludeTripId: data.excludeTripId,
    });
  });

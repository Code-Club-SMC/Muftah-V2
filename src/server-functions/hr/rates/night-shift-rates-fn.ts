import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { nightShiftRates } from "@/db/schemas/hr-schema";
import {
    requireHrManageMiddleware,
    requireHrViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

/**
 * Get the current year's night shift rate.
 * Falls back to the most recent year's rate if no rate is set for the current year.
 */
export const getCurrentNightShiftRateFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .handler(async () => {
        const currentYear = new Date().getFullYear();

        // Try current year first
        let rate = await db.query.nightShiftRates.findFirst({
            where: eq(nightShiftRates.year, currentYear),
        });

        // Fallback to the most recent year
        if (!rate) {
            rate = await db.query.nightShiftRates.findFirst({
                orderBy: [desc(nightShiftRates.year)],
            });
        }

        return rate ?? null;
    });

/**
 * List all night shift rate configurations (historical).
 */
export const listNightShiftRatesFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .handler(async () => {
        return await db.query.nightShiftRates.findMany({
            with: {
                setter: { columns: { id: true, name: true } },
            },
            orderBy: [desc(nightShiftRates.year)],
        });
    });

/**
 * Set or update the night shift rate for a specific year.
 * If a rate already exists for the year, it updates it.
 */
export const upsertNightShiftRateFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            year: z.number().min(2020).max(2100),
            ratePerNight: z.number().positive("Rate must be positive"),
            remarks: z.string().optional(),
        })
    )
    .handler(async ({ data, context }) => {
        const existing = await db.query.nightShiftRates.findFirst({
            where: eq(nightShiftRates.year, data.year),
        });

        if (existing) {
            const [updated] = await db
                .update(nightShiftRates)
                .set({
                    ratePerNight: data.ratePerNight.toString(),
                    remarks: data.remarks || null,
                    setBy: context.session.user.id,
                })
                .where(eq(nightShiftRates.id, existing.id))
                .returning();
            return updated;
        } else {
            const [inserted] = await db
                .insert(nightShiftRates)
                .values({
                    year: data.year,
                    ratePerNight: data.ratePerNight.toString(),
                    remarks: data.remarks || null,
                    setBy: context.session.user.id,
                })
                .returning();
            return inserted;
        }
    });

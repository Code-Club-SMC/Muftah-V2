import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { tadaRates, travelLogs } from "@/db/schemas/hr-schema";
import {
    requireHrManageMiddleware,
    requireHrViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import { eq, desc, and, gte, lte } from "drizzle-orm";

// ────────────────────────────────────────────────────────────────────────────
// TA/DA RATE CONFIG
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get the currently active TA/DA rate per km.
 */
export const getActiveTadaRateFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .handler(async () => {
        const rate = await db.query.tadaRates.findFirst({
            where: eq(tadaRates.isActive, true),
            orderBy: [desc(tadaRates.effectiveFrom)],
        });
        return rate ?? null;
    });

/**
 * List all TA/DA rate history.
 */
export const listTadaRatesFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .handler(async () => {
        return await db.query.tadaRates.findMany({
            with: {
                setter: { columns: { id: true, name: true } },
            },
            orderBy: [desc(tadaRates.effectiveFrom)],
        });
    });

/**
 * Set a new TA/DA rate. Deactivates all previous rates.
 */
export const setTadaRateFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            ratePerKm: z.number().positive("Rate must be positive"),
            effectiveFrom: z.string(), // YYYY-MM-DD
            remarks: z.string().optional(),
        })
    )
    .handler(async ({ data, context }) => {
        return await db.transaction(async (tx) => {
            // Deactivate all existing rates
            await tx
                .update(tadaRates)
                .set({ isActive: false });

            // Insert the new active rate
            const [inserted] = await tx
                .insert(tadaRates)
                .values({
                    ratePerKm: data.ratePerKm.toString(),
                    effectiveFrom: data.effectiveFrom,
                    remarks: data.remarks || null,
                    isActive: true,
                    setBy: context.session.user.id,
                })
                .returning();

            return inserted;
        });
    });

/**
 * Update an existing TA/DA rate's effective from date and/or rate per km.
 */
export const updateTadaRateFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            id: z.string(),
            ratePerKm: z.number().positive("Rate must be positive").optional(),
            effectiveFrom: z.string().optional(), // YYYY-MM-DD
            remarks: z.string().optional(),
        })
    )
    .handler(async ({ data }) => {
        const updateData: any = {};
        if (data.ratePerKm !== undefined) {
            updateData.ratePerKm = data.ratePerKm.toString();
        }
        if (data.effectiveFrom !== undefined) {
            updateData.effectiveFrom = data.effectiveFrom;
        }
        if (data.remarks !== undefined) {
            updateData.remarks = data.remarks || null;
        }

        const [updated] = await db
            .update(tadaRates)
            .set(updateData)
            .where(eq(tadaRates.id, data.id))
            .returning();

        return updated;
    });

// ────────────────────────────────────────────────────────────────────────────
// TRAVEL LOGS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Log a new trip for an employee.
 * Automatically snapshots the current active TA/DA rate.
 */
export const createTravelLogFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            employeeId: z.string(),
            date: z.string(), // YYYY-MM-DD
            destination: z.string().min(1, "Destination is required"),
            roundTripKm: z.number().positive("Distance must be positive"),
            purpose: z.string().optional(),
        })
    )
    .handler(async ({ data }) => {
        // Snapshot the rate that was effective on the trip date.
        const activeRate = await db.query.tadaRates.findFirst({
            where: lte(tadaRates.effectiveFrom, data.date),
            orderBy: [desc(tadaRates.effectiveFrom)],
        });

        if (!activeRate) {
            throw new Error(
                `No TA/DA rate was effective on ${data.date}. Please configure a historical rate first.`
            );
        }

        const ratePerKm = parseFloat(activeRate.ratePerKm);
        const totalAmount = data.roundTripKm * ratePerKm;

        const [inserted] = await db
            .insert(travelLogs)
            .values({
                employeeId: data.employeeId,
                date: data.date,
                destination: data.destination,
                roundTripKm: data.roundTripKm.toString(),
                rateApplied: ratePerKm.toString(),
                totalAmount: totalAmount.toFixed(2),
                purpose: data.purpose || null,
                status: "pending",
            })
            .returning();

        return inserted;
    });

/**
 * List travel logs for an employee, optionally filtered by date range.
 */
export const listTravelLogsFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .inputValidator(
        z.object({
            employeeId: z.string().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            status: z.enum(["pending", "approved", "rejected", "all"]).optional().default("all"),
            limit: z.number().optional().default(50),
        })
    )
    .handler(async ({ data }) => {
        const filters: any[] = [];

        if (data.employeeId) {
            filters.push(eq(travelLogs.employeeId, data.employeeId));
        }
        if (data.startDate) {
            filters.push(gte(travelLogs.date, data.startDate));
        }
        if (data.endDate) {
            filters.push(lte(travelLogs.date, data.endDate));
        }
        if (data.status && data.status !== "all") {
            filters.push(eq(travelLogs.status, data.status));
        }

        return await db.query.travelLogs.findMany({
            where: filters.length > 0 ? and(...filters) : undefined,
            with: {
                employee: {
                    columns: {
                        id: true,
                        employeeCode: true,
                        firstName: true,
                        lastName: true,
                        designation: true,
                    },
                },
                approver: {
                    columns: { id: true, name: true },
                },
            },
            orderBy: [desc(travelLogs.date)],
            limit: data.limit,
        });
    });

/**
 * Approve or reject a travel log entry.
 */
export const processTravelLogFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            id: z.string(),
            status: z.enum(["approved", "rejected"]),
        })
    )
    .handler(async ({ data, context }) => {
        const [updated] = await db
            .update(travelLogs)
            .set({
                status: data.status,
                approvedBy: context.session.user.id,
            })
            .where(eq(travelLogs.id, data.id))
            .returning();

        return updated;
    });

/**
 * Get total approved TA/DA for an employee within a payroll period.
 * Used by the payroll calculator to add TA/DA to earnings.
 */
export const getEmployeeTadaTotalFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .inputValidator(
        z.object({
            employeeId: z.string(),
            startDate: z.string(),
            endDate: z.string(),
        })
    )
    .handler(async ({ data }) => {
        const approvedLogs = await db.query.travelLogs.findMany({
            where: and(
                eq(travelLogs.employeeId, data.employeeId),
                eq(travelLogs.status, "approved"),
                gte(travelLogs.date, data.startDate),
                lte(travelLogs.date, data.endDate)
            ),
        });

        const totalKm = approvedLogs.reduce(
            (sum, l) => sum + parseFloat(l.roundTripKm || "0"),
            0
        );
        const totalAmount = approvedLogs.reduce(
            (sum, l) => sum + parseFloat(l.totalAmount || "0"),
            0
        );

        return {
            trips: approvedLogs.length,
            totalKm: +totalKm.toFixed(2),
            totalAmount: +totalAmount.toFixed(2),
            logs: approvedLogs,
        };
    });

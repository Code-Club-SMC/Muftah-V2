/**
 * Sales returns / credit notes workflow.
 */

import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import {
  finishedGoodsStock,
  returnedFinishedGoodsStock,
} from "@/db/schemas/inventory-schema";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import {
  salesReturns,
  salesReturnItems,
  salesReturnStockTraces,
  slipRecords,
} from "@/db/schemas/sales-erp-schema";
import { recordInvoiceTimelineEvent } from "./invoice-timeline-log";
import {
  requireSalesViewMiddleware,
  requireSalesManageMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

function getUnitsPerCarton(item: {
  packsPerCarton?: number | null;
  actualPackSize?: number | null;
}) {
  return item.packsPerCarton || item.actualPackSize || 1;
}

function getTotalUnits(cartons: number, quantity: number, unitsPerCarton: number) {
  return cartons * unitsPerCarton + quantity;
}

function calculateInboundStockState(params: {
  existingCartons: number;
  existingContainers: number;
  existingTotalInventoryValue: number;
  unitsPerCarton: number;
  inboundCartons: number;
  inboundContainers: number;
  inboundCostPerUnit: number;
}) {
  const existingUnits =
    params.existingCartons * params.unitsPerCarton + params.existingContainers;
  const inboundUnits =
    params.inboundCartons * params.unitsPerCarton + params.inboundContainers;
  const nextUnits = existingUnits + inboundUnits;
  const nextTotalInventoryValue =
    params.existingTotalInventoryValue + inboundUnits * params.inboundCostPerUnit;
  const nextCartons = Math.floor(nextUnits / params.unitsPerCarton);
  const nextContainers = nextUnits % params.unitsPerCarton;
  const nextWacPerPack =
    nextUnits > 0 ? nextTotalInventoryValue / nextUnits : 0;
  const nextWacPerCarton = nextWacPerPack * params.unitsPerCarton;

  return {
    nextCartons,
    nextContainers,
    nextTotalInventoryValue,
    nextWacPerPack,
    nextWacPerCarton,
  };
}

async function getReturnedUnitsByInvoiceItem(
  tx: any,
  invoiceId: string,
  invoiceItemIds: string[],
  statuses: Array<"pending" | "approved">,
  excludeReturnId?: string,
) {
  if (invoiceItemIds.length === 0) {
    return new Map<string, number>();
  }

  const priorReturnItems = await tx.query.salesReturnItems.findMany({
    where: inArray(salesReturnItems.invoiceItemId, invoiceItemIds),
    with: {
      salesReturn: {
        columns: {
          id: true,
          invoiceId: true,
          status: true,
        },
      },
      invoiceItem: {
        columns: {
          packsPerCarton: true,
          actualPackSize: true,
        },
      },
    },
  });

  const totals = new Map<string, number>();

  for (const returnItem of priorReturnItems) {
    if (returnItem.salesReturn.invoiceId !== invoiceId) {
      continue;
    }
    if (!statuses.includes(returnItem.salesReturn.status as (typeof statuses)[number])) {
      continue;
    }
    if (excludeReturnId && returnItem.salesReturn.id === excludeReturnId) {
      continue;
    }

    const unitsPerCarton = getUnitsPerCarton(returnItem.invoiceItem);
    const totalUnits = getTotalUnits(
      returnItem.cartonsReturned ?? 0,
      returnItem.quantityReturned ?? 0,
      unitsPerCarton,
    );

    totals.set(
      returnItem.invoiceItemId,
      (totals.get(returnItem.invoiceItemId) ?? 0) + totalUnits,
    );
  }

  return totals;
}

// ── GET RETURNS FOR INVOICE ────────────────────────────────────────────────

export const getSalesReturnsByInvoiceFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ invoiceId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    return await db.query.salesReturns.findMany({
      where: eq(salesReturns.invoiceId, data.invoiceId),
      with: {
        items: {
          with: {
            invoiceItem: true,
            recipe: { columns: { id: true, name: true } },
          },
        },
        approvedBy: { columns: { id: true, name: true } },
        stockTraces: {
          with: {
            recipe: { columns: { id: true, name: true } },
            warehouse: { columns: { id: true, name: true } },
          },
        },
      },
      orderBy: [desc(salesReturns.returnDate)],
    });
  });

// ── GET RETURN DETAIL ──────────────────────────────────────────────────────

export const getSalesReturnDetailFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ returnId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const salesReturn = await db.query.salesReturns.findFirst({
      where: eq(salesReturns.id, data.returnId),
      with: {
        invoice: {
          columns: { id: true, slipNumber: true, totalPrice: true, status: true },
        },
        customer: { columns: { id: true, name: true } },
        approvedBy: { columns: { id: true, name: true } },
        items: {
          with: {
            invoiceItem: true,
            recipe: { columns: { id: true, name: true } },
          },
        },
        stockTraces: {
          with: {
            recipe: { columns: { id: true, name: true } },
            warehouse: { columns: { id: true, name: true } },
          },
        },
      },
    });
    if (!salesReturn) throw new Error("Return not found");
    return salesReturn;
  });

// ── CREATE RETURN ──────────────────────────────────────────────────────────

export const createSalesReturnFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        invoiceId: z.string().min(1),
        returnDate: z.string().optional(),
        reason: z.string().min(1, "Reason is required"),
        condition: z.enum(["good", "damaged", "expired"]).default("good"),
        notes: z.string().optional(),
        items: z
          .array(
            z.object({
              invoiceItemId: z.string().min(1),
              cartonsReturned: z.number().int().min(0).default(0),
              quantityReturned: z.number().int().min(0).default(0),
              refundPerUnit: z.number().min(0),
            }),
          )
          .min(1, "At least one return item is required"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const invoice = await tx.query.invoices.findFirst({
        where: eq(invoices.id, data.invoiceId),
        with: { items: true, customer: true },
      });
      if (!invoice) throw new Error("Invoice not found");
      if (!invoice.customer) throw new Error("Invoice has no linked customer");

      const invoiceItemMap = new Map(invoice.items.map((i) => [i.id, i]));
      const requestUnitsByItem = new Map<string, number>();
      const reservedUnitsByItem = await getReturnedUnitsByInvoiceItem(
        tx,
        data.invoiceId,
        data.items.map((item) => item.invoiceItemId),
        ["pending", "approved"],
      );
      let totalAmount = 0;

      for (const item of data.items) {
        const invoiceItem = invoiceItemMap.get(item.invoiceItemId);
        if (!invoiceItem) throw new Error("Invoice item not found");

        const cartons = item.cartonsReturned ?? 0;
        const units = item.quantityReturned ?? 0;
        const cpp = getUnitsPerCarton(invoiceItem);
        const totalUnitsReturned = getTotalUnits(cartons, units, cpp);
        if (totalUnitsReturned <= 0) {
          throw new Error(`Return quantity must be greater than zero for ${invoiceItem.pack}`);
        }
        const totalUnitsInvoiced = getTotalUnits(
          invoiceItem.numberOfCartons,
          invoiceItem.quantity,
          cpp,
        );
        requestUnitsByItem.set(
          item.invoiceItemId,
          (requestUnitsByItem.get(item.invoiceItemId) ?? 0) + totalUnitsReturned,
        );
        const alreadyReservedUnits = reservedUnitsByItem.get(item.invoiceItemId) ?? 0;
        const remainingReturnableUnits = Math.max(
          0,
          totalUnitsInvoiced - alreadyReservedUnits,
        );

        if ((requestUnitsByItem.get(item.invoiceItemId) ?? 0) > remainingReturnableUnits) {
          throw new Error(
            `Return quantity exceeds remaining returnable quantity for ${invoiceItem.pack}`,
          );
        }

        const refundPerUnit =
          item.refundPerUnit ??
          (Number(invoiceItem.retailPrice || 0) || Number(invoiceItem.perCartonPrice) / cpp);
        const lineRefund = totalUnitsReturned * refundPerUnit;
        totalAmount += lineRefund;
      }

      const [salesReturn] = await tx
        .insert(salesReturns)
        .values({
          id: createId(),
          invoiceId: data.invoiceId,
          customerId: invoice.customerId,
          returnDate: data.returnDate ? new Date(data.returnDate) : new Date(),
          reason: data.reason,
          condition: data.condition,
          totalAmount: totalAmount.toFixed(2),
          status: "pending",
          notes: data.notes ?? null,
        })
        .returning();

      await tx.insert(salesReturnItems).values(
        data.items.map((item) => {
          const invoiceItem = invoiceItemMap.get(item.invoiceItemId)!;
          const cpp = getUnitsPerCarton(invoiceItem);
          const cartons = item.cartonsReturned ?? 0;
          const units = item.quantityReturned ?? 0;
          const totalUnitsReturned = getTotalUnits(cartons, units, cpp);
          const refundPerUnit =
            item.refundPerUnit ??
            (Number(invoiceItem.retailPrice || 0) || Number(invoiceItem.perCartonPrice) / cpp);
          const lineRefund = totalUnitsReturned * refundPerUnit;

          return {
            id: createId(),
            salesReturnId: salesReturn.id,
            invoiceItemId: item.invoiceItemId,
            recipeId: invoiceItem.recipeId,
            cartonsReturned: cartons,
            quantityReturned: units,
            refundPerUnit: refundPerUnit.toFixed(2),
            totalRefund: lineRefund.toFixed(2),
          };
        }),
      );

      await recordInvoiceTimelineEvent(
        {
          invoiceId: data.invoiceId,
          eventType: "return",
          title: `Return request #${salesReturn.returnNumber} created`,
          description: `Return of PKR ${totalAmount.toFixed(2)} recorded. Status: pending. Reason: ${data.reason}.`,
          metadata: {
            salesReturnId: salesReturn.id,
            returnNumber: salesReturn.returnNumber,
            totalAmount,
            reason: data.reason,
            condition: data.condition,
          },
          actorId: userId,
        },
        tx,
      );

      return salesReturn;
    });
  });

// ── APPROVE / REJECT RETURN ────────────────────────────────────────────────

export const processSalesReturnFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        returnId: z.string().min(1),
        action: z.enum(["approve", "reject"]),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const salesReturn = await tx.query.salesReturns.findFirst({
        where: eq(salesReturns.id, data.returnId),
        with: { items: true, invoice: true },
      });
      if (!salesReturn) throw new Error("Return not found");
      if (salesReturn.status !== "pending") {
        throw new Error("Return has already been processed");
      }

      const newStatus = data.action === "approve" ? "approved" : "rejected";
      const [updated] = await tx
        .update(salesReturns)
        .set({
          status: newStatus,
          approvedById: userId,
          approvedAt: new Date(),
          notes: data.notes ?? salesReturn.notes,
          updatedAt: new Date(),
        })
        .where(eq(salesReturns.id, data.returnId))
        .returning();

      if (data.action === "approve" && salesReturn.invoice) {
        // Reduce customer credit by return amount if invoice was on credit
        const returnAmount = Number(salesReturn.totalAmount);
        const invoiceItemIds = salesReturn.items.map((item) => item.invoiceItemId);
        const approvedUnitsByItem = await getReturnedUnitsByInvoiceItem(
          tx,
          salesReturn.invoiceId,
          invoiceItemIds,
          ["approved"],
          salesReturn.id,
        );
        const invoiceItemRows = await tx.query.invoiceItems.findMany({
          where: inArray(invoiceItems.id, invoiceItemIds),
        });
        const invoiceItemMap = new Map(invoiceItemRows.map((item) => [item.id, item]));

        for (const returnItem of salesReturn.items) {
          const invoiceItem = invoiceItemMap.get(returnItem.invoiceItemId);
          if (!invoiceItem) {
            throw new Error("Invoice item not found for return approval");
          }
          if (!invoiceItem.recipeId) {
            throw new Error(`Invoice item "${invoiceItem.pack}" cannot be restocked because it has no recipe mapping`);
          }
          const stockWarehouseId =
            salesReturn.invoice.stockWarehouseId ?? salesReturn.invoice.warehouseId;
          if (!stockWarehouseId) {
            throw new Error("Invoice warehouse is required to restock approved returns");
          }

          const unitsPerCarton = getUnitsPerCarton(invoiceItem);
          const requestedUnits = getTotalUnits(
            returnItem.cartonsReturned ?? 0,
            returnItem.quantityReturned ?? 0,
            unitsPerCarton,
          );
          const alreadyApprovedUnits =
            approvedUnitsByItem.get(returnItem.invoiceItemId) ?? 0;
          const totalUnitsInvoiced = getTotalUnits(
            invoiceItem.numberOfCartons,
            invoiceItem.quantity,
            unitsPerCarton,
          );

          if (alreadyApprovedUnits + requestedUnits > totalUnitsInvoiced) {
            throw new Error(
              `Approving this return would exceed sold quantity for ${invoiceItem.pack}`,
            );
          }

          const inboundCostPerUnit =
            Number(invoiceItem.costOfGoodsSoldPerUnit || 0) > 0
              ? Number(invoiceItem.costOfGoodsSoldPerUnit)
              : Number(invoiceItem.perCartonPrice || 0) / unitsPerCarton;
          const inboundCartons = returnItem.cartonsReturned ?? 0;
          const inboundContainers = returnItem.quantityReturned ?? 0;
          const totalUnitsMoved = getTotalUnits(
            inboundCartons,
            inboundContainers,
            unitsPerCarton,
          );
          const destination =
            salesReturn.condition === "good" ? "sellable" : salesReturn.condition;

          if (salesReturn.condition === "good") {
            const existingSellableStock = await tx.query.finishedGoodsStock.findFirst({
              where: and(
                eq(finishedGoodsStock.warehouseId, stockWarehouseId),
                eq(finishedGoodsStock.recipeId, invoiceItem.recipeId),
              ),
            });

            const nextState = calculateInboundStockState({
              existingCartons: existingSellableStock?.quantityCartons ?? 0,
              existingContainers: existingSellableStock?.quantityContainers ?? 0,
              existingTotalInventoryValue: Number(existingSellableStock?.totalInventoryValue ?? 0),
              unitsPerCarton,
              inboundCartons,
              inboundContainers,
              inboundCostPerUnit,
            });

            if (existingSellableStock) {
              await tx
                .update(finishedGoodsStock)
                .set({
                  quantityCartons: nextState.nextCartons,
                  quantityContainers: nextState.nextContainers,
                  weightedAverageCostPerPack: nextState.nextWacPerPack.toFixed(4),
                  weightedAverageCostPerCarton: nextState.nextWacPerCarton.toFixed(4),
                  totalInventoryValue: nextState.nextTotalInventoryValue.toFixed(2),
                  updatedAt: new Date(),
                })
                .where(eq(finishedGoodsStock.id, existingSellableStock.id));
            } else {
              await tx.insert(finishedGoodsStock).values({
                id: createId(),
                warehouseId: stockWarehouseId,
                recipeId: invoiceItem.recipeId,
                quantityCartons: nextState.nextCartons,
                quantityContainers: nextState.nextContainers,
                weightedAverageCostPerPack: nextState.nextWacPerPack.toFixed(4),
                weightedAverageCostPerCarton: nextState.nextWacPerCarton.toFixed(4),
                totalInventoryValue: nextState.nextTotalInventoryValue.toFixed(2),
              });
            }
          } else {
            const existingReturnedStock = await tx.query.returnedFinishedGoodsStock.findFirst({
              where: and(
                eq(returnedFinishedGoodsStock.warehouseId, stockWarehouseId),
                eq(returnedFinishedGoodsStock.recipeId, invoiceItem.recipeId),
                eq(returnedFinishedGoodsStock.condition, salesReturn.condition),
              ),
            });

            const nextState = calculateInboundStockState({
              existingCartons: existingReturnedStock?.quantityCartons ?? 0,
              existingContainers: existingReturnedStock?.quantityContainers ?? 0,
              existingTotalInventoryValue: Number(existingReturnedStock?.totalInventoryValue ?? 0),
              unitsPerCarton,
              inboundCartons,
              inboundContainers,
              inboundCostPerUnit,
            });

            if (existingReturnedStock) {
              await tx
                .update(returnedFinishedGoodsStock)
                .set({
                  quantityCartons: nextState.nextCartons,
                  quantityContainers: nextState.nextContainers,
                  weightedAverageCostPerPack: nextState.nextWacPerPack.toFixed(4),
                  weightedAverageCostPerCarton: nextState.nextWacPerCarton.toFixed(4),
                  totalInventoryValue: nextState.nextTotalInventoryValue.toFixed(2),
                  updatedAt: new Date(),
                })
                .where(eq(returnedFinishedGoodsStock.id, existingReturnedStock.id));
            } else {
              await tx.insert(returnedFinishedGoodsStock).values({
                id: createId(),
                warehouseId: stockWarehouseId,
                recipeId: invoiceItem.recipeId,
                condition: salesReturn.condition,
                quantityCartons: nextState.nextCartons,
                quantityContainers: nextState.nextContainers,
                weightedAverageCostPerPack: nextState.nextWacPerPack.toFixed(4),
                weightedAverageCostPerCarton: nextState.nextWacPerCarton.toFixed(4),
                totalInventoryValue: nextState.nextTotalInventoryValue.toFixed(2),
              });
            }
          }

          await tx.insert(salesReturnStockTraces).values({
            id: createId(),
            salesReturnId: salesReturn.id,
            salesReturnItemId: returnItem.id,
            invoiceId: salesReturn.invoiceId,
            invoiceItemId: returnItem.invoiceItemId,
            warehouseId: stockWarehouseId,
            recipeId: invoiceItem.recipeId,
            destination,
            condition: salesReturn.condition,
            cartonsMoved: inboundCartons,
            quantityMoved: inboundContainers,
            totalUnitsMoved,
            costPerUnit: inboundCostPerUnit.toFixed(4),
            totalCost: (totalUnitsMoved * inboundCostPerUnit).toFixed(2),
          });
        }

        await tx
          .update(customers)
          .set({
            credit: sql`${customers.credit} - ${returnAmount.toFixed(2)}`,
            payment: sql`${customers.payment} + ${returnAmount.toFixed(2)}`,
          })
          .where(eq(customers.id, salesReturn.customerId));

        // NOTE: Invoice totals are intentionally NOT mutated here.
        // Sales returns are immutable dated events surfaced in the ledger
        // reader (see ledger-fn.ts). Mutating invoice.credit/amount would
        // rewrite past-period statements and break historical immutability.

        // Update slip amount due
        const slip = await tx.query.slipRecords.findFirst({
          where: eq(slipRecords.invoiceId, salesReturn.invoiceId),
        });
        if (slip) {
          const newDue = Math.max(0, Number(slip.amountDue) - returnAmount);
          await tx
            .update(slipRecords)
            .set({
              amountDue: newDue.toFixed(2),
              status: newDue === 0 ? "closed" : slip.status,
              updatedAt: new Date(),
            })
            .where(eq(slipRecords.id, slip.id));
        }
      }

      await recordInvoiceTimelineEvent(
        {
          invoiceId: salesReturn.invoiceId,
          eventType: "status_change",
          title: `Return ${data.action === "approve" ? "approved" : "rejected"}`,
          description:
            data.action === "approve"
              ? `Return #${salesReturn.returnNumber} approved. Customer credit reduced by PKR ${Number(salesReturn.totalAmount).toFixed(2)}. Inventory disposition: ${salesReturn.condition === "good" ? "restocked to sellable stock" : `moved to ${salesReturn.condition} returned stock`}.`
              : `Return #${salesReturn.returnNumber} rejected. Reason: ${data.notes ?? "Not specified"}.`,
          metadata: {
            salesReturnId: salesReturn.id,
            returnNumber: salesReturn.returnNumber,
            action: data.action,
            totalAmount: salesReturn.totalAmount,
          },
          actorId: userId,
        },
        tx,
      );

      return updated;
    });
  });

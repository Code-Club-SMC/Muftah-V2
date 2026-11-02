import { createId } from "@paralleldrive/cuid2";
import { createServerFn } from "@tanstack/react-start";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { and, eq, sql } from "drizzle-orm";
import {
	chemicals,
	db,
	expenses,
	inventoryAuditLog,
	materialStock,
	packagingMaterials,
	purchaseRecords,
	supplierPayments,
	suppliers,
	transactions,
	wallets,
	warehouses,
} from "@/db";
import { expenseCategories } from "@/db/schemas/finance-schema";
import { findOrCreateLot, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { addStockSchema } from "@/lib/validators/validators";
import { z } from "zod";
import Big from "big.js";

type FinanceWriter = Pick<typeof db, "query" | "select" | "insert" | "update">;

async function ensureSupplierPurchaseCategory(tx: FinanceWriter) {
	const existingCategory = await tx.query.expenseCategories.findFirst({
		where: eq(expenseCategories.slug, "supplier-purchase"),
		columns: {
			id: true,
			name: true,
			isActive: true,
			isArchived: true,
		},
	});

	if (existingCategory) {
		if (!existingCategory.isActive || existingCategory.isArchived) {
			await tx
				.update(expenseCategories)
				.set({
					name: "Supplier Purchase",
					isActive: true,
					isArchived: false,
					updatedAt: new Date(),
				})
				.where(eq(expenseCategories.id, existingCategory.id));
		}

		return {
			id: existingCategory.id,
			name: "Supplier Purchase",
		};
	}

	const [createdCategory] = await tx
		.insert(expenseCategories)
		.values({
			id: createId(),
			name: "Supplier Purchase",
			slug: "supplier-purchase",
			sortOrder: 500,
			isActive: true,
			isArchived: false,
		})
		.returning({
			id: expenseCategories.id,
			name: expenseCategories.name,
		});

	return createdCategory;
}

export const addStockFn = createServerFn()
	.middleware([requireInventoryManageMiddleware])
	.inputValidator(addStockSchema.extend({
		quantity: z.string().trim().refine(value => /^\d+(?:\.\d+)?$/.test(value) &&
			Number(value) > 0 && Number(value) <= 999_999_999.999 && new Big(value).round(3).eq(value),
			"Quantity must be positive and use at most three decimal places"),
	}))
	.handler(async ({ data, context }) => {
		return await db.transaction(async (tx) => {
			// Validate Warehouse Type
			const [warehouse] = await tx.select().from(warehouses)
				.where(eq(warehouses.id, data.warehouseId)).for("share");

			if (!warehouse) throw new Error("Warehouse not found");
			if (!warehouse.isActive) throw new Error("Factory floor facility is inactive");

			// STRICT ENFORCEMENT: Raw materials only in Factory Floor
			if (warehouse.type !== "factory_floor") {
				throw new Error(
					"Raw materials (Chemicals/Packaging) must be added to a Factory Floor facility, not Storage.",
				);
			}

			const targetWarehouseId = warehouse.id;

			const ref = { materialType: data.materialType, materialId: data.materialId } as const;
			await lockMaterialStock(tx, [targetWarehouseId], [ref]);
			const unitCost = new Big(data.cost).div(data.quantity);
			const lot = await findOrCreateLot(tx, ref, unitCost.toString());

			// Auto-calculate payment amount based on payment status
			let amountToRecord = 0;
			if (data.paymentStatus === "paid") {
				amountToRecord = parseFloat(data.cost);
			} else if (data.paymentStatus === "partial" && data.amountPaid) {
				amountToRecord = parseFloat(data.amountPaid);
			}

			// Create Purchase Record (Supplier History)
			const [purchase] = await tx
				.insert(purchaseRecords)
				.values({
					supplierId: data.supplierId,
					warehouseId: targetWarehouseId,
					materialType: data.materialType,
					chemicalId: data.materialType === "chemical" ? data.materialId : null,
					packagingMaterialId:
						data.materialType === "packaging" ? data.materialId : null,
					quantity: data.quantity,
					cost: data.cost,
					paidAmount: amountToRecord.toString(),
					unitCost: lot.unitPrice,
					lotId: lot.id,
					notes: data.notes,
					paymentMethod: data.paymentMethod,
					bankName: data.bankName,
					transactionId: data.transactionId,
				})
				.returning();

			await moveLotStock(tx, { ref, lotId: lot.id, warehouseId: targetWarehouseId, delta: data.quantity, sourceType: "purchase", sourceId: purchase.id });

			// Conditionally create expense and debit wallet (same pattern as add-chemical/packaging)
			const walletId = data.walletId || data.paymentMethod;
			if (
				walletId &&
				walletId !== "pay_later" &&
				(data.paymentStatus === "paid" || data.paymentStatus === "partial")
			) {
				const expenseAmount =
					data.paymentStatus === "paid"
						? parseFloat(data.cost)
						: parseFloat(data.amountPaid ?? "0");

				// Look up supplier name and material name for expense description
				const [supplier] = await tx
					.select()
					.from(suppliers)
					.where(eq(suppliers.id, data.supplierId));
				const supplierName = supplier?.supplierName ?? "Unknown Supplier";

				let materialName = "Unknown Material";
				if (data.materialType === "chemical") {
					const [chem] = await tx
						.select()
						.from(chemicals)
						.where(eq(chemicals.id, data.materialId));
					materialName = chem?.name ?? materialName;
				} else {
					const [pkg] = await tx
						.select()
						.from(packagingMaterials)
						.where(eq(packagingMaterials.id, data.materialId));
					materialName = pkg?.name ?? materialName;
				}

				// Balance check
				const [wallet] = await tx
					.select()
					.from(wallets)
					.where(eq(wallets.id, walletId));
				if (!wallet) throw new Error("Wallet not found");
				const currentBalance = parseFloat(wallet.balance || "0");
				if (currentBalance < expenseAmount) {
					throw new Error(
						`Insufficient balance in "${wallet.name}". Available: PKR ${currentBalance.toLocaleString()}, Required: PKR ${expenseAmount.toLocaleString()}`,
					);
				}

				// Debit wallet
				await tx
					.update(wallets)
					.set({ balance: sql`${wallets.balance} - ${expenseAmount}` })
					.where(eq(wallets.id, walletId));

				// Insert expense
				const category = await ensureSupplierPurchaseCategory(tx);
				const expenseId = createId();
				await tx.insert(expenses).values({
					id: expenseId,
					description: `Supplier Purchase: ${materialName} from ${supplierName}`,
					category: "Supplier Purchase",
					categoryId: category.id,
					amount: expenseAmount.toString(),
					walletId: walletId,
					performedById: context.session.user.id,
				});

				// Insert transaction journal entry
				await tx.insert(transactions).values({
					id: createId(),
					walletId: walletId,
					type: "debit",
					amount: expenseAmount.toString(),
					source: "Expense",
					referenceId: expenseId,
					performedById: context.session.user.id,
				});
			}

			if (amountToRecord > 0) {
				await tx.insert(supplierPayments).values({
					supplierId: data.supplierId,
					purchaseId: purchase.id,
					amount: amountToRecord.toString(),
					method: data.paymentMethod,
					bankName: data.bankName,
					reference: data.transactionId || undefined,
					notes:
						data.paymentStatus === "partial"
							? "Partial payment for stock purchase"
							: "Full payment for stock purchase",
				});
			}

			// Update the material's last supplier ID
			if (data.materialType === "chemical") {
				await tx
					.update(chemicals)
					.set({ lastSupplierId: data.supplierId, updatedAt: new Date() })
					.where(eq(chemicals.id, data.materialId));
			} else {
				await tx
					.update(packagingMaterials)
					.set({ lastSupplierId: data.supplierId, updatedAt: new Date() })
					.where(eq(packagingMaterials.id, data.materialId));
			}

			// Audit log
			await tx.insert(inventoryAuditLog).values({
				warehouseId: targetWarehouseId,
				materialType: data.materialType,
				materialId: data.materialId,
				type: "credit",
				amount: data.quantity,
				reason: `Purchase from Supplier (ID: ${data.supplierId})`,
				lotId: lot.id,
				performedById: context.session.user.id,
			});

			// Look up supplier and material details for rich activity logging
			const [supplier] = await tx
				.select({
					supplierName: suppliers.supplierName,
					supplierShopName: suppliers.supplierShopName,
				})
				.from(suppliers)
				.where(eq(suppliers.id, data.supplierId));
			const supplierName = supplier?.supplierName ?? "Unknown Supplier";

			let loggedMaterialName = "Unknown Material";
			let materialUnit = data.materialType === "chemical" ? "kg" : "units";

			if (data.materialType === "chemical") {
				const [chem] = await tx
					.select({ name: chemicals.name, unit: chemicals.unit })
					.from(chemicals)
					.where(eq(chemicals.id, data.materialId));
				if (chem) {
					loggedMaterialName = chem.name;
					materialUnit = chem.unit || "kg";
				}
			} else {
				const [pkg] = await tx
					.select({
						name: packagingMaterials.name,
						capacityUnit: packagingMaterials.capacityUnit,
						measuredInKg: packagingMaterials.measuredInKg,
					})
					.from(packagingMaterials)
					.where(eq(packagingMaterials.id, data.materialId));
				if (pkg) {
					loggedMaterialName = pkg.name;
					materialUnit = pkg.measuredInKg ? "kg" : pkg.capacityUnit || "units";
				}
			}

			const costNum = parseFloat(data.cost || "0");
			const totalCostFormatted = `PKR ${costNum.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
			const paidFormatted = `PKR ${amountToRecord.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

			let paymentSummary = "";
			if (data.paymentStatus === "paid" || amountToRecord >= costNum) {
				paymentSummary = `(Paid in full: ${totalCostFormatted})`;
			} else if (data.paymentStatus === "partial" && amountToRecord > 0) {
				const dueAmount = costNum - amountToRecord;
				const dueFormatted = `PKR ${dueAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
				paymentSummary = `(Paid: ${paidFormatted}, Balance Due: ${dueFormatted})`;
			} else {
				paymentSummary = `(Total: ${totalCostFormatted}, Unpaid)`;
			}

			const logDescription = `Purchased ${data.quantity} ${materialUnit} of ${loggedMaterialName} from ${supplierName} ${paymentSummary}`;

			logActivityQuiet({
				module: "inventory",
				action: "purchased",
				entityType: "purchase",
				entityId: purchase.id,
				entityLabel: `${loggedMaterialName} (${data.quantity} ${materialUnit})`,
				actorId: context.authContext.session.user.id,
				actorName: context.authContext.session.user.name,
				description: logDescription,
				metadata: {
					materialName: loggedMaterialName,
					materialType: data.materialType,
					quantityPurchased: `${data.quantity} ${materialUnit}`,
					unitCost: `PKR ${parseFloat(lot.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${materialUnit}`,
					totalPrice: totalCostFormatted,
					amountPaid: paidFormatted,
					paymentStatus: data.paymentStatus,
					paymentMethod: data.paymentMethod || "pay_later",
					supplier: supplierName,
					supplierId: data.supplierId,
					facility: warehouse.name,
					notes: data.notes || undefined,
				},
			});

			const [result] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, targetWarehouseId), eq(data.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId, data.materialId)));
			return result;
		});
	});

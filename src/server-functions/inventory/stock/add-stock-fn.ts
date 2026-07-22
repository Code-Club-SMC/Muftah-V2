import { createId } from "@paralleldrive/cuid2";
import { createServerFn } from "@tanstack/react-start";
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
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { addStockSchema } from "@/lib/validators/validators";

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
	.inputValidator(addStockSchema)
	.handler(async ({ data, context }) => {
		return await db.transaction(async (tx) => {
			// Validate Warehouse Type
			const warehouse = await tx.query.warehouses.findFirst({
				where: eq(warehouses.id, data.warehouseId),
			});

			if (!warehouse) throw new Error("Warehouse not found");

			// STRICT ENFORCEMENT: Raw materials only in Factory Floor
			if (warehouse.type !== "factory_floor") {
				throw new Error(
					"Raw materials (Chemicals/Packaging) must be added to a Factory Floor facility, not Storage.",
				);
			}

			const targetWarehouseId = warehouse.id;

			// Check if stock already exists
			const existingStock = await tx.query.materialStock.findFirst({
				where: and(
					eq(materialStock.warehouseId, targetWarehouseId),
					data.materialType === "chemical"
						? eq(materialStock.chemicalId, data.materialId)
						: eq(materialStock.packagingMaterialId, data.materialId),
				),
			});

			type Result = {
				createdAt: Date;
				updatedAt: Date;
				id: string;
				warehouseId: string;
				chemicalId: string | null;
				packagingMaterialId: string | null;
				quantity: string;
			};

			let result: Result;

			if (existingStock) {
				// Update existing stock
				const newQuantity = (
					parseFloat(existingStock.quantity) + parseFloat(data.quantity)
				).toString();

				[result] = await tx
					.update(materialStock)
					.set({ quantity: newQuantity, updatedAt: new Date() })
					.where(eq(materialStock.id, existingStock.id))
					.returning();
			} else {
				// Create new stock entry
				[result] = await tx
					.insert(materialStock)
					.values({
						warehouseId: targetWarehouseId,
						[data.materialType === "chemical"
							? "chemicalId"
							: "packagingMaterialId"]: data.materialId,
						quantity: data.quantity,
					})
					.returning();
			}

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
					unitCost: (parseFloat(data.cost) / parseFloat(data.quantity)).toFixed(
						4,
					),
					notes: data.notes,
					paymentMethod: data.paymentMethod,
					bankName: data.bankName,
					transactionId: data.transactionId,
				})
				.returning();

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
				performedById: context.session.user.id,
			});

			return result;
		});
	});

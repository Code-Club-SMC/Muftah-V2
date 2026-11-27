import Big from "big.js";
import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schemas/core-suppliers";
import { expenseCategories, expenses, otherIncome } from "@/db/schemas/finance-schema";
import { employees, payrolls, payslips } from "@/db/schemas/hr-schema";
import {
  chemicals,
  failedProductionChemicalRecoveries,
  packagingMaterials,
  recipes,
} from "@/db/schemas/inventory-schema";
import {
  formulas,
  mixingMaterialsUsed,
  mixingRuns,
  packagingAllocations,
} from "@/db/schemas/production-schema";
import { salesReturns } from "@/db/schemas/sales-erp-schema";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { reportDateBounds, reportDateKey, reportMonth } from "@/lib/report-dates";
import {
  addToMonth,
  buildMonthlyReport,
  fiscalYearRange,
  type MonthKey,
  type MonthlyReport,
  reportExpenseCategories,
  SUPPLIER_PURCHASE_CATEGORY,
} from "@/lib/reports/monthly-report";

export interface MonthlyReportDetailRow {
  /** Pakistan calendar day, "YYYY-MM-DD". */
  date: string;
  reference: string;
  description: string;
  amount: number;
}

export interface MonthlyReportDetail {
  title: string;
  unit: "rupees" | "kg";
  rows: MonthlyReportDetailRow[];
  total: number;
}

function instantBounds(from: string, to: string): { fromDate: Date; toDate: Date } {
  const { fromDate, toDate } = reportDateBounds({ dateFrom: from, dateTo: to });
  if (!fromDate || !toDate) throw new Error("Report dates are missing");
  return { fromDate, toDate };
}

/** Store credit given for received returns, per invoice. It is money the customer got back. */
function returnCreditByInvoice() {
  return db
    .select({
      invoiceId: salesReturns.invoiceId,
      amount: sql<string>`sum(${salesReturns.customerCreditAmount})`.as("return_credit_amount"),
    })
    .from(salesReturns)
    .where(eq(salesReturns.status, "completed"))
    .groupBy(salesReturns.invoiceId)
    .as("return_credit");
}

/**
 * Money kept from an invoice. Paid amount alone counts money twice when a customer pays, gets store
 * credit (goods returned, or paid above the balance) and spends that credit on another invoice.
 */
function cashKept(row: { paid: string; excess: string; returnCredit: string | null }): Big {
  return new Big(row.paid).minus(row.excess).minus(row.returnCredit ?? 0);
}

/** Litre packs sold before 2026-11-23 were saved with no weight; 1 litre counts as 1 kg, as ml packs do. */
const itemWeightKg = sql<string>`coalesce(sum(case when ${invoiceItems.fillUnitSnapshot} = 'L' and ${invoiceItems.totalWeight} = 0
  then ${invoiceItems.dispatchedUnits} * ${invoiceItems.fillAmountSnapshot} else ${invoiceItems.totalWeight} end), 0)`;

/** Supplier money is shown under Purchases. The saved name still holds if the category is renamed. */
const notSupplierMoney = ne(expenses.category, SUPPLIER_PURCHASE_CATEGORY);

const monthOf = (value: Date): MonthKey => reportDateKey(value).slice(0, 7);

function addDated(bucket: Map<MonthKey, Big>, value: Date | null, amount: string | null): void {
  if (value === null || amount === null) return;
  addToMonth(bucket, monthOf(value), amount);
}

export async function loadMonthlyReport(startYear: number, todayKey: string): Promise<MonthlyReport> {
  const range = fiscalYearRange(startYear);
  const { fromDate, toDate } = instantBounds(range.from, range.to);
  const savedInvoiceInYear = and(
    eq(invoices.status, "saved"),
    gte(invoices.date, fromDate),
    lte(invoices.date, toDate),
  );

  const returnCredit = returnCreditByInvoice();

  const [
    invoiceRows,
    weightRows,
    incomeRows,
    mixingRows,
    failedRows,
    packingRows,
    payrollRows,
    expenseRows,
    categoryRows,
    purchaseRows,
  ] = await Promise.all([
    db
      .select({
        date: invoices.date,
        paid: invoices.paidAmount,
        excess: invoices.excessCreditedAmount,
        returnCredit: returnCredit.amount,
        outstanding: invoices.outstandingAmount,
      })
      .from(invoices)
      .leftJoin(returnCredit, eq(returnCredit.invoiceId, invoices.id))
      .where(savedInvoiceInYear),
    db
      .select({ date: invoices.date, kg: itemWeightKg })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(savedInvoiceInYear)
      .groupBy(invoices.id, invoices.date),
    db
      .select({ date: otherIncome.incomeDate, amount: otherIncome.amount })
      .from(otherIncome)
      .where(
        and(
          isNull(otherIncome.voidedAt),
          gte(otherIncome.incomeDate, fromDate),
          lte(otherIncome.incomeDate, toDate),
        ),
      ),
    db
      .select({
        date: mixingRuns.actualCompletionDate,
        cost: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)`,
      })
      .from(mixingMaterialsUsed)
      .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
      .where(
        and(
          eq(mixingRuns.status, "completed"),
          gte(mixingRuns.actualCompletionDate, fromDate),
          lte(mixingRuns.actualCompletionDate, toDate),
        ),
      )
      .groupBy(mixingRuns.id, mixingRuns.actualCompletionDate),
    db
      .select({
        date: failedProductionChemicalRecoveries.createdAt,
        cost: failedProductionChemicalRecoveries.lossAmount,
      })
      .from(failedProductionChemicalRecoveries)
      .where(
        and(
          gte(failedProductionChemicalRecoveries.createdAt, fromDate),
          lte(failedProductionChemicalRecoveries.createdAt, toDate),
        ),
      ),
    db
      .select({ date: packagingAllocations.completedAt, cost: packagingAllocations.totalPackagingCost })
      .from(packagingAllocations)
      .where(
        and(
          eq(packagingAllocations.status, "completed"),
          gte(packagingAllocations.completedAt, fromDate),
          lte(packagingAllocations.completedAt, toDate),
        ),
      ),
    db
      .select({ month: payrolls.month, gross: sql<string>`coalesce(sum(${payslips.grossSalary}), 0)` })
      .from(payslips)
      .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
      .where(
        and(
          gte(payrolls.month, range.from),
          lte(payrolls.month, range.to),
        ),
      )
      .groupBy(payrolls.id, payrolls.month),
    db
      .select({ categoryId: expenses.categoryId, date: expenses.expenseDate, amount: expenses.amount })
      .from(expenses)
      .where(
        and(
          isNull(expenses.voidedAt),
          notSupplierMoney,
          gte(expenses.expenseDate, fromDate),
          lte(expenses.expenseDate, toDate),
        ),
      ),
    db
      .select({
        id: expenseCategories.id,
        name: expenseCategories.name,
        slug: expenseCategories.slug,
        isActive: expenseCategories.isActive,
        isArchived: expenseCategories.isArchived,
      })
      .from(expenseCategories)
      .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name)),
    db
      .select({ type: purchaseRecords.materialType, date: purchaseRecords.purchaseDate, cost: purchaseRecords.cost })
      .from(purchaseRecords)
      .where(
        and(
          isNull(purchaseRecords.voidedAt),
          gte(purchaseRecords.purchaseDate, fromDate),
          lte(purchaseRecords.purchaseDate, toDate),
        ),
      ),
  ]);

  const cash = new Map<MonthKey, Big>();
  const credit = new Map<MonthKey, Big>();
  for (const row of invoiceRows) {
    addToMonth(cash, monthOf(row.date), cashKept(row));
    addDated(credit, row.date, row.outstanding);
  }

  const weightKg = new Map<MonthKey, Big>();
  for (const row of weightRows) addDated(weightKg, row.date, row.kg);

  const byProduct = new Map<MonthKey, Big>();
  for (const row of incomeRows) addDated(byProduct, row.date, row.amount);

  const rawMaterial = new Map<MonthKey, Big>();
  for (const row of mixingRows) addDated(rawMaterial, row.date, row.cost);
  for (const row of failedRows) addDated(rawMaterial, row.date, row.cost);

  const packing = new Map<MonthKey, Big>();
  for (const row of packingRows) addDated(packing, row.date, row.cost);

  const salaries = new Map<MonthKey, Big>();
  for (const row of payrollRows) addToMonth(salaries, row.month.slice(0, 7), row.gross);

  const spentByCategory = new Map<string, Map<MonthKey, Big>>();
  for (const row of expenseRows) {
    let months = spentByCategory.get(row.categoryId);
    if (!months) {
      months = new Map();
      spentByCategory.set(row.categoryId, months);
    }
    addDated(months, row.date, row.amount);
  }
  const categories = reportExpenseCategories(categoryRows, new Set(spentByCategory.keys())).map(
    (category) => ({
      id: category.id,
      name: category.name,
      months: spentByCategory.get(category.id) ?? new Map<MonthKey, Big>(),
    }),
  );

  const purchaseRawMaterial = new Map<MonthKey, Big>();
  const purchasePacking = new Map<MonthKey, Big>();
  for (const row of purchaseRows) {
    if (row.type === "chemical") addDated(purchaseRawMaterial, row.date, row.cost);
    else if (row.type === "packaging") addDated(purchasePacking, row.date, row.cost);
  }

  return buildMonthlyReport({
    startYear,
    todayKey,
    cash,
    credit,
    byProduct,
    rawMaterial,
    packing,
    salaries,
    expenseCategories: categories,
    purchaseRawMaterial,
    purchasePacking,
    weightKg,
  });
}

function detail(
  title: string,
  unit: MonthlyReportDetail["unit"],
  rows: MonthlyReportDetailRow[],
): MonthlyReportDetail {
  const kept = rows.filter((row) => row.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  const total = kept.reduce((sum, row) => sum.plus(row.amount), new Big(0));
  return { title, unit, rows: kept, total: Number(total.round(unit === "kg" ? 3 : 2).toString()) };
}

const money = (value: Big | string) => Number(new Big(value).round(2).toFixed(2));

/** The records behind one number of the monthly report. */
export async function loadMonthlyReportDetail(line: string, month: MonthKey): Promise<MonthlyReportDetail> {
  const { from, to } = reportMonth(`${month}-01`);
  const { fromDate, toDate } = instantBounds(from, to);
  const savedInvoiceInMonth = and(
    eq(invoices.status, "saved"),
    gte(invoices.date, fromDate),
    lte(invoices.date, toDate),
  );

  if (line === "cash" || line === "credit" || line === "weightTon") {
    if (line === "weightTon") {
      const rows = await db
        .select({
          date: invoices.date,
          number: invoices.invoiceNumber,
          customer: customers.name,
          kg: itemWeightKg,
        })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .innerJoin(invoiceItems, eq(invoiceItems.invoiceId, invoices.id))
        .where(savedInvoiceInMonth)
        .groupBy(invoices.id, invoices.date, invoices.invoiceNumber, customers.name);
      return detail(
        "Weight sold",
        "kg",
        rows.map((row) => ({
          date: reportDateKey(row.date),
          reference: row.number,
          description: row.customer,
          amount: Number(new Big(row.kg).round(3).toFixed(3)),
        })),
      );
    }

    const returnCredit = returnCreditByInvoice();
    const rows = await db
      .select({
        date: invoices.date,
        number: invoices.invoiceNumber,
        customer: customers.name,
        paid: invoices.paidAmount,
        excess: invoices.excessCreditedAmount,
        returnCredit: returnCredit.amount,
        outstanding: invoices.outstandingAmount,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .leftJoin(returnCredit, eq(returnCredit.invoiceId, invoices.id))
      .where(savedInvoiceInMonth);
    return detail(
      line === "cash" ? "Cash received" : "Credit (unpaid)",
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.number,
        description: row.customer,
        amount: money(line === "cash" ? cashKept(row) : row.outstanding),
      })),
    );
  }

  if (line === "byProduct") {
    const rows = await db
      .select({
        date: otherIncome.incomeDate,
        item: otherIncome.itemName,
        quantity: otherIncome.quantity,
        unitPrice: otherIncome.unitPrice,
        amount: otherIncome.amount,
      })
      .from(otherIncome)
      .where(
        and(
          isNull(otherIncome.voidedAt),
          gte(otherIncome.incomeDate, fromDate),
          lte(otherIncome.incomeDate, toDate),
        ),
      );
    return detail(
      "By-product",
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: `${Number(row.quantity)} × ${Number(row.unitPrice)}`,
        description: row.item,
        amount: money(row.amount),
      })),
    );
  }

  if (line === "rawMaterial") {
    const [runs, losses] = await Promise.all([
      db
        .select({
          date: mixingRuns.actualCompletionDate,
          batch: mixingRuns.batchId,
          formula: formulas.name,
          cost: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)`,
        })
        .from(mixingMaterialsUsed)
        .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
        .innerJoin(formulas, eq(mixingRuns.formulaId, formulas.id))
        .where(
          and(
            eq(mixingRuns.status, "completed"),
            gte(mixingRuns.actualCompletionDate, fromDate),
            lte(mixingRuns.actualCompletionDate, toDate),
          ),
        )
        .groupBy(mixingRuns.id, mixingRuns.actualCompletionDate, mixingRuns.batchId, formulas.name),
      db
        .select({
          date: failedProductionChemicalRecoveries.createdAt,
          batch: mixingRuns.batchId,
          chemical: chemicals.name,
          cost: failedProductionChemicalRecoveries.lossAmount,
        })
        .from(failedProductionChemicalRecoveries)
        .leftJoin(mixingRuns, eq(failedProductionChemicalRecoveries.mixingRunId, mixingRuns.id))
        .innerJoin(chemicals, eq(failedProductionChemicalRecoveries.chemicalId, chemicals.id))
        .where(
          and(
            gte(failedProductionChemicalRecoveries.createdAt, fromDate),
            lte(failedProductionChemicalRecoveries.createdAt, toDate),
          ),
        ),
    ]);
    return detail("Raw material", "rupees", [
      ...runs.flatMap((row) =>
        row.date
          ? [{ date: reportDateKey(row.date), reference: row.batch, description: row.formula, amount: money(row.cost) }]
          : [],
      ),
      ...losses.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.batch ?? "Failed batch",
        description: `Lost in failed batch: ${row.chemical}`,
        amount: money(row.cost),
      })),
    ]);
  }

  if (line === "packing") {
    const rows = await db
      .select({
        date: packagingAllocations.completedAt,
        batch: mixingRuns.batchId,
        recipe: recipes.name,
        cost: packagingAllocations.totalPackagingCost,
      })
      .from(packagingAllocations)
      .innerJoin(mixingRuns, eq(packagingAllocations.mixingRunId, mixingRuns.id))
      .leftJoin(recipes, eq(packagingAllocations.recipeId, recipes.id))
      .where(
        and(
          eq(packagingAllocations.status, "completed"),
          gte(packagingAllocations.completedAt, fromDate),
          lte(packagingAllocations.completedAt, toDate),
        ),
      );
    return detail(
      "Packing",
      "rupees",
      rows.flatMap((row) =>
        row.date && row.cost !== null
          ? [{ date: reportDateKey(row.date), reference: row.batch, description: row.recipe ?? "Packing", amount: money(row.cost) }]
          : [],
      ),
    );
  }

  if (line === "salaries") {
    const rows = await db
      .select({
        month: payrolls.month,
        firstName: employees.firstName,
        lastName: employees.lastName,
        gross: payslips.grossSalary,
      })
      .from(payslips)
      .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .where(
        and(gte(payrolls.month, from), lte(payrolls.month, to)),
      );
    return detail(
      "Salaries",
      "rupees",
      rows.map((row) => ({
        date: row.month,
        reference: "Payslip",
        description: `${row.firstName} ${row.lastName}`,
        amount: money(row.gross),
      })),
    );
  }

  if (line.startsWith("expense:")) {
    const categoryId = line.slice("expense:".length);
    const [category] = await db
      .select({ name: expenseCategories.name })
      .from(expenseCategories)
      .where(eq(expenseCategories.id, categoryId));
    if (!category) throw new Error("Expense category not found");
    const rows = await db
      .select({
        date: expenses.expenseDate,
        description: expenses.description,
        payee: expenses.payee,
        slip: expenses.slipNumber,
        amount: expenses.amount,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.categoryId, categoryId),
          isNull(expenses.voidedAt),
          notSupplierMoney,
          gte(expenses.expenseDate, fromDate),
          lte(expenses.expenseDate, toDate),
        ),
      );
    return detail(
      category.name,
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.slip ?? "",
        description: row.description || row.payee || category.name,
        amount: money(row.amount),
      })),
    );
  }

  if (line === "purchaseRawMaterial" || line === "purchasePacking") {
    const rows = await db
      .select({
        date: purchaseRecords.purchaseDate,
        invoiceNumber: purchaseRecords.invoiceNumber,
        chemical: chemicals.name,
        packaging: packagingMaterials.name,
        supplier: suppliers.supplierName,
        cost: purchaseRecords.cost,
      })
      .from(purchaseRecords)
      .leftJoin(chemicals, eq(purchaseRecords.chemicalId, chemicals.id))
      .leftJoin(packagingMaterials, eq(purchaseRecords.packagingMaterialId, packagingMaterials.id))
      .innerJoin(suppliers, eq(purchaseRecords.supplierId, suppliers.id))
      .where(
        and(
          eq(purchaseRecords.materialType, line === "purchaseRawMaterial" ? "chemical" : "packaging"),
          isNull(purchaseRecords.voidedAt),
          gte(purchaseRecords.purchaseDate, fromDate),
          lte(purchaseRecords.purchaseDate, toDate),
        ),
      );
    return detail(
      line === "purchaseRawMaterial" ? "Raw material bought" : "Packing bought",
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.invoiceNumber ?? "",
        description: `${row.chemical ?? row.packaging ?? "Material"} from ${row.supplier}`,
        amount: money(row.cost),
      })),
    );
  }

  throw new Error("This line has no records to show");
}

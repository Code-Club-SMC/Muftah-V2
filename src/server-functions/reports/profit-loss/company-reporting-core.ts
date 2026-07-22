import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { and, eq, gt, gte, inArray, isNull, lte, notInArray, or } from "drizzle-orm";
import { db } from "@/db";
import { expenses, transactions, wallets } from "@/db/schemas/finance-schema";
import {
  chemicals,
  failedProductionChemicalRecoveries,
  products,
  productionRuns,
  recipes,
} from "@/db/schemas/inventory-schema";
import { employees, payrolls, payslips, travelLogs } from "@/db/schemas/hr-schema";
import {
  orderBookerTrips,
  payments,
  salesReturns,
} from "@/db/schemas/sales-erp-schema";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import {
  calculateCumulativeRealization,
  calculateDelta,
  calculatePeriodRealization,
  calculatePointDelta,
  clampRatio,
  createComparisonLabel,
  createPeriodLabel,
  createPreviousRange,
  createReportDateRange,
  hasMeaningfulValue,
  type ReportDateRange,
} from "./reporting-math";

const APPROVED_RETURN_STATUSES = ["approved", "completed"] as const;
const TREND_MONTHS = 6;

const FINANCE_SALE_SOURCES = ["Sale", "Payment Recovery", "Slip Recovery"] as const;
const FINANCE_EXPENSE_SOURCES = ["Expense", "Expense Offset", "TA/DA Reimbursement"] as const;

type ProfitStatusKey = "profit" | "loss" | "break_even" | "no_activity";

interface InvoiceLineRecord {
  invoiceId: string;
  invoiceDate: Date;
  slipNumber: string | null;
  customerName: string;
  invoiceStatus: string;
  invoiceExpenses: number;
  invoiceItemId: string;
  recipeId: string | null;
  recipeName: string | null;
  productId: string | null;
  productName: string | null;
  productCategory: string | null;
  pack: string;
  cartons: number;
  quantity: number;
  actualPackSize: number;
  amount: number;
  cogs: number;
  cogsPerUnit: number;
}

interface PaymentRecord {
  invoiceId: string;
  amount: number;
  paymentDate: Date;
  method: string;
}

interface ReturnItemRecord {
  invoiceId: string;
  invoiceItemId: string;
  effectiveDate: Date;
  totalRefund: number;
  totalCost: number;
  cartonsReturned: number;
  quantityReturned: number;
}

interface ExpenseRecord {
  id: string;
  category: string;
  description: string;
  amount: number;
  expenseDate: Date;
}

interface FailedProductionLossRecord {
  id: string;
  productionRunId: string;
  batchId: string;
  recipeId: string;
  recipeName: string;
  productId: string;
  productName: string;
  chemicalId: string;
  chemicalName: string;
  expectedQuantity: number;
  recoveredQuantity: number;
  lossQuantity: number;
  lossAmount: number;
  costPerUnit: number;
  settledAt: Date;
}

interface PaidPayslipRecord {
  payrollId: string;
  payrollMonth: string;
  payrollStartDate: string;
  payrollEndDate: string;
  paidAt: Date;
  payslipId: string;
  employeeId: string;
  grossSalary: number;
  commissionAmount: number;
}

interface TravelLogRecord {
  id: string;
  employeeId: string;
  date: string;
  totalAmount: number;
  status: string;
  reimbursedAt: Date | null;
  reimbursedVia: string | null;
  paidInPayslipId: string | null;
}

interface OrderBookerRecord {
  id: string;
  employeeId: string | null;
}

interface OrderBookerTripRecord {
  id: string;
  orderBookerId: string;
  tripDate: Date;
  fuelCost: number;
  tadaAmount: number;
}

export interface RealizedInvoiceLine {
  invoiceId: string;
  invoiceDate: Date;
  slipNumber: string | null;
  customerName: string;
  invoiceStatus: string;
  invoiceItemId: string;
  recipeId: string | null;
  recipeName: string | null;
  productId: string | null;
  productName: string | null;
  productCategory: string | null;
  pack: string;
  realizedRevenue: number;
  realizedCogs: number;
  realizedCartons: number;
  realizedUnits: number;
  realizedInvoiceExpenses: number;
  realizedRatio: number;
  paymentToDate: number;
  adjustedLineRevenue: number;
  adjustedLineCogs: number;
}

interface RankRow {
  revenue: number;
  cogs: number;
  cartons: number;
  units: number;
  invoiceCount: number;
}

export interface CompanySummary {
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  grossMargin: number;
  invoiceExpenses: number;
  payroll: number;
  commissions: number;
  tada: number;
  generalExpenses: number;
  totalOperatingExpenses: number;
  netProfit: number;
  netMargin: number;
  totalCartons: number;
  totalUnits: number;
  invoiceCount: number;
}

export interface CompanyTrendPoint extends CompanySummary {
  monthKey: string;
  monthLabel: string;
}

export interface RankedProductRow {
  productId: string;
  productName: string;
  productCategory: string | null;
  revenue: number;
  cogs: number;
  cartons: number;
  units: number;
  invoiceCount: number;
  profit: number;
  margin: number;
}

export interface RankedRecipeRow {
  recipeId: string;
  recipeName: string;
  productId: string;
  productName: string;
  revenue: number;
  cogs: number;
  cartons: number;
  units: number;
  invoiceCount: number;
  profit: number;
  margin: number;
}

export interface DeductionBreakdownRow {
  type: string;
  label: string;
  description: string;
  amount: number;
  impact: number;
}

export interface ProfitStatus {
  key: ProfitStatusKey;
  label: string;
  description: string;
}

export interface FinanceReconciliationRow {
  type: string;
  label: string;
  amount: number;
  direction: "positive" | "negative" | "neutral";
  description: string;
}

export interface FinanceReconciliation {
  currentAccountBalance: number;
  balanceAsOfStart: number;
  balanceAsOfEnd: number;
  periodNetMovement: number;
  salesInflows: number;
  expenseOutflows: number;
  payrollOutflows: number;
  advanceOutflows: number;
  manualAdjustments: number;
  openingBalances: number;
  otherMovements: number;
  bridgeDifference: number;
  bridgeRows: FinanceReconciliationRow[];
}

export interface CompanySnapshot {
  summary: CompanySummary;
  status: ProfitStatus;
  perProduct: RankedProductRow[];
  perRecipe: RankedRecipeRow[];
  deductionBreakdown: DeductionBreakdownRow[];
  realizedLines: RealizedInvoiceLine[];
}

export interface CompanyReportData {
  generatedAt: string;
  comparisonLabel: string;
  reportPeriod: {
    dateFrom: string;
    dateTo: string;
    label: string;
  };
  comparisonPeriod: {
    dateFrom: string;
    dateTo: string;
  };
  summary: CompanySummary;
  previousSummary: CompanySummary;
  status: ProfitStatus;
  monthlyTrend: CompanyTrendPoint[];
  deltas: {
    revenuePercent: number;
    grossProfitPercent: number;
    grossMarginPoints: number;
    operatingExpensesPercent: number;
    netProfitPercent: number;
    netMarginPoints: number;
  };
  deductions: {
    invoiceExpenses: number;
    payroll: number;
    commissions: number;
    tada: number;
    generalExpenses: number;
    totalOperatingExpenses: number;
  };
  deductionBreakdown: DeductionBreakdownRow[];
  reconciliation: FinanceReconciliation;
  perProduct: RankedProductRow[];
  perRecipe: RankedRecipeRow[];
  realizedLines: RealizedInvoiceLine[];
}

export interface LoadedContext {
  lines: InvoiceLineRecord[];
  payments: PaymentRecord[];
  returns: ReturnItemRecord[];
  expenses: ExpenseRecord[];
  failedProductionLosses: FailedProductionLossRecord[];
  paidPayslips: PaidPayslipRecord[];
  travelLogs: TravelLogRecord[];
  orderBookers: OrderBookerRecord[];
  orderBookerTrips: OrderBookerTripRecord[];
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function getLineUnits(line: Pick<InvoiceLineRecord, "cartons" | "quantity" | "actualPackSize">) {
  const unitsPerCarton = line.actualPackSize > 0 ? line.actualPackSize : 0;
  return line.quantity + line.cartons * unitsPerCarton;
}

interface AdjustedLineState {
  line: InvoiceLineRecord;
  adjustedRevenue: number;
  adjustedCogs: number;
  adjustedCartons: number;
  adjustedQuantity: number;
  adjustedUnits: number;
}

function buildAdjustedLineState(
  line: InvoiceLineRecord,
  returnItems: ReturnItemRecord[],
  boundaryDate: Date,
  inclusive: boolean,
): AdjustedLineState {
  const returns = returnItems.filter((returnItem) =>
    inclusive
      ? returnItem.effectiveDate <= boundaryDate
      : returnItem.effectiveDate < boundaryDate,
  );
  const totalRefund = returns.reduce((sum, item) => sum + item.totalRefund, 0);
  const totalCost = returns.reduce((sum, item) => sum + item.totalCost, 0);
  const returnedCartons = returns.reduce(
    (sum, item) => sum + item.cartonsReturned,
    0,
  );
  const returnedQuantity = returns.reduce(
    (sum, item) => sum + item.quantityReturned,
    0,
  );
  const adjustedCartons = Math.max(0, line.cartons - returnedCartons);
  const adjustedQuantity = Math.max(0, line.quantity - returnedQuantity);

  return {
    line,
    adjustedRevenue: Math.max(0, line.amount - totalRefund),
    adjustedCogs: Math.max(0, line.cogs - totalCost),
    adjustedCartons,
    adjustedQuantity,
    adjustedUnits: getLineUnits({
      cartons: adjustedCartons,
      quantity: adjustedQuantity,
      actualPackSize: line.actualPackSize,
    }),
  };
}

function hasLineActivity(line: {
  realizedRevenue: number;
  realizedCogs: number;
  realizedUnits: number;
}): boolean {
  return (
    hasMeaningfulValue(line.realizedRevenue) ||
    hasMeaningfulValue(line.realizedCogs) ||
    hasMeaningfulValue(line.realizedUnits)
  );
}

function buildStatus(summary: CompanySummary): ProfitStatus {
  const hasActivity =
    hasMeaningfulValue(summary.totalRevenue) ||
    hasMeaningfulValue(summary.totalCogs) ||
    hasMeaningfulValue(summary.totalOperatingExpenses);

  if (!hasActivity) {
    return {
      key: "no_activity",
      label: "No activity",
      description: "No realized sales or operating expenses were recorded in this period.",
    };
  }

  if (Math.abs(summary.netProfit) < 0.005) {
    return {
      key: "break_even",
      label: "Break-even",
      description: "The company covered its costs but did not generate a meaningful profit.",
    };
  }

  if (summary.netProfit > 0) {
    return {
      key: "profit",
      label: "Profit",
      description: "The company generated positive net profit after operating expenses.",
    };
  }

  return {
    key: "loss",
    label: "Loss",
    description: "Operating expenses exceeded realized gross profit for this period.",
  };
}

function withProfitMetrics<T extends RankRow>(rows: T[]) {
  return rows
    .map((row) => {
      const revenue = roundCurrency(row.revenue);
      const cogs = roundCurrency(row.cogs);
      const profit = roundCurrency(revenue - cogs);
      return {
        ...row,
        revenue,
        cogs,
        cartons: roundMetric(row.cartons),
        units: roundMetric(row.units),
        invoiceCount: Number(row.invoiceCount ?? 0),
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      };
    })
    .sort((left, right) => {
      if (right.profit !== left.profit) {
        return right.profit - left.profit;
      }

      return right.revenue - left.revenue;
    });
}

function isCapitalizedInventoryExpense(expense: ExpenseRecord) {
  return (
    expense.category === "Supplier Purchase" ||
    expense.description.startsWith("Supplier Purchase:")
  );
}

function isStandaloneTadaExpense(expense: ExpenseRecord) {
  return expense.category === "TA/DA Reimbursement";
}

function isWithinRange(date: Date, range: ReportDateRange) {
  return date >= range.fromDate && date <= range.toDate;
}

export async function loadContext(
  fromDate: Date,
  toDate: Date,
): Promise<LoadedContext> {
  const [
    invoiceWindowRows,
    paymentWindowRows,
    returnWindowRows,
    expenseRows,
    failedProductionLossRows,
    payrollRows,
    orderBookerRows,
  ] = await Promise.all([
    db
      .select({ invoiceId: invoices.id })
      .from(invoices)
      .where(
        and(
          notInArray(invoices.status, ["draft", "voided"]),
          gte(invoices.date, fromDate),
          lte(invoices.date, toDate),
        ),
      ),
    db
      .select({ invoiceId: payments.invoiceId })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          notInArray(invoices.status, ["draft", "voided"]),
          gte(payments.paymentDate, fromDate),
          lte(payments.paymentDate, toDate),
        ),
      ),
    db
      .select({ invoiceId: salesReturns.invoiceId })
      .from(salesReturns)
      .innerJoin(invoices, eq(salesReturns.invoiceId, invoices.id))
      .where(
        and(
          notInArray(invoices.status, ["draft", "voided"]),
          inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
          or(
            and(isNull(salesReturns.approvedAt), gte(salesReturns.returnDate, fromDate), lte(salesReturns.returnDate, toDate)),
            and(gte(salesReturns.approvedAt, fromDate), lte(salesReturns.approvedAt, toDate)),
          ),
        ),
      ),
    db.query.expenses
      .findMany({
        where: and(
          gte(expenses.expenseDate, fromDate),
          lte(expenses.expenseDate, toDate),
        ),
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          category: row.category,
          description: row.description,
          amount: toNumber(row.amount),
          expenseDate: row.expenseDate,
        })),
      ),
    db
      .select({
        id: failedProductionChemicalRecoveries.id,
        productionRunId: failedProductionChemicalRecoveries.productionRunId,
        batchId: productionRuns.batchId,
        recipeId: recipes.id,
        recipeName: recipes.name,
        productId: products.id,
        productName: products.name,
        chemicalId: chemicals.id,
        chemicalName: chemicals.name,
        expectedQuantity: failedProductionChemicalRecoveries.expectedQuantity,
        recoveredQuantity: failedProductionChemicalRecoveries.recoveredQuantity,
        lossQuantity: failedProductionChemicalRecoveries.lossQuantity,
        lossAmount: failedProductionChemicalRecoveries.lossAmount,
        costPerUnit: failedProductionChemicalRecoveries.costPerUnit,
        settledAt: failedProductionChemicalRecoveries.createdAt,
      })
      .from(failedProductionChemicalRecoveries)
      .innerJoin(
        productionRuns,
        eq(failedProductionChemicalRecoveries.productionRunId, productionRuns.id),
      )
      .innerJoin(recipes, eq(productionRuns.recipeId, recipes.id))
      .innerJoin(products, eq(recipes.productId, products.id))
      .innerJoin(chemicals, eq(failedProductionChemicalRecoveries.chemicalId, chemicals.id))
      .where(
        and(
          gte(failedProductionChemicalRecoveries.createdAt, fromDate),
          lte(failedProductionChemicalRecoveries.createdAt, toDate),
        ),
      )
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          productionRunId: row.productionRunId,
          batchId: row.batchId,
          recipeId: row.recipeId,
          recipeName: row.recipeName,
          productId: row.productId,
          productName: row.productName,
          chemicalId: row.chemicalId,
          chemicalName: row.chemicalName,
          expectedQuantity: toNumber(row.expectedQuantity),
          recoveredQuantity: toNumber(row.recoveredQuantity),
          lossQuantity: toNumber(row.lossQuantity),
          lossAmount: toNumber(row.lossAmount),
          costPerUnit: toNumber(row.costPerUnit),
          settledAt: row.settledAt,
        })),
      ),
    db
      .select({
        payrollId: payrolls.id,
        payrollMonth: payrolls.month,
        payrollStartDate: payrolls.startDate,
        payrollEndDate: payrolls.endDate,
        paidAt: payrolls.paidAt,
        payslipId: payslips.id,
        employeeId: employees.id,
        grossSalary: payslips.grossSalary,
        commissionAmount: payslips.commissionAmount,
      })
      .from(payslips)
      .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .where(
        and(
          eq(payrolls.status, "paid"),
          gte(payrolls.paidAt, fromDate),
          lte(payrolls.paidAt, toDate),
        ),
      )
      .then((rows) =>
        rows
          .filter((row) => row.paidAt)
          .map((row) => ({
            payrollId: row.payrollId,
            payrollMonth: row.payrollMonth,
            payrollStartDate: row.payrollStartDate,
            payrollEndDate: row.payrollEndDate,
            paidAt: row.paidAt!,
            payslipId: row.payslipId,
            employeeId: row.employeeId,
            grossSalary: toNumber(row.grossSalary),
            commissionAmount: toNumber(row.commissionAmount),
          })),
      ),
    db.query.orderBookers.findMany({
      columns: {
        id: true,
        employeeId: true,
      },
    }),
  ]);

  const invoiceIds = Array.from(
    new Set([
      ...invoiceWindowRows.map((row) => row.invoiceId),
      ...paymentWindowRows.map((row) => row.invoiceId),
      ...returnWindowRows.map((row) => row.invoiceId),
    ]),
  );

  const payrollEmployeeIds = Array.from(
    new Set(payrollRows.map((row) => row.employeeId)),
  );
  const tripWindowFrom =
    payrollRows.length > 0
      ? new Date(
          Math.min(
            ...payrollRows.map((row) => new Date(row.payrollStartDate).getTime()),
          ),
        )
      : null;
  const tripWindowTo =
    payrollRows.length > 0
      ? new Date(
          Math.max(
            ...payrollRows.map((row) => new Date(row.payrollEndDate).getTime()),
          ),
        )
      : null;
  const orderBookerIds = orderBookerRows.map((row) => row.id);

  const [
    lines,
    paymentRows,
    returnRows,
    payrollTravelLogRows,
    reimbursedTravelLogRows,
    orderBookerTripRows,
  ] = await Promise.all([
    invoiceIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            invoiceId: invoices.id,
            invoiceDate: invoices.date,
            slipNumber: invoices.slipNumber,
            customerName: customers.name,
            invoiceStatus: invoices.status,
            invoiceExpenses: invoices.expenses,
            invoiceItemId: invoiceItems.id,
            recipeId: invoiceItems.recipeId,
            recipeName: recipes.name,
            productId: products.id,
            productName: products.name,
            productCategory: products.category,
            pack: invoiceItems.pack,
            cartons: invoiceItems.numberOfCartons,
            quantity: invoiceItems.quantity,
            actualPackSize: invoiceItems.actualPackSize,
            amount: invoiceItems.amount,
            cogs: invoiceItems.costOfGoodsSold,
            cogsPerUnit: invoiceItems.costOfGoodsSoldPerUnit,
          })
          .from(invoiceItems)
          .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
          .innerJoin(customers, eq(invoices.customerId, customers.id))
          .leftJoin(recipes, eq(invoiceItems.recipeId, recipes.id))
          .leftJoin(products, eq(recipes.productId, products.id))
          .where(
            and(
              inArray(invoices.id, invoiceIds),
              notInArray(invoices.status, ["draft", "voided"]),
              lte(invoices.date, toDate),
            ),
          ),
    invoiceIds.length === 0
      ? Promise.resolve([] as PaymentRecord[])
      : db
          .select({
            invoiceId: payments.invoiceId,
            amount: payments.amount,
            paymentDate: payments.paymentDate,
            method: payments.method,
          })
          .from(payments)
          .where(
            and(
              inArray(payments.invoiceId, invoiceIds),
              lte(payments.paymentDate, toDate),
            ),
          )
          .then((rows) =>
            rows.map((row) => ({
              invoiceId: row.invoiceId,
              amount: toNumber(row.amount),
              paymentDate: row.paymentDate,
              method: row.method,
            })),
          ),
    invoiceIds.length === 0
      ? Promise.resolve([] as ReturnItemRecord[])
      : db.query.salesReturns
          .findMany({
            where: and(
              inArray(salesReturns.invoiceId, invoiceIds),
              inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
              or(
                and(isNull(salesReturns.approvedAt), lte(salesReturns.returnDate, toDate)),
                lte(salesReturns.approvedAt, toDate),
              ),
            ),
            with: {
              items: true,
              stockTraces: true,
            },
          })
          .then((rows) => {
            const flattened: ReturnItemRecord[] = [];

            for (const row of rows) {
              for (const item of row.items) {
                const totalCost = row.stockTraces
                  .filter((trace) => trace.salesReturnItemId === item.id)
                  .reduce((sum, trace) => sum + toNumber(trace.totalCost), 0);

                flattened.push({
                  invoiceId: row.invoiceId,
                  invoiceItemId: item.invoiceItemId,
                  effectiveDate: row.approvedAt ?? row.returnDate,
                  totalRefund: toNumber(item.totalRefund),
                  totalCost,
                  cartonsReturned: item.cartonsReturned ?? 0,
                  quantityReturned: item.quantityReturned ?? 0,
                });
              }
            }

            return flattened;
          }),
    payrollEmployeeIds.length === 0 || !tripWindowFrom || !tripWindowTo
      ? Promise.resolve([] as TravelLogRecord[])
      : db.query.travelLogs
          .findMany({
            where: and(
              inArray(travelLogs.employeeId, payrollEmployeeIds),
              gte(travelLogs.date, format(tripWindowFrom, "yyyy-MM-dd")),
              lte(travelLogs.date, format(tripWindowTo, "yyyy-MM-dd")),
            ),
          })
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              employeeId: row.employeeId,
              date: row.date,
              totalAmount: toNumber(row.totalAmount),
              status: row.status,
              reimbursedAt: row.reimbursedAt ?? null,
              reimbursedVia: row.reimbursedVia ?? null,
              paidInPayslipId: row.paidInPayslipId ?? null,
            })),
          ),
    db.query.travelLogs
      .findMany({
        where: and(
          gte(travelLogs.reimbursedAt, fromDate),
          lte(travelLogs.reimbursedAt, toDate),
        ),
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          employeeId: row.employeeId,
          date: row.date,
          totalAmount: toNumber(row.totalAmount),
          status: row.status,
          reimbursedAt: row.reimbursedAt ?? null,
          reimbursedVia: row.reimbursedVia ?? null,
          paidInPayslipId: row.paidInPayslipId ?? null,
        })),
      ),
    orderBookerIds.length === 0 || !tripWindowFrom || !tripWindowTo
      ? Promise.resolve([] as OrderBookerTripRecord[])
      : db.query.orderBookerTrips
          .findMany({
            where: and(
              inArray(orderBookerTrips.orderBookerId, orderBookerIds),
              gte(orderBookerTrips.tripDate, tripWindowFrom),
              lte(orderBookerTrips.tripDate, tripWindowTo),
            ),
          })
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              orderBookerId: row.orderBookerId,
              tripDate: row.tripDate,
              fuelCost: toNumber(row.fuelCost),
              tadaAmount: toNumber(row.tadaAmount),
            })),
          ),
  ]);

  const travelLogRows = Array.from(
    new Map(
      [...payrollTravelLogRows, ...reimbursedTravelLogRows].map((row) => [
        row.id,
        row,
      ]),
    ).values(),
  );

  return {
    lines: lines.map((row) => ({
      invoiceId: row.invoiceId,
      invoiceDate: row.invoiceDate,
      slipNumber: row.slipNumber,
      customerName: row.customerName,
      invoiceStatus: row.invoiceStatus,
      invoiceExpenses: toNumber(row.invoiceExpenses),
      invoiceItemId: row.invoiceItemId,
      recipeId: row.recipeId,
      recipeName: row.recipeName,
      productId: row.productId,
      productName: row.productName,
      productCategory: row.productCategory,
      pack: row.pack,
      cartons: row.cartons ?? 0,
      quantity: row.quantity ?? 0,
      actualPackSize: row.actualPackSize ?? 0,
      amount: toNumber(row.amount),
      cogs: toNumber(row.cogs),
      cogsPerUnit: toNumber(row.cogsPerUnit),
    })),
    payments: paymentRows,
    returns: returnRows,
    expenses: expenseRows,
    failedProductionLosses: failedProductionLossRows,
    paidPayslips: payrollRows,
    travelLogs: travelLogRows,
    orderBookers: orderBookerRows,
    orderBookerTrips: orderBookerTripRows,
  };
}

export function buildSnapshot(context: LoadedContext, range: ReportDateRange): CompanySnapshot {
  const paymentsByInvoice = new Map<string, PaymentRecord[]>();
  const returnsByItem = new Map<string, ReturnItemRecord[]>();

  for (const payment of context.payments) {
    const bucket = paymentsByInvoice.get(payment.invoiceId);
    if (bucket) {
      bucket.push(payment);
    } else {
      paymentsByInvoice.set(payment.invoiceId, [payment]);
    }
  }

  for (const returnItem of context.returns) {
    const bucket = returnsByItem.get(returnItem.invoiceItemId);
    if (bucket) {
      bucket.push(returnItem);
    } else {
      returnsByItem.set(returnItem.invoiceItemId, [returnItem]);
    }
  }

  const linesByInvoice = new Map<string, InvoiceLineRecord[]>();
  for (const line of context.lines) {
    const bucket = linesByInvoice.get(line.invoiceId);
    if (bucket) {
      bucket.push(line);
    } else {
      linesByInvoice.set(line.invoiceId, [line]);
    }
  }

  const realizedLines: RealizedInvoiceLine[] = [];
  const productMap = new Map<string, RankedProductRow>();
  const recipeMap = new Map<string, RankedRecipeRow>();

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalCartons = 0;
  let totalUnits = 0;
  let invoiceCount = 0;
  let invoiceExpenses = 0;

  for (const [invoiceId, invoiceLines] of linesByInvoice.entries()) {
    const invoicePayments = paymentsByInvoice.get(invoiceId) ?? [];
    const paymentBeforeRange = invoicePayments
      .filter((payment) => payment.paymentDate < range.fromDate)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const paymentToDate = invoicePayments
      .filter((payment) => payment.paymentDate <= range.toDate)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const startAdjustedLines = invoiceLines.map((line) =>
      buildAdjustedLineState(
        line,
        returnsByItem.get(line.invoiceItemId) ?? [],
        range.fromDate,
        false,
      ),
    );
    const endAdjustedLines = invoiceLines.map((line) =>
      buildAdjustedLineState(
        line,
        returnsByItem.get(line.invoiceItemId) ?? [],
        range.toDate,
        true,
      ),
    );
    const startAdjustedInvoiceTotal = startAdjustedLines.reduce(
      (sum, item) => sum + item.adjustedRevenue,
      0,
    );
    const endAdjustedInvoiceTotal = endAdjustedLines.reduce(
      (sum, item) => sum + item.adjustedRevenue,
      0,
    );
    const lineInvoiceExpenses = roundCurrency(invoiceLines[0]?.invoiceExpenses ?? 0);
    let invoiceHasActivity = false;

    for (let lineIndex = 0; lineIndex < invoiceLines.length; lineIndex += 1) {
      const startAdjusted = startAdjustedLines[lineIndex];
      const endAdjusted = endAdjustedLines[lineIndex];
      const startState = calculateCumulativeRealization({
        adjustedInvoiceTotal: startAdjustedInvoiceTotal,
        paymentToDate: paymentBeforeRange,
        adjustedLineRevenue: startAdjusted.adjustedRevenue,
        adjustedLineCogs: startAdjusted.adjustedCogs,
        adjustedCartons: startAdjusted.adjustedCartons,
        adjustedUnits: startAdjusted.adjustedUnits,
        invoiceExpenses: lineInvoiceExpenses,
      });
      const endState = calculateCumulativeRealization({
        adjustedInvoiceTotal: endAdjustedInvoiceTotal,
        paymentToDate,
        adjustedLineRevenue: endAdjusted.adjustedRevenue,
        adjustedLineCogs: endAdjusted.adjustedCogs,
        adjustedCartons: endAdjusted.adjustedCartons,
        adjustedUnits: endAdjusted.adjustedUnits,
        invoiceExpenses: lineInvoiceExpenses,
      });
      const periodState = calculatePeriodRealization(startState, endState);
      const realizedRevenue = roundCurrency(periodState.realizedRevenue);
      const realizedCogs = roundCurrency(periodState.realizedCogs);
      const realizedCartons = roundMetric(periodState.realizedCartons);
      const realizedUnits = roundMetric(periodState.realizedUnits);
      const realizedInvoiceExpense = roundCurrency(
        periodState.realizedInvoiceExpenses,
      );
      const lineRecord: RealizedInvoiceLine = {
        invoiceId: endAdjusted.line.invoiceId,
        invoiceDate: endAdjusted.line.invoiceDate,
        slipNumber: endAdjusted.line.slipNumber,
        customerName: endAdjusted.line.customerName,
        invoiceStatus: endAdjusted.line.invoiceStatus,
        invoiceItemId: endAdjusted.line.invoiceItemId,
        recipeId: endAdjusted.line.recipeId,
        recipeName: endAdjusted.line.recipeName,
        productId: endAdjusted.line.productId,
        productName: endAdjusted.line.productName,
        productCategory: endAdjusted.line.productCategory,
        pack: endAdjusted.line.pack,
        realizedRevenue,
        realizedCogs,
        realizedCartons,
        realizedUnits,
        realizedInvoiceExpenses: realizedInvoiceExpense,
        realizedRatio: clampRatio(endState.realizedRatio),
        paymentToDate: roundCurrency(paymentToDate),
        adjustedLineRevenue: roundCurrency(endAdjusted.adjustedRevenue),
        adjustedLineCogs: roundCurrency(endAdjusted.adjustedCogs),
      };

      totalRevenue += realizedRevenue;
      totalCogs += realizedCogs;
      totalCartons += realizedCartons;
      totalUnits += realizedUnits;
      invoiceExpenses += realizedInvoiceExpense;
      invoiceHasActivity ||= hasLineActivity(lineRecord);

      realizedLines.push(lineRecord);

      const productKey = endAdjusted.line.productId ?? "unmapped";
      const productName = endAdjusted.line.productName ?? "Unmapped Sales";
      const existingProduct = productMap.get(productKey) ?? {
        productId: productKey,
        productName,
        productCategory: endAdjusted.line.productCategory,
        revenue: 0,
        cogs: 0,
        cartons: 0,
        units: 0,
        invoiceCount: 0,
        profit: 0,
        margin: 0,
      };
      existingProduct.revenue += realizedRevenue;
      existingProduct.cogs += realizedCogs;
      existingProduct.cartons += realizedCartons;
      existingProduct.units += realizedUnits;
      productMap.set(productKey, existingProduct);

      if (
        endAdjusted.line.recipeId &&
        endAdjusted.line.productId &&
        endAdjusted.line.recipeName &&
        endAdjusted.line.productName
      ) {
        const recipeKey = endAdjusted.line.recipeId;
        const existingRecipe = recipeMap.get(recipeKey) ?? {
          recipeId: endAdjusted.line.recipeId,
          recipeName: endAdjusted.line.recipeName,
          productId: endAdjusted.line.productId,
          productName: endAdjusted.line.productName,
          revenue: 0,
          cogs: 0,
          cartons: 0,
          units: 0,
          invoiceCount: 0,
          profit: 0,
          margin: 0,
        };
        existingRecipe.revenue += realizedRevenue;
        existingRecipe.cogs += realizedCogs;
        existingRecipe.cartons += realizedCartons;
        existingRecipe.units += realizedUnits;
        recipeMap.set(recipeKey, existingRecipe);
      }
    }

    if (invoiceHasActivity) {
      invoiceCount += 1;
    }
  }

  const invoiceIdsWithRealization = new Set(
    realizedLines.filter((line) => hasLineActivity(line)).map((line) => line.invoiceId),
  );

  for (const product of productMap.values()) {
    product.invoiceCount = new Set(
      realizedLines
        .filter(
          (line) =>
            (line.productId ?? "unmapped") === product.productId &&
            hasLineActivity(line),
        )
        .map((line) => line.invoiceId),
    ).size;
  }

  for (const recipe of recipeMap.values()) {
    recipe.invoiceCount = new Set(
      realizedLines
        .filter(
          (line) =>
            line.recipeId === recipe.recipeId && hasLineActivity(line),
        )
        .map((line) => line.invoiceId),
    ).size;
  }

  const payrollRows = context.paidPayslips.filter((row) => isWithinRange(row.paidAt, range));
  const orderBookerByEmployee = new Map(
    context.orderBookers
      .filter((row) => row.employeeId)
      .map((row) => [row.employeeId!, row.id]),
  );

  let payrollExpense = 0;
  let commissionExpense = 0;
  let tadaExpense = 0;

  for (const slip of payrollRows) {
    const payrollStart = new Date(slip.payrollStartDate);
    const payrollEnd = new Date(slip.payrollEndDate);
    const payrollTravelLogs = context.travelLogs.filter((log) => {
      const logDate = new Date(log.date);
      return (
        log.employeeId === slip.employeeId &&
        logDate >= payrollStart &&
        logDate <= payrollEnd &&
        (
          log.paidInPayslipId === slip.payslipId ||
          (!log.reimbursedAt && (log.status === "approved" || log.status === "reimbursed"))
        )
      );
    });
    const payrollTravelAmount = payrollTravelLogs.reduce(
      (sum, log) => sum + log.totalAmount,
      0,
    );
    const linkedOrderBookerId = orderBookerByEmployee.get(slip.employeeId);
    const orderBookerTravelAmount = linkedOrderBookerId
      ? context.orderBookerTrips
          .filter(
            (trip) =>
              trip.orderBookerId === linkedOrderBookerId &&
              trip.tripDate >= payrollStart &&
              trip.tripDate <= payrollEnd,
          )
          .reduce((sum, trip) => sum + trip.fuelCost + trip.tadaAmount, 0)
      : 0;
    const payrollTada = payrollTravelAmount + orderBookerTravelAmount;

    payrollExpense += Math.max(0, slip.grossSalary - slip.commissionAmount - payrollTada);
    commissionExpense += slip.commissionAmount;
    tadaExpense += payrollTada;
  }

  const standaloneTadaExpense = context.travelLogs
    .filter(
      (log) =>
        log.reimbursedAt &&
        isWithinRange(log.reimbursedAt, range) &&
        log.paidInPayslipId === null &&
        log.reimbursedVia !== "payroll",
    )
    .reduce((sum, log) => sum + log.totalAmount, 0);

  tadaExpense += standaloneTadaExpense;

  const financeGeneralExpense = context.expenses
    .filter((expense) => isWithinRange(expense.expenseDate, range))
    .filter((expense) => !isCapitalizedInventoryExpense(expense))
    .filter((expense) => !isStandaloneTadaExpense(expense))
    .reduce((sum, expense) => sum + expense.amount, 0);
  const failedProductionLossExpense = context.failedProductionLosses
    .filter((loss) => isWithinRange(loss.settledAt, range))
    .reduce((sum, loss) => sum + loss.lossAmount, 0);
  const generalExpense = financeGeneralExpense + failedProductionLossExpense;

  const totalOperatingExpenses =
    invoiceExpenses + payrollExpense + commissionExpense + tadaExpense + generalExpense;
  const grossProfit = totalRevenue - totalCogs;
  const netProfit = grossProfit - totalOperatingExpenses;

  const summary: CompanySummary = {
    totalRevenue: roundCurrency(totalRevenue),
    totalCogs: roundCurrency(totalCogs),
    grossProfit: roundCurrency(grossProfit),
    grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
    invoiceExpenses: roundCurrency(invoiceExpenses),
    payroll: roundCurrency(payrollExpense),
    commissions: roundCurrency(commissionExpense),
    tada: roundCurrency(tadaExpense),
    generalExpenses: roundCurrency(generalExpense),
    totalOperatingExpenses: roundCurrency(totalOperatingExpenses),
    netProfit: roundCurrency(netProfit),
    netMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
    totalCartons: roundMetric(totalCartons),
    totalUnits: roundMetric(totalUnits),
    invoiceCount: invoiceCount || invoiceIdsWithRealization.size,
  };

  const deductionBreakdown: DeductionBreakdownRow[] = [
    {
      type: "invoice_expenses",
      label: "Invoice Expenses",
      description: "Invoice-linked overhead allocated in line with realized collections.",
      amount: summary.invoiceExpenses,
      impact: -summary.invoiceExpenses,
    },
    {
      type: "payroll",
      label: "Payroll",
      description: "Paid payroll cost after pulling commission and TA/DA into separate buckets.",
      amount: summary.payroll,
      impact: -summary.payroll,
    },
    {
      type: "commissions",
      label: "Commissions",
      description: "Commission paid to sales staff through payroll.",
      amount: summary.commissions,
      impact: -summary.commissions,
    },
    {
      type: "tada",
      label: "TA/DA",
      description: "Travel allowance, daily allowance, and distribution reimbursements.",
      amount: summary.tada,
      impact: -summary.tada,
    },
    {
      type: "general_expenses",
      label: "General Expenses",
      description:
        "Approved finance expenses plus failed-batch chemical write-offs, excluding capitalized inventory purchases.",
      amount: summary.generalExpenses,
      impact: -summary.generalExpenses,
    },
  ];

  return {
    summary,
    status: buildStatus(summary),
    perProduct: withProfitMetrics(Array.from(productMap.values())),
    perRecipe: withProfitMetrics(Array.from(recipeMap.values())),
    deductionBreakdown,
    realizedLines,
  };
}

async function buildFinanceReconciliation(range: ReportDateRange, summary: CompanySummary) {
  const [
    walletRows,
    inRangeTransactions,
    afterEndTransactions,
    afterStartTransactions,
    capitalizedExpenses,
    expenseOffsetPayments,
    failedProductionLosses,
  ] =
    await Promise.all([
      db.select({ balance: wallets.balance }).from(wallets),
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          source: transactions.source,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(and(gte(transactions.createdAt, range.fromDate), lte(transactions.createdAt, range.toDate))),
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          source: transactions.source,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(gt(transactions.createdAt, range.toDate)),
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          source: transactions.source,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(gte(transactions.createdAt, range.fromDate)),
      db.query.expenses.findMany({
        where: and(gte(expenses.expenseDate, range.fromDate), lte(expenses.expenseDate, range.toDate)),
      }).then((rows) =>
        rows
          .map((row) => ({
            id: row.id,
            category: row.category,
            description: row.description,
            amount: toNumber(row.amount),
            expenseDate: row.expenseDate,
          }))
          .filter(isCapitalizedInventoryExpense),
      ),
      db
        .select({
          amount: payments.amount,
        })
        .from(payments)
        .where(
          and(
            eq(payments.method, "expense_offset"),
            gte(payments.paymentDate, range.fromDate),
            lte(payments.paymentDate, range.toDate),
          ),
        ),
      db
        .select({
          lossAmount: failedProductionChemicalRecoveries.lossAmount,
        })
        .from(failedProductionChemicalRecoveries)
        .where(
          and(
            gte(failedProductionChemicalRecoveries.createdAt, range.fromDate),
            lte(failedProductionChemicalRecoveries.createdAt, range.toDate),
          ),
        ),
    ]);

  const currentAccountBalance = walletRows.reduce(
    (sum, row) => sum + toNumber(row.balance),
    0,
  );

  const normalizeTransactions = (rows: Array<{ type: string; amount: string | number; source: string }>) =>
    rows.map((row) => ({
      type: row.type,
      source: row.source,
      amount: toNumber(row.amount),
    }));

  const inRange = normalizeTransactions(inRangeTransactions);
  const afterEnd = normalizeTransactions(afterEndTransactions);
  const afterStart = normalizeTransactions(afterStartTransactions);

  const signedAmount = (row: { type: string; amount: number }) =>
    row.type === "credit" ? row.amount : -row.amount;

  const periodNetMovement = roundCurrency(
    inRange.reduce((sum, row) => sum + signedAmount(row), 0),
  );
  const balanceAsOfEnd = roundCurrency(
    currentAccountBalance - afterEnd.reduce((sum, row) => sum + signedAmount(row), 0),
  );
  const balanceAsOfStart = roundCurrency(
    currentAccountBalance - afterStart.reduce((sum, row) => sum + signedAmount(row), 0),
  );

  const sumBySource = (predicate: (source: string) => boolean) =>
    roundCurrency(
      inRange
        .filter((row) => predicate(row.source))
        .reduce((sum, row) => sum + signedAmount(row), 0),
    );

  const salesInflows = sumBySource((source) => FINANCE_SALE_SOURCES.includes(source as (typeof FINANCE_SALE_SOURCES)[number]));
  const expenseOutflows = roundCurrency(
    Math.abs(sumBySource((source) => FINANCE_EXPENSE_SOURCES.includes(source as (typeof FINANCE_EXPENSE_SOURCES)[number]))),
  );
  const payrollOutflows = roundCurrency(
    Math.abs(sumBySource((source) => source.startsWith("Payroll"))),
  );
  const advanceOutflows = roundCurrency(
    Math.abs(sumBySource((source) => source === "Advance Payment")),
  );
  const manualAdjustments = sumBySource((source) => source === "Manual Adjustment");
  const openingBalances = sumBySource((source) => source === "Opening Balance");
  const otherMovements = roundCurrency(
    inRange
      .filter(
        (row) =>
          !FINANCE_SALE_SOURCES.includes(row.source as (typeof FINANCE_SALE_SOURCES)[number]) &&
          !FINANCE_EXPENSE_SOURCES.includes(row.source as (typeof FINANCE_EXPENSE_SOURCES)[number]) &&
          !row.source.startsWith("Payroll") &&
          row.source !== "Advance Payment" &&
          row.source !== "Manual Adjustment" &&
          row.source !== "Opening Balance",
      )
      .reduce((sum, row) => sum + signedAmount(row), 0),
  );

  const capitalizedInventoryPurchases = capitalizedExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
  const failedBatchLosses = failedProductionLosses.reduce(
    (sum, row) => sum + toNumber(row.lossAmount),
    0,
  );
  const nonCashExpenseOffsets = expenseOffsetPayments.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0,
  );
  const payrollCashGap = roundCurrency(summary.payroll + summary.commissions + summary.tada - payrollOutflows);

  const bridgeRows: FinanceReconciliationRow[] = [
    {
      type: "net_profit",
      label: "Operational Net Profit",
      amount: summary.netProfit,
      direction: "positive",
      description: "Net profit from the company report for the selected period.",
    },
    {
      type: "cogs_non_cash",
      label: "Add Back Non-cash COGS",
      amount: summary.totalCogs,
      direction: "positive",
      description: "Sold-goods cost reduces profit now, but the cash left the business when inventory was purchased.",
    },
    {
      type: "capitalized_inventory",
      label: "Less Inventory Purchase Cash Outflows",
      amount: capitalizedInventoryPurchases,
      direction: "negative",
      description: "Supplier purchases move cash in finance but are excluded from current-period operating expense.",
    },
    {
      type: "expense_offsets",
      label: "Less Non-cash Expense Offsets",
      amount: nonCashExpenseOffsets,
      direction: "negative",
      description: "Expense-offset settlements count as realized revenue but do not create a wallet credit.",
    },
    {
      type: "failed_batch_losses",
      label: "Add Back Non-cash Failed Batch Losses",
      amount: failedBatchLosses,
      direction: "positive",
      description: "Failed-batch chemical write-offs reduce profit when settled but do not move wallet cash.",
    },
    {
      type: "payroll_cash_gap",
      label: "Payroll Cash vs Expense Timing",
      amount: payrollCashGap,
      direction: payrollCashGap >= 0 ? "positive" : "negative",
      description: "Difference between payroll expense shown in P&L and the actual wallet debit recorded in finance.",
    },
    {
      type: "advance_payments",
      label: "Less Salary Advances",
      amount: advanceOutflows,
      direction: "negative",
      description: "Salary advances reduce wallet balance but are not operating expenses in this report.",
    },
    {
      type: "manual_and_opening",
      label: "Manual / Opening Balance Adjustments",
      amount: manualAdjustments + openingBalances + otherMovements,
      direction: manualAdjustments + openingBalances + otherMovements >= 0 ? "positive" : "negative",
      description: "Finance-only balance events that do not belong inside operating profit.",
    },
  ];

  const bridgeDifference = roundCurrency(
    periodNetMovement -
      bridgeRows.reduce((sum, row) => {
        if (row.direction === "positive") {
          return sum + row.amount;
        }
        if (row.direction === "negative") {
          return sum - row.amount;
        }
        return sum;
      }, 0),
  );

  if (Math.abs(bridgeDifference) >= 0.01) {
    bridgeRows.push({
      type: "remaining_difference",
      label: "Remaining Timing Difference",
      amount: Math.abs(bridgeDifference),
      direction: bridgeDifference >= 0 ? "positive" : "negative",
      description: "Residual timing difference between realized profit and wallet movement after the mapped bridge items.",
    });
  }

  return {
    currentAccountBalance,
    balanceAsOfStart,
    balanceAsOfEnd,
    periodNetMovement,
    salesInflows,
    expenseOutflows,
    payrollOutflows,
    advanceOutflows,
    manualAdjustments,
    openingBalances,
    otherMovements,
    bridgeDifference,
    bridgeRows,
  } satisfies FinanceReconciliation;
}

export async function getCompanyReportData(input?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  const range = createReportDateRange(input);
  const previousRange = createPreviousRange(range);
  const trendFromDate = startOfMonth(addMonths(range.toDate, -TREND_MONTHS + 1));
  const preloadFromDate = previousRange.fromDate < trendFromDate ? previousRange.fromDate : trendFromDate;

  const context = await loadContext(preloadFromDate, range.toDate);
  const current = buildSnapshot(context, range);
  const previous = buildSnapshot(context, previousRange);
  const monthlyTrend: CompanyTrendPoint[] = [];

  for (let monthIndex = 0; monthIndex < TREND_MONTHS; monthIndex += 1) {
    const bucketDate = addMonths(trendFromDate, monthIndex);
    const bucketRange = createReportDateRange({
      dateFrom: format(startOfMonth(bucketDate), "yyyy-MM-dd"),
      dateTo: format(endOfMonth(bucketDate), "yyyy-MM-dd"),
    });
    const snapshot = buildSnapshot(context, bucketRange);

    monthlyTrend.push({
      monthKey: format(bucketDate, "yyyy-MM-01"),
      monthLabel: format(bucketDate, "MMM yyyy"),
      ...snapshot.summary,
    });
  }

  const reconciliation = await buildFinanceReconciliation(range, current.summary);

  return {
    generatedAt: new Date().toISOString(),
    comparisonLabel: createComparisonLabel(range, previousRange),
    reportPeriod: {
      dateFrom: range.fromDate.toISOString(),
      dateTo: range.toDate.toISOString(),
      label: createPeriodLabel(range),
    },
    comparisonPeriod: {
      dateFrom: previousRange.fromDate.toISOString(),
      dateTo: previousRange.toDate.toISOString(),
    },
    summary: current.summary,
    previousSummary: previous.summary,
    status: current.status,
    monthlyTrend,
    deltas: {
      revenuePercent: calculateDelta(current.summary.totalRevenue, previous.summary.totalRevenue),
      grossProfitPercent: calculateDelta(current.summary.grossProfit, previous.summary.grossProfit),
      grossMarginPoints: calculatePointDelta(current.summary.grossMargin, previous.summary.grossMargin),
      operatingExpensesPercent: calculateDelta(
        current.summary.totalOperatingExpenses,
        previous.summary.totalOperatingExpenses,
      ),
      netProfitPercent: calculateDelta(current.summary.netProfit, previous.summary.netProfit),
      netMarginPoints: calculatePointDelta(current.summary.netMargin, previous.summary.netMargin),
    },
    deductions: {
      invoiceExpenses: current.summary.invoiceExpenses,
      payroll: current.summary.payroll,
      commissions: current.summary.commissions,
      tada: current.summary.tada,
      generalExpenses: current.summary.generalExpenses,
      totalOperatingExpenses: current.summary.totalOperatingExpenses,
    },
    deductionBreakdown: current.deductionBreakdown,
    reconciliation,
    perProduct: current.perProduct,
    perRecipe: current.perRecipe,
    realizedLines: current.realizedLines,
  } satisfies CompanyReportData;
}

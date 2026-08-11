import { createServerFn } from "@tanstack/react-start";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, recipes } from "@/db/schemas/inventory-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { REPORT_SOURCES } from "@/lib/report-source";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import { getCompanyReportData } from "./company-reporting-core";
import { fetchScopedInvoiceRows } from "./reporting-core";

function escapeCsv(value: string | number | null | undefined): string {
  const str = String(value ?? "");
  if (/^[+=@-]/.test(str)) return `"'${str}"`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export const exportPnlCsvFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        productId: z.string().optional(),
        recipeId: z.string().optional(),
        distributorId: z.string().optional(),
        customerType: z.string().optional(),
        source: z.enum(REPORT_SOURCES).default("all"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const fromDate = data.dateFrom
      ? new Date(data.dateFrom)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const toDate = data.dateTo ? new Date(data.dateTo) : new Date();
    toDate.setHours(23, 59, 59, 999);

    if (!data.productId && !data.recipeId) {
      const report = await getCompanyReportData({
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        source: data.source,
      });

      const headerRows = [
        ["Report", "Company Profitability Overview"],
        ["Period", report.reportPeriod.label],
        ["Invoice Source", report.source],
        ["Status", report.status.label],
        ["Collected Revenue", report.summary.totalRevenue.toFixed(2)],
        ["COGS", report.summary.totalCogs.toFixed(2)],
        ["Gross Profit", report.summary.grossProfit.toFixed(2)],
        ["Invoice Expenses", report.summary.invoiceExpenses.toFixed(2)],
        ["Payroll", report.summary.payroll.toFixed(2)],
        ["Commissions", report.summary.commissions.toFixed(2)],
        ["TA/DA", report.summary.tada.toFixed(2)],
        ["General Expenses", report.summary.generalExpenses.toFixed(2)],
        [
          "Total Operating Expenses",
          report.summary.totalOperatingExpenses.toFixed(2),
        ],
        ["Net Profit", report.summary.netProfit.toFixed(2)],
        ["Wallet Movement", report.reconciliation.periodNetMovement.toFixed(2)],
        [],
      ];

      const lineHeaders = [
        "Invoice Date",
        "Invoice ID",
        "Invoice Number",
        "Customer",
        "Product",
        "Recipe",
        "Pack",
        "Realization %",
        "Payment To Date",
        "Adjusted Revenue",
        "Adjusted COGS",
        "Realized Revenue",
        "Realized COGS",
        "Allocated Invoice Expenses",
        "Gross Profit",
      ];

      const lineRows = report.realizedLines.map((row) => [
        escapeCsv(row.invoiceDate.toISOString().split("T")[0]),
        escapeCsv(row.invoiceId),
        escapeCsv(row.invoiceNumber),
        escapeCsv(row.customerName),
        escapeCsv(row.productName ?? "Unmapped Sales"),
        escapeCsv(row.recipeName ?? ""),
        escapeCsv(row.pack),
        escapeCsv((row.realizedRatio * 100).toFixed(2)),
        escapeCsv(row.paymentToDate.toFixed(2)),
        escapeCsv(row.adjustedLineRevenue.toFixed(2)),
        escapeCsv(row.adjustedLineCogs.toFixed(2)),
        escapeCsv(row.realizedRevenue.toFixed(2)),
        escapeCsv(row.realizedCogs.toFixed(2)),
        escapeCsv(row.realizedInvoiceExpenses.toFixed(2)),
        escapeCsv((row.realizedRevenue - row.realizedCogs).toFixed(2)),
      ]);

      const reconciliationRows = [
        [],
        ["Finance Reconciliation"],
        ["Label", "Amount", "Direction", "Description"],
        ...report.reconciliation.bridgeRows.map((row) => [
          escapeCsv(row.label),
          escapeCsv(row.amount.toFixed(2)),
          escapeCsv(row.direction),
          escapeCsv(row.description),
        ]),
      ];

      const csv = [
        ...headerRows.map((row) => row.map(escapeCsv).join(",")),
        lineHeaders.join(","),
        ...lineRows.map((row) => row.join(",")),
        ...reconciliationRows.map((row) => row.map(escapeCsv).join(",")),
      ].join("\n");

      return {
        csv,
        filename: `company-profit-loss-${fromDate.toISOString().split("T")[0]}-${toDate.toISOString().split("T")[0]}.csv`,
        rowCount: report.realizedLines.length,
      };
    }

    if (!data.distributorId && !data.customerType) {
      const rows = await fetchScopedInvoiceRows(
        {
          productId: data.productId,
          recipeId: data.recipeId,
          source: data.source,
        },
        {
          fromDate,
          toDate,
        },
      );

      const headers = [
        "Invoice Date",
        "Invoice ID",
        "Slip Number",
        "Customer",
        "Recipe",
        "Variant",
        "Pack",
        "Realization %",
        "Payment To Date",
        "Adjusted Revenue",
        "Adjusted COGS",
        "Realized Revenue",
        "Realized COGS",
        "Direct Profit",
      ];

      const csvRows = rows.map((row) => [
        escapeCsv(row.invoiceDate.split("T")[0]),
        escapeCsv(row.invoiceId),
        escapeCsv(row.invoiceNumber),
        escapeCsv(row.customerName),
        escapeCsv(row.recipeName),
        escapeCsv(row.variantLabel),
        escapeCsv(row.pack),
        escapeCsv((row.realizedRatio * 100).toFixed(2)),
        escapeCsv(row.paymentToDate.toFixed(2)),
        escapeCsv(row.adjustedLineRevenue.toFixed(2)),
        escapeCsv(row.adjustedLineCogs.toFixed(2)),
        escapeCsv(row.realizedRevenue.toFixed(2)),
        escapeCsv(row.realizedCogs.toFixed(2)),
        escapeCsv(row.realizedProfit.toFixed(2)),
      ]);

      return {
        csv: [headers.join(","), ...csvRows.map((row) => row.join(","))].join(
          "\n",
        ),
        filename: `profit-loss-report-${fromDate.toISOString().split("T")[0]}-${toDate.toISOString().split("T")[0]}.csv`,
        rowCount: rows.length,
      };
    }

    const conditions = [
      ne(invoices.status, "voided"),
      gte(invoices.date, fromDate),
      lte(invoices.date, toDate),
    ];

    if (data.productId) {
      conditions.push(eq(recipes.productId, data.productId));
    }
    if (data.recipeId) {
      conditions.push(eq(invoiceItems.recipeId, data.recipeId));
    }
    if (data.distributorId) {
      conditions.push(eq(invoices.customerId, data.distributorId));
    }
    if (data.customerType) {
      conditions.push(eq(customers.customerType, data.customerType));
    }
    if (data.source !== "all") {
      conditions.push(eq(invoices.source, data.source));
    }

    const rows = await db
      .select({
        date: invoices.date,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        customerName: customers.name,
        customerType: customers.customerType,
        productName: products.name,
        recipeName: recipes.name,
        pack: invoiceItems.pack,
        cartons: invoiceItems.numberOfCartons,
        units: invoiceItems.quantity,
        perCartonPrice: invoiceItems.perCartonPrice,
        revenue: invoiceItems.amount,
        cogs: invoiceItems.costOfGoodsSold,
        cogsPerUnit: invoiceItems.costOfGoodsSoldPerUnit,
        profit: sql<number>`${invoiceItems.amount}::numeric - ${invoiceItems.costOfGoodsSold}::numeric`,
        margin: sql<number>`CASE WHEN ${invoiceItems.amount}::numeric > 0 THEN ((${invoiceItems.amount}::numeric - ${invoiceItems.costOfGoodsSold}::numeric) / ${invoiceItems.amount}::numeric * 100) ELSE 0 END`,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .innerJoin(recipes, eq(invoiceItems.recipeId, recipes.id))
      .innerJoin(products, eq(recipes.productId, products.id))
      .where(and(...conditions))
      .orderBy(sql`${invoices.date} DESC`);

    const headers = [
      "Date",
      "Invoice ID",
      "Invoice Number",
      "Customer",
      "Customer Type",
      "Product",
      "Recipe",
      "Pack",
      "Cartons",
      "Units",
      "Per Carton Price",
      "Revenue",
      "COGS",
      "COGS Per Unit",
      "Profit",
      "Margin %",
    ];

    const csvRows = rows.map((row) => [
      escapeCsv(row.date.toISOString().split("T")[0]),
      escapeCsv(row.invoiceId),
      escapeCsv(row.invoiceNumber),
      escapeCsv(row.customerName),
      escapeCsv(row.customerType),
      escapeCsv(row.productName),
      escapeCsv(row.recipeName),
      escapeCsv(row.pack),
      escapeCsv(row.cartons ?? 0),
      escapeCsv(row.units ?? 0),
      escapeCsv(row.perCartonPrice ?? "0"),
      escapeCsv(row.revenue ?? "0"),
      escapeCsv(row.cogs ?? "0"),
      escapeCsv(row.cogsPerUnit ?? "0"),
      escapeCsv(Number(row.profit ?? 0).toFixed(2)),
      escapeCsv(Number(row.margin ?? 0).toFixed(2)),
    ]);

    return {
      csv: [headers.join(","), ...csvRows.map((row) => row.join(","))].join(
        "\n",
      ),
      filename: `profit-loss-report-${fromDate.toISOString().split("T")[0]}-${toDate.toISOString().split("T")[0]}.csv`,
      rowCount: rows.length,
    };
  });

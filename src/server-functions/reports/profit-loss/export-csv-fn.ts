import { reportDateKey } from "@/lib/report-dates";
import { createReportDateRange } from "./reporting-math";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, recipes } from "@/db/schemas/inventory-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { formatReportMoney } from "@/lib/report-format";
import { formatReportTimestamp } from "@/lib/report-dates";
import { reportSourceLabel, REPORT_SOURCES } from "@/lib/report-source";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import { getCompanyReportData } from "./company-reporting-core";
import { fetchScopedInvoiceRows } from "./reporting-core";

function escapeCsv(value: string | number | null | undefined): string {
  let str = String(value ?? "");
  // Preserve signed financial values; neutralize formula-leading text before CSV quoting.
  if (/^[+=@-]/.test(str) && !/^-?\d[\d,]*(?:\.\d+)?$/.test(str))
    str = "'" + str;
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
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
    const { fromDate, toDate } = createReportDateRange(data);
    const metadata = [
      ["Application", "Titan ERP"],
      ["Currency", "PKR"],
      ["Date from", reportDateKey(fromDate)],
      ["Date to", reportDateKey(toDate)],
      ["Invoice Source", reportSourceLabel(data.source)],
      [
        "CSV detail basis",
        "Invoice contribution rows; failed-batch losses are not included in scoped CSV direct profit.",
      ],
      [
        "Scope",
        data.recipeId
          ? `Recipe ${data.recipeId}`
          : data.productId
            ? `Product ${data.productId}`
            : "Company-wide",
      ],
      ["Generated", formatReportTimestamp(new Date())],
      [
        "Basis",
        "Operational payment-based realized profitability. Product and recipe direct profit excludes shared company overhead.",
      ],
      ...(data.source !== "all"
        ? [
            [
              "Source scope",
              "Shared payroll, factory expenses, failed-batch losses, and wallet reconciliation are excluded from this invoice-source contribution.",
            ],
          ]
        : []),
      [],
    ].map((row) => row.map(escapeCsv).join(","));

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
        ["Collected Revenue", formatReportMoney(report.summary.totalRevenue)],
        ["COGS", formatReportMoney(report.summary.totalCogs)],
        ["Gross Profit", formatReportMoney(report.summary.grossProfit)],
        ["Invoice Expenses", formatReportMoney(report.summary.invoiceExpenses)],
        ["Payroll", formatReportMoney(report.summary.payroll)],
        ["Commissions", formatReportMoney(report.summary.commissions)],
        ["TA/DA", formatReportMoney(report.summary.tada)],
        ["General Expenses", formatReportMoney(report.summary.generalExpenses)],
        [
          "Total Operating Expenses",
          formatReportMoney(report.summary.totalOperatingExpenses),
        ],
        ["Net Profit", formatReportMoney(report.summary.netProfit)],
        [
          "Wallet Movement",
          formatReportMoney(report.reconciliation.periodNetMovement),
        ],
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
        reportDateKey(row.invoiceDate),
        row.invoiceId,
        row.invoiceNumber,
        row.customerName,
        row.productName ?? "Unmapped Sales",
        row.recipeName ?? "",
        row.pack,
        (row.realizedRatio * 100).toFixed(2),
        formatReportMoney(row.paymentToDate),
        formatReportMoney(row.adjustedLineRevenue),
        formatReportMoney(row.adjustedLineCogs),
        formatReportMoney(row.realizedRevenue),
        formatReportMoney(row.realizedCogs),
        formatReportMoney(row.realizedInvoiceExpenses),
        formatReportMoney(row.realizedRevenue - row.realizedCogs),
      ]);

      const reconciliationRows = [
        [],
        ["Finance Reconciliation"],
        ["Label", "Amount", "Direction", "Description"],
        ...report.reconciliation.bridgeRows.map((row) => [
          row.label,
          formatReportMoney(row.amount),
          row.direction,
          row.description,
        ]),
      ];

      const csv = [
        ...metadata,
        ...headerRows.map((row) => row.map(escapeCsv).join(",")),
        lineHeaders.join(","),
        ...lineRows.map((row) => row.map(escapeCsv).join(",")),
        ...reconciliationRows.map((row) => row.map(escapeCsv).join(",")),
      ].join("\n");

      return {
        csv,
        filename: `company-profit-loss-${reportDateKey(fromDate)}-${reportDateKey(toDate)}.csv`,
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
        reportDateKey(row.invoiceDate),
        row.invoiceId,
        row.invoiceNumber,
        row.customerName,
        row.recipeName,
        row.variantLabel,
        row.pack,
        (row.realizedRatio * 100).toFixed(2),
        formatReportMoney(row.paymentToDate),
        formatReportMoney(row.adjustedLineRevenue),
        formatReportMoney(row.adjustedLineCogs),
        formatReportMoney(row.realizedRevenue),
        formatReportMoney(row.realizedCogs),
        formatReportMoney(row.realizedProfit),
      ]);

      return {
        csv: [
          ...metadata,
          headers.join(","),
          ...csvRows.map((row) => row.map(escapeCsv).join(",")),
        ].join("\n"),
        filename: `profit-loss-report-${reportDateKey(fromDate)}-${reportDateKey(toDate)}.csv`,
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
      reportDateKey(row.date),
      row.invoiceId,
      row.invoiceNumber,
      row.customerName,
      row.customerType,
      row.productName,
      row.recipeName,
      row.pack,
      row.cartons ?? 0,
      row.units ?? 0,
      formatReportMoney(row.perCartonPrice ?? 0),
      formatReportMoney(row.revenue ?? 0),
      formatReportMoney(row.cogs ?? 0),
      formatReportMoney(row.cogsPerUnit ?? 0),
      formatReportMoney(row.profit ?? 0),
      Number(row.margin ?? 0).toFixed(2),
    ]);

    return {
      csv: [
        ...metadata,
        headers.join(","),
        ...csvRows.map((row) => row.map(escapeCsv).join(",")),
      ].join("\n"),
      filename: `profit-loss-report-${reportDateKey(fromDate)}-${reportDateKey(toDate)}.csv`,
      rowCount: rows.length,
    };
  });

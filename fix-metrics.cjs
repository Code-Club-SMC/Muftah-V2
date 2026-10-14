const fs = require('fs');
const file = '/home/abdul-rehman/Projects/titan-new/src/server-functions/dashboard/get-dashboard-fn.ts';
let content = fs.readFileSync(file, 'utf8');

const startMatch = "  const [";
const endMatch = "  ]);";

const startIndex = content.indexOf(startMatch);
const endIndex = content.indexOf(endMatch, startIndex);

if (startIndex !== -1 && endIndex !== -1) {
  const newBlock = `  const [
    revenueRow,
    materialConsumptionRow,
    expensesRow,
    payrollsInRange,
  ] = await Promise.all([
    db
      .select({ total: sql<string>\`coalesce(sum(\${invoices.totalPrice}), 0)\` })
      .from(invoices)
      .where(
        and(
          gte(invoices.createdAt, rangeStart),
          lte(invoices.createdAt, rangeEnd),
          inArray(invoices.paymentStatus, ["paid", "partially_paid"]),
        ),
      )
      .then((r) => r[0]),
    db
      .select({
        totalMaterialCost: sql<string>\`coalesce(sum(\${productionMaterialsUsed.totalCost}), 0)\`,
      })
      .from(productionMaterialsUsed)
      .innerJoin(productionRuns, eq(productionMaterialsUsed.productionRunId, productionRuns.id))
      .where(
        and(
          eq(productionRuns.status, "completed"),
          gte(productionRuns.actualCompletionDate, rangeStart),
          lte(productionRuns.actualCompletionDate, rangeEnd),
        ),
      )
      .then((r) => r[0]),
    db
      .select({ total: sql<string>\`coalesce(sum(\${expenses.amount}), 0)\` })
      .from(expenses)
      .where(and(gte(expenses.createdAt, rangeStart), lte(expenses.createdAt, rangeEnd)))
      .then((r) => r[0]),
    db.query.payrolls.findMany({
      where: and(
        gte(payrolls.createdAt, rangeStart),
        lte(payrolls.createdAt, rangeEnd),
      ),
      columns: { id: true },
    }),
  ]);`;
  
  content = content.substring(0, startIndex) + newBlock + content.substring(endIndex + 5);
  fs.writeFileSync(file, content);
  console.log("Fixed metrics fn");
} else {
  console.log("Could not find blocks");
}

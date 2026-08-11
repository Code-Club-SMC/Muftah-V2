import { db } from "./index";
import { customers, invoices, invoiceItems } from "./schemas/sales-schema";
import { payments, slipRecords, salesmen } from "./schemas/sales-erp-schema";
import { warehouses } from "./schemas/inventory-schema";
import { wallets } from "./schemas/finance-schema";
import { user } from "./schemas/auth-schema";
import { createId } from "@paralleldrive/cuid2";
import { eq, sql } from "drizzle-orm";
import { subDays, addDays } from "date-fns";

// ---------------------------------------------------------------------------
// Distributor Ledger Seed — Realistic demo data for visualization
// Creates: Distributor, Salesman, Invoices, Payments, Slip Records
// ---------------------------------------------------------------------------

async function seedDistributorLedger() {
  console.log("🌱 Seeding distributor ledger demo data...");

  // ── 1. Get or create a user (for performedById) ─────────────────────────
  let adminUser = await db.query.user.findFirst();
  if (!adminUser) {
    console.log("Creating admin user...");
    const [inserted] = await db
      .insert(user)
      .values({
        id: createId(),
        name: "Admin User",
        email: "admin@titan.pk",
        emailVerified: true,
      })
      .returning();
    adminUser = inserted;
  }

  // ── 2. Get or create a warehouse ────────────────────────────────────────
  let warehouse = await db.query.warehouses.findFirst();
  if (!warehouse) {
    console.log("Creating main warehouse...");
    const [inserted] = await db
      .insert(warehouses)
      .values({
        id: createId(),
        name: "Main Warehouse",
        address: "Plot 45, Industrial Area",
        city: "Lahore",
        state: "Punjab",
        type: "storage",
        latitude: "31.52040000",
        longitude: "74.35870000",
        isActive: true,
      })
      .returning();
    warehouse = inserted;
  }

  // ── 3. Create or find salesman ──────────────────────────────────────────
  let salesman = await db.query.salesmen.findFirst({
    where: eq(salesmen.name, "Usman Ahmed"),
  });

  if (!salesman) {
    console.log("Creating salesman: Usman Ahmed...");
    const [inserted] = await db
      .insert(salesmen)
      .values({
        id: createId(),
        name: "Usman Ahmed",
        phone: "0300-1234567",
        status: "active",
      })
      .returning();
    salesman = inserted;
  }

  // ── 4. Create or find distributor ───────────────────────────────────────
  let distributor = await db.query.customers.findFirst({
    where: eq(customers.name, "Al-Madina Distributors"),
  });

  if (!distributor) {
    console.log("Creating distributor: Al-Madina Distributors...");
    const [inserted] = await db
      .insert(customers)
      .values({
        id: createId(),
        name: "Al-Madina Distributors",
        address: "Shop #12, Shah Alam Market",
        city: "Lahore",
        state: "Punjab",
        mobileNumber: "0321-4567890",
        customerType: "distributor",
        salesmanId: salesman.id,
        defaultMargin: "15.00",
        totalSale: "0",
        totalPaidAmount: "0",
        outstandingAmount: "0",
      })
      .returning();
    distributor = inserted;
  }

  console.log(`Using distributor: ${distributor.name} (${distributor.id})`);

  const [cashWallet, bankWallet] = await Promise.all([
    db.query.wallets.findFirst({ where: eq(wallets.type, "cash") }),
    db.query.wallets.findFirst({ where: eq(wallets.type, "bank") }),
  ]);
  if (!cashWallet || !bankWallet) {
    throw new Error("Create one cash account and one bank account before running this seed");
  }

  // ── 5. Check if invoices already exist (idempotency) ────────────────────
  const existingInvoiceCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(eq(invoices.customerId, distributor.id));

  if (existingInvoiceCount[0]?.count > 0) {
    console.log(`\n⚠️  Distributor already has ${existingInvoiceCount[0].count} invoices.`);
    console.log("   Skipping invoice creation to avoid duplicates.");
    console.log(`\n📍 Navigate to: /sales/people/distributors/${distributor.id}/ledger`);
    process.exit(0);
  }

  // ── 6. Create realistic invoices over past 4 months ─────────────────────
  // Helper: generate items that sum exactly to the invoice total
  function generateItems(totalAmount: number) {
    const products = [
      { pack: "Dishwash Liquid 1L", price: 1800, retailPrice: 2100 },
      { pack: "Detergent Powder 5kg", price: 2500, retailPrice: 2900 },
      { pack: "Fabric Softener 1L", price: 1500, retailPrice: 1800 },
      { pack: "Bleach 1L", price: 800, retailPrice: 1000 },
      { pack: "Glass Cleaner 500ml", price: 1200, retailPrice: 1500 },
      { pack: "Floor Cleaner 1L", price: 2000, retailPrice: 2400 },
    ];

    const items: { pack: string; cartons: number; price: number; retailPrice: number }[] = [];
    let remaining = totalAmount;

    for (let i = 0; i < products.length && remaining > 0; i++) {
      const product = products[i];
      const cartons = Math.floor(remaining / product.price);
      if (cartons > 0) {
        const amount = cartons * product.price;
        items.push({
          pack: product.pack,
          cartons,
          price: product.price,
          retailPrice: product.retailPrice,
        });
        remaining -= amount;
      }
    }

    // If there's still a remainder, adjust the last item
    if (remaining > 0 && items.length > 0) {
      const lastItem = items[items.length - 1];
      const extraCartons = Math.ceil(remaining / lastItem.price);
      lastItem.cartons += extraCartons;
    }

    return items;
  }

  const invoiceData = [
    // Month 1 (4 months ago) - Fully paid
    {
      daysAgo: 120,
      items: generateItems(900000),
      cash: 400000,
      credit: 500000,
      status: "paid",
      slipStatus: "closed",
      paymentDays: 25,
    },
    // Month 2 (3 months ago) - Fully paid
    {
      daysAgo: 90,
      items: generateItems(750000),
      cash: 300000,
      credit: 450000,
      status: "paid",
      slipStatus: "closed",
      paymentDays: 20,
    },
    // Month 3 (2 months ago) - Partially paid
    {
      daysAgo: 60,
      items: generateItems(1100000),
      cash: 500000,
      credit: 600000,
      status: "partially_paid",
      slipStatus: "partially_recovered",
      paymentDays: 30,
      paidSoFar: 350000,
    },
    // Month 4 (1 month ago) - Partially paid
    {
      daysAgo: 35,
      items: generateItems(900000),
      cash: 400000,
      credit: 500000,
      status: "partially_paid",
      slipStatus: "partially_recovered",
      paymentDays: 25,
      paidSoFar: 200000,
    },
    // Current month - Unpaid (recent)
    {
      daysAgo: 10,
      items: generateItems(1500000),
      cash: 600000,
      credit: 900000,
      status: "saved",
      slipStatus: "open",
      paymentDays: null,
    },
    // Another recent invoice - Unpaid
    {
      daysAgo: 5,
      items: generateItems(500000),
      cash: 200000,
      credit: 300000,
      status: "saved",
      slipStatus: "open",
      paymentDays: null,
    },
  ];

  let slipCounter = 1000;
  let totalSales = 0;
  let totalPayments = 0;
  let totalCredit = 0;

  for (const inv of invoiceData) {
    const invoiceDate = subDays(new Date(), inv.daysAgo);
    const invoiceId = createId();
    const invoiceNumber = `INV-SEED-${slipCounter++}`;

    // Calculate totals
    const totalPrice = inv.cash + inv.credit;

    console.log(`Creating invoice from ${inv.daysAgo} days ago: PKR ${totalPrice.toLocaleString()}`);

    // Create invoice
    const laterPayment =
      inv.status === "paid" ? inv.credit : (inv.paidSoFar ?? 0);
    const paidAmount = inv.cash + laterPayment;
    const outstandingAmount = Math.max(0, totalPrice - paidAmount);

    await db.insert(invoices).values({
      id: invoiceId,
      date: invoiceDate,
      customerId: distributor.id,
      warehouseId: warehouse.id,
      performedById: adminUser.id,
      salesmanId: salesman.id,
      invoiceNumber,
      paidAmount: paidAmount.toString(),
      outstandingAmount: outstandingAmount.toString(),
      amount: totalPrice.toString(),
      totalPrice: totalPrice.toString(),
      status: "saved",
      paymentStatus:
        outstandingAmount === 0
          ? "paid"
          : paidAmount > 0
            ? "partially_paid"
            : "unpaid",
      paymentDueDate: outstandingAmount > 0 ? addDays(invoiceDate, 30) : null,
      remarks: "Monthly bulk order",
    });

    // Create invoice items
    for (const item of inv.items) {
      const amount = item.cartons * item.price;
      await db.insert(invoiceItems).values({
        id: createId(),
        invoiceId,
        pack: item.pack,
        numberOfCartons: item.cartons,
        perCartonPrice: item.price.toString(),
        amount: amount.toString(),
        retailPrice: item.retailPrice.toString(),
        hsnCode: "3401.2000",
        margin: ((item.retailPrice - item.price) * item.cartons).toString(),
        totalWeight: (item.cartons * 12.5).toFixed(3),
      });
    }

    // Create slip record if there's credit
    if (inv.credit > 0) {
      const amountRecovered = inv.paidSoFar || 0;
      await db.insert(slipRecords).values({
        id: createId(),
        slipNumber: invoiceNumber,
        invoiceId,
        customerId: distributor.id,
        salesmanId: salesman.id,
        invoiceAmount: totalPrice.toString(),
        paidAmount: paidAmount.toString(),
        outstandingAmount: outstandingAmount.toString(),
        status: inv.slipStatus,
        recoveryStatus: inv.slipStatus === "closed" ? "resolved" : inv.slipStatus === "partially_recovered" ? "in_progress" : "pending",
        issuedAt: invoiceDate,
      });

      totalCredit += inv.credit;
      totalPayments += amountRecovered;
    }

    // Create payment records
    if (inv.cash > 0) {
      await db.insert(payments).values({
        id: createId(),
        customerId: distributor.id,
        invoiceId,
        amount: inv.cash.toString(),
        method: "cash",
        status: "confirmed",
        walletId: cashWallet.id,
        recordedById: adminUser.id,
        paymentDate: invoiceDate,
        effectiveDate: invoiceDate,
        source: "invoice_creation",
        confirmedById: adminUser.id,
        confirmedAt: invoiceDate,
        notes: "Cash payment at time of delivery",
      });
      totalPayments += inv.cash;
    }

      if (inv.paidSoFar && inv.paidSoFar > 0) {
      const paymentDate = subDays(new Date(), inv.daysAgo - inv.paymentDays!);
      await db.insert(payments).values({
        id: createId(),
        customerId: distributor.id,
        invoiceId,
        amount: inv.paidSoFar.toString(),
        method: "bank_transfer",
        status: "confirmed",
        walletId: bankWallet.id,
        reference: `TRF-${Math.floor(Math.random() * 1000000)}`,
        recordedById: adminUser.id,
        paymentDate,
        effectiveDate: paymentDate,
        source: "recovery",
        sourceRecordId: `seed-partial-${invoiceId}`,
        confirmedById: adminUser.id,
        confirmedAt: paymentDate,
        notes: "Partial payment via bank transfer",
      });
      totalPayments += inv.paidSoFar;
    }

    if (inv.status === "paid" && inv.credit > 0) {
      const paymentDate = subDays(new Date(), inv.daysAgo - inv.paymentDays!);
      await db.insert(payments).values({
        id: createId(),
        customerId: distributor.id,
        invoiceId,
        amount: inv.credit.toString(),
        method: "bank_transfer",
        status: "confirmed",
        walletId: bankWallet.id,
        reference: `TRF-${Math.floor(Math.random() * 1000000)}`,
        recordedById: adminUser.id,
        paymentDate,
        effectiveDate: paymentDate,
        source: "recovery",
        sourceRecordId: `seed-final-${invoiceId}`,
        confirmedById: adminUser.id,
        confirmedAt: paymentDate,
        notes: "Credit payment via bank transfer",
      });
      totalPayments += inv.credit;
    }

    totalSales += totalPrice;
  }

  // ── 7. Update distributor totals ────────────────────────────────────────
  const outstandingCredit = totalCredit - (totalPayments - invoiceData.reduce((sum, inv) => sum + inv.cash, 0));

  await db
    .update(customers)
    .set({
      totalSale: totalSales.toString(),
      totalPaidAmount: totalPayments.toString(),
      outstandingAmount: outstandingCredit.toString(),
    })
    .where(eq(customers.id, distributor.id));

  console.log("\n✅ Distributor ledger seed completed!");
  console.log(`   Total Sales: PKR ${totalSales.toLocaleString()}`);
  console.log(`   Total Payments: PKR ${totalPayments.toLocaleString()}`);
  console.log(`   Outstanding Amount: PKR ${outstandingCredit.toLocaleString()}`);
  console.log(`   Invoices Created: ${invoiceData.length}`);
  console.log(`\n📍 Navigate to: /sales/people/distributors/${distributor.id}/ledger`);

  process.exit(0);
}

seedDistributorLedger().catch((err) => {
  console.error("❌ Distributor ledger seeding failed:", err);
  process.exit(1);
});

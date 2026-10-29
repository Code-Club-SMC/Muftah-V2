# Salesman Activity-Driven Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement activity-driven attendance for salesmen in Titan ERP, automatically marking attendance from order deliveries and recovery attempts, displaying a dedicated Salesmen tab in the HR attendance dashboard, highlighting pending review days, and enforcing attendance verification before payroll finalization.

**Architecture:** A shared synchronization service (`syncSalesmanAttendanceForDate`) evaluates active deliveries (`orders.fulfilledBySalesmanId`) and credit recovery collections (`creditRecoveryAttempts.assignedToId`) for a given business date. If activities exist and no manual HR record overrides it, an attendance record is created with `entrySource: "salesman_activity"` and `status: "present"`. If all activities are removed, the auto-generated row is deleted. The HR daily attendance table is updated with a dedicated "Salesmen" tab, and payroll's `shouldBlockMissingAttendance` is updated to block when a salesman has unresolved working days.

**Tech Stack:** TanStack Start, React 19, TypeScript, Drizzle ORM, PostgreSQL, Tailwind CSS v4, shadcn/ui, Vitest.

## Global Constraints
- Do NOT modify `src/routeTree.gen.ts`.
- Invoices are explicitly EXCLUDED as an attendance trigger (only deliveries and recovery visits count).
- Never overwrite or delete manual HR attendance entries (`entrySource !== "salesman_activity"`).
- Attendance for salesmen uses `status: "present"`, `checkIn: null`, `checkOut: null`, and standard duty hours.
- Pakistan Standard Time (PKT, UTC+5) is used for business date conversions (`toPKTDate`).

---

### Task 1: Salesman Attendance Sync Engine

**Files:**
- Create: `src/server-functions/sales/salesman-attendance-sync.ts`
- Test: `src/server-functions/sales/salesman-attendance-sync.test.ts`

**Interfaces:**
- Consumes: `db` or `tx`, `orders`, `creditRecoveryAttempts`, `salesmen`, `employees`, `attendance` schemas, `toPKTDate` from `@/lib/attendance/time`.
- Produces: `syncSalesmanAttendanceForDate(args: { tx: DbTransaction; salesmanId: string; businessDate: string; standardDutyHours?: number }): Promise<{ status: "synced" | "skipped_manual" | "deleted" | "no_op" }>`

- [ ] **Step 1: Write the contract and behavior tests**

Create `src/server-functions/sales/salesman-attendance-sync.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SYNC_SOURCE = readFileSync(
  resolve("src/server-functions/sales/salesman-attendance-sync.ts"),
  "utf8",
);

describe("salesman-attendance-sync contract", () => {
  it("exports syncSalesmanAttendanceForDate and constant", () => {
    expect(SYNC_SOURCE).toContain("export const SALESMAN_ACTIVITY_ENTRY_SOURCE = \"salesman_activity\"");
    expect(SYNC_SOURCE).toContain("export async function syncSalesmanAttendanceForDate");
  });

  it("checks both order deliveries and recovery attempts but excludes invoices", () => {
    expect(SYNC_SOURCE).toContain("fulfilledBySalesmanId");
    expect(SYNC_SOURCE).toContain("creditRecoveryAttempts");
    expect(SYNC_SOURCE).not.toContain("invoices.salesmanId");
  });

  it("protects manual HR attendance rows from overwrite", () => {
    expect(SYNC_SOURCE).toContain("entrySource !== SALESMAN_ACTIVITY_ENTRY_SOURCE");
    expect(SYNC_SOURCE).toContain("return { status: \"skipped_manual\" }");
  });

  it("deletes auto-generated row when activities drop to zero", () => {
    expect(SYNC_SOURCE).toContain(".delete(attendance)");
    expect(SYNC_SOURCE).toContain("existingAttendance.entrySource === SALESMAN_ACTIVITY_ENTRY_SOURCE");
  });

  it("sets checkIn and checkOut to null with standard duty hours", () => {
    expect(SYNC_SOURCE).toContain("checkIn: null");
    expect(SYNC_SOURCE).toContain("checkOut: null");
    expect(SYNC_SOURCE).toContain("dutyHours");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server-functions/sales/salesman-attendance-sync.test.ts`  
Expected: FAIL with "no such file or directory".

- [ ] **Step 3: Implement `salesman-attendance-sync.ts`**

Create `src/server-functions/sales/salesman-attendance-sync.ts`:
```typescript
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import {
  creditRecoveryAttempts,
  orders,
  salesmen,
} from "@/db/schemas/sales-erp-schema";

export const SALESMAN_ACTIVITY_ENTRY_SOURCE = "salesman_activity" as const;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getSalesmanBusinessDateRange(businessDate: string): {
  start: Date;
  endExclusive: Date;
} {
  const start = new Date(`${businessDate}T00:00:00+05:00`);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}

export async function syncSalesmanAttendanceForDate(args: {
  tx: DbTransaction;
  salesmanId: string;
  businessDate: string;
  standardDutyHours?: number;
}): Promise<{ status: "synced" | "skipped_manual" | "deleted" | "no_op" }> {
  const salesman = await args.tx.query.salesmen.findFirst({
    where: eq(salesmen.id, args.salesmanId),
    columns: { id: true, employeeId: true },
  });

  if (!salesman || !salesman.employeeId) {
    return { status: "no_op" };
  }

  const employee = await args.tx.query.employees.findFirst({
    where: eq(employees.id, salesman.employeeId),
    columns: { id: true, standardDutyHours: true, status: true },
  });

  if (!employee || employee.status !== "active") {
    return { status: "no_op" };
  }

  const { start, endExclusive } = getSalesmanBusinessDateRange(args.businessDate);

  const [existingAttendance, deliveryCountResult, recoveryCountResult] =
    await Promise.all([
      args.tx.query.attendance.findFirst({
        where: and(
          eq(attendance.employeeId, employee.id),
          eq(attendance.date, args.businessDate),
        ),
      }),
      args.tx
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(
          and(
            eq(orders.fulfilledBySalesmanId, args.salesmanId),
            eq(orders.status, "delivered"),
            gte(orders.fulfilledAt, start),
            lt(orders.fulfilledAt, endExclusive),
          ),
        ),
      args.tx
        .select({ count: sql<number>`count(*)` })
        .from(creditRecoveryAttempts)
        .where(
          and(
            eq(creditRecoveryAttempts.assignedToId, args.salesmanId),
            gte(creditRecoveryAttempts.attemptedAt, start),
            lt(creditRecoveryAttempts.attemptedAt, endExclusive),
          ),
        ),
    ]);

  // HR Precedence: Do not touch records created or edited manually by HR
  if (
    existingAttendance &&
    existingAttendance.entrySource !== SALESMAN_ACTIVITY_ENTRY_SOURCE
  ) {
    return { status: "skipped_manual" };
  }

  const totalActivities =
    Number(deliveryCountResult[0]?.count || 0) +
    Number(recoveryCountResult[0]?.count || 0);

  if (totalActivities === 0) {
    if (
      existingAttendance &&
      existingAttendance.entrySource === SALESMAN_ACTIVITY_ENTRY_SOURCE
    ) {
      await args.tx
        .delete(attendance)
        .where(eq(attendance.id, existingAttendance.id));
      return { status: "deleted" };
    }
    return { status: "no_op" };
  }

  const dutyHours = Math.max(
    args.standardDutyHours ||
      (employee.standardDutyHours
        ? parseFloat(employee.standardDutyHours)
        : 8),
    0,
  ).toFixed(2);

  const now = new Date();

  await args.tx
    .insert(attendance)
    .values({
      employeeId: employee.id,
      date: args.businessDate,
      status: "present",
      checkIn: null,
      checkOut: null,
      dutyHours,
      overtimeHours: "0.00",
      isLate: false,
      isNightShift: false,
      overtimeStatus: "pending",
      overtimeRemarks: null,
      earlyDepartureStatus: "none",
      checkOutReason: null,
      shiftViolations: [],
      isApprovedLeave: false,
      leaveApprovalStatus: "none",
      leaveType: null,
      entrySource: SALESMAN_ACTIVITY_ENTRY_SOURCE,
      notes: "Auto-synced from field activities (deliveries/recoveries)",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [attendance.employeeId, attendance.date],
      set: {
        status: "present",
        checkIn: null,
        checkOut: null,
        dutyHours,
        entrySource: SALESMAN_ACTIVITY_ENTRY_SOURCE,
        updatedAt: now,
      },
    });

  return { status: "synced" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server-functions/sales/salesman-attendance-sync.test.ts`  
Expected: PASS.

---

### Task 2: Integrate Activity Triggers in Sales Workflows

**Files:**
- Modify: `src/server-functions/sales/orders-fn.ts:270-330`
- Modify: `src/server-functions/sales/credit-recovery-fn.ts:430-465`
- Test: `src/server-functions/sales/salesman-attendance-triggers.test.ts`

**Interfaces:**
- Consumes: `syncSalesmanAttendanceForDate` from `./salesman-attendance-sync`.
- Produces: Attendance automatically synced on order fulfillment and recovery logging.

- [ ] **Step 1: Write integration tests for triggers**

Create `src/server-functions/sales/salesman-attendance-triggers.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORDERS_SOURCE = readFileSync(
  resolve("src/server-functions/sales/orders-fn.ts"),
  "utf8",
);
const RECOVERY_SOURCE = readFileSync(
  resolve("src/server-functions/sales/credit-recovery-fn.ts"),
  "utf8",
);

describe("salesman attendance triggers in sales workflows", () => {
  it("triggers attendance sync in fulfillOrderFn", () => {
    expect(ORDERS_SOURCE).toContain("syncSalesmanAttendanceForDate");
    expect(ORDERS_SOURCE).toContain("salesmanId: data.fulfilledBySalesmanId");
  });

  it("triggers attendance sync in logRecoveryAttemptFn", () => {
    expect(RECOVERY_SOURCE).toContain("syncSalesmanAttendanceForDate");
    expect(RECOVERY_SOURCE).toContain("salesmanId: data.assignedToId");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server-functions/sales/salesman-attendance-triggers.test.ts`  
Expected: FAIL with missing sync calls.

- [ ] **Step 3: Modify `orders-fn.ts` to trigger attendance sync on fulfillment**

In `src/server-functions/sales/orders-fn.ts`:
Add import:
```typescript
import { syncSalesmanAttendanceForDate } from "./salesman-attendance-sync";
import { toPKTDate } from "@/lib/attendance/time";
```
Inside `fulfillOrderFn` transaction, right after `calculateCommissionForOrder`:
```typescript
await syncSalesmanAttendanceForDate({
  tx,
  salesmanId: data.fulfilledBySalesmanId,
  businessDate: toPKTDate(new Date()),
});
```

- [ ] **Step 4: Modify `credit-recovery-fn.ts` to trigger attendance sync on recovery attempt**

In `src/server-functions/sales/credit-recovery-fn.ts`:
Add import:
```typescript
import { syncSalesmanAttendanceForDate } from "./salesman-attendance-sync";
import { toPKTDate } from "@/lib/attendance/time";
```
Inside `logRecoveryAttemptFn` transaction, right after creating the attempt:
```typescript
if (data.assignedToId) {
  await syncSalesmanAttendanceForDate({
    tx,
    salesmanId: data.assignedToId,
    businessDate: toPKTDate(attempt.attemptedAt),
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test src/server-functions/sales/salesman-attendance-triggers.test.ts`  
Expected: PASS.

---

### Task 3: Include Salesmen in Daily Attendance Dataset & Activity Counting

**Files:**
- Modify: `src/server-functions/hr/attendance/get-daily-attendance-fn.ts`
- Modify: `src/lib/order-booker-trip-attendance-phase4.test.ts:21`
- Test: `src/server-functions/hr/attendance/get-daily-attendance-salesmen.test.ts`

**Interfaces:**
- Consumes: `employees`, `attendance`, `orders`, `creditRecoveryAttempts`, `salesmen`.
- Produces: `getDailyAttendanceFn` returning all active employees (standard, order bookers, salesmen) with `salesmanActivity?: { deliveriesCount: number; recoveryCount: number }`.

- [ ] **Step 1: Write the test for daily attendance dataset**

Create `src/server-functions/hr/attendance/get-daily-attendance-salesmen.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DAILY_FN_SOURCE = readFileSync(
  resolve("src/server-functions/hr/attendance/get-daily-attendance-fn.ts"),
  "utf8",
);

describe("getDailyAttendanceFn includes salesmen", () => {
  it("does not exclude salesmen from the employee query", () => {
    expect(DAILY_FN_SOURCE).not.toContain("eq(employees.isSalesman, false)");
  });

  it("filters punches only for standard punch-driven employees", () => {
    expect(DAILY_FN_SOURCE).toContain("!employee.isOrderBooker && !employee.isSalesman");
  });

  it("attaches salesman activity summaries for the date", () => {
    expect(DAILY_FN_SOURCE).toContain("salesmanActivity");
  });
});
```

- [ ] **Step 2: Update `order-booker-trip-attendance-phase4.test.ts`**

In `src/lib/order-booker-trip-attendance-phase4.test.ts:21`:
Update:
```typescript
// Replace line 21:
// expect(dailyAttendanceSource).toContain("eq(employees.isSalesman, false)");
// With:
expect(dailyAttendanceSource).not.toContain("eq(employees.isSalesman, false)");
```

- [ ] **Step 3: Modify `get-daily-attendance-fn.ts`**

Update `src/server-functions/hr/attendance/get-daily-attendance-fn.ts`:
Remove `eq(employees.isSalesman, false)` from the `where` clause.
Update `punchDrivenEmployeeIds` to exclude salesmen:
```typescript
const punchDrivenEmployeeIds = allEmployees
  .filter((employee) => !employee.isOrderBooker && !employee.isSalesman)
  .map((employee) => employee.id);
```
Query salesman activities for salesmen in `allEmployees` for the date range:
```typescript
const salesmanEmployees = allEmployees.filter((e) => e.isSalesman);
const salesmanEmployeeIds = salesmanEmployees.map((e) => e.id);

const linkedSalesmen = salesmanEmployeeIds.length > 0
  ? await db.query.salesmen.findMany({
      where: inArray(salesmen.employeeId, salesmanEmployeeIds),
      columns: { id: true, employeeId: true },
    })
  : [];

const salesmanIdMap = new Map(linkedSalesmen.map((s) => [s.employeeId, s.id]));
const salesmanIds = linkedSalesmen.map((s) => s.id);

const { start, endExclusive } = getSalesmanBusinessDateRange(date);

const [deliveries, recoveries] = salesmanIds.length > 0
  ? await Promise.all([
      db
        .select({
          salesmanId: orders.fulfilledBySalesmanId,
          count: sql<number>`count(*)`,
        })
        .from(orders)
        .where(
          and(
            inArray(orders.fulfilledBySalesmanId, salesmanIds),
            eq(orders.status, "delivered"),
            gte(orders.fulfilledAt, start),
            lt(orders.fulfilledAt, endExclusive),
          ),
        )
        .groupBy(orders.fulfilledBySalesmanId),
      db
        .select({
          salesmanId: creditRecoveryAttempts.assignedToId,
          count: sql<number>`count(*)`,
        })
        .from(creditRecoveryAttempts)
        .where(
          and(
            inArray(creditRecoveryAttempts.assignedToId, salesmanIds),
            gte(creditRecoveryAttempts.attemptedAt, start),
            lt(creditRecoveryAttempts.attemptedAt, endExclusive),
          ),
        )
        .groupBy(creditRecoveryAttempts.assignedToId),
    ])
  : [[], []];

const deliveryCountMap = new Map(deliveries.map((d) => [d.salesmanId, Number(d.count)]));
const recoveryCountMap = new Map(recoveries.map((r) => [r.salesmanId, Number(r.count)]));
```
Attach `salesmanActivity: { deliveriesCount, recoveryCount }` to each salesman employee in the return array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/server-functions/hr/attendance/get-daily-attendance-salesmen.test.ts src/lib/order-booker-trip-attendance-phase4.test.ts`  
Expected: PASS.

---

### Task 4: Add Dedicated Salesmen Tab & Badges in HR Attendance List

**Files:**
- Modify: `src/components/hr/attendance/attendance-list-table.tsx`
- Modify: `src/components/hr/employees/add-employee-form.tsx:594`
- Modify: `src/components/hr/employees/edit-employee-form.tsx:640`
- Test: `src/components/hr/attendance/salesman-attendance-table.test.ts`

**Interfaces:**
- Consumes: `EmployeeWithAttendance` from `attendance-list-table.tsx` including `isSalesman: boolean`.
- Produces: 3-tab layout: Standard Staff, Order Bookers, Salesmen (`value="salesmen"`).

- [ ] **Step 1: Write component tests for Salesmen tab**

Create `src/components/hr/attendance/salesman-attendance-table.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TABLE_SOURCE = readFileSync(
  resolve("src/components/hr/attendance/attendance-list-table.tsx"),
  "utf8",
);
const ADD_FORM_SOURCE = readFileSync(
  resolve("src/components/hr/employees/add-employee-form.tsx"),
  "utf8",
);
const EDIT_FORM_SOURCE = readFileSync(
  resolve("src/components/hr/employees/edit-employee-form.tsx"),
  "utf8",
);

describe("Salesman tab in attendance table", () => {
  it("filters standardData to exclude both order bookers and salesmen", () => {
    expect(TABLE_SOURCE).toContain("!e.isOrderBooker && !e.isSalesman");
  });

  it("filters salesmanData for isSalesman", () => {
    expect(TABLE_SOURCE).toContain("const salesmanData = data.filter((e) => e.isSalesman)");
  });

  it("renders the Salesmen tab trigger", () => {
    expect(TABLE_SOURCE).toContain('value="salesmen"');
    expect(TABLE_SOURCE).toContain("Salesmen");
  });

  it("updates employee form descriptions", () => {
    expect(ADD_FORM_SOURCE).not.toContain("Excluded from attendance.");
    expect(ADD_FORM_SOURCE).toContain("Attendance is tracked from deliveries and recoveries.");
    expect(EDIT_FORM_SOURCE).not.toContain("Excluded from attendance.");
    expect(EDIT_FORM_SOURCE).toContain("Attendance is tracked from deliveries and recoveries.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/hr/attendance/salesman-attendance-table.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Modify `attendance-list-table.tsx`**

In `src/components/hr/attendance/attendance-list-table.tsx`:
1. Add `isSalesman: boolean` and `salesmanActivity?: { deliveriesCount: number; recoveryCount: number }` to `EmployeeWithAttendance`.
2. Update data partitioning:
```typescript
const standardData = data.filter((e) => !e.isOrderBooker && !e.isSalesman);
const orderBookerData = data.filter((e) => e.isOrderBooker);
const salesmanData = data.filter((e) => e.isSalesman);
```
3. Create `salesmanColumns`:
   - Employee info (Name, Code, Avatar)
   - Status (Rest Day badge, manual status badge, Present (Field Activity), or PendingReviewBadge if no record on working day)
   - Activity Summary: `deliveriesCount > 0 || recoveryCount > 0 ? "${deliveriesCount} Deliveries, ${recoveryCount} Recoveries" : "No Activity"`
   - Actions (Mark Attendance button / dropdown)
4. Add `<TabsTrigger value="salesmen">` and `<TabsContent value="salesmen">` with `<DataTable columns={salesmanColumns} data={salesmanData} />`.

- [ ] **Step 4: Update employee forms description text**

In `src/components/hr/employees/add-employee-form.tsx:594` and `src/components/hr/employees/edit-employee-form.tsx`:
Replace:
```typescript
Creates a linked salesman record. Excluded from attendance.
```
With:
```typescript
Creates a linked salesman record. Attendance is tracked from deliveries and recoveries.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test src/components/hr/attendance/salesman-attendance-table.test.ts`  
Expected: PASS.

---

### Task 5: Enforce Payroll Attendance Verification for Salesmen

**Files:**
- Modify: `src/server-functions/hr/payroll/core.ts:71-78`
- Modify: `src/lib/order-booker-trip-attendance-phase4.test.ts:38-43`
- Modify: `src/lib/order-booker-trip-attendance-regressions.test.ts:58-62`
- Test: `src/server-functions/hr/payroll/salesman-payroll-blocking.test.ts`

**Interfaces:**
- Consumes: `shouldBlockMissingAttendance(employee: Pick<typeof employees.$inferSelect, "isSalesman" | "isOrderBooker">): boolean`
- Produces: Returns `true` for both order bookers and salesmen.

- [ ] **Step 1: Write test for salesman payroll blocking**

Create `src/server-functions/hr/payroll/salesman-payroll-blocking.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAYROLL_CORE_SOURCE = readFileSync(
  resolve("src/server-functions/hr/payroll/core.ts"),
  "utf8",
);

describe("payroll blocks missing attendance for salesmen", () => {
  it("does not bypass salesmen in shouldBlockMissingAttendance", () => {
    expect(PAYROLL_CORE_SOURCE).not.toContain("return !employee.isSalesman;");
    expect(PAYROLL_CORE_SOURCE).toContain("function shouldBlockMissingAttendance(");
    expect(PAYROLL_CORE_SOURCE).toContain("return true;");
  });
});
```

- [ ] **Step 2: Update previous phase 4 & regression tests**

In `src/lib/order-booker-trip-attendance-phase4.test.ts:38-43`:
Update:
```typescript
it("blocks missing attendance for order bookers and salesmen", () => {
  expect(payrollCoreSource).toContain("function shouldBlockMissingAttendance");
  expect(payrollCoreSource).not.toContain("return !employee.isSalesman;");
});
```
In `src/lib/order-booker-trip-attendance-regressions.test.ts:58-62`:
Update:
```typescript
it("does not skip unresolved attendance in payroll", () => {
  expect(payrollCore).toContain("function shouldBlockMissingAttendance(");
  expect(payrollCore).not.toContain("return !employee.isSalesman;");
});
```

- [ ] **Step 3: Modify `shouldBlockMissingAttendance` in `src/server-functions/hr/payroll/core.ts`**

Update `src/server-functions/hr/payroll/core.ts:71-78`:
```typescript
function shouldBlockMissingAttendance(
  _employee: Pick<typeof employees.$inferSelect, "isSalesman" | "isOrderBooker">,
): boolean {
  // All employees (including Order Bookers and Salesmen) require all working days
  // to be resolved (present, rest day, holiday, leave, or marked absent) before payroll finalizes.
  return true;
}
```

- [ ] **Step 4: Run all test suites and typecheck**

Run: `bun run test src/server-functions/hr/payroll/salesman-payroll-blocking.test.ts src/lib/order-booker-trip-attendance-phase4.test.ts src/lib/order-booker-trip-attendance-regressions.test.ts`  
Expected: PASS.

Run: `bun run typecheck`  
Expected: PASS with 0 type errors.

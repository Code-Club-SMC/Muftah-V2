import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { employees, salaryRevisions } from "@/db/schemas/hr-schema";
import { salesmen, orderBookers } from "@/db/schemas/sales-erp-schema";
import { createEmployeeSchema } from "@/lib/validators/hr-validators";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { logActivityQuiet } from "@/lib/activity-logger.server";

function isEmployeeCodeUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("employees_employee_code_unique")
  );
}

export const createEmployeeFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(createEmployeeSchema)
  .handler(async ({ data, context }) => {
    try {
      return await db.transaction(async (tx) => {
        const existingEmployee = await tx.query.employees.findFirst({
          where: eq(employees.employeeCode, data.employeeCode),
          columns: { id: true },
        });

        if (existingEmployee) {
          throw new Error("Employee code already exists.");
        }

        const [newEmployee] = await tx
          .insert(employees)
          .values({
            firstName: data.firstName,
            lastName: data.lastName,
            employeeCode: data.employeeCode,
            designation: data.designation,
            department: data.department,
            joiningDate: data.joiningDate,
            status: data.status as
              | "active"
              | "on_leave"
              | "terminated"
              | "resigned",
            employmentType: data.employmentType as
              | "full_time"
              | "part_time"
              | "contract"
              | "intern",
            phone: data.phone,
            cnic: data.cnic,
            address: data.address,
            bankName: data.bankName,
            restDays: data.restDays ?? [0],
            bankAccountNumber: data.bankAccountNumber,
            standardDutyHours: data.standardDutyHours,
            shifts: (data.shifts ?? []).filter(
              (s: { start: string; end: string }) => s.start && s.end,
            ),
            basicSalary: data.basicSalary || "0",
            isOrderBooker: data.isOrderBooker ?? false,
            isSalesman: data.isSalesman ?? false,
            allowanceConfig: data.allowanceConfig,
            annualLeaveAllowance: data.annualLeaveAllowance ?? 14,
            annualLeaveBalance: data.annualLeaveAllowance ?? 14,
            basicSalaryDeductionPolicyOverrideEnabled:
              data.basicSalaryDeductionPolicyOverrideEnabled ?? false,
            basicSalaryDeductionPolicyOverride:
              data.basicSalaryDeductionPolicyOverrideEnabled
                ? data.basicSalaryDeductionPolicyOverride
                : null,
          })
          .returning();

        // Record initial salary revision (effective on joining date)
        await tx.insert(salaryRevisions).values({
          employeeId: newEmployee.id,
          revisionDate: data.joiningDate,
          basicSalary: data.basicSalary || "0",
          allowanceConfig: data.allowanceConfig || [],
          reason: "Initial salary on joining",
          changedById: context.session.user.id,
        });

        // Create linked salesman record
        if (data.isSalesman) {
          await tx.insert(salesmen).values({
            name: `${data.firstName} ${data.lastName}`.trim(),
            phone: data.phone || undefined,
            employeeId: newEmployee.id,
          });
        }

        // Create linked order booker record
        if (data.isOrderBooker) {
          await tx.insert(orderBookers).values({
            name: `${data.firstName} ${data.lastName}`.trim(),
            phone: data.phone || undefined,
            address: data.address || undefined,
            employeeId: newEmployee.id,
          });
        }

        logActivityQuiet({
          module: "hr",
          action: "created",
          entityType: "employee",
          actorId: context.session.user.id,
          actorName: context.session.user.name,
          description: `Created employee ${newEmployee.firstName} ${newEmployee.lastName} (${newEmployee.employeeCode})`,
        });

        return newEmployee;
      });
    } catch (error) {
      if (isEmployeeCodeUniqueViolation(error)) {
        throw new Error("Employee code already exists.");
      }
      throw error;
    }
  });

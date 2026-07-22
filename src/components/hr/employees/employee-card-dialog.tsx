import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Printer, IdCard } from "lucide-react";
import type { getEmployeesFn } from "@/server-functions/hr/employees/get-employees-fn";
import {
  EmployeeCard,
  openEmployeeCardPrintWindow,
} from "./employee-card";

type Employee = Awaited<ReturnType<typeof getEmployeesFn>>[0];

export const EmployeeCardDialog = ({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
}) => {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Employee Card"
      description="Preview and print the official Muftah Chemical employee ID card."
      icon={IdCard}
      className="sm:max-w-4xl rounded-2xl shadow-2xl"
    >
      <div className="flex flex-col items-center gap-6 py-6 bg-muted/30 rounded-xl mt-4">
        <div className="flex flex-col lg:flex-row gap-8 items-center justify-center overflow-x-auto w-full pb-2">
          <EmployeeCard employee={employee} side="front" />
          <EmployeeCard employee={employee} side="back" />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t mt-4">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button onClick={() => openEmployeeCardPrintWindow(employee)} className="gap-2">
          <Printer className="size-4" />
          Print Card
        </Button>
      </div>
    </ResponsiveDialog>
  );
};

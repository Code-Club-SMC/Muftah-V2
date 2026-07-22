import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Calculator } from "lucide-react";
import { SalaryCalculatorForm } from "./salary-calculator-form";

interface SalaryCalculatorSheetProps {
  employeeId: string | null;
  month: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SalaryCalculatorSheet({
  employeeId,
  month,
  isOpen,
  onClose,
}: SalaryCalculatorSheetProps) {
  return (
    <ResponsiveSheet
      title="Salary Calculation"
      description={`Review and adjust salary details for ${month} before generating the final slip.`}
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      className="sm:max-w-2xl"
      icon={Calculator}
    >
      {employeeId && (
        <SalaryCalculatorForm
          key={employeeId}
          employeeId={employeeId}
          month={month}
          onSuccess={onClose}
          isOpen={isOpen}
        />
      )}
    </ResponsiveSheet>
  );
}

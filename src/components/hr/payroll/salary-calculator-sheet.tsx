import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Calculator } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SalaryCalculatorForm } from "./salary-calculator-form";

interface SalaryCalculatorSheetProps {
  employeeId: string | null;
  month: string;
  isOpen: boolean;
  onClose: () => void;
  /** Shown when the slip being revised is already (partly) paid. */
  paidNote?: string;
}

export function SalaryCalculatorSheet({
  employeeId,
  month,
  isOpen,
  onClose,
  paidNote,
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
      {paidNote && (
        <Alert className="mb-4 rounded-none border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40">
          <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">{paidNote}</AlertDescription>
        </Alert>
      )}
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

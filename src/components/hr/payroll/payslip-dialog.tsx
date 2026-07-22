import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { PayslipView, type PayslipData } from "./payslip-view";
import { format, parseISO } from "date-fns";
import { FileText } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payslip: PayslipData | null;
};

export const PayslipDialog = ({ open, onOpenChange, payslip }: Props) => {
  // If no payslip is selected but dialog is open (rare race condition), handle gracefully
  if (!open) return null;

  const monthStr = payslip?.payroll?.month
    ? format(parseISO(payslip.payroll.month), "MMMM yyyy")
    : "";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Payslip - ${monthStr}`}
      description="Confidential salary slip details."
      className="min-w-fit max-h-[90vh] overflow-y-auto"
      icon={FileText}
    >
      {payslip ? (
        <PayslipView payslip={payslip} showActions={true} />
      ) : (
        <div className="p-8 text-center text-muted-foreground">
          No payslip data available.
        </div>
      )}
    </ResponsiveDialog>
  );
};

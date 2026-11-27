import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { PayslipView, type PayslipData } from "./payslip-view";
import { format, parseISO } from "date-fns";
import { FileText } from "lucide-react";
import { useSalaryPaymentHistory } from "@/hooks/hr/use-salary-payments";
import { SalaryPaymentsPanel } from "./salary-payments-panel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payslip: PayslipData | null;
};

export const PayslipDialog = ({ open, onOpenChange, payslip }: Props) => {
  const { data: history } = useSalaryPaymentHistory(open ? payslip?.id : null);
  const paidFrom = history
    ? history.paidFrom ?? (history.state.status === "nothing_to_pay" ? "Nothing to pay" : "Not paid yet")
    : undefined;

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
        <>
          <PayslipView payslip={payslip} showActions={true} paidFrom={paidFrom} />
          {history && <SalaryPaymentsPanel history={history} />}
        </>
      ) : (
        <div className="p-8 text-center text-muted-foreground">
          No payslip data available.
        </div>
      )}
    </ResponsiveDialog>
  );
};

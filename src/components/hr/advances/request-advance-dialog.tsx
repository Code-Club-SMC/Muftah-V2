import { useState, useEffect } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateSalaryAdvance,
  useUpdateSalaryAdvance,
} from "@/hooks/hr/use-salary-advances";
import { useQuery } from "@tanstack/react-query";
import { getEmployeesFn } from "@/server-functions/hr/employees/get-employees-fn";
import { Loader2, HandCoins, CalendarRange } from "lucide-react";
import { toast } from "sonner";

export const RequestAdvanceDialog = ({
  open,
  onOpenChange,
  defaultEmployeeId,
  advanceToEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmployeeId?: string;
  advanceToEdit?: {
    id: string;
    employeeId: string;
    amount: string;
    installmentMonths: number;
    reason: string;
  } | null;
}) => {
  const isEditing = !!advanceToEdit;
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId || "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [installmentMonths, setInstallmentMonths] = useState("1");

  const createMutation = useCreateSalaryAdvance();
  const updateMutation = useUpdateSalaryAdvance();

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Get active employees — only load when dialog is open
  const { data: employees = [], isLoading: isEmployeesLoading } = useQuery({
    queryKey: ["employees", "active"],
    queryFn: () => getEmployeesFn({ data: { status: "active" } }),
    enabled: open && !isEditing, // Only need employees if not editing or already selected
  });

  // Reset when dialog opens or when advanceToEdit changes
  useEffect(() => {
    if (open) {
      if (advanceToEdit) {
        setEmployeeId(advanceToEdit.employeeId);
        setAmount(parseFloat(advanceToEdit.amount).toString());
        setReason(advanceToEdit.reason);
        setInstallmentMonths(advanceToEdit.installmentMonths.toString());
      } else {
        setEmployeeId(defaultEmployeeId || "");
        setAmount("");
        setReason("");
        setInstallmentMonths("1");
      }
    }
  }, [open, advanceToEdit, defaultEmployeeId]);

  const parsedAmount = parseFloat(amount) || 0;
  const parsedInstallments = Math.max(1, parseInt(installmentMonths, 10)) || 1;
  const perInstallment = (parsedAmount / parsedInstallments).toFixed(2);

  const handleSubmit = async () => {
    if (!employeeId || !amount || !reason) {
      toast.error("Please fill all required fields.");
      return;
    }

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Invalid amount.");
      return;
    }

    if (isEditing) {
      await updateMutation.mutateAsync(
        {
          data: {
            id: advanceToEdit.id,
            amount: parsedAmount,
            reason,
            installmentMonths: parsedInstallments,
          },
        },
        {
          onSuccess: () => onOpenChange(false),
        },
      );
    } else {
      await createMutation.mutateAsync(
        {
          data: {
            employeeId,
            amount: parsedAmount,
            reason,
            date: new Date().toISOString().split("T")[0],
            installmentMonths: parsedInstallments,
          },
        },
        {
          onSuccess: () => onOpenChange(false),
        },
      );
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEditing ? "Edit Salary Advance Request" : "Request Salary Advance"
      }
      description={
        isEditing
          ? "Modify the details of this pending advance request."
          : "Create a new salary advance request for an employee."
      }
      icon={HandCoins}
    >
      <div className="space-y-6 py-4">
        {!isEditing && (
          <div className="flex flex-col space-y-2">
            <label className="text-sm font-semibold ">
              Employee <span className="text-destructive">*</span>
            </label>
            <Select
              value={employeeId}
              onValueChange={setEmployeeId}
              disabled={isEmployeesLoading}
            >
              <SelectTrigger className="h-11">
                <SelectValue
                  placeholder={
                    isEmployeesLoading
                      ? "Loading employees..."
                      : "Select an employee..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp: any) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.employeeCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col space-y-2">
          <label className="text-sm font-semibold ">
            Amount (PKR) <span className="text-destructive">*</span>
          </label>
          <Input
            type="number"
            placeholder="e.g. 30000"
            value={amount}
            className="h-11"
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="flex flex-col space-y-2">
          <label className="text-sm font-semibold">
            Repayment Window (Months){" "}
            <span className="text-destructive">*</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <CalendarRange className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="number"
                min="1"
                max="36"
                value={installmentMonths}
                onChange={(e) => setInstallmentMonths(e.target.value)}
                className="pl-9 h-11"
                placeholder="Enter number of months..."
              />
            </div>
            <div className="bg-muted/50 px-4 py-2 rounded-lg border text-xs font-medium text-muted-foreground min-w-[100px] text-center">
              {parsedInstallments}{" "}
              {parsedInstallments === 1 ? "Month" : "Months"}
            </div>
          </div>
          {parsedAmount > 0 && (
            <p className="text-xs text-muted-foreground mt-1 px-1">
              {parsedInstallments === 1 ? (
                <span className="text-amber-600 font-medium">
                  Full amount will be deducted from the next single payslip.
                </span>
              ) : (
                <>
                  ≈{" "}
                  <span className="font-bold text-foreground">
                    PKR {parseFloat(perInstallment).toLocaleString()}
                  </span>{" "}
                  deducted per payslip over {parsedInstallments} months
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-col space-y-2">
          <label className="text-sm font-semibold ">
            Reason / Description <span className="text-destructive">*</span>
          </label>
          <Textarea
            placeholder="Why is this advance being requested?"
            value={reason}
            className=" resize-none min-h-[100px]"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t mt-6">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            className="min-w-[140px]"
          >
            {isPending ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : isEditing ? (
              "Save Changes"
            ) : (
              "Submit Request"
            )}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
};

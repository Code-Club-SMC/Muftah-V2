import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ShieldCheck, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
  type BasicSalaryDeductionPolicy,
} from "@/lib/types/hr-types";
import {
  getHrPayrollSettingsFn,
  updateHrPayrollSettingsFn,
} from "@/server-functions/hr/payroll/settings-fn";

const POLICY_OPTIONS: Array<{
  key: keyof BasicSalaryDeductionPolicy;
  label: string;
  description: string;
}> = [
  {
    key: "absent",
    label: "Absent",
    description: "Deduct basic salary for unauthorized absence.",
  },
  {
    key: "annualLeave",
    label: "Annual Leave",
    description: "Deduct basic salary for unpaid or excess annual leave.",
  },
  {
    key: "sickLeave",
    label: "Sick Leave",
    description: "Deduct basic salary during sick leave.",
  },
  {
    key: "specialLeave",
    label: "Special Leave",
    description: "Deduct basic salary during special leave. Default keeps basic paid.",
  },
  {
    key: "lateArrival",
    label: "Late Arrival",
    description: "Deduct basic salary hourly for approved late/short time.",
  },
  {
    key: "earlyLeaving",
    label: "Early Leaving",
    description: "Deduct basic salary hourly for approved early departure.",
  },
  {
    key: "notEmployed",
    label: "Not Employed / Proration",
    description: "Prorate basic salary before joining date or after employment cutoff.",
  },
];

export const Route = createFileRoute("/_protected/hr/settings/")({
  loader: async ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery({
      queryKey: ["hr-payroll-settings"],
      queryFn: () => getHrPayrollSettingsFn(),
    });
  },
  component: HrSettingsPage,
});

function HrSettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery({
    queryKey: ["hr-payroll-settings"],
    queryFn: () => getHrPayrollSettingsFn(),
  });

  const policy = {
    ...DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
    ...(data.basicSalaryDeductionPolicy ?? {}),
  };

  const updateMutation = useMutation({
    mutationFn: (basicSalaryDeductionPolicy: BasicSalaryDeductionPolicy) =>
      updateHrPayrollSettingsFn({ data: { basicSalaryDeductionPolicy } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-payroll-settings"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-dashboard"] });
      toast.success("Payroll settings updated");
    },
    onError: (error) => {
      toast.error("Failed to update payroll settings", {
        description: error.message,
      });
    },
  });

  const setPolicyValue = (
    key: keyof BasicSalaryDeductionPolicy,
    value: boolean,
  ) => {
    updateMutation.mutate({
      ...policy,
      [key]: value,
    });
  };

  const resetDefaults = () => {
    updateMutation.mutate(DEFAULT_BASIC_SALARY_DEDUCTION_POLICY);
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8 animate-in fade-in duration-500">
        <header className="border-b pb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <Settings2 className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-3xl uppercase tracking-tighter">
                HR Settings
              </h1>
              <p className="text-sm text-muted-foreground">
                Configure company-wide payroll policies and salary deduction behavior.
              </p>
            </div>
          </div>
        </header>

        <div className="max-w-4xl py-6">
          <Card className="border-border/60">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="size-5 text-primary" />
                    Basic Salary Deduction Policy
                  </CardTitle>
                  <CardDescription>
                    This company policy is used unless an employee has an explicit override.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={resetDefaults}
                >
                  Reset Defaults
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {POLICY_OPTIONS.map((option) => (
                <div
                  key={option.key}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-muted/20 p-4"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{option.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                  <Switch
                    checked={policy[option.key]}
                    disabled={updateMutation.isPending}
                    onCheckedChange={(checked) => setPolicyValue(option.key, checked)}
                    aria-label={`Toggle ${option.label} basic salary deduction`}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

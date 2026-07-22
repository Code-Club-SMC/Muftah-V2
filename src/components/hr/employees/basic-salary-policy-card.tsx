import type { AnyFieldApi } from "@tanstack/react-form";
import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
  type BasicSalaryDeductionPolicy,
} from "@/lib/types/hr-types";

const BASIC_POLICY_OPTIONS: Array<{
  key: keyof BasicSalaryDeductionPolicy;
  label: string;
}> = [
  { key: "absent", label: "Absent" },
  { key: "annualLeave", label: "Annual" },
  { key: "sickLeave", label: "Sick" },
  { key: "specialLeave", label: "Special" },
  { key: "lateArrival", label: "Late" },
  { key: "earlyLeaving", label: "Early" },
  { key: "notEmployed", label: "Proration" },
];

export function BasicSalaryPolicyCard({ form }: { form: any }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/15 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h4 className="text-sm font-semibold">Basic Salary Deduction Policy</h4>
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            By default this employee follows company HR settings. Override only for contractual exceptions.
          </p>
        </div>
        <form.Field name="basicSalaryDeductionPolicyOverrideEnabled">
          {(field: AnyFieldApi) => (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">
                Override
              </span>
              <Switch
                checked={!!field.state.value}
                onCheckedChange={(checked) => {
                  field.handleChange(checked);
                  if (checked) {
                    form.setFieldValue(
                      "basicSalaryDeductionPolicyOverride",
                      DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
                    );
                  }
                }}
              />
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="basicSalaryDeductionPolicyOverrideEnabled">
        {(enabledField: AnyFieldApi) =>
          enabledField.state.value ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
              {BASIC_POLICY_OPTIONS.map((option) => (
                <form.Field
                  key={option.key}
                  name={`basicSalaryDeductionPolicyOverride.${option.key}`}
                >
                  {(field: AnyFieldApi) => (
                    <button
                      type="button"
                      onClick={() => field.handleChange(!field.state.value)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        field.state.value
                          ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
                          : "border-border/60 bg-background text-muted-foreground"
                      }`}
                    >
                      <span className="block text-[10px] font-black uppercase">
                        {option.label}
                      </span>
                      <span className="text-[10px]">
                        {field.state.value ? "Deduct basic" : "Keep basic"}
                      </span>
                    </button>
                  )}
                </form.Field>
              ))}
            </div>
          ) : (
            <p className="text-[11px] font-medium text-muted-foreground">
              Following company policy from HR Settings.
            </p>
          )
        }
      </form.Field>
    </div>
  );
}

/**
 * AllowanceCard.tsx
 * Place at: @/components/hr/allowance-card.tsx
 *
 * Shared component used by both AddEmployeeForm and EditEmployeeForm.
 * Renders a single allowance card with name, amount, and deduction toggles.
 */

import type { AnyFieldApi } from "@tanstack/react-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/custom/tooltip-wrapper";
import { Trash2, UserX, CalendarX, StarOff, Clock, Timer, Thermometer } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// DEDUCTION OCCASIONS
// Single source of truth — exported so both forms can import it for the legend.
// ─────────────────────────────────────────────────────────────────────────────

export const DEDUCTION_OCCASIONS = [
  {
    id: "absent" as const,
    label: "Absent",
    fullLabel: "Unauthorized Absence",
    tooltip: "Deduct per day when employee is absent without approval",
    icon: UserX,
    color: "text-rose-600 dark:text-rose-400",
    activeBg: "bg-rose-50 border-rose-300 dark:bg-rose-500/10 dark:border-rose-500/30",
    dotColor: "bg-rose-500",
    legendColor: "bg-rose-500",
  },
  {
    id: "annualLeave" as const,
    label: "Annual",
    fullLabel: "Annual Leave",
    tooltip: "Deduct per day when employee is on annual leave",
    icon: CalendarX,
    color: "text-amber-600 dark:text-amber-400",
    activeBg: "bg-amber-50 border-amber-300 dark:bg-amber-500/10 dark:border-amber-500/30",
    dotColor: "bg-amber-500",
    legendColor: "bg-amber-500",
  },
  {
    id: "sickLeave" as const,
    label: "Sick",
    fullLabel: "Sick Leave",
    tooltip: "Deduct per day when employee is on sick leave (Bradford counted)",
    icon: Thermometer,
    color: "text-teal-600 dark:text-teal-400",
    activeBg: "bg-teal-50 border-teal-300 dark:bg-teal-500/10 dark:border-teal-500/30",
    dotColor: "bg-teal-500",
    legendColor: "bg-teal-500",
  },
  {
    id: "specialLeave" as const,
    label: "Spl. Leave",
    fullLabel: "Special Leave",
    tooltip: "Deduct per day on special leave. Only Basic Salary is paid — everything else is cut.",
    icon: StarOff,
    color: "text-orange-600 dark:text-orange-400",
    activeBg: "bg-orange-50 border-orange-300 dark:bg-orange-500/10 dark:border-orange-500/30",
    dotColor: "bg-orange-500",
    legendColor: "bg-orange-500",
  },
  {
    id: "lateArrival" as const,
    label: "Late",
    fullLabel: "Late Arrival",
    tooltip: "Deduct proportionally per late minute, calculated on hourly basis",
    icon: Clock,
    color: "text-blue-600 dark:text-blue-400",
    activeBg: "bg-blue-50 border-blue-300 dark:bg-blue-500/10 dark:border-blue-500/30",
    dotColor: "bg-blue-500",
    legendColor: "bg-blue-500",
  },
  {
    id: "earlyLeaving" as const,
    label: "Early",
    fullLabel: "Early Leaving",
    tooltip: "Deduct proportionally per early-left minute, calculated on hourly basis",
    icon: Timer,
    color: "text-indigo-600 dark:text-indigo-400",
    activeBg: "bg-indigo-50 border-indigo-300 dark:bg-indigo-500/10 dark:border-indigo-500/30",
    dotColor: "bg-indigo-500",
    legendColor: "bg-indigo-500",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// Using FormApi<any, any> which is the correct public type for passing
// a form instance as a prop in TanStack Form.
// ─────────────────────────────────────────────────────────────────────────────

interface AllowanceCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  index: number;
  allowanceId: string;
  onRemove: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const AllowanceCard = ({
  form,
  index,
  allowanceId,
  onRemove,
}: AllowanceCardProps) => {
  const isCustom = allowanceId.startsWith("custom_");

  return (
    <div className="relative flex flex-col gap-2.5 p-3.5 border rounded-xl bg-card hover:border-primary/40 transition-all  group">

      {/* ── Name + Remove ── */}
      <div className="flex items-center justify-between gap-1">
        <form.Field name={`allowanceConfig[${index}].name`}>
          {(field: AnyFieldApi) => (
            <Input
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Allowance Name"
              readOnly={!isCustom}
              title={
                !isCustom
                  ? "Standard allowance names cannot be changed"
                  : undefined
              }
              className={`h-7 text-xs font-bold border-transparent px-1 focus-visible:ring-1 bg-transparent w-full shadow-none ${isCustom
                ? "hover:border-border cursor-text"
                : "cursor-default select-none text-foreground/80"
                }`}
            />
          )}
        </form.Field>

        <TooltipWrapper tooltipContent="Remove this allowance">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={onRemove}
            aria-label="Remove allowance"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </TooltipWrapper>
      </div>

      {/* ── Amount ── */}
      <form.Field name={`allowanceConfig[${index}].amount`}>
        {(field: AnyFieldApi) => (
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
              <span className="text-[10px] text-muted-foreground font-bold">PKR</span>
            </div>
            <Input
              type="number"
              placeholder="0"
              value={(field.state.value as number) === 0 ? "" : (field.state.value as number)}
              onBlur={field.handleBlur}
              onChange={(e) =>
                field.handleChange(e.target.value === "" ? 0 : Number(e.target.value))
              }
              className="h-9 pl-10 text-sm font-mono font-medium focus-visible:ring-1 bg-muted/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        )}
      </form.Field>

      {/* ── Deduction Occasion Toggles ── */}
      <div className="space-y-1.5 pt-0.5">
        <span className="text-[9px] font-black text-muted-foreground/50 uppercase  px-0.5">
          Deduct on
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {DEDUCTION_OCCASIONS.map((occasion) => (
            <form.Field
              key={occasion.id}
              name={`allowanceConfig[${index}].deductions.${occasion.id}`}
            >
              {(field: AnyFieldApi) => {
                const isActive = !!field.state.value;
                const Icon = occasion.icon;
                return (
                  <TooltipWrapper
                    tooltipContent={`${occasion.fullLabel} — ${occasion.tooltip}`}
                  >
                    <button
                      type="button"
                      onClick={() => field.handleChange(!field.state.value)}
                      aria-label={`${isActive ? "Disable" : "Enable"} deduction on ${occasion.fullLabel}`}
                      aria-pressed={isActive}
                      className={`relative flex items-center justify-center size-7 rounded-lg border transition-all duration-150 ${isActive
                        ? `${occasion.activeBg} ${occasion.color} border-2 `
                        : "bg-transparent text-muted-foreground/35 border-dashed border-muted-foreground/25 hover:border-muted-foreground/40 hover:text-muted-foreground/60"
                        }`}
                    >
                      <Icon className="size-3.5" />
                      {isActive && (
                        <span
                          className={`absolute -top-1 -right-1 size-2 ${occasion.dotColor} rounded-full border border-background`}
                        />
                      )}
                    </button>
                  </TooltipWrapper>
                );
              }}
            </form.Field>
          ))}
        </div>
      </div>

      {/* ── Active rules count ── */}
      <form.Field name={`allowanceConfig[${index}].deductions`}>
        {(field: AnyFieldApi) => {
          const vals = (field.state.value ?? {}) as Record<string, boolean>;
          const activeCount = Object.values(vals).filter(Boolean).length;
          return (
            <p className="text-[9px] px-0.5 font-medium text-muted-foreground/50">
              {activeCount > 0
                ? `${activeCount} deduction rule${activeCount > 1 ? "s" : ""} active`
                : "No deduction rules active"}
            </p>
          );
        }}
      </form.Field>

    </div>
  );
};
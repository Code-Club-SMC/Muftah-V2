import { format, parseISO } from "date-fns";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExpenseTemplates, useSkipExpenseTemplateMonth } from "@/hooks/finance/use-expense-templates";
import {
  getTemplateReminder,
  templateChipLabel,
  toDayKey,
  type TemplateReminder,
} from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";

export function ExpenseReminders({
  onRecord,
}: {
  onRecord: (template: ExpenseTemplate, reminder: TemplateReminder) => void;
}) {
  const { data: templates = [] } = useExpenseTemplates();
  const skip = useSkipExpenseTemplateMonth();
  const todayKey = toDayKey(new Date());

  const due = templates
    .flatMap((template) => {
      const reminder = getTemplateReminder({
        reminderDay: template.reminderDay,
        todayKey,
        expenseDates: template.expenseDates.map(toDayKey),
        skippedMonth: template.skippedMonth,
      });
      return reminder ? [{ template, reminder }] : [];
    })
    .sort((a, b) =>
      a.reminder.status !== b.reminder.status
        ? a.reminder.status === "overdue"
          ? -1
          : 1
        : a.reminder.dueDate.localeCompare(b.reminder.dueDate),
    );

  if (due.length === 0) return null;

  return (
    <section className="border border-amber-500/30 bg-amber-500/5 p-4" aria-labelledby="due-this-week">
      <h2 id="due-this-week" className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <BellRing className="size-4 text-amber-600" />
        Due this week
      </h2>
      <ul className="divide-y divide-amber-500/20">
        {due.map(({ template, reminder }) => {
          const day = format(parseISO(reminder.dueDate), "d MMM");
          return (
            <li key={template.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium wrap-break-word">{templateChipLabel(template)}</p>
                <p className={cn("text-sm", reminder.status === "overdue" ? "text-rose-500" : "text-muted-foreground")}>
                  {reminder.status === "overdue" ? `Overdue since ${day}` : `Due ${day}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="rounded-none shadow-none" onClick={() => onRecord(template, reminder)}>
                  Record
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-none shadow-none"
                  disabled={skip.isPending}
                  onClick={() => skip.mutate({ data: { templateId: template.id, monthKey: reminder.monthKey } })}
                >
                  Skip this month
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

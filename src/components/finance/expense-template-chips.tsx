import { RepeatIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { templateChipLabel } from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";

export function ExpenseTemplateChips({
  templates,
  selectedId,
  onPick,
}: {
  templates: ExpenseTemplate[];
  selectedId: string | null;
  onPick: (template: ExpenseTemplate) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <div className="space-y-2" role="group" aria-label="Templates">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <RepeatIcon className="size-3.5" />
        Repeat a saved expense
      </p>
      <div className="flex flex-wrap gap-2">
        {templates.map((template) => (
          <Button
            key={template.id}
            type="button"
            size="sm"
            variant={template.id === selectedId ? "default" : "outline"}
            className={cn("h-8 rounded-none", template.id !== selectedId && "shadow-none")}
            onClick={() => onPick(template)}
          >
            {templateChipLabel(template)}
          </Button>
        ))}
      </div>
    </div>
  );
}

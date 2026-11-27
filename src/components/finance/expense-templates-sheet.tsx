import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useArchiveExpenseTemplate, useExpenseTemplates } from "@/hooks/finance/use-expense-templates";
import { templateChipLabel } from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { ExpenseTemplateDialog } from "./expense-template-dialog";

export function ExpenseTemplatesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: templates = [] } = useExpenseTemplates(open);
  const archive = useArchiveExpenseTemplate();
  const [editing, setEditing] = useState<ExpenseTemplate | null>(null);
  const [deleting, setDeleting] = useState<ExpenseTemplate | null>(null);

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Templates"
        description="Saved repeats. Save a new one from any expense with Save as template."
      >
        {templates.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No templates yet. Open an expense and pick Save as template.
          </p>
        ) : (
          <ul className="divide-y border">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium wrap-break-word">{templateChipLabel(template)}</p>
                  <p className="text-sm text-muted-foreground">
                    {template.categoryName}
                    {template.payee ? ` · ${template.payee}` : ""} ·{" "}
                    <span>{template.reminderDay ? `Reminds on day ${template.reminderDay}` : "No reminder"}</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-none"
                  aria-label={`Edit ${template.name}`}
                  onClick={() => setEditing(template)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-none text-rose-500 hover:text-rose-600"
                  aria-label={`Delete ${template.name}`}
                  onClick={() => setDeleting(template)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ResponsiveSheet>

      <ExpenseTemplateDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        source={editing ? { kind: "template", template: editing } : null}
      />
      <AlertDialog open={deleting !== null} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Expenses already recorded from it stay as they are. Its reminder stops.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none"
              onClick={() =>
                deleting && archive.mutate({ data: { templateId: deleting.id } }, { onSuccess: () => setDeleting(null) })
              }
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

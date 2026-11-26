import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveExpenseTemplate } from "@/hooks/finance/use-expense-templates";
import { formatAmountInput, getExpenseTitle, parseAmountInput } from "@/lib/finance/expense-entry";
import type { ExpenseListItem, ExpenseTemplate } from "@/lib/types/finance-types";
import { ExpenseAmountField } from "./expense-amount-field";

export type TemplateSource =
  | { kind: "expense"; expense: ExpenseListItem }
  | { kind: "template"; template: ExpenseTemplate }
  | null;

const NO_REMINDER = "none";
const DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));

function startingValues(source: Exclude<TemplateSource, null>) {
  if (source.kind === "template") {
    const t = source.template;
    return {
      name: t.name,
      amount: t.amount ? formatAmountInput(String(Number(t.amount))) : "",
      reminder: t.reminderDay ? String(t.reminderDay) : NO_REMINDER,
    };
  }
  const e = source.expense;
  return {
    // "Category · Paid to" even when the expense has a note: the note stays on the template as its note.
    name: getExpenseTitle({ description: "", payee: e.payee, category: e.category }),
    amount: formatAmountInput(String(Number(e.amount))),
    reminder: NO_REMINDER,
  };
}

export function ExpenseTemplateDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: TemplateSource;
}) {
  const save = useSaveExpenseTemplate();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [reminder, setReminder] = useState(NO_REMINDER);

  useEffect(() => {
    if (!open || !source) return;
    const start = startingValues(source);
    setName(start.name);
    setAmount(start.amount);
    setReminder(start.reminder);
  }, [open, source]);

  if (!source) return null;

  const submit = () => {
    const base =
      source.kind === "template"
        ? {
            templateId: source.template.id,
            categoryId: source.template.categoryId,
            payee: source.template.payee,
            walletId: source.template.walletId,
            note: source.template.note,
          }
        : {
            categoryId: source.expense.category?.id ?? "",
            payee: source.expense.payee,
            walletId: source.expense.wallet?.id ?? null,
            note: source.expense.description.trim() || null,
          };
    const typed = parseAmountInput(amount);
    save.mutate(
      {
        data: {
          ...base,
          name: name.trim(),
          amount: typed > 0 ? typed : null,
          reminderDay: reminder === NO_REMINDER ? null : Number(reminder),
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none">
        <DialogHeader>
          <DialogTitle>{source.kind === "template" ? "Edit template" : "Save as template"}</DialogTitle>
          <DialogDescription>
            It shows as a one-tap button on Record expense. Nothing is ever recorded on its own.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className="rounded-none shadow-none"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-amount">
              Amount <span className="font-normal text-muted-foreground">(leave empty if it changes every time)</span>
            </Label>
            <ExpenseAmountField id="template-amount" value={amount} onChange={setAmount} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-reminder">Monthly reminder</Label>
            <Select value={reminder} onValueChange={setReminder}>
              <SelectTrigger id="template-reminder" className="w-full rounded-none shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                <SelectItem value={NO_REMINDER}>No reminder</SelectItem>
                {DAYS.map((day) => (
                  <SelectItem key={day} value={day}>{`Day ${day} of every month`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-none shadow-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-none shadow-none" disabled={!name.trim() || save.isPending} onClick={submit}>
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

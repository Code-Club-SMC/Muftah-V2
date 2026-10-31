import { format } from "date-fns";
import type { ExpenseListItem } from "@/lib/types/finance-types";

const when = (value: Date | string) => format(new Date(value), "d MMM yyyy, h:mm a");

export function ExpenseHistory({ expense }: { expense: ExpenseListItem }) {
  if (!expense.voidedAt && expense.edits.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes since it was recorded.</p>;
  }

  return (
    <ol className="space-y-3">
      {expense.voidedAt ? (
        <li className="border-l-2 border-rose-500 pl-3">
          <p className="text-sm font-semibold">
            Voided by {expense.voidedBy?.name ?? "Unknown"} · {when(expense.voidedAt)}
          </p>
          {expense.voidReason ? (
            <p className="text-sm text-muted-foreground wrap-break-word">Reason: {expense.voidReason}</p>
          ) : null}
        </li>
      ) : null}
      {expense.edits.map((edit) => (
        <li key={edit.id} className="border-l-2 border-border pl-3">
          <p className="text-sm font-semibold">
            Edited by {edit.editor?.name ?? "Unknown"} · {when(edit.editedAt)}
          </p>
          <ul className="mt-1 space-y-0.5">
            {edit.changes.map((change) => (
              <li key={change.field} className="text-sm wrap-break-word">
                <span className="text-muted-foreground">{change.field}:</span>{" "}
                {`${change.from || "—"} → ${change.to || "—"}`}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

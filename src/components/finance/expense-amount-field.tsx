import { useCallback, useLayoutEffect, useRef, type Ref } from "react";
import { Input } from "@/components/ui/input";
import { amountInWords } from "@/lib/amount-in-words";
import {
  formatAmountInput,
  MAX_EXPENSE_AMOUNT,
  parseAmountInput,
} from "@/lib/finance/expense-entry";

const WORDS_FROM = 1000;

const countAmountChars = (text: string) => text.replace(/[^\d.]/g, "").length;

/** Where the caret belongs in `formatted` so it stays after the same digit it was after while typing. */
function caretAfterFormatting(formatted: string, charsBeforeCaret: number): number {
  if (charsBeforeCaret <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/[\d.]/.test(formatted[index])) seen += 1;
    if (seen === charsBeforeCaret) return index + 1;
  }
  return formatted.length;
}

export function ExpenseAmountField({
  id,
  value,
  onChange,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const amount = parseAmountInput(value);
  const localRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof inputRef === "function") inputRef(node);
      else if (inputRef) inputRef.current = node;
    },
    [inputRef],
  );

  // Commas are added while typing; put the caret back next to the digit the user just typed.
  useLayoutEffect(() => {
    const input = localRef.current;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (!input || caret === null || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
  });

  return (
    <div className="space-y-1">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground">
          Rs
        </span>
        <Input
          ref={setRefs}
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0"
          value={value}
          onChange={(event) => {
            const raw = event.target.value;
            const next = formatAmountInput(raw);
            // Too large for the books: keep what was there instead of saving a number that fails later.
            if (parseAmountInput(next) > MAX_EXPENSE_AMOUNT) return;
            const caret = event.target.selectionStart ?? raw.length;
            pendingCaret.current = caretAfterFormatting(next, countAmountChars(raw.slice(0, caret)));
            onChange(next);
          }}
          className="h-14 rounded-none pl-11 text-2xl font-semibold tabular-nums shadow-none"
        />
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {amount >= WORDS_FROM ? amountInWords(amount) : ""}
      </p>
    </div>
  );
}

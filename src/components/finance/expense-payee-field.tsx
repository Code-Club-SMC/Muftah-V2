import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { filterPayeeSuggestions } from "@/lib/finance/expense-entry";
import { cn } from "@/lib/utils";

export function ExpensePayeeField({
  id,
  value,
  onChange,
  payees,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  payees: string[];
}) {
  const listId = useId();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = showSuggestions ? filterPayeeSuggestions(payees, value) : [];
  const isOpen = suggestions.length > 0;
  const highlighted = activeIndex >= 0 && activeIndex < suggestions.length ? activeIndex : -1;

  const close = () => {
    setShowSuggestions(false);
    setActiveIndex(-1);
  };

  const pick = (payee: string) => {
    onChange(payee);
    close();
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setShowSuggestions(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (!showSuggestions) setShowSuggestions(true);
            const count = filterPayeeSuggestions(payees, value).length;
            if (count === 0) return;
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((current) => (current + step + count) % count);
            return;
          }
          if (!isOpen) return;
          if (event.key === "Enter" && highlighted >= 0) {
            // Enter picks the highlighted name; it must not also save the form.
            event.preventDefault();
            event.stopPropagation();
            pick(suggestions[highlighted]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        placeholder="e.g. LESCO, Shell Pump Ravi Road"
        autoComplete="off"
        maxLength={200}
        className="h-11 rounded-none shadow-none"
      />
      {isOpen ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Names used before"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto border border-border bg-popover shadow-md"
        >
          {suggestions.map((payee, index) => (
            <li
              key={payee}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm hover:bg-muted",
                index === highlighted && "bg-muted",
              )}
              // mouseDown (not click) so it runs before the input's blur hides the list.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(payee);
              }}
            >
              {payee}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

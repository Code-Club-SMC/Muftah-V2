import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { CheckIcon, ChevronDown } from "lucide-react";
import { DatePicker } from "@/components/custom/date-picker";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCurrentMonthRange } from "@/lib/finance-expenses";
import type { ExpenseCategoryDefinition, FinanceWalletSummary } from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";

/** `walletId` is "" for all accounts. */
export type ExpenseFilterState = { categoryIds: string[]; walletId: string; payee: string; range: DateRange };

export const defaultExpenseFilters = (): ExpenseFilterState => ({
  categoryIds: [],
  walletId: "",
  payee: "",
  range: getCurrentMonthRange(),
});

const ALL_ACCOUNTS = "all";

export function ExpenseFilters({
  value,
  onChange,
  categories,
  wallets,
}: {
  value: ExpenseFilterState;
  onChange: (next: ExpenseFilterState) => void;
  categories: ExpenseCategoryDefinition[];
  wallets: FinanceWalletSummary[];
}) {
  // Paid to waits for a 300 ms pause in typing before it filters.
  const [payee, setPayee] = useState(value.payee);
  useEffect(() => setPayee(value.payee), [value.payee]);
  useEffect(() => {
    if (payee === value.payee) return;
    const timer = setTimeout(() => onChange({ ...value, payee }), 300);
    return () => clearTimeout(timer);
  }, [payee, value, onChange]);

  const toggleCategory = (id: string) =>
    onChange({
      ...value,
      categoryIds: value.categoryIds.includes(id)
        ? value.categoryIds.filter((current) => current !== id)
        : [...value.categoryIds, id],
    });

  const categoryText =
    value.categoryIds.length === 0
      ? "All categories"
      : value.categoryIds.length === 1
        ? (categories.find((c) => c.id === value.categoryIds[0])?.name ?? "1 category")
        : `${value.categoryIds.length} categories`;
  const isFiltered = value.categoryIds.length > 0 || value.walletId !== "" || value.payee !== "";

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9 justify-between gap-2 rounded-none shadow-none lg:w-52"
            aria-label="Category"
          >
            <span className="truncate">{categoryText}</span>
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 rounded-none p-0" align="start">
          <Command>
            <CommandInput placeholder="Search categories" />
            <CommandList>
              <CommandEmpty>No category found.</CommandEmpty>
              <CommandGroup>
                {categories.map((category) => {
                  const picked = value.categoryIds.includes(category.id);
                  return (
                    <CommandItem
                      key={category.id}
                      value={category.name}
                      onSelect={() => toggleCategory(category.id)}
                      className="rounded-none"
                    >
                      <CheckIcon className={cn("mr-2 size-4", picked ? "opacity-100" : "opacity-0")} />
                      {category.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Select
        value={value.walletId || ALL_ACCOUNTS}
        onValueChange={(id) => onChange({ ...value, walletId: id === ALL_ACCOUNTS ? "" : id })}
      >
        <SelectTrigger className="h-9 w-full rounded-none shadow-none lg:w-48" aria-label="Account">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-none">
          <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
          {wallets.map((wallet) => (
            <SelectItem key={wallet.id} value={wallet.id}>
              {wallet.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        aria-label="Paid to"
        placeholder="Paid to"
        value={payee}
        onChange={(event) => setPayee(event.target.value)}
        maxLength={200}
        className="h-9 rounded-none shadow-none lg:w-48"
      />

      <DatePicker
        mode="range"
        range={value.range}
        onRangeChange={(range) => onChange({ ...value, range: range ?? getCurrentMonthRange() })}
        placeholder="Current month"
        className="h-9 min-w-65 rounded-none shadow-none"
      />

      {/* Keeps the date range: this link only shows for category, account or payee filters. */}
      {isFiltered ? (
        <Button
          variant="link"
          className="h-9 px-1"
          onClick={() => onChange({ ...defaultExpenseFilters(), range: value.range })}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

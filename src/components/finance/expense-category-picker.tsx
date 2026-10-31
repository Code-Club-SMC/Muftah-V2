import { useState } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pickQuickCategories } from "@/lib/finance/expense-entry";
import type { ExpenseCategoryDefinition } from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";

export function ExpenseCategoryPicker({
  categories,
  usageRank,
  value,
  onChange,
}: {
  categories: ExpenseCategoryDefinition[];
  usageRank: string[];
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const quick = pickQuickCategories(categories, usageRank);
  const selected = categories.find((category) => category.id === value);
  const selectedIsTile = quick.some((category) => category.id === value);
  const pickedFromSearch = selected !== undefined && !selectedIsTile;
  const hasMore = categories.length > quick.length;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {quick.map((category) => (
          <Button
            key={category.id}
            type="button"
            variant={category.id === value ? "default" : "outline"}
            aria-pressed={category.id === value}
            className="h-14 justify-start whitespace-normal rounded-none text-left shadow-none"
            onClick={() => onChange(category.id)}
          >
            {category.name}
          </Button>
        ))}
      </div>

      {hasMore || pickedFromSearch ? (
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={pickedFromSearch ? "default" : "ghost"}
              className="h-9 rounded-none px-2 text-sm"
            >
              <SearchIcon className="mr-2 size-4" />
              {pickedFromSearch ? `Other: ${selected.name}` : "Search all categories"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 rounded-none p-0" align="start">
            <Command>
              <CommandInput placeholder="Type a category..." />
              <CommandList>
                <CommandEmpty>No category found.</CommandEmpty>
                <CommandGroup>
                  {categories.map((category) => (
                    <CommandItem
                      key={category.id}
                      // Ids keep two categories with the same name apart; the name is what gets searched.
                      value={category.id}
                      keywords={[category.name]}
                      onSelect={() => {
                        onChange(category.id);
                        setSearchOpen(false);
                      }}
                    >
                      <CheckIcon
                        className={cn("mr-2 size-4", category.id === value ? "opacity-100" : "opacity-0")}
                      />
                      {category.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

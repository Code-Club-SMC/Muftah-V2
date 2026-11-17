import React, { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type ChemicalOption = {
  id: string;
  name: string;
  unit: string;
};

type Props = {
  value: string;
  onChange: (chemicalId: string) => void;
  chemicals: ChemicalOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function ChemicalSearchSelect({
  value,
  onChange,
  chemicals,
  placeholder = "Search and select chemical...",
  disabled = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  const selectedChemical = chemicals.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm font-normal ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            !selectedChemical && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selectedChemical
              ? `${selectedChemical.name} (${selectedChemical.unit})`
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search chemical by name..." autoFocus />
          <CommandList className="max-h-60 overflow-y-auto">
            <CommandEmpty>No chemical found.</CommandEmpty>
            <CommandGroup>
              {chemicals.map((c) => {
                const isSelected = c.id === value;
                return (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    keywords={[c.name, c.unit]}
                    onSelect={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between"
                  >
                    <span className="font-medium truncate">
                      {c.name}{" "}
                      <span className="text-xs text-muted-foreground font-normal">
                        ({c.unit})
                      </span>
                    </span>
                    <Check
                      className={cn(
                        "ml-2 h-4 w-4 shrink-0",
                        isSelected ? "opacity-100 text-primary" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

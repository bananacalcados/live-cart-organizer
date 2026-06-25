import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  tone?: "include" | "exclude";
  renderLabel?: (value: string) => string;
}

export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  placeholder = "Selecionar...",
  tone = "include",
  renderLabel,
}: Props) {
  const display = (v: string) => (renderLabel ? renderLabel(v) : v);
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };

  const badgeClass =
    tone === "exclude"
      ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
      : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200";

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-neutral-600">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="w-full justify-between h-9 text-xs font-normal bg-white"
          >
            <span className="truncate text-neutral-500">
              {value.length > 0 ? `${value.length} selecionado(s)` : placeholder}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} className="text-xs" />
            <CommandList>
              <CommandEmpty>Nada encontrado.</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem key={opt} value={display(opt)} onSelect={() => toggle(opt)} className="text-xs">
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        value.includes(opt) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {display(opt)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {value.map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className={cn("text-[10px] gap-1 cursor-pointer", badgeClass)}
              onClick={() => toggle(v)}
            >
              {display(v)}
              <X className="h-2.5 w-2.5" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

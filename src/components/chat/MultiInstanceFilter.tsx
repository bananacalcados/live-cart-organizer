import { WhatsAppNumber } from "@/stores/whatsappNumberStore";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface MultiInstanceFilterProps {
  numbers: WhatsAppNumber[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  className?: string;
}

export function MultiInstanceFilter({
  numbers,
  selectedIds,
  onSelectedIdsChange,
  className,
}: MultiInstanceFilterProps) {
  if (numbers.length <= 1) return null;

  const allSelected = selectedIds.length === 0; // empty = show all

  const toggleId = (id: string) => {
    if (selectedIds.includes(id)) {
      const next = selectedIds.filter(i => i !== id);
      onSelectedIdsChange(next);
    } else {
      onSelectedIdsChange([...selectedIds, id]);
    }
  };

  const selectAll = () => onSelectedIdsChange([]);

  const label = allSelected
    ? "Todas instâncias"
    : selectedIds.length === 1
      ? numbers.find(n => n.id === selectedIds[0])?.label || "1 instância"
      : `${selectedIds.length} instâncias`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <Phone className="h-3.5 w-3.5 mr-2" />
          {label}
          {!allSelected && (
            <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
              {selectedIds.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-1">
          <button
            onClick={selectAll}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm transition-colors"
          >
            <Checkbox checked={allSelected} />
            <span className="font-medium">Todas as instâncias</span>
          </button>
          {numbers.map(num => {
            const checked = selectedIds.includes(num.id);
            return (
              <button
                key={num.id}
                onClick={() => toggleId(num.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm transition-colors"
              >
                <Checkbox checked={checked} />
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{num.label}</span>
                  <span className="text-xs text-muted-foreground">{num.phone_display}</span>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

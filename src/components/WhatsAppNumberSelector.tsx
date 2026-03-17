import { useCallback, useEffect, useMemo } from "react";
import { Phone } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";

interface WhatsAppNumberSelectorProps {
  className?: string;
  /** Filter numbers by provider (e.g. 'zapi' or 'meta'). Shows all if omitted. */
  filterProvider?: string;
  value?: string | null;
  onValueChange?: (id: string) => void;
}

export function WhatsAppNumberSelector({ className, filterProvider, value, onValueChange }: WhatsAppNumberSelectorProps) {
  const { numbers, selectedNumberId, isLoading, fetchNumbers, setSelectedNumberId } = useWhatsAppNumberStore();

  useEffect(() => {
    if (numbers.length === 0) {
      fetchNumbers();
    }
  }, [numbers.length, fetchNumbers]);

  const filtered = useMemo(() => {
    if (!filterProvider) return numbers;
    return numbers.filter(n => (n.provider || 'meta') === filterProvider);
  }, [numbers, filterProvider]);

  const currentValue = value ?? selectedNumberId;

  const handleValueChange = useCallback((id: string) => {
    if (onValueChange) {
      onValueChange(id);
      return;
    }
    setSelectedNumberId(id);
  }, [onValueChange, setSelectedNumberId]);

  useEffect(() => {
    if (filtered.length === 0) return;
    if (currentValue && filtered.some(n => n.id === currentValue)) return;
    handleValueChange(filtered[0].id);
  }, [filtered, currentValue, handleValueChange]);

  if (isLoading || filtered.length <= 1) return null;

  const effectiveId = currentValue && filtered.some(n => n.id === currentValue)
    ? currentValue
    : filtered[0]?.id || '';

  return (
    <Select value={effectiveId || ''} onValueChange={handleValueChange}>
      <SelectTrigger className={className}>
        <Phone className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
        <SelectValue placeholder="Selecionar número" />
      </SelectTrigger>
      <SelectContent>
        {filtered.map((num) => (
          <SelectItem key={num.id} value={num.id}>
            <div className="flex items-center gap-2">
              <span>{num.label}</span>
              <span className="text-xs text-muted-foreground">{num.phone_display}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

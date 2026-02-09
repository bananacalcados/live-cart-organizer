import { useEffect } from "react";
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
}

export function WhatsAppNumberSelector({ className }: WhatsAppNumberSelectorProps) {
  const { numbers, selectedNumberId, isLoading, fetchNumbers, setSelectedNumberId } = useWhatsAppNumberStore();

  useEffect(() => {
    if (numbers.length === 0) {
      fetchNumbers();
    }
  }, [numbers.length, fetchNumbers]);

  if (isLoading || numbers.length <= 1) return null;

  return (
    <Select value={selectedNumberId || ''} onValueChange={setSelectedNumberId}>
      <SelectTrigger className={className}>
        <Phone className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
        <SelectValue placeholder="Selecionar número" />
      </SelectTrigger>
      <SelectContent>
        {numbers.map((num) => (
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

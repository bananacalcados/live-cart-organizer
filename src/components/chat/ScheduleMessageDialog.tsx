import { useState } from "react";
import { Clock, CalendarIcon, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  message: string;
  whatsappNumberId?: string | null;
  onScheduled?: () => void;
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  phone,
  message,
  whatsappNumberId,
  onScheduled,
}: ScheduleMessageDialogProps) {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("09:00");
  const [isSaving, setIsSaving] = useState(false);

  const handleSchedule = async () => {
    if (!date || !time || !message.trim()) return;

    const [hours, minutes] = time.split(":").map(Number);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(hours, minutes, 0, 0);

    if (scheduledAt <= new Date()) {
      toast.error("A data/hora deve ser no futuro");
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.from("scheduled_messages").insert({
        phone,
        message: message.trim(),
        scheduled_at: scheduledAt.toISOString(),
        whatsapp_number_id: whatsappNumberId || null,
      } as any);

      if (error) throw error;

      toast.success(`Mensagem agendada para ${format(scheduledAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`);
      onOpenChange(false);
      setDate(undefined);
      setTime("09:00");
      onScheduled?.();
    } catch (err: any) {
      toast.error("Erro ao agendar: " + (err.message || "Erro desconhecido"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Agendar Mensagem
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted p-3 text-xs max-h-[100px] overflow-y-auto whitespace-pre-wrap">
            {message || <span className="text-muted-foreground italic">Nenhuma mensagem</span>}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Data de envio</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal h-9 text-sm",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Horário</Label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          <div className="text-xs text-muted-foreground">
            Para: <span className="font-medium text-foreground">{phone}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={isSaving || !date || !time || !message.trim()}
            className="gap-1"
          >
            <Send className="h-4 w-4" />
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

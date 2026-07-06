import { useState } from "react";
import { FileText, CalendarIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Conversation } from "./ChatTypes";
import { exportConversationPdf, ExportMessage } from "@/lib/chat/exportConversationPdf";

interface ExportConversationDialogProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PeriodMode = "all" | "day" | "range";

export function ExportConversationDialog({
  conversation,
  open,
  onOpenChange,
}: ExportConversationDialogProps) {
  const [mode, setMode] = useState<PeriodMode>("all");
  const [singleDay, setSingleDay] = useState<Date | undefined>();
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [includeImages, setIncludeImages] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");

  function periodLabel(): string {
    if (mode === "day" && singleDay) {
      return format(singleDay, "dd/MM/yyyy", { locale: ptBR });
    }
    if (mode === "range" && fromDate && toDate) {
      return `${format(fromDate, "dd/MM/yyyy")} até ${format(toDate, "dd/MM/yyyy")}`;
    }
    return "Conversa inteira";
  }

  async function handleExport() {
    // Validate period selection
    if (mode === "day" && !singleDay) {
      toast.error("Selecione o dia da conversa.");
      return;
    }
    if (mode === "range" && (!fromDate || !toDate)) {
      toast.error("Selecione a data inicial e final.");
      return;
    }

    setLoading(true);
    setProgress("Buscando mensagens...");
    try {
      let query = supabase
        .from("whatsapp_messages")
        .select(
          "id, message, direction, created_at, media_type, media_url, status, sender_name",
        )
        .eq("phone", conversation.phone)
        .order("created_at", { ascending: true })
        .limit(5000);

      if (conversation.whatsapp_number_id) {
        query = query.eq("whatsapp_number_id", conversation.whatsapp_number_id);
      }

      if (mode === "day" && singleDay) {
        const start = new Date(singleDay);
        start.setHours(0, 0, 0, 0);
        const end = new Date(singleDay);
        end.setHours(23, 59, 59, 999);
        query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
      } else if (mode === "range" && fromDate && toDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const messages = (data || []) as ExportMessage[];
      if (messages.length === 0) {
        toast.error("Nenhuma mensagem encontrada no período selecionado.");
        setLoading(false);
        setProgress("");
        return;
      }

      await exportConversationPdf(
        messages,
        {
          contactName: conversation.customerName || conversation.phone,
          phone: conversation.phone,
          instanceLabel: conversation.instanceLabel,
          periodLabel: periodLabel(),
        },
        { includeImages, onProgress: setProgress },
      );

      toast.success("PDF gerado com sucesso!");
      onOpenChange(false);
    } catch (err) {
      console.error("[ExportConversation]", err);
      toast.error("Erro ao gerar o PDF. Tente novamente.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Exportar conversa em PDF
          </DialogTitle>
          <DialogDescription>
            Gera um documento fiel ao WhatsApp para uso como comprovação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Período</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as PeriodMode)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="p-all" />
                <Label htmlFor="p-all" className="font-normal cursor-pointer">
                  Conversa inteira
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="day" id="p-day" />
                <Label htmlFor="p-day" className="font-normal cursor-pointer">
                  Um dia específico
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="range" id="p-range" />
                <Label htmlFor="p-range" className="font-normal cursor-pointer">
                  Intervalo de datas
                </Label>
              </div>
            </RadioGroup>
          </div>

          {mode === "day" && (
            <DatePickerField
              label="Dia"
              date={singleDay}
              onSelect={setSingleDay}
              placeholder="Selecione o dia"
            />
          )}

          {mode === "range" && (
            <div className="grid grid-cols-2 gap-2">
              <DatePickerField
                label="De"
                date={fromDate}
                onSelect={setFromDate}
                placeholder="Início"
              />
              <DatePickerField
                label="Até"
                date={toDate}
                onSelect={setToDate}
                placeholder="Fim"
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label className="cursor-pointer">Incluir imagens</Label>
              <p className="text-xs text-muted-foreground">
                Embute as fotos na conversa (arquivo maior).
              </p>
            </div>
            <Switch checked={includeImages} onCheckedChange={setIncludeImages} />
          </div>

          {loading && progress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleExport} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Gerar PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatePickerField({
  label,
  date,
  onSelect,
  placeholder,
}: {
  label: string;
  date: Date | undefined;
  onSelect: (d: Date | undefined) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "dd/MM/yyyy") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={onSelect}
            initialFocus
            locale={ptBR}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

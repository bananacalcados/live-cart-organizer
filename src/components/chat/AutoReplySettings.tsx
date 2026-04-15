import { useState, useEffect } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AutoReplyData {
  id?: string;
  type: "welcome" | "away";
  message: string;
  is_active: boolean;
  schedule_start: string | null;
  schedule_end: string | null;
  schedule_days: number[];
}

const DAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

const defaultWelcome: AutoReplyData = {
  type: "welcome",
  message: "",
  is_active: false,
  schedule_start: null,
  schedule_end: null,
  schedule_days: [0, 1, 2, 3, 4, 5, 6],
};

const defaultAway: AutoReplyData = {
  type: "away",
  message: "",
  is_active: false,
  schedule_start: "08:00",
  schedule_end: "18:00",
  schedule_days: [1, 2, 3, 4, 5],
};

interface AutoReplySettingsProps {
  whatsappNumberId: string | null;
}

export function AutoReplySettings({ whatsappNumberId }: AutoReplySettingsProps) {
  const [open, setOpen] = useState(false);
  const [welcome, setWelcome] = useState<AutoReplyData>({ ...defaultWelcome });
  const [away, setAway] = useState<AutoReplyData>({ ...defaultAway });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !whatsappNumberId) return;
    const load = async () => {
      const { data } = await supabase
        .from("whatsapp_auto_replies")
        .select("*")
        .eq("whatsapp_number_id", whatsappNumberId);
      if (data) {
        const w = data.find((r: any) => r.type === "welcome");
        const a = data.find((r: any) => r.type === "away");
        if (w) setWelcome({ id: w.id, type: "welcome", message: w.message, is_active: w.is_active, schedule_start: w.schedule_start, schedule_end: w.schedule_end, schedule_days: w.schedule_days || [0,1,2,3,4,5,6] });
        else setWelcome({ ...defaultWelcome });
        if (a) setAway({ id: a.id, type: "away", message: a.message, is_active: a.is_active, schedule_start: a.schedule_start, schedule_end: a.schedule_end, schedule_days: a.schedule_days || [1,2,3,4,5] });
        else setAway({ ...defaultAway });
      }
    };
    load();
  }, [open, whatsappNumberId]);

  const handleSave = async () => {
    if (!whatsappNumberId) { toast.error("Selecione um número WhatsApp"); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      for (const item of [welcome, away]) {
        const payload = {
          whatsapp_number_id: whatsappNumberId,
          type: item.type,
          message: item.message,
          is_active: item.is_active,
          schedule_start: item.schedule_start,
          schedule_end: item.schedule_end,
          schedule_days: item.schedule_days,
          created_by: user?.id || null,
          updated_at: new Date().toISOString(),
        };
        if (item.id) {
          await supabase.from("whatsapp_auto_replies").update(payload).eq("id", item.id);
        } else {
          await supabase.from("whatsapp_auto_replies").insert(payload as any);
        }
      }
      toast.success("Configurações de auto-resposta salvas!");
      setOpen(false);
    } catch (err) {
      toast.error("Erro ao salvar configurações");
    }
    setSaving(false);
  };

  const toggleDay = (days: number[], day: number) => {
    return days.includes(day) ? days.filter(d => d !== day) : [...days, day];
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-[#aebac1] hover:bg-[#2a3942]" title="Auto-resposta">
          <Settings className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md bg-[#111b21] border-[#2a3942] p-0 overflow-y-auto">
        <SheetHeader className="p-4 border-b border-[#2a3942]">
          <SheetTitle className="text-[#e9edef]">Configurações de Auto-resposta</SheetTitle>
        </SheetHeader>

        <div className="p-4 space-y-6">
          {/* Welcome */}
          <div className="bg-[#1a2228] border border-[#2a3942] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-[#e9edef] font-semibold">Mensagem de Boas-vindas</Label>
              <Switch
                checked={welcome.is_active}
                onCheckedChange={(v) => setWelcome(p => ({ ...p, is_active: v }))}
                className="data-[state=checked]:bg-[#00a884]"
              />
            </div>
            <p className="text-[11px] text-[#8696a0]">
              Enviada automaticamente quando um novo cliente entra em contato pela primeira vez (uma vez a cada 24h por contato)
            </p>
            <Textarea
              placeholder="Olá! 👋 Seja bem-vindo..."
              value={welcome.message}
              onChange={(e) => setWelcome(p => ({ ...p, message: e.target.value }))}
              rows={4}
              className="bg-[#202c33] border-[#3b4a54] text-[#e9edef] placeholder:text-[#8696a0]"
            />
            {welcome.message && (
              <div className="flex justify-end">
                <div className="bg-[#005c4b] text-[#e9edef] rounded-lg px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
                  {welcome.message}
                </div>
              </div>
            )}
          </div>

          {/* Away */}
          <div className="bg-[#1a2228] border border-[#2a3942] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-[#e9edef] font-semibold">Mensagem de Ausência</Label>
              <Switch
                checked={away.is_active}
                onCheckedChange={(v) => setAway(p => ({ ...p, is_active: v }))}
                className="data-[state=checked]:bg-[#00a884]"
              />
            </div>
            <p className="text-[11px] text-[#8696a0]">
              A mensagem de ausência será enviada FORA do horário de funcionamento definido abaixo
            </p>
            <Textarea
              placeholder="Estamos fora do horário de atendimento..."
              value={away.message}
              onChange={(e) => setAway(p => ({ ...p, message: e.target.value }))}
              rows={4}
              className="bg-[#202c33] border-[#3b4a54] text-[#e9edef] placeholder:text-[#8696a0]"
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-[11px] text-[#8696a0]">Início</Label>
                <Input
                  type="time"
                  value={away.schedule_start || "08:00"}
                  onChange={(e) => setAway(p => ({ ...p, schedule_start: e.target.value }))}
                  className="h-8 bg-[#202c33] border-[#3b4a54] text-[#e9edef]"
                />
              </div>
              <div className="flex-1">
                <Label className="text-[11px] text-[#8696a0]">Fim</Label>
                <Input
                  type="time"
                  value={away.schedule_end || "18:00"}
                  onChange={(e) => setAway(p => ({ ...p, schedule_end: e.target.value }))}
                  className="h-8 bg-[#202c33] border-[#3b4a54] text-[#e9edef]"
                />
              </div>
            </div>
            <div>
              <p className="text-[11px] text-[#8696a0] mb-2">
                Dias em que o atendimento está ATIVO. Nos dias desmarcados, a mensagem será enviada o dia todo
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map(day => (
                  <button
                    key={day.value}
                    onClick={() => setAway(p => ({ ...p, schedule_days: toggleDay(p.schedule_days, day.value) }))}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                      away.schedule_days.includes(day.value)
                        ? "bg-[#00a884] text-[#111b21]"
                        : "bg-[#202c33] text-[#8696a0]"
                    )}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            {away.message && (
              <div className="flex justify-end">
                <div className="bg-[#005c4b] text-[#e9edef] rounded-lg px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
                  {away.message}
                </div>
              </div>
            )}
          </div>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-[#00a884] hover:bg-[#00a884]/90 text-[#111b21] font-medium"
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

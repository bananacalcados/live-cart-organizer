import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Tira a conversa da linha SUPORTE e da lista "Em suporte"; volta sozinha se a cliente mandar mensagem nova. */
export function FinishSupportButton({ phone, whatsappNumberId, compact, onFinished }: {
  phone: string; whatsappNumberId: string | null; compact?: boolean; onFinished?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    const { error } = await supabase.rpc("support_finish_conversation" as any, { p_phone: phone, p_whatsapp_number_id: whatsappNumberId, p_reason: reason || null });
    setBusy(false);
    if (error) { toast.error("Não foi possível finalizar o suporte."); return; }
    toast.success("Suporte finalizado.");
    setOpen(false); setReason("");
    onFinished?.();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={compact ? "ghost" : "outline"} size="sm" className={compact ? "h-7 px-1.5 text-xs gap-1 text-emerald-700" : ""} title="Suporte finalizado">
          <CheckCircle2 className={compact ? "h-3.5 w-3.5" : "mr-1 h-4 w-4"} />
          <span className={compact ? "hidden xl:inline" : ""}>Suporte finalizado</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="end">
        <p className="text-sm font-medium">Finalizar suporte desta conversa?</p>
        <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" autoComplete="off" />
        <Button size="sm" className="w-full" disabled={busy} onClick={finish}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirmar</Button>
      </PopoverContent>
    </Popover>
  );
}

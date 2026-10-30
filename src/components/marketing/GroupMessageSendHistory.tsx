import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, Loader2 } from "lucide-react";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { toast } from "sonner";

type Row = { id: string; group_name: string | null; status: string; whatsapp_number_id: string | null; provider_message_id: string | null; sent_at: string | null };
export function GroupMessageSendHistory({ messageId }: { messageId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const numbers = useWhatsAppNumberStore(s => s.numbers);
  async function load(nextOffset: number) {
    setBusy(true);
    const { data, error } = await supabase.from("group_campaign_block_dispatches")
      .select("id,group_name,status,whatsapp_number_id,provider_message_id,sent_at")
      .eq("scheduled_message_id", messageId).order("created_at").order("id").range(nextOffset, nextOffset + 49);
    setBusy(false);
    if (error) { toast.error("Não foi possível abrir o histórico"); return; }
    const next = (data || []) as Row[];
    setRows(prev => nextOffset ? [...prev, ...next] : next);
    setOffset(nextOffset + next.length); setMore(next.length === 50); setOpen(true);
  }
  return <div className="my-1">
    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => open ? setOpen(false) : load(0)}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />} Histórico do envio
    </Button>
    {open && <ScrollArea className="max-h-48"><div className="space-y-2 text-xs text-muted-foreground">
      {rows.map(row => <div key={row.id} className="break-words">
        <p>{row.group_name || "Grupo"} · {numbers.find(n => n.id === row.whatsapp_number_id)?.label || "Instância registrada"} · {row.status === "sent" ? "Enviado" : row.status === "pending" ? "Pendente" : row.status === "sending" ? "Enviando" : row.status === "failed" ? "Falhou" : "Cancelado"}</p>
        {row.provider_message_id && <p>Mensagem: {row.provider_message_id}</p>}
      </div>)}
      {rows.length === 0 && <p>Nenhum envio registrado.</p>}
      {more && <Button variant="outline" size="sm" disabled={busy} onClick={() => load(offset)}>Carregar mais</Button>}
    </div></ScrollArea>}
  </div>;
}
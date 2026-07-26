import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Msg = {
  id: string;
  phone: string;
  message: string;
  direction: string;
  media_type: string | null;
  media_url: string | null;
  created_at: string;
  whatsapp_number_id: string | null;
  sender_name: string | null;
  is_mass_dispatch: boolean | null;
};

type Instance = { id: string; label: string; provider: string | null };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  name?: string;
}

const onlyDigits = (v: string) => (v || "").replace(/\D/g, "");

export function LeadChatHistoryDialog({ open, onOpenChange, phone, name }: Props) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState<string>("all");

  const suffix = useMemo(() => {
    const d = onlyDigits(phone);
    return d.slice(-8);
  }, [phone]);

  const load = async () => {
    if (!suffix || suffix.length < 8) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data: msgs, error }, { data: nums }] = await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select("id, phone, message, direction, media_type, media_url, created_at, whatsapp_number_id, sender_name, is_mass_dispatch")
          .like("phone", `%${suffix}`)
          .order("created_at", { ascending: true })
          .limit(1000),
        supabase
          .from("whatsapp_numbers_safe")
          .select("id, label, provider"),
      ]);
      if (error) throw error;
      setMessages((msgs || []) as Msg[]);
      setInstances((nums || []) as Instance[]);
    } catch (e: any) {
      toast.error("Erro ao carregar conversa: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSelected("all");
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phone]);

  const instanceLabel = (id: string | null) => {
    if (!id) return "Sem instância";
    const i = instances.find(n => n.id === id);
    return i ? i.label : "Instância removida";
  };

  // Instances that actually have history with this person.
  const usedInstances = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of messages) {
      const key = m.whatsapp_number_id || "none";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([id, count]) => ({ id, count, label: id === "none" ? "Sem instância" : instanceLabel(id) }))
      .sort((a, b) => b.count - a.count);
  }, [messages, instances]);

  const shown = useMemo(() => {
    if (selected === "all") return messages;
    if (selected === "none") return messages.filter(m => !m.whatsapp_number_id);
    return messages.filter(m => m.whatsapp_number_id === selected);
  }, [messages, selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            {name || "Lead"} <span className="text-xs font-normal text-muted-foreground">{phone}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Instance switcher */}
        <div className="px-4 py-2 border-b flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={selected === "all" ? "default" : "outline"}
            className="h-7 text-[11px]"
            onClick={() => setSelected("all")}
          >
            Todas ({messages.length})
          </Button>
          {usedInstances.map(i => (
            <Button
              key={i.id}
              size="sm"
              variant={selected === i.id ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setSelected(i.id)}
            >
              {i.label} ({i.count})
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="h-7 ml-auto" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-muted/20">
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && shown.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-10">
              Nenhuma mensagem encontrada para esse contato.
            </p>
          )}
          {!loading && shown.map(m => {
            const out = m.direction === "outgoing";
            return (
              <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-lg px-3 py-2 text-xs shadow-sm",
                    out ? "bg-primary/10 border border-primary/20" : "bg-background border"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {instanceLabel(m.whatsapp_number_id)}
                    </Badge>
                    {m.is_mass_dispatch && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0">disparo</Badge>
                    )}
                  </div>
                  {m.media_url && (m.media_type || "").startsWith("image") ? (
                    <img src={m.media_url} alt="Mídia da conversa" className="rounded max-h-48 mb-1" loading="lazy" />
                  ) : m.media_url ? (
                    <a href={m.media_url} target="_blank" rel="noreferrer" className="underline text-[11px] block mb-1">
                      Abrir mídia ({m.media_type || "arquivo"})
                    </a>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{m.message}</p>
                  <p className="text-[9px] text-muted-foreground mt-1 text-right">
                    {new Date(m.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

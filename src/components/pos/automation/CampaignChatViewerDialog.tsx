import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, MessageCircle, Phone } from "lucide-react";

interface ChatMsg {
  id: string;
  message: string | null;
  direction: string;
  created_at: string;
  media_type: string | null;
  media_url: string | null;
  sender_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string | null;
  name?: string | null;
  whatsappNumberId?: string | null;
}

const fmt = (v: string) =>
  new Date(v).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

/** Last 8 significant digits — robust across DDI/9th-digit variations. */
const last8 = (raw: string | null) => (raw || "").replace(/\D/g, "").slice(-8);

export function CampaignChatViewerDialog({ open, onOpenChange, phone, name, whatsappNumberId }: Props) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const suffix = last8(phone);
    if (suffix.length < 8) { setMsgs([]); return; }
    setLoading(true);
    let q = supabase
      .from("whatsapp_messages")
      .select("id, message, direction, created_at, media_type, media_url, sender_name")
      .ilike("phone", `%${suffix}`)
      .order("created_at", { ascending: true })
      .limit(300);
    if (whatsappNumberId) q = q.eq("whatsapp_number_id", whatsappNumberId);
    const { data, error } = await q;
    if (error) toast.error("Erro ao carregar conversa");
    setMsgs((data as ChatMsg[]) || []);
    setLoading(false);
  }, [phone, whatsappNumberId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[80vh] p-0 overflow-hidden gap-0 flex flex-col">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            {name || "Conversa"}
          </DialogTitle>
          <p className="flex items-center gap-1.5 text-xs text-neutral-500">
            <Phone className="h-3 w-3" /> {phone || "—"}
            <span className="ml-auto">
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={load} disabled={loading}>
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Atualizar
              </Button>
            </span>
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-auto bg-[#e5ddd5]/40 p-3 space-y-2">
          {loading && msgs.length === 0 ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>
          ) : msgs.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-400">
              Nenhuma mensagem encontrada para este número nesta instância.
            </p>
          ) : (
            msgs.map((m) => {
              const out = m.direction === "outgoing";
              return (
                <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      out ? "bg-emerald-100 text-neutral-800 rounded-br-sm" : "bg-white text-neutral-800 rounded-bl-sm"
                    }`}
                  >
                    {out && m.sender_name && (
                      <p className="mb-0.5 text-[10px] font-semibold text-emerald-700">{m.sender_name}</p>
                    )}
                    {m.media_url && m.media_type === "image" && (
                      <img src={m.media_url} alt="" className="mb-1 max-h-52 rounded-lg object-cover" loading="lazy" />
                    )}
                    {m.media_url && m.media_type === "video" && (
                      <video src={m.media_url} controls className="mb-1 max-h-52 rounded-lg" />
                    )}
                    {m.media_url && m.media_type === "audio" && (
                      <audio src={m.media_url} controls className="mb-1 w-56" />
                    )}
                    {m.message && <p className="whitespace-pre-wrap break-words">{m.message}</p>}
                    {!m.message && !m.media_url && (
                      <p className="italic text-neutral-400">[{m.media_type || "mensagem"}]</p>
                    )}
                    <p className={`mt-0.5 text-[10px] ${out ? "text-emerald-600/70" : "text-neutral-400"}`}>{fmt(m.created_at)}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

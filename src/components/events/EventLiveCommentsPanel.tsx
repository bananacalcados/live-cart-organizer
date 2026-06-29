import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Radio, Search, Ban, ShoppingBag, Instagram, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { WhatsAppChatDialog } from "@/components/WhatsAppChatDialog";
import { InstagramDMChat } from "@/components/events/InstagramDMChat";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";
import { Order } from "@/types/order";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LiveComment {
  id: string;
  comment_id: string;
  username: string;
  comment_text: string;
  profile_pic_url: string | null;
  is_order: boolean | null;
  ai_classification: string | null;
  created_at: string;
}

const cleanHandle = (h: string) => (h || "").replace(/^@/, "").trim().toLowerCase();

// Remove o prefixo "💬 Comentário no Live/Reel/post: " salvo em whatsapp_messages
const stripCommentPrefix = (m: string) =>
  (m || "").replace(/^💬\s*Coment[áa]rio\s+no\s+[^:]+:\s*/i, "").trim();

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Ontem";
  return format(d, "dd/MM HH:mm", { locale: ptBR });
}

interface Props {
  eventId: string | null;
}

/**
 * Painel lateral do módulo Eventos: mostra os comentários da Live
 * (vídeo ao vivo do Instagram).
 *
 * Fontes de dados (mescladas):
 *  1) Tabela `live_comments` (quando o evento foi marcado como "Ativar Live").
 *  2) Tabela `whatsapp_messages` (canal Instagram) — onde TODO comentário de
 *     live/reel chega via webhook do Meta, mesmo sem "Ativar Live" ligado.
 *     É aqui que ficam os históricos das lives passadas.
 *
 * Como os comentários do webhook não têm event_id, eles são filtrados por
 * PERÍODO. O padrão vai da data de criação do evento até hoje, e pode ser
 * ajustado para fazer o pente fino de qualquer faixa de datas.
 *
 * - Clicar no @ de quem comentou abre o modal de pedido (editar não pago ou criar novo).
 * - Clientes BANIDOS recebem uma TAG vermelha de "BANIDO".
 */
export function EventLiveCommentsPanel({ eventId }: Props) {
  const { orders } = useDbOrderStore();
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [bannedHandles, setBannedHandles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Faixa de datas (pente fino)
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  // Modal de pedido
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DbOrder | null>(null);
  const [prefillHandle, setPrefillHandle] = useState<string>("");

  // Chats (Instagram DM / WhatsApp) abertos a partir de um comentário
  const [igChatHandle, setIgChatHandle] = useState<string | null>(null);
  const [igChatOpen, setIgChatOpen] = useState(false);
  const [waChatOrder, setWaChatOrder] = useState<Order | null>(null);
  const [waChatOpen, setWaChatOpen] = useState(false);

  // Mapa handle(limpo) -> whatsapp cadastrado (para o botão de WhatsApp)
  const [whatsappByHandle, setWhatsappByHandle] = useState<Map<string, string>>(new Map());

  // Define o início padrão da faixa = data de criação/início do evento
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("created_at, start_date")
        .eq("id", eventId)
        .maybeSingle();
      if (cancelled) return;
      const base = (data?.start_date as string) || (data?.created_at as string);
      if (base) setFromDate(format(new Date(base), "yyyy-MM-dd"));
      setToDate(format(new Date(), "yyyy-MM-dd"));
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const loadComments = useCallback(async () => {
    if (!eventId || !fromDate) {
      setComments([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const startIso = new Date(`${fromDate}T00:00:00`).toISOString();
    const endIso = new Date(`${toDate}T23:59:59.999`).toISOString();

    const [lcRes, waRes] = await Promise.all([
      // 1) live_comments do evento (quando "Ativar Live" foi usado)
      supabase
        .from("live_comments")
        .select("id, comment_id, username, comment_text, profile_pic_url, is_order, ai_classification, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(2000),
      // 2) comentários de live/reel que chegaram pelo webhook do Meta
      supabase
        .from("whatsapp_messages")
        .select("id, sender_name, message, created_at")
        .eq("channel", "instagram")
        .eq("direction", "incoming")
        .ilike("message", "💬 Comentário no%")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false })
        .limit(3000),
    ]);

    const merged: LiveComment[] = [];
    const seen = new Set<string>();

    const pushUnique = (c: LiveComment) => {
      const key = `${cleanHandle(c.username)}|${(c.comment_text || "").toLowerCase().trim()}|${c.created_at.slice(0, 16)}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(c);
    };

    for (const row of (lcRes.data as LiveComment[]) || []) pushUnique(row);

    for (const row of (waRes.data as any[]) || []) {
      const username = (row.sender_name || "").toString();
      if (!username.startsWith("@")) continue;
      pushUnique({
        id: row.id,
        comment_id: row.id,
        username,
        comment_text: stripCommentPrefix(row.message),
        profile_pic_url: null,
        is_order: null,
        ai_classification: null,
        created_at: row.created_at,
      });
    }

    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setComments(merged);
    setLoading(false);
  }, [eventId, fromDate, toDate]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Clientes banidos (instagram_handle) — para a TAG de BANIDO
  const loadBanned = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("instagram_handle")
      .eq("is_banned", true);
    const set = new Set<string>();
    (data || []).forEach((c: any) => {
      const h = cleanHandle(c.instagram_handle || "");
      if (h) set.add(h);
    });
    setBannedHandles(set);
  }, []);

  useEffect(() => {
    loadBanned();
  }, [loadBanned]);

  // Realtime: novos comentários (live_comments) entram automaticamente
  useEffect(() => {
    if (!eventId) return;
    const ch = supabase
      .channel(`live-panel-${eventId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_comments", filter: `event_id=eq.${eventId}` },
        (payload) => {
          const c = payload.new as LiveComment;
          setComments((prev) => {
            if (prev.some((x) => x.id === c.id || x.comment_id === c.comment_id)) return prev;
            return [c, ...prev];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [eventId]);

  // Polling leve (30s) para puxar novos comentários do webhook quando o "to" é hoje
  useEffect(() => {
    if (!eventId) return;
    const isToToday = toDate === format(new Date(), "yyyy-MM-dd");
    if (!isToToday) return;
    const t = setInterval(() => loadComments(), 30000);
    return () => clearInterval(t);
  }, [eventId, toDate, loadComments]);

  // Mapa handle -> pedido NÃO PAGO mais recente deste evento
  const unpaidOrderByHandle = useMemo(() => {
    const map = new Map<string, DbOrder>();
    for (const o of orders) {
      const h = cleanHandle(o.customer?.instagram_handle || "");
      if (!h) continue;
      if (isOrderMarkedPaid(o) || o.stage === "cancelled") continue;
      const existing = map.get(h);
      if (!existing || new Date(o.updated_at) > new Date(existing.updated_at)) {
        map.set(h, o);
      }
    }
    return map;
  }, [orders]);

  const openForHandle = (rawHandle: string) => {
    const clean = cleanHandle(rawHandle);
    const unpaid = unpaidOrderByHandle.get(clean);
    if (unpaid) {
      setEditingOrder(unpaid);
      setPrefillHandle("");
    } else {
      setEditingOrder(null);
      setPrefillHandle(clean);
    }
    setDialogOpen(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return comments;
    return comments.filter(
      (c) =>
        cleanHandle(c.username).includes(q.replace(/^@/, "")) ||
        (c.comment_text || "").toLowerCase().includes(q),
    );
  }, [comments, search]);

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Radio className="h-5 w-5 text-pink-500" />
        <h2 className="text-sm font-bold">Comentários da Live</h2>
        <span className="ml-auto rounded-full bg-pink-500/15 px-2 py-0.5 text-xs font-semibold text-pink-600 dark:text-pink-300">
          {comments.length}
        </span>
      </div>

      {/* Faixa de datas (pente fino) */}
      <div className="grid grid-cols-2 gap-2 border-b border-border p-2">
        <label className="flex flex-col gap-0.5 text-[10px] font-medium text-muted-foreground">
          De
          <Input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] font-medium text-muted-foreground">
          Até
          <Input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 text-xs"
          />
        </label>
      </div>

      {/* Busca */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar @ ou texto do comentário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Lista de comentários */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Carregando comentários...</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {comments.length === 0
              ? "Nenhum comentário da live neste período. Ajuste as datas acima."
              : "Nenhum comentário encontrado para a busca."}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((c) => {
              const handle = cleanHandle(c.username);
              const isBanned = bannedHandles.has(handle);
              const hasUnpaid = unpaidOrderByHandle.has(handle);
              return (
                <div key={c.id} className="flex gap-2.5 px-3 py-2.5 hover:bg-muted/40">
                  <Avatar className="h-9 w-9 shrink-0">
                    {c.profile_pic_url && <AvatarImage src={c.profile_pic_url} alt={handle} />}
                    <AvatarFallback className="bg-pink-500/20 text-pink-600 text-xs">
                      {handle.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => openForHandle(c.username)}
                        title="Abrir / criar pedido deste cliente"
                        className="flex items-center gap-1 text-sm font-semibold text-pink-600 hover:underline dark:text-pink-300"
                      >
                        <ShoppingBag className="h-3 w-3" />@{handle}
                      </button>
                      {isBanned && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">
                          <Ban className="h-2.5 w-2.5" />
                          Banido
                        </span>
                      )}
                      {hasUnpaid && (
                        <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                          Pedido aberto
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">{timeLabel(c.created_at)}</span>
                    </div>
                    <p className="mt-0.5 break-words text-sm text-foreground/90">{c.comment_text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {eventId && (
        <OrderDialogDb
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingOrder={editingOrder}
          eventId={eventId}
          prefillInstagram={prefillHandle || undefined}
        />
      )}
    </div>
  );
}

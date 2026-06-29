import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Radio, Search, Ban, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";
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

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Ontem";
  return format(d, "dd/MM", { locale: ptBR });
}

interface Props {
  eventId: string | null;
}

/**
 * Painel lateral do módulo Eventos: mostra SOMENTE os comentários da Live
 * (vídeo ao vivo do Instagram) — sem conversas de WhatsApp/Instagram.
 *
 * - Clicar no @ de quem comentou abre o modal de pedido:
 *    • se a pessoa já tem um pedido NÃO PAGO neste evento → abre para editar;
 *    • se já tem pedido pago, ou não tem pedido → abre um pedido novo já com o @ preenchido.
 * - Clientes BANIDOS recebem uma TAG vermelha de "BANIDO".
 */
export function EventLiveCommentsPanel({ eventId }: Props) {
  const { orders } = useDbOrderStore();
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [bannedHandles, setBannedHandles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modal de pedido
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DbOrder | null>(null);
  const [prefillHandle, setPrefillHandle] = useState<string>("");

  const loadComments = useCallback(async () => {
    if (!eventId) {
      setComments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("live_comments")
      .select("id, comment_id, username, comment_text, profile_pic_url, is_order, ai_classification, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(2000);
    setComments((data as LiveComment[]) || []);
    setLoading(false);
  }, [eventId]);

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

  // Realtime: novos comentários entram automaticamente
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

  const openForHandle = (rawHandle: string, commentId?: string) => {
    const clean = cleanHandle(rawHandle);
    const unpaid = unpaidOrderByHandle.get(clean);
    if (unpaid) {
      // Já tem pedido não pago → editar (adicionar/trocar/excluir produtos)
      setEditingOrder(unpaid);
      setPrefillHandle("");
    } else {
      // Sem pedido OU pedido pago → pedido novo do zero, já com o @
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
              ? "Nenhum comentário da live ainda."
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
                        onClick={() => openForHandle(c.username, c.comment_id)}
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

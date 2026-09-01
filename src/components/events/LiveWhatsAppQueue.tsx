import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveChatContacts } from "@/lib/chatContactsCache";
import { useWaMessageBroadcast } from "@/hooks/useWaMessageBroadcast";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { cn } from "@/lib/utils";
import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Archive, ArchiveRestore, MessageCircle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { DbOrder } from "@/types/database";

export interface LiveConversation {
  phone: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  direction: string;
  whatsappNumberId: string | null;
  name?: string;
  isGroup: boolean;
}

export type QueueFilter = "live" | "no_order" | "all" | "archived";

interface LiveWhatsAppQueueProps {
  /** Evento atual: o arquivamento vale SÓ para a Central desta live. */
  eventId: string;
  /** Início da live: conversas com mensagem depois disso entram no filtro "Da live". */
  liveStartedAt?: string | null;
  /** Pedidos do evento atual (para marcar quem já tem pedido). */
  orders: DbOrder[];
  selectedKey: string | null;
  onSelect: (conv: LiveConversation) => void;
  onCreateOrder: (conv: LiveConversation) => void;
  /** Instância configurada na live (usada como padrão do filtro). */
  defaultInstanceId?: string | null;
}

const suffix8 = (phone?: string | null) => {
  const digits = (phone || "").replace(/\D/g, "");
  return digits ? digits.slice(-8) : "";
};

const ALL = "__all__";

export function LiveWhatsAppQueue({
  eventId,
  liveStartedAt,
  orders,
  selectedKey,
  onSelect,
  onCreateOrder,
  defaultInstanceId = null,
}: LiveWhatsAppQueueProps) {

  const [conversations, setConversations] = useState<LiveConversation[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("live");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [instanceId, setInstanceId] = useState<string>(defaultInstanceId || ALL);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const { numbers, fetchNumbers } = useWhatsAppNumberStore();

  useEffect(() => {
    fetchNumbers();
  }, [fetchNumbers]);

  useEffect(() => {
    if (defaultInstanceId) setInstanceId(defaultInstanceId);
  }, [defaultInstanceId]);

  // Conversas arquivadas SÓ nesta live
  const loadArchived = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("event_archived_conversations")
      .select("phone")
      .eq("event_id", eventId);
    setArchived(new Set(((data || []) as any[]).map((r) => suffix8(r.phone))));
  }, [eventId]);

  useEffect(() => {
    loadArchived();
  }, [loadArchived]);

  const toggleArchive = useCallback(
    async (conv: LiveConversation) => {
      const key = suffix8(conv.phone);
      const isArchived = archived.has(key);
      if (isArchived) {
        await (supabase as any)
          .from("event_archived_conversations")
          .delete()
          .eq("event_id", eventId)
          .eq("phone", conv.phone);
        setArchived((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        toast.success("Conversa restaurada na fila da live");
      } else {
        await (supabase as any).from("event_archived_conversations").insert({
          event_id: eventId,
          phone: conv.phone,
          whatsapp_number_id: conv.whatsappNumberId,
        });
        setArchived((prev) => new Set(prev).add(key));
        toast.success("Conversa arquivada nesta live");
      }
    },
    [archived, eventId]
  );

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_conversations", {
      p_number_id: null,
      p_dispatch_only: false,
    });
    if (error) {
      console.error("[LiveWhatsAppQueue] get_conversations", error);
      setLoading(false);
      return;
    }
    const rows = (data || []) as any[];
    const convs: LiveConversation[] = rows
      .filter((r) => !r.is_dispatch_only)
      .map((r) => ({
        phone: r.phone,
        lastMessage: r.last_message || "",
        lastMessageAt: new Date(r.last_message_at),
        unreadCount: Number(r.unread_count || 0),
        direction: r.direction,
        whatsappNumberId: r.whatsapp_number_id || null,
        name: r.sender_name || undefined,
        isGroup: Boolean(r.is_group) || String(r.phone).includes("@g.us"),
      }))
      .filter((c) => !c.isGroup)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

    // Nomes apenas dos telefones visíveis (cache compartilhado)
    const maps = await resolveChatContacts(convs.slice(0, 200).map((c) => c.phone));
    setConversations(
      convs.map((c) => ({ ...c, name: maps.names[c.phone] || c.name }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useWaMessageBroadcast(() => {
    load();
  }, { debounceMs: 1200 });

  const orderBySuffix = useMemo(() => {
    const map = new Map<string, DbOrder>();
    for (const o of orders) {
      const key = suffix8((o as any).customer?.whatsapp);
      if (key) map.set(key, o);
    }
    return map;
  }, [orders]);

  const startedAtMs = liveStartedAt ? new Date(liveStartedAt).getTime() : null;

  // Instância escolhida no filtro (uma só, ou todas)
  const byInstance = useMemo(
    () =>
      instanceId === ALL
        ? conversations
        : conversations.filter((c) => c.whatsappNumberId === instanceId),
    [conversations, instanceId]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return byInstance.filter((c) => {
      const isArchived = archived.has(suffix8(c.phone));
      if (filter === "archived") {
        if (!isArchived) return false;
      } else if (isArchived) {
        return false;
      }
      const order = orderBySuffix.get(suffix8(c.phone));
      if (filter === "live" && startedAtMs && c.lastMessageAt.getTime() < startedAtMs) return false;
      if (filter === "no_order" && order) return false;
      if (term) {
        const hay = `${c.name || ""} ${c.phone}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [byInstance, filter, search, orderBySuffix, startedAtMs, archived]);

  const counts = useMemo(() => {
    let live = 0;
    let noOrder = 0;
    let archivedCount = 0;
    let all = 0;
    for (const c of byInstance) {
      if (archived.has(suffix8(c.phone))) {
        archivedCount++;
        continue;
      }
      all++;
      if (!startedAtMs || c.lastMessageAt.getTime() >= startedAtMs) live++;
      if (!orderBySuffix.get(suffix8(c.phone))) noOrder++;
    }
    return { live, noOrder, all, archived: archivedCount };
  }, [byInstance, orderBySuffix, startedAtMs, archived]);

  const instanceLabel = (id: string | null) =>
    numbers.find((n) => n.id === id)?.label || null;


  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-bold text-emerald-500">
          <MessageCircle className="h-4 w-4" /> Fila da Live
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => load()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2 px-2 py-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nome ou telefone..."
          className="h-8 text-xs"
        />
        <div className="flex flex-wrap gap-1">
          {([
            ["live", `Da live (${counts.live})`],
            ["no_order", `Sem pedido (${counts.noOrder})`],
            ["all", `Todas (${counts.all})`],
          ] as [QueueFilter, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                filter === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {loading && (
          <p className="py-6 text-center text-xs text-muted-foreground">Carregando conversas...</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhuma conversa neste filtro.
          </p>
        )}
        {filtered.map((c) => {
          const order = orderBySuffix.get(suffix8(c.phone));
          const key = `${c.phone}::${c.whatsappNumberId || ""}`;
          const isSelected = selectedKey === key;
          const isFromLive = !startedAtMs || c.lastMessageAt.getTime() >= startedAtMs;
          const label = instanceLabel(c.whatsappNumberId);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(c)}
              className={cn(
                "w-full rounded-lg border p-2 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/10"
                  : c.direction === "incoming" && c.unreadCount > 0
                    ? "border-emerald-500/50 bg-emerald-500/5 hover:bg-emerald-500/10"
                    : "border-border hover:bg-muted/50"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold">
                  {c.name || c.phone}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {isToday(c.lastMessageAt)
                    ? format(c.lastMessageAt, "HH:mm", { locale: ptBR })
                    : format(c.lastMessageAt, "dd/MM", { locale: ptBR })}
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{c.lastMessage}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {isFromLive && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-300">
                    veio da live
                  </span>
                )}
                {order ? (
                  <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[9px] font-semibold text-sky-600 dark:text-sky-300">
                    pedido #{String(order.id).slice(0, 6)}
                  </span>
                ) : (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[9px] font-semibold text-destructive">
                    sem pedido
                  </span>
                )}
                {c.unreadCount > 0 && (
                  <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold text-white">
                    {c.unreadCount}
                  </span>
                )}
                {label && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px] text-muted-foreground">
                    {label}
                  </span>
                )}
              </div>
              {!order && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateOrder(c);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      onCreateOrder(c);
                    }
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-primary py-1 text-[11px] font-bold text-primary-foreground hover:opacity-90"
                >
                  <Plus className="h-3 w-3" /> Criar pedido
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

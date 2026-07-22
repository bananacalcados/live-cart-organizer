import { useMemo, useState, useEffect, useCallback } from "react";
import { Check, QrCode, Phone, Clock, AlertCircle, RefreshCw, Pin, Link as LinkIcon, MessageSquareOff, ClipboardList, Layers, Link2, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { DbOrder } from "@/types/database";
import { Order } from "@/types/order";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";
import { getOrderFinalValue } from "@/lib/orderTotal";
import { groupOrdersByCustomer, sameShippingAddress, OrderRegLite } from "@/lib/customerOrderGrouping";
import { WhatsAppChatDialog } from "@/components/WhatsAppChatDialog";
import { OrderDetailsDialog } from "@/components/OrderDetailsDialog";
import { EventCustomerOrdersDialog } from "@/components/events/EventCustomerOrdersDialog";
import { InstagramDMChat } from "@/components/events/InstagramDMChat";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface EventPaymentCardsBarProps {
  orders: DbOrder[];
  /** Mantido por compatibilidade — abrir pedido (não usado no clique principal). */
  onSelectOrder?: (order: DbOrder) => void;
}

type PayFilter = "awaiting" | "paid" | "errors";

interface FailedAttempt {
  id: string;
  sale_id: string;
  amount: number | null;
  payment_method: string;
  gateway: string | null;
  error_message: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
}

function formatPhone(phone?: string | null): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.length > 11 ? digits.slice(-11) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits;
}

function methodLabel(method: string): string {
  if (method === "pix") return "PIX";
  if (method === "credit_card" || method === "card") return "Cartão";
  return method || "—";
}

/** Converte DbOrder para o tipo Order legado usado pelo chat de WhatsApp. */
function dbOrderToLegacy(dbOrder: DbOrder): Order {
  const handle = dbOrder.customer?.instagram_handle?.trim()
    ? (dbOrder.customer.instagram_handle.startsWith("@")
        ? dbOrder.customer.instagram_handle
        : `@${dbOrder.customer.instagram_handle}`)
    : "";
  return {
    id: dbOrder.id,
    instagramHandle: handle,
    whatsapp: dbOrder.customer?.whatsapp,
    cartLink: dbOrder.cart_link,
    products: dbOrder.products,
    stage: dbOrder.stage as Order["stage"],
    notes: dbOrder.notes,
    createdAt: new Date(dbOrder.created_at),
    updatedAt: new Date(dbOrder.updated_at),
    hasUnreadMessages: dbOrder.has_unread_messages,
    lastCustomerMessageAt: dbOrder.last_customer_message_at ? new Date(dbOrder.last_customer_message_at) : undefined,
    lastSentMessageAt: dbOrder.last_sent_message_at ? new Date(dbOrder.last_sent_message_at) : undefined,
  };
}

/**
 * Barra de cards de pagamento dos pedidos DESTE evento.
 * Substitui a barra de filtros (Todos / Não Pagos / etc) dentro do evento.
 *
 * - "Aguardando": pedidos em aguardando pagamento (não pagos).
 * - "Pagos": pedidos com pagamento confirmado.
 * - "Erros de Pagamento": tentativas de pagamento que FALHARAM no checkout
 *   (somente deste evento). Fundo vermelho escuro com letras brancas.
 *
 * Ao clicar no card abre o CHAT da conversa (WhatsApp ou Instagram) na
 * instância em que a conversa aconteceu (mesma da mensagem inicial da live),
 * e não o modal de pedido.
 */
export function EventPaymentCardsBar({ orders }: EventPaymentCardsBarProps) {
  const [filter, setFilter] = useState<PayFilter>("awaiting");
  const [chatOrder, setChatOrder] = useState<Order | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [igHandle, setIgHandle] = useState<string | null>(null);
  const [igOpen, setIgOpen] = useState(false);

  const [failedAttempts, setFailedAttempts] = useState<FailedAttempt[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);

  // Team-shared pinned conversations + checkout-link step per order.
  const currentUserId = useCurrentUserId();
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [stepByOrder, setStepByOrder] = useState<Record<string, number>>({});
  const [detailsOrder, setDetailsOrder] = useState<DbOrder | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Agrupamento por cliente (aba Pagos) + unificação de pedidos.
  const { fetchOrdersByEvent } = useDbOrderStore();
  const eventId = orders[0] ? (orders[0] as any).event_id : null;
  const refreshOrders = useCallback(() => {
    if (eventId) fetchOrdersByEvent(eventId);
  }, [eventId, fetchOrdersByEvent]);
  const [paidRegs, setPaidRegs] = useState<Record<string, OrderRegLite>>({});
  const [groupDialogOrders, setGroupDialogOrders] = useState<DbOrder[] | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);

  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);


  const handleCardClick = (order: DbOrder) => {
    const phone = order.customer?.whatsapp?.replace(/\D/g, "");
    if (phone) {
      // Tem WhatsApp → abre o chat de WhatsApp na instância da conversa.
      setChatOrder(dbOrderToLegacy(order));
      setChatOpen(true);
      return;
    }
    // Sem WhatsApp → tenta abrir DM do Instagram.
    const handle = order.customer?.instagram_handle?.replace(/^@/, "").trim();
    if (handle) {
      setIgHandle(handle);
      setIgOpen(true);
    }
  };

  // Abre o chat a partir de uma tentativa de pagamento que falhou.
  const handleAttemptClick = (att: FailedAttempt) => {
    const phone = att.customer_phone?.replace(/\D/g, "");
    if (phone) {
      setChatOrder({
        id: att.sale_id,
        instagramHandle: att.customer_name?.startsWith("@") ? att.customer_name : "",
        whatsapp: att.customer_phone || undefined,
        products: [],
        stage: "awaiting_payment" as Order["stage"],
        createdAt: new Date(att.created_at),
        updatedAt: new Date(att.created_at),
      } as Order);
      setChatOpen(true);
      return;
    }
    const handle = att.customer_name?.replace(/^@/, "").trim();
    if (handle) {
      setIgHandle(handle);
      setIgOpen(true);
    }
  };

  const loadErrors = useCallback(async () => {
    if (orderIds.length === 0) {
      setFailedAttempts([]);
      return;
    }
    setLoadingErrors(true);
    try {
      const batchSize = 100;
      const all: FailedAttempt[] = [];
      for (let i = 0; i < orderIds.length; i += batchSize) {
        const batch = orderIds.slice(i, i + batchSize);
        const { data } = await supabase
          .from("pos_checkout_attempts")
          .select("id, sale_id, amount, payment_method, gateway, error_message, customer_name, customer_phone, created_at")
          .in("sale_id", batch)
          .eq("status", "failed")
          .order("created_at", { ascending: false });
        if (data) all.push(...(data as FailedAttempt[]));
      }
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setFailedAttempts(all);
    } catch (err) {
      console.error("Erro ao carregar erros de pagamento:", err);
    } finally {
      setLoadingErrors(false);
    }
  }, [orderIds]);

  useEffect(() => {
    if (filter === "errors") loadErrors();
  }, [filter, loadErrors]);

  // ── Load team-shared pins for the currently listed orders ──
  const loadPins = useCallback(async () => {
    if (orderIds.length === 0) { setPinnedIds(new Set()); return; }
    const next = new Set<string>();
    const batchSize = 100;
    for (let i = 0; i < orderIds.length; i += batchSize) {
      const batch = orderIds.slice(i, i + batchSize);
      const { data } = await supabase
        .from("event_pinned_conversations")
        .select("order_id")
        .in("order_id", batch);
      for (const row of (data || []) as { order_id: string }[]) next.add(row.order_id);
    }
    setPinnedIds(next);
  }, [orderIds]);

  useEffect(() => { loadPins(); }, [loadPins]);

  const togglePin = useCallback(async (order: DbOrder) => {
    const isPinned = pinnedIds.has(order.id);
    // Optimistic update
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (isPinned) next.delete(order.id); else next.add(order.id);
      return next;
    });
    if (isPinned) {
      await supabase.from("event_pinned_conversations").delete().eq("order_id", order.id);
    } else {
      await supabase.from("event_pinned_conversations").insert({
        order_id: order.id,
        event_id: (order as any).event_id ?? null,
        pinned_by: currentUserId || null,
      } as never);
    }
    loadPins();
  }, [pinnedIds, currentUserId, loadPins]);

  // ── Compute checkout-link step (1/2/3) for listed non-paid orders ──
  useEffect(() => {
    const ids = orders.filter((o) => !isOrderMarkedPaid(o)).map((o) => o.id);
    if (ids.length === 0) { setStepByOrder({}); return; }
    let cancelled = false;
    (async () => {
      const startedMap: Record<string, boolean> = {};
      for (const o of orders) startedMap[o.id] = !!(o as any).checkout_started_at;
      const map: Record<string, number> = {};
      const batchSize = 100;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const { data } = await supabase
          .from("customer_registrations")
          .select("order_id, full_name, cpf, whatsapp, cep, address, city, state")
          .in("order_id", batch);
        const byOrder = new Map<string, any>();
        for (const r of (data || []) as any[]) byOrder.set(r.order_id, r);
        for (const id of batch) {
          const reg = byOrder.get(id);
          const notPlaceholder = (v?: string | null, ph?: string) =>
            !!(v && v.trim() && (!ph || v.trim().toUpperCase() !== ph.toUpperCase()));
          const hasIdentification = !!reg && notPlaceholder(reg.full_name) && notPlaceholder(reg.cpf) && notPlaceholder(reg.whatsapp);
          const hasAddress = !!reg
            && notPlaceholder(reg.cep) && reg.cep?.replace(/\D/g, "") !== "00000000"
            && notPlaceholder(reg.address, "Pendente")
            && notPlaceholder(reg.city, "Pendente")
            && notPlaceholder(reg.state);
          map[id] = hasAddress ? 3 : hasIdentification ? 2 : startedMap[id] ? 1 : 0;
        }
      }
      if (!cancelled) setStepByOrder(map);
    })();
    return () => { cancelled = true; };
  }, [orders]);

  const { awaiting, paid } = useMemo(() => {
    const awaitingList: DbOrder[] = [];
    const paidList: DbOrder[] = [];
    for (const o of orders) {
      if (isOrderMarkedPaid(o)) {
        paidList.push(o);
      } else if (o.stage !== "cancelled" && o.stage !== "incomplete_order") {
        // Todo pedido NÃO pago (e não cancelado/incompleto) está aguardando pagamento,
        // independente do stage exato (contacted, new, awaiting_confirmation, awaiting_payment, no_response...).
        awaitingList.push(o);
      }
    }
    // Pinned first, then by date. Team-shared pins keep priority cards at the top.
    const sortByPinThenDate = (a: DbOrder, b: DbOrder) => {
      const pa = pinnedIds.has(a.id) ? 1 : 0;
      const pb = pinnedIds.has(b.id) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    };
    awaitingList.sort(sortByPinThenDate);
    paidList.sort(sortByPinThenDate);
    return { awaiting: awaitingList, paid: paidList };
  }, [orders, pinnedIds]);

  // ── Carrega fichas (cpf/endereço) dos pedidos PAGOS p/ agrupar por cliente ──
  const paidIds = useMemo(() => paid.map((o) => o.id).join(","), [paid]);
  useEffect(() => {
    if (filter !== "paid") return;
    const ids = paidIds ? paidIds.split(",") : [];
    if (ids.length === 0) { setPaidRegs({}); return; }
    let cancelled = false;
    (async () => {
      const map: Record<string, OrderRegLite> = {};
      const batchSize = 100;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const { data } = await supabase
          .from("customer_registrations")
          .select("order_id, cpf, whatsapp, cep, address, address_number, city, state")
          .in("order_id", batch);
        for (const r of (data || []) as OrderRegLite[]) if (r.order_id) map[r.order_id] = r;
      }
      if (!cancelled) setPaidRegs(map);
    })();
    return () => { cancelled = true; };
  }, [filter, paidIds]);

  // Entradas da aba Pagos: cada entrada é um cliente (1+ pedidos agrupados).
  const paidEntries = useMemo(() => {
    const groups = groupOrdersByCustomer(paid, paidRegs);
    return groups.map((g) => {
      // Representante: o pedido "mestre" (se unificado), senão o mais recente.
      const master = g.find((o) => g.some((c) => c.merged_into_order_id === o.id));
      const rep =
        master ||
        [...g].sort(
          (a, b) =>
            new Date(b.paid_at || b.created_at).getTime() -
            new Date(a.paid_at || a.created_at).getTime(),
        )[0];
      return { rep, group: g };
    });
  }, [paid, paidRegs]);

  type CardEntry = { rep: DbOrder; group: DbOrder[] };
  const cards: CardEntry[] =
    filter === "paid"
      ? paidEntries
      : awaiting.map((o) => ({ rep: o, group: [o] }));




  return (
    <div className="sticky top-16 z-40 bg-background/95 backdrop-blur border-b border-border/40">
      <div className="container py-2">
        {/* Toggle Aguardando / Pagos / Erros */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setFilter("awaiting")}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
              filter === "awaiting"
                ? "bg-neutral-900 text-yellow-400 ring-1 ring-yellow-400/60"
                : "bg-neutral-900/10 text-neutral-900 dark:text-neutral-200 hover:bg-neutral-900/20",
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            Aguardando Pagamento
            <span
              className={cn(
                "px-1.5 py-0.5 rounded-full text-[10px]",
                filter === "awaiting" ? "bg-yellow-400 text-neutral-900 font-bold" : "bg-background/20",
              )}
            >
              {awaiting.length}
            </span>
          </button>
          <button
            onClick={() => setFilter("paid")}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
              filter === "paid"
                ? "bg-stage-paid text-white"
                : "bg-stage-paid/10 text-stage-paid hover:bg-stage-paid/20",
            )}
          >
            <Check className="h-3.5 w-3.5" />
            Pagamentos Concluídos
            <span className="bg-background/20 px-1.5 py-0.5 rounded-full text-[10px]">{paid.length}</span>
          </button>
          <button
            onClick={() => setFilter("errors")}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
              filter === "errors"
                ? "bg-red-900 text-white ring-1 ring-red-400/60"
                : "bg-red-900/10 text-red-800 dark:text-red-300 hover:bg-red-900/20",
            )}
          >
            <AlertCircle className="h-3.5 w-3.5" />
            Erros de Pagamento
            {failedAttempts.length > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                  filter === "errors" ? "bg-white text-red-900" : "bg-red-900/20",
                )}
              >
                {failedAttempts.length}
              </span>
            )}
          </button>
        </div>

        {/* Conteúdo: Erros de Pagamento */}
        {filter === "errors" ? (
          <div className="rounded-lg bg-red-950 border border-red-800/60 p-2 text-white">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-semibold text-red-100">
                Tentativas de pagamento que falharam neste evento
              </span>
              <button
                onClick={loadErrors}
                className="flex items-center gap-1 text-[11px] text-red-200 hover:text-white"
              >
                <RefreshCw className={cn("h-3 w-3", loadingErrors && "animate-spin")} />
                Atualizar
              </button>
            </div>
            {loadingErrors && failedAttempts.length === 0 ? (
              <div className="text-xs text-red-200 py-2 px-1">Carregando erros de pagamento...</div>
            ) : failedAttempts.length === 0 ? (
              <div className="text-xs text-red-200 py-2 px-1">
                Nenhum erro de pagamento registrado neste evento.
              </div>
            ) : (
              <div className="flex items-stretch gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {failedAttempts.map((att) => (
                  <button
                    key={att.id}
                    onClick={() => handleAttemptClick(att)}
                    title="Abrir conversa"
                    className="group flex flex-col gap-1 min-w-[220px] max-w-[260px] px-3 py-2 rounded-lg border border-red-700 bg-red-900 text-white text-left transition-colors shrink-0 hover:bg-red-800"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-white shrink-0">
                        <AlertCircle className="h-3 w-3" />
                      </span>
                      <span className="truncate text-xs font-semibold text-white">
                        {att.customer_name || "Sem nome"}
                      </span>
                    </div>
                    {att.customer_phone && (
                      <span className="flex items-center gap-1 text-[11px] truncate text-white/70">
                        <Phone className="h-3 w-3 shrink-0" />
                        {formatPhone(att.customer_phone)}
                      </span>
                    )}
                    <span className="text-[12px] font-bold text-red-200">
                      {methodLabel(att.payment_method)}
                      {att.gateway ? ` · ${att.gateway}` : ""}
                      {att.amount ? ` • R$ ${att.amount.toFixed(2)}` : ""}
                    </span>
                    {att.error_message && (
                      <span className="text-[10px] text-red-300 line-clamp-2" title={att.error_message}>
                        {att.error_message}
                      </span>
                    )}
                    <span className="text-[10px] text-white/50">
                      {format(new Date(att.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : /* Cards de pedidos (Aguardando / Pagos) */ cards.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2 px-1">
            {filter === "paid"
              ? "Nenhum pagamento concluído neste evento ainda."
              : "Nenhum pedido aguardando pagamento neste evento."}
          </div>
        ) : (
          <div className="flex items-stretch gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {cards.map((entry) => {
              const order = entry.rep;
              const group = entry.group;
              const isGroup = group.length > 1;
              const groupMerged = isGroup && group.some((o) => o.merged_into_order_id);
              const paidCard = filter === "paid";
              // Card precisa de unificação: cliente com 2+ pedidos pagos,
              // ainda não unificados e com o MESMO endereço de entrega.
              const needsUnify =
                paidCard && isGroup && !groupMerged && sameShippingAddress(group, paidRegs);
              const name = order.customer?.instagram_handle?.trim() || "Sem nome";
              const phone = formatPhone(order.customer?.whatsapp);
              const value = isGroup
                ? group.reduce((s, o) => s + getOrderFinalValue(o), 0)
                : getOrderFinalValue(order);
              // Pisca quando há mensagem do cliente não visualizada (apenas aguardando).
              const unread = !paidCard && !!order.has_unread_messages;
              const isPinned = pinnedIds.has(order.id);
              // "SEM RESPOSTA": enviamos o template mas o cliente nunca respondeu.
              const noResponse = !paidCard && !!order.last_sent_message_at && !order.last_customer_message_at;
              const step = paidCard ? 0 : (stepByOrder[order.id] ?? 0);
              const onCardClick = () => {
                if (isGroup) { setGroupDialogOrders(group); setGroupDialogOpen(true); }
                else handleCardClick(order);
              };
              return (
                <div
                  key={order.id}
                  role="button"
                  tabIndex={0}
                  onClick={onCardClick}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onCardClick(); }}
                  title={isGroup ? "Ver todos os pedidos deste cliente" : unread ? "Mensagem não lida — abrir conversa" : "Abrir conversa"}
                  className={cn(
                    "group relative flex flex-col gap-1 min-w-[210px] max-w-[250px] min-h-[104px] px-3 py-2 rounded-lg border text-left transition-colors shrink-0 cursor-pointer",
                    paidCard
                      ? "bg-stage-paid/10 border-stage-paid/40 hover:bg-stage-paid/20"
                      : "bg-neutral-900 text-white border-l-4 border-l-yellow-400 border-y-neutral-700 border-r-neutral-700 hover:bg-neutral-800",
                    unread && "animate-pulse ring-2 ring-yellow-400 ring-offset-2 ring-offset-background",
                    isPinned && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background",
                    isGroup && !needsUnify && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
                    // Precisa unificar → anel âmbar pulsante para chamar atenção.
                    needsUnify && "ring-2 ring-amber-500 ring-offset-2 ring-offset-background animate-pulse",
                  )}
                >
                  {unread && (
                    <span className="absolute -top-1.5 -left-1.5 flex h-3.5 w-3.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                      <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-yellow-400" />
                    </span>
                  )}

                  {/* Fixar conversa (compartilhado com a equipe) */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); togglePin(order); }}
                    title={isPinned ? "Desafixar conversa" : "Fixar conversa"}
                    className={cn(
                      "absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                      isPinned
                        ? "bg-sky-500 text-white"
                        : paidCard
                          ? "bg-black/5 text-muted-foreground hover:bg-black/10"
                          : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white",
                    )}
                  >
                    <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
                  </button>

                  <div className="flex items-center gap-1.5 min-w-0 pr-7">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full shrink-0",
                        paidCard ? "bg-stage-paid/25 text-stage-paid" : "bg-yellow-400/20 text-yellow-400",
                      )}
                    >
                      {paidCard ? <Check className="h-3 w-3" /> : <QrCode className="h-3 w-3" />}
                    </span>
                    <span className={cn("truncate text-xs font-semibold", !paidCard && "text-white")}>@{name}</span>
                    {isGroup && (
                      <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-primary/15 text-primary border border-primary/40 px-1.5 py-0.5 text-[9px] font-bold shrink-0">
                        <Layers className="h-2.5 w-2.5" />
                        {group.length}
                      </span>
                    )}
                  </div>
                  {phone && (
                    <span
                      className={cn(
                        "flex items-center gap-1 text-[11px] truncate",
                        paidCard ? "text-muted-foreground" : "text-white/70",
                      )}
                    >
                      <Phone className="h-3 w-3 shrink-0" />
                      {phone}
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-[12px] font-bold",
                      paidCard ? "text-stage-paid" : "text-yellow-400",
                    )}
                  >
                    {paidCard ? "PAGO • " : "Aguardando • "}R$ {value.toFixed(2)}
                    {isGroup && <span className="ml-1 text-[10px] font-medium opacity-70">(total)</span>}
                  </span>

                  {groupMerged && (
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-stage-paid/20 text-stage-paid border border-stage-paid/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                      <Link2 className="h-2.5 w-2.5" />
                      Unificado
                    </span>
                  )}

                  {/* Chamada de ação: precisa unificar (mesmo endereço, ainda separado) */}
                  {needsUnify && (
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-500 text-white border border-amber-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide shadow-sm">
                      <PackageCheck className="h-2.5 w-2.5" />
                      Unificar envio · {group.length} pedidos
                    </span>
                  )}

                  {/* Ver informações do(s) pedido(s) — pago */}
                  {paidCard && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isGroup) { setGroupDialogOrders(group); setGroupDialogOpen(true); }
                        else { setDetailsOrder(order); setDetailsOpen(true); }
                      }}
                      className={cn(
                        "mt-auto inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
                        needsUnify
                          ? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25"
                          : "border-stage-paid/40 bg-stage-paid/10 text-stage-paid hover:bg-stage-paid/20",
                      )}
                      title={isGroup ? "Ver todos os pedidos deste cliente e unificar" : "Ver todas as informações do pedido"}
                    >
                      <ClipboardList className="h-3 w-3" />
                      {needsUnify ? `Unificar ${group.length} pedidos` : isGroup ? `Ver ${group.length} pedidos` : "Ver pedido"}
                    </button>
                  )}

                  {/* Tags: SEM RESPOSTA + Etapa do link */}

                  {(noResponse || step > 0) && (
                    <div className="mt-auto flex flex-wrap items-center gap-1 pt-0.5">
                      {noResponse && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 text-red-300 border border-red-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                          <MessageSquareOff className="h-2.5 w-2.5" />
                          Sem resposta
                        </span>
                      )}
                      {step > 0 && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                            paidCard
                              ? "bg-primary/10 text-primary border border-primary/30"
                              : "bg-sky-400/15 text-sky-300 border border-sky-400/40",
                          )}
                        >
                          <LinkIcon className="h-2.5 w-2.5" />
                          Etapa {step}/3
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Chat de WhatsApp na instância da conversa */}
      {chatOrder?.whatsapp && (
        <WhatsAppChatDialog open={chatOpen} onOpenChange={setChatOpen} order={chatOrder} wide />
      )}

      {/* DM do Instagram (quando não há WhatsApp) */}
      {igHandle && <InstagramDMChat open={igOpen} onOpenChange={setIgOpen} username={igHandle} />}

      {/* Detalhes completos do pedido pago */}
      {detailsOrder && (
        <OrderDetailsDialog
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          orderId={detailsOrder.id}
          fallbackWhatsapp={detailsOrder.customer?.whatsapp}
          fallbackInstagram={detailsOrder.customer?.instagram_handle}
        />
      )}

      {/* Todos os pedidos de um cliente + unificação de envio */}
      {groupDialogOrders && (
        <EventCustomerOrdersDialog
          open={groupDialogOpen}
          onOpenChange={(v) => { setGroupDialogOpen(v); if (!v) setGroupDialogOrders(null); }}
          orders={groupDialogOrders}
          onChanged={refreshOrders}
        />
      )}
    </div>
  );
}

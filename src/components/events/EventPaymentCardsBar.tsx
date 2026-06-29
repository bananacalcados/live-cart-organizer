import { useMemo, useState } from "react";
import { Check, QrCode, Phone, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { DbOrder } from "@/types/database";
import { Order } from "@/types/order";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";
import { getOrderFinalValue } from "@/lib/orderTotal";
import { WhatsAppChatDialog } from "@/components/WhatsAppChatDialog";
import { InstagramDMChat } from "@/components/events/InstagramDMChat";

interface EventPaymentCardsBarProps {
  orders: DbOrder[];
  /** Mantido por compatibilidade — abrir pedido (não usado no clique principal). */
  onSelectOrder?: (order: DbOrder) => void;
}

type PayFilter = "awaiting" | "paid";

function formatPhone(phone?: string | null): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.length > 11 ? digits.slice(-11) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits;
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

  const { awaiting, paid } = useMemo(() => {
    const awaitingList: DbOrder[] = [];
    const paidList: DbOrder[] = [];
    for (const o of orders) {
      if (isOrderMarkedPaid(o)) {
        paidList.push(o);
      } else if (o.stage === "awaiting_payment") {
        awaitingList.push(o);
      }
    }
    const sortByDate = (a: DbOrder, b: DbOrder) =>
      new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    awaitingList.sort(sortByDate);
    paidList.sort(sortByDate);
    return { awaiting: awaitingList, paid: paidList };
  }, [orders]);

  const list = filter === "paid" ? paid : awaiting;

  return (
    <div className="sticky top-16 z-40 bg-background/95 backdrop-blur border-b border-border/40">
      <div className="container py-2">
        {/* Toggle Aguardando / Pagos */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setFilter("awaiting")}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
              filter === "awaiting"
                ? "bg-neutral-900 text-white"
                : "bg-neutral-900/10 text-neutral-900 dark:text-neutral-200 hover:bg-neutral-900/20",
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            Aguardando Pagamento
            <span className="bg-background/20 px-1.5 py-0.5 rounded-full text-[10px]">{awaiting.length}</span>
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
        </div>

        {/* Cards */}
        {list.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2 px-1">
            {filter === "paid"
              ? "Nenhum pagamento concluído neste evento ainda."
              : "Nenhum pedido aguardando pagamento neste evento."}
          </div>
        ) : (
          <div className="flex items-stretch gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {list.map((order) => {
              const paidCard = filter === "paid";
              const name = order.customer?.instagram_handle?.trim() || "Sem nome";
              const phone = formatPhone(order.customer?.whatsapp);
              const value = getOrderFinalValue(order);
              return (
                <button
                  key={order.id}
                  onClick={() => handleCardClick(order)}
                  title="Abrir conversa"
                  className={cn(
                    "group flex flex-col gap-1 min-w-[200px] max-w-[240px] px-3 py-2 rounded-lg border text-left transition-colors shrink-0",
                    paidCard
                      ? "bg-stage-paid/10 border-stage-paid/40 hover:bg-stage-paid/20"
                      : "bg-neutral-900 text-white border-neutral-700 hover:bg-neutral-800",
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full shrink-0",
                        paidCard ? "bg-stage-paid/25 text-stage-paid" : "bg-white/15 text-white",
                      )}
                    >
                      {paidCard ? <Check className="h-3 w-3" /> : <QrCode className="h-3 w-3" />}
                    </span>
                    <span className={cn("truncate text-xs font-semibold", !paidCard && "text-white")}>@{name}</span>
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
                      paidCard ? "text-stage-paid" : "text-white",
                    )}
                  >
                    {paidCard ? "PAGO • " : "Aguardando • "}R$ {value.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Chat de WhatsApp na instância da conversa */}
      {chatOrder?.whatsapp && (
        <WhatsAppChatDialog open={chatOpen} onOpenChange={setChatOpen} order={chatOrder} />
      )}

      {/* DM do Instagram (quando não há WhatsApp) */}
      {igHandle && <InstagramDMChat open={igOpen} onOpenChange={setIgOpen} username={igHandle} />}
    </div>
  );
}

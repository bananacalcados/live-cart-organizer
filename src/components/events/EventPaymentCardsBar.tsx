import { useMemo, useState } from "react";
import { Check, QrCode, Phone, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { DbOrder } from "@/types/database";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";
import { getOrderFinalValue } from "@/lib/orderTotal";

interface EventPaymentCardsBarProps {
  orders: DbOrder[];
  onSelectOrder: (order: DbOrder) => void;
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

/**
 * Barra de cards de pagamento dos pedidos DESTE evento.
 * Substitui a barra de filtros (Todos / Não Pagos / etc) dentro do evento.
 *
 * - "Aguardando": pedidos em aguardando pagamento (não pagos).
 * - "Pagos": pedidos com pagamento confirmado.
 * Mostra @ / nome do cliente, telefone, valor da compra e status.
 * Só lista pedidos do evento atual (os `orders` já vêm escopados pelo evento).
 */
export function EventPaymentCardsBar({ orders, onSelectOrder }: EventPaymentCardsBarProps) {
  const [filter, setFilter] = useState<PayFilter>("awaiting");

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
                ? "bg-stage-awaiting text-white"
                : "bg-stage-awaiting/10 text-stage-awaiting hover:bg-stage-awaiting/20",
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
                  onClick={() => onSelectOrder(order)}
                  title="Abrir pedido"
                  className={cn(
                    "group flex flex-col gap-1 min-w-[200px] max-w-[240px] px-3 py-2 rounded-lg border text-left transition-colors shrink-0",
                    paidCard
                      ? "bg-stage-paid/10 border-stage-paid/40 hover:bg-stage-paid/20"
                      : "bg-stage-awaiting/10 border-stage-awaiting/40 hover:bg-stage-awaiting/20",
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full shrink-0",
                        paidCard ? "bg-stage-paid/25 text-stage-paid" : "bg-stage-awaiting/25 text-stage-awaiting",
                      )}
                    >
                      {paidCard ? <Check className="h-3 w-3" /> : <QrCode className="h-3 w-3" />}
                    </span>
                    <span className="truncate text-xs font-semibold">@{name}</span>
                  </div>
                  {phone && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                      <Phone className="h-3 w-3 shrink-0" />
                      {phone}
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-[12px] font-bold",
                      paidCard ? "text-stage-paid" : "text-stage-awaiting",
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
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, PartyPopper, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";

interface EventPaymentNotificationProps {
  /** Evento atualmente aberto. O modal SÓ aparece para pagamentos deste evento. */
  eventId: string | null;
}

interface PaidInfo {
  orderId: string;
  customerName: string;
  amount?: number | null;
}

/**
 * Escuta em tempo real os pedidos do evento atual e exibe um modal de
 * confirmação quando um pedido é pago (PIX ou cartão, qualquer gateway).
 * O modal é estritamente isolado por evento: a subscription filtra por
 * event_id, então pagamentos de outros eventos nunca disparam aqui.
 */
export function EventPaymentNotification({ eventId }: EventPaymentNotificationProps) {
  const [paidInfo, setPaidInfo] = useState<PaidInfo | null>(null);
  const knownPaidRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!eventId) return;

    let active = true;
    knownPaidRef.current = new Set();

    // Inicializa o conjunto de pedidos já pagos para não notificar pagamentos antigos
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, is_paid, paid_externally, stage")
        .eq("event_id", eventId);
      if (!active || !data) return;
      data.forEach((o: any) => {
        if (isOrderMarkedPaid(o)) knownPaidRef.current.add(o.id);
      });
    })();

    const resolveCustomerName = async (order: any): Promise<string> => {
      try {
        if (order?.customer_id) {
          const { data: cust } = await supabase
            .from("customers")
            .select("instagram_handle, whatsapp, name")
            .eq("id", order.customer_id)
            .maybeSingle();
          if (cust?.instagram_handle) {
            return cust.instagram_handle.startsWith("@") ? cust.instagram_handle : `@${cust.instagram_handle}`;
          }
          if ((cust as any)?.name) return (cust as any).name;
          if (cust?.whatsapp) return cust.whatsapp;
        }
      } catch {
        /* noop */
      }
      return "Cliente";
    };

    const handleUpdate = async (newRow: any) => {
      if (!newRow || newRow.event_id !== eventId) return;
      const isPaid = isOrderMarkedPaid(newRow);
      if (!isPaid) return;
      if (knownPaidRef.current.has(newRow.id)) return;
      knownPaidRef.current.add(newRow.id);

      const customerName = await resolveCustomerName(newRow);
      if (!active) return;
      setPaidInfo({
        orderId: newRow.id,
        customerName,
        amount: newRow.amount_paid ?? newRow.paid_amount ?? null,
      });
    };

    const channel = supabase
      .channel(`event-payments-${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `event_id=eq.${eventId}` },
        (payload) => handleUpdate(payload.new),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `event_id=eq.${eventId}` },
        (payload) => handleUpdate(payload.new),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  return (
    <Dialog open={!!paidInfo} onOpenChange={(open) => !open && setPaidInfo(null)}>
      <DialogContent className="max-w-sm text-center">
        <DialogHeader>
          <DialogTitle className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-green-500/30" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15">
                <CheckCircle2 className="h-9 w-9 text-green-600" />
              </div>
            </div>
            <span className="flex items-center gap-2 text-lg">
              <PartyPopper className="h-5 w-5 text-amber-500" />
              Pagamento confirmado!
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-base">
            <span className="font-bold">{paidInfo?.customerName}</span> realizou o pagamento.
          </p>
          {paidInfo?.amount ? (
            <p className="text-sm text-muted-foreground">
              Valor: <span className="font-semibold text-foreground">R$ {Number(paidInfo.amount).toFixed(2)}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">O pedido foi movido para a coluna PAGO.</p>
        </div>
        <Button onClick={() => setPaidInfo(null)} className="w-full gap-2">
          <X className="h-4 w-4" />
          Fechar
        </Button>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Layers,
  MapPin,
  MessageCircle,
  ClipboardList,
  Link2,
  Link2Off,
  AlertTriangle,
  Package,
  Check,
} from "lucide-react";
import { DbOrder } from "@/types/database";
import { Order } from "@/types/order";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { getOrderFinalValue } from "@/lib/orderTotal";
import { OrderRegLite, addressKey } from "@/lib/customerOrderGrouping";
import { OrderDetailsDialog } from "@/components/OrderDetailsDialog";
import { WhatsAppChatDialog } from "@/components/WhatsAppChatDialog";
import { InstagramDMChat } from "@/components/events/InstagramDMChat";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface EventCustomerOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Todos os pedidos PAGOS deste cliente neste evento. */
  orders: DbOrder[];
  /** Chamado após unificar/desfazer para recarregar a lista. */
  onChanged?: () => void;
}

function dbOrderToLegacy(dbOrder: DbOrder): Order {
  const handle = dbOrder.customer?.instagram_handle?.trim()
    ? dbOrder.customer.instagram_handle.startsWith("@")
      ? dbOrder.customer.instagram_handle
      : `@${dbOrder.customer.instagram_handle}`
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
  } as Order;
}

const fmtMoney = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function EventCustomerOrdersDialog({
  open,
  onOpenChange,
  orders,
  onChanged,
}: EventCustomerOrdersDialogProps) {
  const currentUserId = useCurrentUserId();
  const [regs, setRegs] = useState<Record<string, OrderRegLite>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [chatOrder, setChatOrder] = useState<Order | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [igHandle, setIgHandle] = useState<string | null>(null);
  const [igOpen, setIgOpen] = useState(false);

  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);

  useEffect(() => {
    if (!open || orderIds.length === 0) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("customer_registrations")
          .select(
            "order_id, full_name, cpf, whatsapp, cep, address, address_number, complement, neighborhood, city, state",
          )
          .in("order_id", orderIds);
        const map: Record<string, OrderRegLite> = {};
        for (const r of (data || []) as OrderRegLite[]) {
          if (r.order_id) map[r.order_id] = r;
        }
        setRegs(map);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, orderIds]);

  const customerName =
    orders[0]?.customer?.instagram_handle?.trim() ||
    regs[orders[0]?.id]?.full_name ||
    "Cliente";

  const total = useMemo(
    () => orders.reduce((s, o) => s + getOrderFinalValue(o), 0),
    [orders],
  );

  const anyMerged = orders.some((o) => o.merged_into_order_id);
  const isUnified = anyMerged;

  // Endereços iguais? Só permite unificar se todos tiverem o mesmo endereço válido.
  const addrKeys = orders.map((o) => addressKey(regs[o.id]));
  const missingAddress = addrKeys.some((k) => k === null);
  const sameAddress = !missingAddress && addrKeys.every((k) => k === addrKeys[0]);
  const canUnify = orders.length >= 2 && sameAddress && !isUnified;

  const handleUnify = async () => {
    if (!canUnify) return;
    setSaving(true);
    try {
      // Mestre = pedido pago mais antigo.
      const sorted = [...orders].sort(
        (a, b) =>
          new Date(a.paid_at || a.created_at).getTime() -
          new Date(b.paid_at || b.created_at).getTime(),
      );
      const master = sorted[0];
      const children = sorted.slice(1).map((o) => o.id);
      const { error } = await supabase
        .from("orders")
        .update({
          merged_into_order_id: master.id,
          merged_at: new Date().toISOString(),
          merged_by: currentUserId || null,
        } as never)
        .in("id", children);
      if (error) throw error;
      toast.success("Pedidos unificados — enviar em 1 pacote só.");
      onChanged?.();
      onOpenChange(false);
    } catch (e) {
      console.error("[Unify] error:", e);
      toast.error("Erro ao unificar pedidos.");
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          merged_into_order_id: null,
          merged_at: null,
          merged_by: null,
        } as never)
        .in("id", orderIds);
      if (error) throw error;
      toast.success("Unificação desfeita.");
      onChanged?.();
      onOpenChange(false);
    } catch (e) {
      console.error("[Undo unify] error:", e);
      toast.error("Erro ao desfazer unificação.");
    } finally {
      setSaving(false);
    }
  };

  const openChat = (order: DbOrder) => {
    const phone = order.customer?.whatsapp?.replace(/\D/g, "");
    if (phone) {
      setChatOrder(dbOrderToLegacy(order));
      setChatOpen(true);
      return;
    }
    const handle = order.customer?.instagram_handle?.replace(/^@/, "").trim();
    if (handle) {
      setIgHandle(handle);
      setIgOpen(true);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Pedidos de @{customerName}
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {orders.length} pedidos pagos neste evento
                </span>
                <span className="text-base font-bold text-primary">{fmtMoney(total)}</span>
              </div>

              {isUnified && (
                <div className="flex items-center gap-2 rounded-lg border border-stage-paid/40 bg-stage-paid/10 px-3 py-2 text-stage-paid">
                  <Check className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-semibold">
                    Pedidos unificados — devem ser enviados juntos, em 1 pacote.
                  </span>
                </div>
              )}

              {/* Lista de pedidos */}
              <div className="space-y-2">
                {orders.map((o) => {
                  const reg = regs[o.id];
                  const isMaster = isUnified && !o.merged_into_order_id;
                  const isChild = !!o.merged_into_order_id;
                  const productCount = (o.products || []).reduce(
                    (s, p: any) => s + (Number(p.quantity) || 1),
                    0,
                  );
                  const addr = reg
                    ? `${reg.address || "?"}, ${reg.address_number || "s/n"} — ${reg.city || "?"}/${reg.state || "?"}`
                    : "Endereço não informado";
                  return (
                    <div
                      key={o.id}
                      className={cn(
                        "rounded-lg border p-3",
                        isMaster && "border-stage-paid/50 bg-stage-paid/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-semibold">
                            {fmtMoney(getOrderFinalValue(o))}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            · {productCount} {productCount === 1 ? "item" : "itens"}
                          </span>
                          {isMaster && (
                            <Badge variant="secondary" className="text-[9px]">Principal</Badge>
                          )}
                          {isChild && (
                            <Badge variant="outline" className="text-[9px]">Unificado</Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {format(new Date(o.paid_at || o.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="break-words">{addr}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailsId(o.id)}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted transition-colors"
                        >
                          <ClipboardList className="h-3 w-3" /> Ver pedido
                        </button>
                        <button
                          type="button"
                          onClick={() => openChat(o)}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted transition-colors"
                        >
                          <MessageCircle className="h-3 w-3" /> Conversa
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Aviso de endereços diferentes */}
              {!isUnified && orders.length >= 2 && !sameAddress && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="text-xs">
                    {missingAddress
                      ? "Algum pedido está sem endereço de entrega definido. Não é possível unificar."
                      : "Os endereços de entrega são diferentes. Não faz sentido unificar — envie separadamente."}
                  </span>
                </div>
              )}

              {/* Ações */}
              <div className="pt-1">
                {isUnified ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleUndo}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />}
                    Desfazer unificação
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canUnify || saving}
                    onClick={handleUnify}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    Unificar em 1 envio
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {detailsId && (
        <OrderDetailsDialog
          open={!!detailsId}
          onOpenChange={(v) => !v && setDetailsId(null)}
          orderId={detailsId}
        />
      )}
      {chatOrder?.whatsapp && (
        <WhatsAppChatDialog open={chatOpen} onOpenChange={setChatOpen} order={chatOrder} wide />
      )}
      {igHandle && <InstagramDMChat open={igOpen} onOpenChange={setIgOpen} username={igHandle} />}
    </>
  );
}

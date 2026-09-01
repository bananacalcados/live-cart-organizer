import { useMemo, useState } from "react";
import { DbOrder } from "@/types/database";
import { Order, OrderStage, Stage, STAGES } from "@/types/order";
import { LiveWhatsAppQueue, LiveConversation } from "./LiveWhatsAppQueue";
import { LiveOrdersColumn } from "./LiveOrdersColumn";
import { EventLiveCommentsPanel } from "./EventLiveCommentsPanel";
import { PresenterTeamChat } from "./PresenterTeamChat";
import { WhatsAppChat } from "@/components/WhatsAppChat";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquare, Plus, Users } from "lucide-react";

interface LiveAttendanceCenterProps {
  eventId: string;
  event: any;
  orders: DbOrder[];
  stages?: Stage[];
  onEditOrder: (order: DbOrder) => void;
}

const suffix8 = (phone?: string | null) => {
  const digits = (phone || "").replace(/\D/g, "");
  return digits ? digits.slice(-8) : "";
};

const dbOrderToOrder = (o: DbOrder): Order => ({
  id: o.id,
  instagramHandle: o.customer?.instagram_handle || "",
  whatsapp: o.customer?.whatsapp || "",
  cartLink: (o as any).cart_link || undefined,
  products: ((o.products || []) as any[]).map((p) => ({
    id: p.id,
    shopifyId: p.shopify_id || p.shopifyId || "",
    sku: p.sku,
    title: p.title,
    variant: p.variant,
    price: Number(p.price) || 0,
    quantity: Number(p.quantity) || 1,
    image: p.image,
  })),
  stage: o.stage as OrderStage,
  notes: (o as any).notes || undefined,
  createdAt: new Date(o.created_at),
  updatedAt: new Date(o.updated_at),
});

/** Central de Atendimento da Live: fila do WhatsApp + chat + pedidos verticais. */
export function LiveAttendanceCenter({
  eventId,
  event,
  orders,
  stages = STAGES,
  onEditOrder,
}: LiveAttendanceCenterProps) {
  const [selected, setSelected] = useState<LiveConversation | null>(null);
  const [sideTab, setSideTab] = useState<"comments" | "team">("comments");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionsConv, setActionsConv] = useState<LiveConversation | null>(null);
  const [prefill, setPrefill] = useState<{ phone?: string; name?: string }>({});


  const liveStartedAt: string | null =
    event?.live_broadcast_started_at || event?.start_date || null;

  const instanceIds: string[] = useMemo(() => {
    const id = event?.whatsapp_number_id;
    return id ? [id] : [];
  }, [event?.whatsapp_number_id]);

  const selectedOrder = useMemo(() => {
    if (!selected) return null;
    const key = suffix8(selected.phone);
    return orders.find((o) => suffix8(o.customer?.whatsapp) === key) || null;
  }, [selected, orders]);

  const chatOrder: Order | null = useMemo(() => {
    if (!selected) return null;
    if (selectedOrder) return dbOrderToOrder(selectedOrder);
    return {
      id: `live-conv-${selected.phone}`,
      instagramHandle: selected.name || "",
      whatsapp: selected.phone,
      products: [],
      stage: "pre_sale" as OrderStage,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }, [selected, selectedOrder]);

  const openCreateOrder = (conv: LiveConversation) => {
    setPrefill({ phone: conv.phone, name: conv.name });
    setDialogOpen(true);
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[600px] gap-3 px-3 pb-3">
      {/* Coluna 1 — fila */}
      <div className="hidden w-[280px] shrink-0 lg:block">
        <LiveWhatsAppQueue
          eventId={eventId}
          liveStartedAt={liveStartedAt}
          eventPeriodStart={event?.start_date || event?.created_at || null}
          eventPeriodEnd={event?.end_date || null}
          orders={orders}
          selectedKey={selected ? `${selected.phone}::${selected.whatsappNumberId || ""}` : null}
          onSelect={(c) => setSelected(c)}
          onCreateOrder={openCreateOrder}
          onQuickActions={(c) => {
            setSelected(c);
            setActionsConv(c);
          }}
          defaultInstanceId={instanceIds[0] || null}
        />
      </div>



      {/* Coluna 2 — chat */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        {chatOrder && selected ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {selected.name || selected.phone}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {selected.phone}
                  {selectedOrder ? ` · pedido #${String(selectedOrder.id).slice(0, 6)}` : " · sem pedido nesta live"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1"
                  onClick={() => setActionsConv(selected)}
                >
                  <Zap className="h-3.5 w-3.5" /> Ações
                </Button>
                {selectedOrder ? (
                  <Button size="sm" variant="outline" onClick={() => onEditOrder(selectedOrder)}>
                    Abrir pedido
                  </Button>
                ) : (
                  <Button size="sm" className="gap-1 font-bold" onClick={() => openCreateOrder(selected)}>
                    <Plus className="h-3.5 w-3.5" /> Criar pedido na live
                  </Button>
                )}
              </div>

            </div>
            <div className="min-h-0 flex-1">
              <WhatsAppChat
                key={`${selected.phone}::${selectedOrder?.id || "noorder"}`}
                order={chatOrder}
                orderless={!selectedOrder}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageSquare className="h-8 w-8 opacity-40" />
            <p className="text-sm">Selecione uma conversa da fila para atender</p>
          </div>
        )}
      </div>

      {/* Coluna 3 — pedidos vertical (telas largas) */}
      <div className="hidden w-[300px] shrink-0 flex-col 2xl:flex">
        <LiveOrdersColumn orders={orders} stages={stages} onEditOrder={onEditOrder} />
      </div>

      {/* Coluna 4 — comentários da live (sempre visível) */}
      <div className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">

        <div className="flex gap-1 border-b border-border px-2 py-2">
          <button
            type="button"
            onClick={() => setSideTab("comments")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
              sideTab === "comments"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            Comentários da Live
          </button>
          <button
            type="button"
            onClick={() => setSideTab("team")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
              sideTab === "team"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="h-3 w-3" /> Chat da equipe
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {sideTab === "comments" ? (
            <EventLiveCommentsPanel eventId={eventId} />
          ) : (
            <PresenterTeamChat eventId={eventId} />
          )}
        </div>
      </div>

      {/* Telas médias: pedidos ao lado do chat */}
      <div className="hidden w-[280px] shrink-0 flex-col xl:flex 2xl:hidden">
        <LiveOrdersColumn orders={orders} stages={stages} onEditOrder={onEditOrder} />
      </div>



      <OrderDialogDb
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        prefillWhatsapp={prefill.phone}
        prefillName={prefill.name}
      />
    </div>
  );
}

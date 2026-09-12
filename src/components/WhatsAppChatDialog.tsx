import { useEffect, useRef, useState } from "react";
import type { PixSendChannel } from "@/lib/pix/sendPixMessages";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { WhatsAppChat } from "./WhatsAppChat";
import { Order } from "@/types/order";
import { OrderDetailsDialog } from "./OrderDetailsDialog";
import { CreateSupportTicketDialog } from "./CreateSupportTicketDialog";
import { EventCrossellDialog } from "./events/EventCrossellDialog";
import { IdCard, ClipboardList, Headphones, Images, Gift, ShoppingBag, X, History } from "lucide-react";
import { CustomerFichaPanel } from "./CustomerFichaDialog";
import { OrderGiftPanel } from "./events/OrderGiftPanel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DbOrder } from "@/types/database";
import { OrderDialogDb } from "./OrderDialogDb";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { LiveCustomerHistoryPanel } from "./events/LiveCustomerHistoryPanel";

type LivePanel = "ficha" | "historico" | "details" | "edit" | "crossell" | "gift" | "support" | null;

interface WhatsAppChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
  /** Wider/taller layout with a vertical sidebar of quick actions (Events module). */
  wide?: boolean;
  /** Show the vertical action sidebar. Defaults to `wide`. */
  showSidebar?: boolean;
}

interface SidebarButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  tone?: "default" | "accent";
  asChild?: boolean;
  children?: React.ReactNode;
}

function SidebarButton({ icon: Icon, label, onClick, tone = "default" }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex w-full flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-[10px] font-medium transition-colors",
        tone === "accent"
          ? "bg-accent/10 text-accent hover:bg-accent/20"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="leading-tight">{label}</span>
    </button>
  );
}

export function WhatsAppChatDialog({
  open,
  onOpenChange,
  order,
  wide = false,
  showSidebar,
}: WhatsAppChatDialogProps) {
  const withSidebar = showSidebar ?? wide;
  const [activePanel, setActivePanel] = useState<LivePanel>("ficha");
  const pixChannelRef = useRef<PixSendChannel | null>(null);
  const dbOrder = useDbOrderStore((state) => state.orders.find((item) => item.id === order.id) || null);

  const fichaOrder = dbOrder || ({
    id: order.id,
    event_id: "",
    customer_id: "",
    products: order.products || [],
    stage: order.stage || "cart",
    is_paid: false,
    has_unread_messages: false,
    created_at: order.createdAt?.toISOString?.() || new Date().toISOString(),
    updated_at: order.updatedAt?.toISOString?.() || new Date().toISOString(),
    customer: {
      instagram_handle: order.instagramHandle || "",
      whatsapp: order.whatsapp || "",
    },
  } as unknown as DbOrder);

  useEffect(() => {
    if (open) setActivePanel("historico");
  }, [open, order.id]);

  const togglePanel = (panel: Exclude<LivePanel, null>) => setActivePanel((current) => current === panel ? null : panel);
  const panelOpen = activePanel !== null;

  const renderPanel = () => {
    const close = () => setActivePanel(null);
    if (activePanel === "historico") return <LiveCustomerHistoryPanel order={fichaOrder} fallbackPhone={order.whatsapp} fallbackInstagram={order.instagramHandle} />;
    if (activePanel === "ficha") return <CustomerFichaPanel order={fichaOrder} onClose={close} getPixChannel={() => pixChannelRef.current} />;
    if (activePanel === "gift") return <OrderGiftPanel orderId={order.id} customerLabel={order.instagramHandle || order.whatsapp || undefined} onClose={close} />;
    if (activePanel === "details") return <OrderDetailsDialog embedded open onOpenChange={(value) => !value && close()} orderId={order.id} fallbackWhatsapp={order.whatsapp} fallbackInstagram={order.instagramHandle} />;
    if (activePanel === "edit") return dbOrder ? <OrderDialogDb embedded open onOpenChange={(value) => !value && close()} editingOrder={dbOrder} eventId={dbOrder.event_id} /> : <div className="p-4 text-sm text-muted-foreground">O pedido ainda não está disponível para edição.</div>;
    if (activePanel === "crossell" && order.whatsapp) return <EventCrossellDialog embedded open onOpenChange={(value) => !value && close()} phone={order.whatsapp} customerName={order.instagramHandle || undefined} order={order} />;
    if (activePanel === "support") return <CreateSupportTicketDialog embedded open onOpenChange={(value) => !value && close()} phone={order.whatsapp} customerName={order.instagramHandle || undefined} onCreated={close} />;
    return null;
  };

  // Com uma ferramenta aberta ao lado, o modal expande para acomodar chat + painel.
  const dialogClass = wide
    ? panelOpen
      ? "max-w-[1400px] sm:max-w-[1400px] w-[98vw] h-[90vh] p-0 gap-0 overflow-hidden border bg-background shadow-2xl block [&>button.absolute]:hidden"
      : "max-w-5xl sm:max-w-5xl w-[95vw] h-[85vh] p-0 gap-0 overflow-hidden border bg-background shadow-2xl block"
    : "max-w-md sm:max-w-md w-[95vw] h-[600px] p-0 gap-0 overflow-hidden border bg-background shadow-2xl block";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={dialogClass}>
          <div className="flex h-full w-full bg-background">
            {withSidebar && (
              <aside className="flex w-16 shrink-0 flex-col items-stretch gap-1 border-r border-border/50 bg-card px-1.5 py-3">
                <SidebarButton
                  icon={IdCard}
                  label="Ficha"
                   tone={activePanel === "ficha" ? "accent" : "default"}
                   onClick={() => togglePanel("ficha")}
                />
                <SidebarButton
                  icon={ClipboardList}
                  label="Pedido"
                   tone={activePanel === "details" ? "accent" : "default"}
                   onClick={() => togglePanel("details")}
                />
                <SidebarButton icon={ShoppingBag} label="Editar" tone={activePanel === "edit" ? "accent" : "default"} onClick={() => togglePanel("edit")} />
                <SidebarButton
                  icon={Images}
                  label="Crossell"
                   tone={activePanel === "crossell" ? "accent" : "default"}
                  onClick={() => {
                    if (!order.whatsapp) return;
                     togglePanel("crossell");
                  }}
                />
                <SidebarButton
                  icon={Gift}
                  label="Brinde"
                   tone={activePanel === "gift" ? "accent" : "default"}
                   onClick={() => togglePanel("gift")}
                />
                <SidebarButton icon={Headphones} label="Suporte" tone={activePanel === "support" ? "accent" : "default"} onClick={() => togglePanel("support")} />
              </aside>
            )}
            <div className="min-w-0 flex-1 h-full">
              <WhatsAppChat
                order={order}
                onBack={() => onOpenChange(false)}
                 onOpenFicha={withSidebar ? () => togglePanel("ficha") : undefined}
                 onOpenDetails={withSidebar ? () => togglePanel("details") : undefined}
                 onOpenEditOrder={withSidebar ? () => togglePanel("edit") : undefined}
                 onOpenSupport={withSidebar ? () => togglePanel("support") : undefined}
                pixChannelRef={pixChannelRef}
              />
            </div>
             {withSidebar && panelOpen && <div className="relative hidden sm:block w-[480px] shrink-0 h-full border-l border-border/60 bg-card">
               {activePanel !== "ficha" && activePanel !== "gift" && <Button variant="ghost" size="icon" className="absolute right-2 top-2 z-20" onClick={() => setActivePanel(null)} aria-label="Fechar painel"><X className="h-4 w-4" /></Button>}
               {renderPanel()}
             </div>}
          </div>
          {/* Mobile: ficha vira sobreposição de tela cheia dentro do modal */}
           {withSidebar && panelOpen && <div className="absolute inset-0 z-10 sm:hidden bg-card">
             {activePanel !== "ficha" && activePanel !== "gift" && <Button variant="ghost" size="icon" className="absolute right-2 top-2 z-20" onClick={() => setActivePanel(null)} aria-label="Fechar painel"><X className="h-4 w-4" /></Button>}
             {renderPanel()}
           </div>}
        </DialogContent>
      </Dialog>

    </>
  );
}

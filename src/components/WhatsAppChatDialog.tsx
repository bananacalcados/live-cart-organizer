import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { WhatsAppChat } from "./WhatsAppChat";
import { Order } from "@/types/order";
import { CustomerFichaDialog } from "./CustomerFichaDialog";
import { OrderDetailsDialog } from "./OrderDetailsDialog";
import { CreateSupportTicketDialog } from "./CreateSupportTicketDialog";
import { EventCrossellDialog } from "./events/EventCrossellDialog";
import { IdCard, ClipboardList, Headphones, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DbOrder } from "@/types/database";

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
  const [fichaOpen, setFichaOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [crossellOpen, setCrossellOpen] = useState(false);

  const fichaOrder = {
    id: order.id,
    customer: {
      instagram_handle: order.instagramHandle || "",
      whatsapp: order.whatsapp || "",
    },
  } as unknown as DbOrder;

  const dialogClass = wide
    ? "max-w-5xl sm:max-w-5xl w-[95vw] h-[85vh] p-0 gap-0 overflow-hidden border bg-background shadow-2xl block"
    : "max-w-md sm:max-w-md w-[95vw] h-[600px] p-0 gap-0 overflow-hidden border bg-background shadow-2xl block";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={dialogClass}>
          <div className="flex h-full w-full bg-background">
            {withSidebar && (
              <aside className="flex w-16 shrink-0 flex-col items-stretch gap-1 border-r border-border/50 bg-card px-1.5 py-3">
                <SidebarButton icon={IdCard} label="Ficha" onClick={() => setFichaOpen(true)} />
                <SidebarButton
                  icon={ClipboardList}
                  label="Pedido"
                  onClick={() => setDetailsOpen(true)}
                />
                <SidebarButton
                  icon={Images}
                  label="Crossell"
                  tone="accent"
                  onClick={() => {
                    if (!order.whatsapp) return;
                    setCrossellOpen(true);
                  }}
                />
                <CreateSupportTicketDialog
                  phone={order.whatsapp}
                  customerName={order.instagramHandle || undefined}
                  trigger={
                    <button
                      type="button"
                      title="Suporte"
                      className="flex w-full flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Headphones className="h-5 w-5" />
                      <span className="leading-tight">Suporte</span>
                    </button>
                  }
                />
              </aside>
            )}
            <div className="min-w-0 flex-1 h-full">
              <WhatsAppChat order={order} onBack={() => onOpenChange(false)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {withSidebar && (
        <>
          <CustomerFichaDialog open={fichaOpen} onOpenChange={setFichaOpen} order={fichaOrder} />
          <OrderDetailsDialog
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            orderId={order.id}
            fallbackWhatsapp={order.whatsapp}
            fallbackInstagram={order.instagramHandle}
          />
          {order.whatsapp && (
            <EventCrossellDialog
              open={crossellOpen}
              onOpenChange={setCrossellOpen}
              phone={order.whatsapp}
              customerName={order.instagramHandle || undefined}
            />
          )}
        </>
      )}
    </>
  );
}

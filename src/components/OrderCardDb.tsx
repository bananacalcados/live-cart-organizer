import { useState, useEffect } from "react";
import { Instagram, Phone, Package, Trash2, Edit2, MessageCircle, MessagesSquare, Gift, Truck, Percent, DollarSign, Wallet, ClipboardCopy, ExternalLink, UserCheck, ShoppingBag, Loader2, AlertTriangle } from "lucide-react";
import { DbOrder } from "@/types/database";
import { STAGES } from "@/types/order";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SendWhatsAppDialog } from "./SendWhatsAppDialog";
import { WhatsAppChatDialog } from "./WhatsAppChatDialog";
import { Order } from "@/types/order";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface OrderCardDbProps {
  order: DbOrder;
  onEdit: (order: DbOrder) => void;
  onDelete: (orderId: string) => void;
  isDragging?: boolean;
}

// Convert DbOrder to Order for dialog compatibility
const dbOrderToOrder = (dbOrder: DbOrder): Order => ({
  id: dbOrder.id,
  instagramHandle: dbOrder.customer?.instagram_handle || '',
  whatsapp: dbOrder.customer?.whatsapp,
  cartLink: dbOrder.cart_link,
  products: dbOrder.products,
  stage: dbOrder.stage as Order['stage'],
  notes: dbOrder.notes,
  createdAt: new Date(dbOrder.created_at),
  updatedAt: new Date(dbOrder.updated_at),
  hasUnreadMessages: dbOrder.has_unread_messages,
  lastCustomerMessageAt: dbOrder.last_customer_message_at ? new Date(dbOrder.last_customer_message_at) : undefined,
  lastSentMessageAt: dbOrder.last_sent_message_at ? new Date(dbOrder.last_sent_message_at) : undefined,
});

export function OrderCardDb({ order, onEdit, onDelete, isDragging }: OrderCardDbProps) {
  const [showWhatsAppDialog, setShowWhatsAppDialog] = useState(false);
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [hasRegistration, setHasRegistration] = useState(false);
  const [hasShopifyOrder, setHasShopifyOrder] = useState<boolean | null>(null);
  const [isCreatingShopifyOrder, setIsCreatingShopifyOrder] = useState(false);

  // Check if customer has existing registration data + Shopify order
  useEffect(() => {
    if (!order.customer_id) return;
    const checkRegistration = async () => {
      const { data } = await supabase
        .rpc('get_latest_registration_by_customer', { p_customer_id: order.customer_id })
        .maybeSingle();
      setHasRegistration(!!data);
      // Check if Shopify order was created for this order
      if (order.is_paid || order.paid_externally) {
        const { data: reg } = await supabase
          .from('customer_registrations')
          .select('shopify_draft_order_id')
          .eq('order_id', order.id)
          .maybeSingle();
        setHasShopifyOrder(!!reg?.shopify_draft_order_id);
      }
    };
    checkRegistration();
  }, [order.customer_id, order.id, order.is_paid, order.paid_externally]);

  const handleCreateShopifyOrder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCreatingShopifyOrder(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-create-order", {
        body: { orderId: order.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Pedido criado na Shopify! ${data?.shopifyOrderName || ""}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro ao criar pedido";
      toast.error(msg);
    } finally {
      setIsCreatingShopifyOrder(false);
    }
  };
  
  const stage = STAGES.find((s) => s.id === order.stage);
  const totalValue = order.products.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );
  const totalItems = order.products.reduce((sum, p) => sum + p.quantity, 0);

  const hasUnread = order.has_unread_messages;

  // Calculate discount
  const discountAmount = order.discount_type && order.discount_value
    ? order.discount_type === 'percentage'
      ? totalValue * (order.discount_value / 100)
      : order.discount_value
    : 0;
  
  const finalValue = Math.max(0, totalValue - discountAmount);

  // Convert for dialogs
  const orderForDialog = dbOrderToOrder(order);

  return (
    <div
      className={`order-card ${isDragging ? "dragging" : ""} ${
        hasUnread ? "ring-2 ring-stage-contacted bg-stage-contacted/10" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
            <Instagram className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">{order.customer?.instagram_handle}</p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(order.created_at), {
                addSuffix: true,
                locale: ptBR,
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(order);
            }}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(order.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Badges for Registration, Paid Externally, Gift, Free Shipping, Discount */}
      <div className="flex flex-wrap gap-1 mb-3">
        {(order.is_paid || order.paid_externally) && hasShopifyOrder === false && (
          <Badge variant="secondary" className="text-[10px] bg-destructive/20 text-destructive border-destructive/30 animate-pulse">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Sem Shopify
          </Badge>
        )}
        {hasRegistration && (
          <Badge variant="secondary" className="text-[10px] bg-stage-paid/20 text-stage-paid border-stage-paid/30">
            <UserCheck className="h-3 w-3 mr-1" />
            Dados Cadastrados
          </Badge>
        )}
        {order.paid_externally && (
          <Badge variant="secondary" className="text-[10px] bg-primary/20 text-primary border-primary/30">
            <Wallet className="h-3 w-3 mr-1" />
            Pago Externo
          </Badge>
        )}
        {order.has_gift && (
          <Badge variant="secondary" className="text-[10px] bg-accent/20 text-accent border-accent/30">
            <Gift className="h-3 w-3 mr-1" />
            Brinde
          </Badge>
        )}
        {order.free_shipping && (
          <Badge variant="secondary" className="text-[10px] bg-stage-paid/20 text-stage-paid border-stage-paid/30">
            <Truck className="h-3 w-3 mr-1" />
            Frete Grátis
          </Badge>
        )}
        {order.discount_value && order.discount_value > 0 && (
          <Badge variant="secondary" className="text-[10px] bg-stage-contacted/20 text-stage-contacted border-stage-contacted/30">
            {order.discount_type === 'percentage' ? (
              <>
                <Percent className="h-3 w-3 mr-1" />
                {order.discount_value}% off
              </>
            ) : (
              <>
                <DollarSign className="h-3 w-3 mr-1" />
                R${order.discount_value.toFixed(0)} off
              </>
            )}
          </Badge>
        )}
      </div>

      {order.customer?.whatsapp && (
        <div className="flex items-center gap-2 mb-3">
          <a
            href={`https://wa.me/${order.customer.whatsapp.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-stage-paid hover:underline flex-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Phone className="h-3 w-3" />
            {order.customer.whatsapp}
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-stage-paid hover:text-stage-paid/80 hover:bg-stage-paid/10"
            onClick={(e) => {
              e.stopPropagation();
              const phone = order.customer?.whatsapp?.replace(/\D/g, "") || "";
              const totalVal = order.products.reduce((s, p) => s + p.price * p.quantity, 0);
              const text = order.products.length > 0
                ? `Olá! 👋\n\nSeu pedido na Live Cart:\n\n${order.products.map(p => `• ${p.quantity}x ${p.title} - R$ ${(p.price * p.quantity).toFixed(2)}`).join("\n")}\n\n💰 Total: R$ ${totalVal.toFixed(2)}`
                : `Olá! 👋 Como posso ajudar?`;
              window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
            }}
            title="Abrir no WhatsApp Web"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-stage-paid hover:text-stage-paid/80 hover:bg-stage-paid/10"
            onClick={(e) => {
              e.stopPropagation();
              setShowWhatsAppDialog(true);
            }}
            title="Enviar mensagem via Z-API"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-stage-paid hover:text-stage-paid/80 hover:bg-stage-paid/10"
            onClick={(e) => {
              e.stopPropagation();
              setShowChatDialog(true);
            }}
            title="Abrir chat em tempo real"
          >
            <MessagesSquare className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {order.products.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Package className="h-3 w-3" />
            {totalItems} {totalItems === 1 ? "item" : "itens"}
          </div>
          <div className="space-y-1.5 max-h-24 overflow-y-auto">
            {order.products.slice(0, 3).map((product) => (
              <div
                key={product.id}
                className="flex items-center gap-2 text-xs bg-secondary/50 rounded-md p-1.5"
              >
                {product.image && (
                  <img
                    src={product.image}
                    alt={product.title}
                    className="w-8 h-8 rounded object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.title}</p>
                  <p className="text-muted-foreground">
                    {product.quantity}x R$ {product.price.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
            {order.products.length > 3 && (
              <p className="text-xs text-muted-foreground text-center">
                +{order.products.length - 3} mais
              </p>
            )}
          </div>
          <div className="pt-2 border-t border-border/50 space-y-1">
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="text-muted-foreground">R$ {totalValue.toFixed(2)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-stage-contacted">Desconto:</span>
                <span className="text-stage-contacted">-R$ {discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm font-medium">Total:</span>
              <span className="text-sm font-bold text-accent">
                R$ {finalValue.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-4 text-center text-xs text-muted-foreground bg-secondary/30 rounded-lg">
          Nenhum produto adicionado
        </div>
      )}

      {/* Registration link / Shopify order button */}
      {order.products.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {hasRegistration ? (
            <Button
              variant="default"
              size="sm"
              className="w-full text-xs gap-1"
              onClick={handleCreateShopifyOrder}
              disabled={isCreatingShopifyOrder}
            >
              {isCreatingShopifyOrder ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Criando...</>
              ) : (
                <><ShoppingBag className="h-3 w-3" /> Criar Pedido Shopify</>
              )}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                const url = `${window.location.origin}/register/${order.id}`;
                navigator.clipboard.writeText(url).then(
                  () => toast.success("Link de cadastro copiado!"),
                  () => {
                    window.prompt("Copie o link:", url);
                  }
                );
              }}
            >
              <ClipboardCopy className="h-3 w-3" />
              Copiar Link de Cadastro
            </Button>
          )}
        </div>
      )}

      {order.notes && (
        <p className="mt-2 text-xs text-muted-foreground italic line-clamp-2">
          "{order.notes}"
        </p>
      )}

      <SendWhatsAppDialog
        open={showWhatsAppDialog}
        onOpenChange={setShowWhatsAppDialog}
        order={orderForDialog}
      />

      {order.customer?.whatsapp && (
        <WhatsAppChatDialog
          open={showChatDialog}
          onOpenChange={setShowChatDialog}
          order={orderForDialog}
        />
      )}
    </div>
  );
}

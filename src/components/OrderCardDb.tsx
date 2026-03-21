import { useState, useEffect, useCallback } from "react";
import { Instagram, Phone, Package, Trash2, Edit2, MessageCircle, MessagesSquare, Gift, Truck, Percent, DollarSign, Wallet, ClipboardCopy, ExternalLink, UserCheck, ShoppingBag, Loader2, AlertTriangle, Store, CreditCard, CheckCircle2, Pencil, Bot } from "lucide-react";
import { DbOrder } from "@/types/database";
import { STAGES, getMissingFields } from "@/types/order";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SendWhatsAppDialog } from "./SendWhatsAppDialog";
import { WhatsAppChatDialog } from "./WhatsAppChatDialog";
import { SendToPOSDialog } from "./SendToPOSDialog";
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
const dbOrderToOrder = (dbOrder: DbOrder): Order => {
  const instagramHandle = dbOrder.customer?.instagram_handle?.trim()
    ? (dbOrder.customer.instagram_handle.startsWith('@') ? dbOrder.customer.instagram_handle : `@${dbOrder.customer.instagram_handle}`)
    : '';

  return {
    id: dbOrder.id,
    instagramHandle,
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
  };
};

export function OrderCardDb({ order, onEdit, onDelete, isDragging }: OrderCardDbProps) {
  const [showWhatsAppDialog, setShowWhatsAppDialog] = useState(false);
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [showPOSDialog, setShowPOSDialog] = useState(false);
  const [hasRegistration, setHasRegistration] = useState(false);
  const [hasShopifyOrder, setHasShopifyOrder] = useState<boolean | null>(null);
  const [shopifyOrderName, setShopifyOrderName] = useState<string | null>(null);
  const [isCreatingShopifyOrder, setIsCreatingShopifyOrder] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [liveMessages, setLiveMessages] = useState<string[]>([]);
  const [togglingFreeShipping, setTogglingFreeShipping] = useState(false);
  const [togglingAiPause, setTogglingAiPause] = useState(false);
  const { moveOrder: storeMove, updateOrder } = useDbOrderStore();

  const persistShopifyVerification = useCallback((verified: boolean, orderName: string | null) => {
    if (!order.event_id) return;

    try {
      const storageKey = `shopify-verify-${order.event_id}`;
      const cached = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      const next = Array.isArray(cached)
        ? cached.filter((entry: any) => entry?.orderId !== order.id)
        : [];

      next.push({
        orderId: order.id,
        hasShopify: verified,
        shopifyOrderName: orderName || undefined,
      });

      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch (error) {
      console.warn('Erro ao persistir verificação Shopify em cache:', error);
    }
  }, [order.event_id, order.id]);

  const applyShopifyVerification = useCallback((verified: boolean, orderName: string | null) => {
    setHasShopifyOrder(verified);
    setShopifyOrderName(orderName);
    persistShopifyVerification(verified, orderName);
  }, [persistShopifyVerification]);

  const refreshShopifyStatus = useCallback(async () => {
    if (!order.customer_id) return;

    const { data } = await supabase
      .rpc('get_latest_registration_by_customer', { p_customer_id: order.customer_id })
      .maybeSingle();

    setHasRegistration(!!data);

    if (data?.shopify_draft_order_id) {
      applyShopifyVerification(true, data.shopify_draft_order_name || null);
      return;
    }

    if (order.is_paid || order.paid_externally) {
      const phone = order.customer?.whatsapp?.replace(/\D/g, "") || "";

      if (phone.length >= 8) {
        const phoneSuffix = phone.slice(-8);
        const { data: expeditions } = await supabase
          .from("expedition_orders")
          .select("shopify_order_name, customer_phone")
          .or(`customer_phone.ilike.%${phoneSuffix}`)
          .limit(20);

        if (expeditions && expeditions.length > 0) {
          const crmVariantIds = new Set<string>();
          for (const p of order.products) {
            if (p.shopifyId) {
              const match = p.shopifyId.match(/ProductVariant\/(\d+)/);
              if (match) crmVariantIds.add(match[1]);
            }
          }

          if (crmVariantIds.size > 0) {
            applyShopifyVerification(true, expeditions[0].shopify_order_name || null);
            return;
          }

          applyShopifyVerification(true, expeditions[0].shopify_order_name || null);
          return;
        }
      }

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('shopify-verify-')) {
          try {
            const results = JSON.parse(sessionStorage.getItem(key) || '[]');
            const match = results.find((r: any) => r.orderId === order.id);
            if (match) {
              setHasShopifyOrder(!!match.hasShopify);
              setShopifyOrderName(match.shopifyOrderName || null);
              return;
            }
          } catch {}
        }
      }

      applyShopifyVerification(false, null);
      return;
    }

    setHasShopifyOrder(null);
    setShopifyOrderName(null);
  }, [applyShopifyVerification, order.customer?.whatsapp, order.customer_id, order.id, order.is_paid, order.paid_externally, order.products]);

  useEffect(() => {
    void refreshShopifyStatus();
  }, [refreshShopifyStatus]);

  useEffect(() => {
    const handleShopifyOrderCreated = (event: Event) => {
      const customEvent = event as CustomEvent<{ orderId?: string; shopifyOrderName?: string | null }>;
      if (customEvent.detail?.orderId !== order.id) return;
      applyShopifyVerification(true, customEvent.detail?.shopifyOrderName || null);
      window.setTimeout(() => {
        void refreshShopifyStatus();
      }, 1500);
    };

    window.addEventListener('shopify-order-created', handleShopifyOrderCreated as EventListener);
    return () => {
      window.removeEventListener('shopify-order-created', handleShopifyOrderCreated as EventListener);
    };
  }, [applyShopifyVerification, order.id, refreshShopifyStatus]);

  // Fetch live messages the customer sent (for awaiting_confirmation display)
  useEffect(() => {
    if (order.stage !== 'awaiting_confirmation' && order.stage !== 'incomplete_order') return;
    if (!order.customer?.whatsapp) return;
    const phone = order.customer.whatsapp.replace(/\D/g, '');
    if (!phone) return;
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('message')
        .eq('phone', phone)
        .eq('direction', 'incoming')
        .order('created_at', { ascending: false })
        .limit(5);
      if (data) setLiveMessages(data.map(m => m.message).filter(Boolean));
    };
    fetchMessages();
  }, [order.stage, order.customer?.whatsapp]);

  const handleConfirmOrder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirming(true);
    try {
      // 1. Generate payment link
      const paymentLink = `https://checkout.bananacalcados.com.br/checkout/order/${order.id}`;

      // Save link to order
      await supabase.from('orders').update({ cart_link: paymentLink }).eq('id', order.id);

      // 2. Move to "Novo Pedido"
      await storeMove(order.id, 'new');

      // 3. Fetch event's whatsapp_number_id to resolve Z-API instance
      let loja = 'centro';
      let zapiInstanceId = '';
      let zapiToken = '';
      let zapiClientToken = '';
      
      if (order.event_id) {
        const { data: eventData } = await supabase
          .from('events')
          .select('whatsapp_number_id')
          .eq('id', order.event_id)
          .single();
        
        if (eventData?.whatsapp_number_id) {
          const { data: whatsappData } = await supabase
            .from('whatsapp_numbers')
            .select('id, label, phone_display, zapi_instance_id, zapi_token, zapi_client_token')
            .eq('id', eventData.whatsapp_number_id)
            .single();
          
          if (whatsappData) {
            // Determine loja based on label
            const labelLower = (whatsappData.label || '').toLowerCase();
            if (labelLower.includes('pérola') || labelLower.includes('perola')) {
              loja = 'perola';
            } else {
              loja = 'centro';
            }
            zapiInstanceId = (whatsappData as any).zapi_instance_id || '';
            zapiToken = (whatsappData as any).zapi_token || '';
            zapiClientToken = (whatsappData as any).zapi_client_token || '';
          }
        }
      }

      // 4. Build webhook payload
      const firstProduct = order.products[0];
      const variantParts = firstProduct?.variant?.split('/').map(s => s.trim()) || [];
      const tamanho = variantParts[0] || '';
      const cor = variantParts.length > 1 ? variantParts[1] : '';

      const payload = {
        pedido_id: order.id,
        cliente_nome: order.customer?.instagram_handle || '',
        cliente_telefone: (() => {
          const raw = order.customer?.whatsapp || '';
          const digits = raw.replace(/\D/g, '');
          return digits.startsWith('55') ? digits : '55' + digits;
        })(),
        produto: order.products.map(p => `${p.quantity}x ${p.title}`).join(', '),
        tamanho,
        cor,
        valor_total: finalValue,
        link_pagamento: paymentLink,
        loja,
        whatsapp: {
          zapi_instance_id: zapiInstanceId,
          zapi_token: zapiToken,
          zapi_client_token: zapiClientToken,
        },
      };

      console.log('🚀 [WEBHOOK] Disparando webhook novo-pedido para pedido:', order.id);
      console.log('🚀 [WEBHOOK] Payload:', JSON.stringify(payload, null, 2));
      
      try {
        const webhookUrl = import.meta.env.VITE_AGENTE2_NOVO_PEDIDO || 'https://api.bananacalcados.com.br/webhook/novo-pedido';
        console.log('🚀 [WEBHOOK] URL:', webhookUrl);
        const webhookResp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        console.log('🚀 [WEBHOOK] Response status:', webhookResp.status);
        const webhookBody = await webhookResp.text();
        console.log('🚀 [WEBHOOK] Response body:', webhookBody);
      } catch (webhookErr) {
        console.error('🚀 [WEBHOOK] Fetch falhou (CORS/rede):', webhookErr);
      }

      toast.success('Pedido confirmado! Link de pagamento gerado e enviado ao Agente.');
    } catch {
      toast.error('Erro ao confirmar pedido');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCreateShopifyOrder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCreatingShopifyOrder(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-create-order", {
        body: { orderId: order.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const createdOrderName = data?.shopifyOrderName || null;
      applyShopifyVerification(true, createdOrderName);
      toast.success(`Pedido criado na Shopify! ${createdOrderName || ""}`);

      window.setTimeout(() => {
        void refreshShopifyStatus();
      }, 1500);
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
  
  // Missing fields for incomplete orders
  const missingFields = getMissingFields(order);
  const isIncomplete = missingFields.length > 0;

  // Auto-promote: if order is incomplete_order but all fields are filled, move to awaiting_confirmation
  useEffect(() => {
    if (order.stage === 'incomplete_order' && !isIncomplete) {
      storeMove(order.id, 'awaiting_confirmation');
    }
  }, [order.stage, isIncomplete, order.id, storeMove]);

  // Calculate discount
  const discountAmount = order.discount_type && order.discount_value
    ? order.discount_type === 'percentage'
      ? totalValue * (order.discount_value / 100)
      : order.discount_value
    : 0;
  
  const orderShippingCost = order.free_shipping ? 0 : Number(order.shipping_cost || 0);
  const finalValue = Math.max(0, totalValue - discountAmount + orderShippingCost);

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
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-sm">{order.customer?.instagram_handle}</p>
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-[11px] text-muted-foreground truncate font-mono">
                ID: {order.id}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await navigator.clipboard.writeText(order.id);
                    toast.success("ID do pedido copiado!");
                  } catch {
                    window.prompt("Copie o ID do pedido:", order.id);
                  }
                }}
                title="Copiar ID do pedido"
              >
                <ClipboardCopy className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(order.created_at), {
                addSuffix: true,
                locale: ptBR,
              })}
            </p>
          </div>
        </div>
      </div>

      {/* AI Paused indicator */}
      {order.ai_paused && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-destructive/10 border border-destructive/30 rounded-md">
          <Bot className="h-3 w-3 text-destructive" />
          <span className="text-[10px] font-medium text-destructive">IA Pausada</span>
        </div>
      )}

      {/* Missing fields badges for incomplete orders */}
      {order.stage === 'incomplete_order' && missingFields.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {missingFields.map((field) => (
            <Badge key={field} variant="outline" className="text-[10px] bg-stage-incomplete/10 text-stage-incomplete border-stage-incomplete/40">
              ⚠️ {field}
            </Badge>
          ))}
        </div>
      )}

      {/* Badges for Registration, Paid Externally, Gift, Free Shipping, Discount */}
      <div className="flex flex-wrap gap-1 mb-3">
        {(order.is_paid || order.paid_externally) && hasShopifyOrder === true && (
          <Badge variant="secondary" className="text-[10px] bg-stage-paid/20 text-stage-paid border-stage-paid/30">
            <ShoppingBag className="h-3 w-3 mr-1" />
            {shopifyOrderName ? `Shopify ${shopifyOrderName}` : 'Na Shopify'}
          </Badge>
        )}
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
        {/* Payment Gateway Badge */}
        {(order.is_paid || order.paid_externally) && (() => {
          const gateway = order.mercadopago_payment_id ? 'Mercado Pago'
            : order.pagarme_order_id ? 'Pagar.me'
            : order.appmax_order_id ? 'AppMax'
            : order.vindi_transaction_id ? 'Vindi'
            : null;
          if (!gateway) return null;
          return (
            <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground border-border">
              <CreditCard className="h-3 w-3 mr-1" />
              {gateway}
            </Badge>
          );
        })()}
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

      {/* Toggle Frete Grátis */}
      {!order.is_paid && !order.paid_externally && (
        <div className="mb-3">
          <Button
            variant={order.free_shipping ? "default" : "outline"}
            size="sm"
            className={`w-full text-xs gap-1.5 h-7 ${order.free_shipping ? 'bg-stage-paid hover:bg-stage-paid/90 text-white' : ''}`}
            disabled={togglingFreeShipping}
            onClick={async (e) => {
              e.stopPropagation();
              setTogglingFreeShipping(true);
              try {
                await updateOrder(order.id, { free_shipping: !order.free_shipping } as any);
                toast.success(order.free_shipping ? 'Frete grátis removido' : 'Frete grátis ativado!');
              } catch { toast.error('Erro ao atualizar'); }
              setTogglingFreeShipping(false);
            }}
          >
            <Truck className="h-3 w-3" />
            {order.free_shipping ? '✅ Frete Grátis Ativo' : 'Ativar Frete Grátis'}
          </Button>
        </div>
      )}
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
            {(discountAmount > 0 || orderShippingCost > 0) && (
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
            {orderShippingCost > 0 && !order.free_shipping && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Frete:</span>
                <span className="text-muted-foreground">+R$ {orderShippingCost.toFixed(2)}</span>
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
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1"
            onClick={(e) => {
              e.stopPropagation();
              setShowPOSDialog(true);
            }}
          >
            <Store className="h-3 w-3" />
            Enviar ao PDV (Retirada)
          </Button>
        </div>
      )}

      {/* Awaiting Confirmation: live messages + action buttons */}
      {order.stage === 'awaiting_confirmation' && (
        <div className="mt-3 space-y-2">
          {liveMessages.length > 0 && (
            <div className="bg-secondary/50 rounded-lg p-2 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Mensagens do cliente</p>
              {liveMessages.map((msg, i) => (
                <p key={i} className="text-xs text-foreground bg-background/60 rounded px-2 py-1">
                  "{msg}"
                </p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex-1 text-xs gap-1 bg-stage-paid hover:bg-stage-paid/90 text-white"
              onClick={handleConfirmOrder}
              disabled={isConfirming}
            >
              {isConfirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Confirmar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs gap-1"
              onClick={(e) => { e.stopPropagation(); onEdit(order); }}
            >
              <Pencil className="h-3 w-3" />
              Corrigir
            </Button>
          </div>
        </div>
      )}

      {order.notes && (
        <p className="mt-2 text-xs text-muted-foreground italic line-clamp-2">
          "{order.notes}"
        </p>
      )}

      {/* Action buttons: IA, Editar, Excluir */}
      <div className="mt-3 flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className={`flex-1 text-xs gap-1 ${order.ai_paused ? 'border-destructive/50 text-destructive hover:bg-destructive/10' : ''}`}
          title={order.ai_paused ? 'Retomar IA' : 'Pausar IA'}
          disabled={togglingAiPause}
          onClick={async (e) => {
            e.stopPropagation();
            setTogglingAiPause(true);
            try {
              const newPaused = !order.ai_paused;
              const customerPhone = order.customer?.whatsapp || '';
              try {
                if (newPaused) {
                  await fetch('https://api.bananacalcados.com.br/ia/pausar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telefone: customerPhone, motivo: 'manual_vendedora', permanente: false }),
                  });
                } else {
                  await fetch('https://api.bananacalcados.com.br/ia/retomar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telefone: customerPhone }),
                  });
                }
              } catch (apiErr) {
                console.error('Erro ao chamar API externa de IA:', apiErr);
              }
              await updateOrder(order.id, {
                ai_paused: newPaused,
                ai_paused_at: newPaused ? new Date().toISOString() : null,
              } as any);
              toast.success(newPaused ? 'IA pausada para este pedido' : 'IA retomada');
            } catch { toast.error('Erro ao alterar pausa da IA'); }
            setTogglingAiPause(false);
          }}
        >
          <Bot className="h-3.5 w-3.5" />
          {order.ai_paused ? 'Retomar IA' : 'Pausar IA'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs gap-1"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(order);
          }}
        >
          <Edit2 className="h-3.5 w-3.5" />
          Editar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs gap-1 text-destructive hover:bg-destructive/10 border-destructive/30"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(order.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir
        </Button>
      </div>

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

      <SendToPOSDialog
        open={showPOSDialog}
        onOpenChange={setShowPOSDialog}
        order={order}
      />
    </div>
  );
}

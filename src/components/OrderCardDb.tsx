import { useState, useEffect, useCallback } from "react";
import { Instagram, Phone, Package, Trash2, Edit2, MessageCircle, MessagesSquare, Gift, Truck, Percent, DollarSign, Wallet, ClipboardCopy, ExternalLink, UserCheck, ShoppingBag, Loader2, AlertTriangle, Store, CreditCard, CheckCircle2, Pencil, Bot, Bike, MapPin, Check } from "lucide-react";
import { DbOrder } from "@/types/database";
import { STAGES, getMissingFields } from "@/types/order";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SendWhatsAppDialog } from "./SendWhatsAppDialog";
import { WhatsAppChatDialog } from "./WhatsAppChatDialog";
import { InstagramDMChat } from "./events/InstagramDMChat";
import { SendToPOSDialog } from "./SendToPOSDialog";
import { CustomerFichaDialog } from "./CustomerFichaDialog";
import { GatewayPaymentLookupButton } from "./GatewayPaymentLookupButton";
import { OrderFullViewDialog } from "./OrderFullViewDialog";


import { Order } from "@/types/order";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Link2Off, RefreshCw, Trash, Radio } from "lucide-react";

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
  const [showIgChatDialog, setShowIgChatDialog] = useState(false);
  const [showPOSDialog, setShowPOSDialog] = useState(false);
  const [showFichaDialog, setShowFichaDialog] = useState(false);
  const [showFullViewDialog, setShowFullViewDialog] = useState(false);

  const [hasRegistration, setHasRegistration] = useState(false);
  const [hasShopifyOrder, setHasShopifyOrder] = useState<boolean | null>(null);
  const [shopifyOrderName, setShopifyOrderName] = useState<string | null>(null);
  const [isCreatingShopifyOrder, setIsCreatingShopifyOrder] = useState(false);
  const [isPhysicalEvent, setIsPhysicalEvent] = useState(false);
  const [isManualRoutingEvent, setIsManualRoutingEvent] = useState(false);
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDeleteOrderDialog, setShowDeleteOrderDialog] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showShopifyActionsDialog, setShowShopifyActionsDialog] = useState(false);
  const [exchangeReason, setExchangeReason] = useState("Troca de produto/tamanho");
  const [isConfirming, setIsConfirming] = useState(false);
  const [liveMessages, setLiveMessages] = useState<string[]>([]);
  const [togglingFreeShipping, setTogglingFreeShipping] = useState(false);
  const [togglingAiPause, setTogglingAiPause] = useState(false);
  // Fallback da forma de pagamento via pos_checkout_attempts (PIX vs Cartão)
  // quando o pedido não tem payment_method_label preenchido.
  const [checkoutMethod, setCheckoutMethod] = useState<string | null>(null);
  const [checkoutInstallments, setCheckoutInstallments] = useState<number | null>(null);
  // Progresso do link de checkout: -1 = ainda não calculado, 0 = aguardando abertura,
  // 1 = Identificação, 2 = Entrega, 3 = Pagamento. Quando pago, deixamos de exibir.
  const [linkStep, setLinkStep] = useState<number>(-1);
  const { moveOrder: storeMove, updateOrder } = useDbOrderStore();

  // Calcula em que etapa do link de checkout o cliente parou (com base no que ele
  // já preencheu na ficha) e se o link chegou a ser aberto.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: reg } = await supabase
          .from("customer_registrations")
          .select("full_name,cpf,whatsapp,cep,address,city,state")
          .eq("order_id", order.id)
          .maybeSingle();
        if (cancelled) return;

        const notPlaceholder = (v?: string | null, ph?: string) =>
          !!(v && v.trim() && (!ph || v.trim().toUpperCase() !== ph.toUpperCase()));

        const hasIdentification = !!reg && notPlaceholder(reg.full_name) && notPlaceholder(reg.cpf) && notPlaceholder(reg.whatsapp);
        const hasAddress = !!reg
          && notPlaceholder(reg.cep) && reg.cep?.replace(/\D/g, "") !== "00000000"
          && notPlaceholder(reg.address, "Pendente")
          && notPlaceholder(reg.city, "Pendente")
          && notPlaceholder(reg.state);

        let step = 0;
        if (hasAddress) step = 3;
        else if (hasIdentification) step = 2;
        else if (order.checkout_started_at) step = 1;
        else step = 0;

        setLinkStep(step);
      } catch {
        if (!cancelled) setLinkStep(-1);
      }
    })();
    return () => { cancelled = true; };
  }, [order.id, order.checkout_started_at]);

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

  // Detect if order belongs to a physical-store event (auto-routes to POS; should NOT create Shopify order)
  useEffect(() => {
    if (!order.event_id) { setIsPhysicalEvent(false); setIsManualRoutingEvent(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('channel, default_store_id, manual_pos_routing')
        .eq('id', order.event_id)
        .maybeSingle();
      if (cancelled) return;
      const manual = !!(data as any)?.manual_pos_routing;
      const physical = manual || (!!(data?.default_store_id) && (data?.channel ?? 'site') !== 'site');
      setIsManualRoutingEvent(manual);
      setIsPhysicalEvent(physical);
    })();
    return () => { cancelled = true; };
  }, [order.event_id]);

  const applyShopifyVerification = useCallback((verified: boolean, orderName: string | null) => {
    setHasShopifyOrder(verified);
    setShopifyOrderName(orderName);
    persistShopifyVerification(verified, orderName);
  }, [persistShopifyVerification]);

  const refreshShopifyStatus = useCallback(async () => {
    if (!order.customer_id) return;

    // Check if shopify_order_name is already persisted on the order itself
    if ((order as any).shopify_order_name) {
      applyShopifyVerification(true, (order as any).shopify_order_name);
      return;
    }

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

  // Fallback: descobre PIX vs Cartão (e parcelas) a partir da tentativa de
  // checkout bem-sucedida, quando o pedido pago não tem o método identificado.
  useEffect(() => {
    const isPaid = order.is_paid || order.paid_externally;
    const lbl = (order.payment_method_label || '').toLowerCase();
    const labelHasMethod = lbl.includes('pix') || lbl.includes('cart') || lbl.includes('crédito')
      || lbl.includes('credito') || lbl.includes('débito') || lbl.includes('debito');
    // Roda o fallback sempre que o método (PIX/Cartão) não puder ser extraído da label,
    // mesmo que exista uma label só com o nome do gateway (ex.: "Mercado Pago").
    if (!isPaid || labelHasMethod) {
      setCheckoutMethod(null);
      setCheckoutInstallments(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('pos_checkout_attempts')
        .select('payment_method, metadata')
        .eq('sale_id', order.id)
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      setCheckoutMethod(data.payment_method || null);
      const meta = (data.metadata as Record<string, unknown> | null) || {};
      const inst = Number(meta.installments ?? meta.installment ?? 0);
      setCheckoutInstallments(Number.isFinite(inst) && inst > 0 ? inst : null);
    })();
    return () => { cancelled = true; };
  }, [order.id, order.is_paid, order.paid_externally, order.payment_method_label]);



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

      // 3. Fetch event's whatsapp_number_id to resolve the store (loja)
      let loja = 'centro';
      let whatsappNumberId = '';
      
      let automationEnabled = false;
      if (order.event_id) {
        const { data: eventData } = await supabase
          .from('events')
          .select('whatsapp_number_id, automation_enabled')
          .eq('id', order.event_id)
          .single();
        
        automationEnabled = eventData?.automation_enabled === true;
        
        if (eventData?.whatsapp_number_id) {
          whatsappNumberId = eventData.whatsapp_number_id;
          const { data: whatsappData } = await supabase
            .from('whatsapp_numbers_safe')
            .select('id, label, phone_display')
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
        automation_enabled: automationEnabled,
        customer_id: order.customer_id || '',
        instagram_handle: order.customer?.instagram_handle || '',
      };

      console.log('🚀 [WEBHOOK] Disparando para pedido:', order.id, 'automationEnabled:', automationEnabled);

      if (automationEnabled) {
        // O início da Livete já é disparado pelo move para "new".
        console.log('🤖 [LIVETE] Start handled by moveOrder for', order.id);
      } else {
        // Fallback: send to VPS webhook (legacy) via secure edge function
        // so Z-API credentials are never read in the browser.
        try {
          const webhookUrl = import.meta.env.VITE_AGENTE2_NOVO_PEDIDO || 'https://api.bananacalcados.com.br/webhook/novo-pedido';
          await supabase.functions.invoke('legacy-order-webhook', {
            body: { payload, whatsapp_number_id: whatsappNumberId, webhook_url: webhookUrl },
          });
        } catch (webhookErr) {
          console.error('🚀 [WEBHOOK] Falha ao despachar webhook legado:', webhookErr);
        }
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

      // Auto-move to "Aguardando Envio" and set delivery_method
      await storeMove(order.id, 'awaiting_shipping');
      await supabase.from('orders').update({ delivery_method: 'shipping' }).eq('id', order.id);

      window.dispatchEvent(new CustomEvent('shopify-order-created', {
        detail: { orderId: order.id, shopifyOrderName: createdOrderName }
      }));

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

  const performUnlinkShopify = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("shopify-delete-event-order", {
        body: { orderId: order.id, mode: "unlink" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setHasShopifyOrder(null);
      setShopifyOrderName(null);
      sessionStorage.removeItem(`shopify-verify-${order.event_id}`);
      toast.success("Pedido desvinculado da Shopify");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao desvincular");
    }
  };

  const performDeleteShopify = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("shopify-delete-event-order", {
        body: { orderId: order.id, mode: "delete" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setHasShopifyOrder(null);
      setShopifyOrderName(null);
      sessionStorage.removeItem(`shopify-verify-${order.event_id}`);
      toast.success("Pedido apagado da Shopify");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao apagar pedido");
    }
  };

  const performUpdateShopify = async (reason: string) => {
    setIsCreatingShopifyOrder(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-update-event-order", {
        body: { orderId: order.id, reason },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const newName = data?.current?.shopifyOrderName || null;
      applyShopifyVerification(true, newName);
      toast.success(`Troca registrada! Novo pedido: ${newName || ""}`);
      window.dispatchEvent(new CustomEvent('shopify-order-created', {
        detail: { orderId: order.id, shopifyOrderName: newName }
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar troca");
    } finally {
      setIsCreatingShopifyOrder(false);
    }
  };

  const handleMototaxi = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await storeMove(order.id, 'awaiting_mototaxi');
      await supabase.from('orders').update({ delivery_method: 'mototaxi' }).eq('id', order.id);
      toast.success('Pedido movido para Aguardando Mototaxista');
    } catch {
      toast.error('Erro ao mover pedido');
    }
  };

  const handlePickup = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await storeMove(order.id, 'awaiting_pickup');
      await supabase.from('orders').update({ delivery_method: 'pickup' }).eq('id', order.id);
      toast.success('Pedido movido para Aguardando Retirada');
    } catch {
      toast.error('Erro ao mover pedido');
    }
  };

  const handleMarkDelivered = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await storeMove(order.id, 'completed');
      toast.success('Pedido concluído!');
      // Send WhatsApp notification
      const phone = order.customer?.whatsapp?.replace(/\D/g, '') || '';
      if (phone) {
        const msg = order.stage === 'awaiting_pickup'
          ? `Olá ${order.customer?.instagram_handle || ''}! ✅ Seu pedido foi retirado com sucesso. Obrigado pela preferência! 🎉`
          : `Olá ${order.customer?.instagram_handle || ''}! ✅ Seu pedido foi entregue com sucesso. Obrigado pela preferência! 🎉`;
        try {
          await supabase.functions.invoke('zapi-send-message', {
            body: { phone, message: msg },
          });
        } catch (whatsErr) {
          console.error('Erro ao enviar WhatsApp de conclusão:', whatsErr);
        }
      }
    } catch {
      toast.error('Erro ao concluir pedido');
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
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowFichaDialog(true); }}
                className="font-semibold text-foreground text-sm hover:text-primary hover:underline text-left"
                title="Abrir ficha do cliente"
              >
                {order.customer?.instagram_handle}
              </button>
            </div>
            {/* Botão para abrir/editar os dados que o cliente preencheu no link de checkout */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowFichaDialog(true); }}
              className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm hover:bg-red-700"
              title="Ver/editar os dados cadastrais do cliente"
            >
              <UserCheck className="h-3 w-3" />
              VER DADOS
            </button>
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
        {/* Data em que o card/pedido foi montado */}
        <Badge variant="outline" className="text-[10px] bg-muted/50 text-muted-foreground border-border">
          📅 {format(new Date(order.created_at), "dd/MM/yyyy")}
        </Badge>
        {/* Status do link de checkout — só exibe enquanto o pedido não está pago */}
        {!order.is_paid && !order.paid_externally && linkStep >= 0 && (
          linkStep === 0 ? (
            <Badge variant="outline" className="text-[10px] bg-muted/60 text-muted-foreground border-border">
              ⏳ Aguard. abertura
            </Badge>
          ) : (
            <>
              <Badge variant="secondary" className="text-[10px] bg-stage-contacted/20 text-stage-contacted border-stage-contacted/40">
                🔗 Link aberto
              </Badge>
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/40">
                {linkStep === 1 ? "Etapa 1/3 · Identificação"
                  : linkStep === 2 ? "Etapa 2/3 · Entrega"
                  : "Etapa 3/3 · Pagamento"}
              </Badge>
            </>
          )
        )}
        {(order.is_paid || order.paid_externally) && hasShopifyOrder === true && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowShopifyActionsDialog(true);
            }}
            className="inline-flex"
          >
            <Badge
              variant="secondary"
              className="text-[10px] bg-stage-paid/20 text-stage-paid border-stage-paid/30 cursor-pointer hover:bg-stage-paid/30 inline-flex items-center"
            >
              <ShoppingBag className="h-3 w-3 mr-1" />
              {shopifyOrderName ? `Shopify ${shopifyOrderName}` : 'Na Shopify'}
            </Badge>
          </button>
        )}
        {(order.is_paid || order.paid_externally) && hasShopifyOrder === false && !isPhysicalEvent && (
          <Badge variant="secondary" className="text-[10px] bg-destructive/20 text-destructive border-destructive/30 animate-pulse">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Sem Shopify
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
          {order.customer?.instagram_handle && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-pink-500 hover:text-pink-600 hover:bg-pink-500/10"
              onClick={(e) => { e.stopPropagation(); setShowIgChatDialog(true); }}
              title="Abrir chat Instagram DM"
            >
              <Instagram className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
      {!order.customer?.whatsapp && order.customer?.instagram_handle && (
        <div className="flex items-center gap-2 mb-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-pink-500 hover:text-pink-600 hover:bg-pink-500/10"
            onClick={(e) => { e.stopPropagation(); setShowIgChatDialog(true); }}
            title="Abrir chat Instagram DM"
          >
            <Instagram className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">Apenas Instagram</span>
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
          {isManualRoutingEvent ? (
            <>
              <Button
                variant="default"
                size="sm"
                className="w-full text-xs gap-1 bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
                onClick={(e) => { e.stopPropagation(); setShowPOSDialog(true); }}
                disabled={!(order.is_paid || order.paid_externally)}
              >
                <Radio className="h-3 w-3" />
                {order.pos_sale_id ? "Reenviar Pedido ao PDV" : "Enviar Pedido Pago ao PDV"}
              </Button>
              <p className="text-[10px] text-center text-muted-foreground">
                {order.pos_sale_id
                  ? "Já enviado ao PDV."
                  : (order.is_paid || order.paid_externally)
                    ? "Escolha a loja e a vendedora que fez a venda."
                    : "Disponível após o pagamento."}
              </p>
            </>
          ) : isPhysicalEvent ? (
            <div className="w-full text-[11px] text-center text-muted-foreground bg-secondary/40 rounded-md py-1.5 px-2">
              Evento de loja física — pedido vai automaticamente para o PDV ao ser pago.
            </div>
          ) : hasRegistration ? (
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
          {!isManualRoutingEvent && (
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
          )}

          <GatewayPaymentLookupButton orderId={order.id} compact />

          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1"
            onClick={(e) => {
              e.stopPropagation();
              setShowFullViewDialog(true);
            }}
          >
            <Package className="h-3 w-3" />
            Ver Pedido
          </Button>




          {/* Fulfillment buttons for paid orders */}
          {(order.is_paid || order.paid_externally) && order.stage === 'paid' && (
            <div className="flex gap-1.5 mt-1.5">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs gap-1 border-stage-awaiting-mototaxi/50 text-stage-awaiting-mototaxi hover:bg-stage-awaiting-mototaxi/10"
                onClick={handleMototaxi}
              >
                <Bike className="h-3 w-3" />
                Mototaxista
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs gap-1 border-stage-awaiting-pickup/50 text-stage-awaiting-pickup hover:bg-stage-awaiting-pickup/10"
                onClick={handlePickup}
              >
                <MapPin className="h-3 w-3" />
                Retirar Loja
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Mark as delivered/picked up for awaiting stages */}
      {(order.stage === 'awaiting_mototaxi' || order.stage === 'awaiting_pickup') && (
        <div className="mt-2">
          <Button
            variant="default"
            size="sm"
            className="w-full text-xs gap-1 bg-stage-completed hover:bg-stage-completed/90 text-white"
            onClick={handleMarkDelivered}
          >
            <Check className="h-3 w-3" />
            {order.stage === 'awaiting_pickup' ? 'Confirmar Retirada' : 'Confirmar Entrega'}
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
            setShowDeleteOrderDialog(true);
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

      <CustomerFichaDialog
        open={showFichaDialog}
        onOpenChange={setShowFichaDialog}
        order={order}
      />

      <OrderFullViewDialog
        open={showFullViewDialog}
        onOpenChange={setShowFullViewDialog}
        order={order}
      />


      {order.customer?.whatsapp && (
        <WhatsAppChatDialog
          open={showChatDialog}
          onOpenChange={setShowChatDialog}
          order={orderForDialog}
          wide
        />
      )}

      {order.customer?.instagram_handle && (
        <InstagramDMChat
          open={showIgChatDialog}
          onOpenChange={setShowIgChatDialog}
          username={order.customer.instagram_handle}
          eventId={order.event_id}
          fallbackCommentId={order.latest_comment_id || undefined}
          orderId={order.id}
        />
      )}

      <SendToPOSDialog
        open={showPOSDialog}
        onOpenChange={setShowPOSDialog}
        order={order}
      />

      <Dialog open={showShopifyActionsDialog} onOpenChange={setShowShopifyActionsDialog}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Ações do pedido na Shopify</DialogTitle>
            <DialogDescription>
              Escolha o que deseja fazer com este pedido vinculado na Shopify.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={isCreatingShopifyOrder}
              onClick={() => {
                setShowShopifyActionsDialog(false);
                setExchangeReason("Troca de produto/tamanho");
                setShowUpdateDialog(true);
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Editar pedido
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => {
                setShowShopifyActionsDialog(false);
                setShowUnlinkDialog(true);
              }}
            >
              <Link2Off className="h-4 w-4" />
              Desvincular
            </Button>
            <Button
              variant="destructive"
              className="justify-start gap-2"
              onClick={() => {
                setShowShopifyActionsDialog(false);
                setShowDeleteDialog(true);
              }}
            >
              <Trash className="h-4 w-4" />
              Apagar pedido da Shopify
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular pedido da Shopify?</AlertDialogTitle>
            <AlertDialogDescription>
              O pedido permanece na Shopify, apenas o vínculo com este card será removido. Você poderá criar um novo pedido depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => performUnlinkShopify()}>Desvincular</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteOrderDialog} onOpenChange={setShowDeleteOrderDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pedido definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação apaga o pedido de forma permanente e <strong>não pode ser desfeita</strong>.
              O link de pagamento já enviado ao cliente vai parar de funcionar
              (aparecerá "Pedido não encontrado"). Só exclua se tiver certeza de que
              o cliente não vai mais pagar por este link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDelete(order.id)}
            >
              Excluir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar pedido na Shopify?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação cancela e exclui o pedido na Shopify. Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => performDeleteShopify()}
            >
              Apagar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Trocar produto/tamanho na Shopify</DialogTitle>
            <DialogDescription>
              O pedido atual será cancelado e um novo será criado com os dados atuais. O histórico fica salvo no card. O número do pedido na Shopify será diferente.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={exchangeReason}
            onChange={(e) => setExchangeReason(e.target.value)}
            placeholder="Motivo da troca (opcional)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateDialog(false)}>Cancelar</Button>
            <Button
              disabled={isCreatingShopifyOrder}
              onClick={async () => {
                setShowUpdateDialog(false);
                await performUpdateShopify(exchangeReason);
              }}
            >
              {isCreatingShopifyOrder ? "Processando..." : "Confirmar troca"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

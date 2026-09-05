import { useState, useEffect, useMemo, useCallback } from "react";
import { Instagram, Phone, StickyNote, X, Link, Info, Loader2, RefreshCw, Ban, Gift, Truck, Percent, DollarSign, ShoppingBag, Tag, Wallet, CreditCard, QrCode, Lock, Store, MapPin, Package, Copy, ShieldCheck, AlertTriangle, ExternalLink, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { normalizeBRPhone } from "@/lib/phoneUtils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ProductSelector } from "./ProductSelector";
import { DbOrder, DbOrderProduct, DbCustomer, DiscountType } from "@/types/database";
import { STAGES, OrderStage } from "@/types/order";
import { useCustomerStore } from "@/stores/customerStore";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useChargebackRegistry } from "@/hooks/useChargebackRegistry";
import { CustomerChargebackBadge } from "@/components/pos/CustomerChargebackBadge";

import { createShopifyCartFromOrder } from "@/lib/shopifyCart";
import { createYampiPaymentLinkFromOrder } from "@/lib/yampi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface OrderDialogDbProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingOrder?: DbOrder | null;
  eventId: string;
  prefillInstagram?: string;
  prefillCommentId?: string;
  /** Telefone do lead (área de membros) — resolve o cliente pelo WhatsApp */
  prefillWhatsapp?: string;
  /** Nome do lead, usado como identificador quando não há @ do Instagram */
  prefillName?: string;
}

export function OrderDialogDb({ open, onOpenChange, editingOrder, eventId, prefillInstagram, prefillCommentId, prefillWhatsapp, prefillName }: OrderDialogDbProps) {

  const { findCustomerByInstagram, findCustomerByWhatsApp, lookupCustomerByInstagram, lookupCustomerByWhatsApp, createOrUpdateCustomer, updateCustomer, banCustomer, unbanCustomer, customers, fetchCustomers, isLoading: customersLoading } = useCustomerStore();

  // Garante a base de clientes carregada em QUALQUER tela que abra o modal
  // (chat, central da live, comentários...). Sem isso o @ não é reconhecido
  // e o cliente antigo (com telefone) não é reaproveitado.
  useEffect(() => {
    if (open && customers.length === 0 && !customersLoading) {
      void fetchCustomers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [editingHandle, setEditingHandle] = useState(false);
  const { createOrder, updateOrder, findActiveOrderByCustomer, orders } = useDbOrderStore();

  const [instagramHandle, setInstagramHandle] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [fullName, setFullName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cartLink, setCartLink] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<OrderStage>("new");
  const [localProducts, setLocalProducts] = useState<DbOrderProduct[]>([]);
  const [isGeneratingCartLink, setIsGeneratingCartLink] = useState(false);
  const [isGeneratingYampiLink, setIsGeneratingYampiLink] = useState(false);
  const [isGeneratingPayPalLink, setIsGeneratingPayPalLink] = useState(false);
  const [isGeneratingPixLink, setIsGeneratingPixLink] = useState(false);
  const [pixCode, setPixCode] = useState<string>("");
  const [isCreatingShopifyOrder, setIsCreatingShopifyOrder] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [chargebackConfirmed, setChargebackConfirmed] = useState(false);
  const [showChargebackConfirm, setShowChargebackConfirm] = useState(false);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookup, setLookup] = useState<any | null>(null);

  const runGatewayLookup = async () => {
    if (!editingOrder?.id) return;
    setLookupLoading(true);
    setLookup(null);
    try {
      const { data, error } = await supabase.functions.invoke("gateway-payment-lookup", {
        body: { orderId: editingOrder.id },
      });
      if (error) throw error;
      setLookup(data);
      if (data?.warning) toast.info(data.warning);
    } catch (e: any) {
      toast.error(`Falha ao consultar gateway: ${e.message || e}`);
    } finally {
      setLookupLoading(false);
    }
  };
  
  // Discount and extras
  const [discountType, setDiscountType] = useState<DiscountType | "">("");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [freeShipping, setFreeShipping] = useState(false);
  const [hasGift, setHasGift] = useState(false);
  const [giftDescription, setGiftDescription] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [customShippingCost, setCustomShippingCost] = useState<string>("");
  const [paidExternally, setPaidExternally] = useState(false);
  const [maxInstallmentsOverride, setMaxInstallmentsOverride] = useState<string>("");

  // Pickup & delivery
  const [isPickup, setIsPickup] = useState(false);
  const [pickupStoreId, setPickupStoreId] = useState<string>("");
  const [isDelivery, setIsDelivery] = useState(false);
  const [pickupStores, setPickupStores] = useState<{id: string; name: string}[]>([]);
  const [isCreatingPickup, setIsCreatingPickup] = useState(false);
  const [isPhysicalEvent, setIsPhysicalEvent] = useState(false);

  // Detect physical-store event (auto-routes to POS instead of Shopify)
  useEffect(() => {
    if (!eventId) { setIsPhysicalEvent(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('channel, default_store_id')
        .eq('id', eventId)
        .maybeSingle();
      if (cancelled) return;
      setIsPhysicalEvent(!!(data?.default_store_id) && (data?.channel ?? 'site') !== 'site');
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  // Load stores for pickup
  useEffect(() => {
    const loadStores = async () => {
      const { data } = await supabase
        .from('pos_stores')
        .select('id, name')
        .eq('is_active', true)
        .in('name', ['Loja Centro', 'Loja Perola'])
        .order('name');
      if (data) setPickupStores(data);
    };
    loadStores();
  }, []);

  // Check for existing customer by Instagram as user types
  const existingCustomer = useMemo(() => {
    if (editingOrder || !instagramHandle.trim()) return null;
    return findCustomerByInstagram(instagramHandle);
  }, [instagramHandle, editingOrder, findCustomerByInstagram, customers]);

  // Check for existing customer by WhatsApp as user types
  const existingCustomerByWhatsApp = useMemo(() => {
    if (editingOrder || !whatsapp.trim() || existingCustomer) return null;
    return findCustomerByWhatsApp(whatsapp);
  }, [whatsapp, editingOrder, existingCustomer, findCustomerByWhatsApp, customers]);

  // Chargeback do cliente: pelo telefone digitado ou pelo @ do Instagram
  const { byPhone: cbByPhone, byHandle: cbByHandle } = useChargebackRegistry();
  const orderChargebacks = useMemo(() => {
    const phone = whatsapp || editingOrder?.customer?.whatsapp || existingCustomer?.whatsapp || "";
    const byPhone = cbByPhone(phone);
    if (byPhone.length) return byPhone;
    return cbByHandle(instagramHandle || editingOrder?.customer?.instagram_handle || "");
  }, [whatsapp, instagramHandle, editingOrder, existingCustomer, cbByPhone, cbByHandle]);

  useEffect(() => { setChargebackConfirmed(false); }, [whatsapp, instagramHandle]);


  // Check if there's an active order for this customer in current event
  const existingOrderInEvent = useMemo(() => {
    if (!existingCustomer || !eventId) return null;
    return findActiveOrderByCustomer(eventId, existingCustomer.id);
  }, [existingCustomer, eventId, findActiveOrderByCustomer, orders]);

  useEffect(() => {
    setEditingHandle(false);
    if (editingOrder) {
      setInstagramHandle(editingOrder.customer?.instagram_handle || "");
      setWhatsapp(editingOrder.customer?.whatsapp || "");
      setFullName((editingOrder.customer as any)?.full_name || "");
      setCartLink(editingOrder.cart_link || "");
      setNotes(editingOrder.notes || "");
      setStage(editingOrder.stage as OrderStage);
      setLocalProducts([...editingOrder.products]);
      setDiscountType(editingOrder.discount_type || "");
      setDiscountValue(editingOrder.discount_value || 0);
      setFreeShipping(editingOrder.free_shipping || false);
      setHasGift(editingOrder.has_gift || false);
      setGiftDescription((editingOrder as any).gift_description || "");
      setCouponCode(editingOrder.coupon_code || "");
      setPaidExternally(editingOrder.paid_externally || false);
      setCustomShippingCost((editingOrder as any).custom_shipping_cost != null ? String((editingOrder as any).custom_shipping_cost) : "");
      setIsPickup((editingOrder as any).is_pickup || false);
      setPickupStoreId((editingOrder as any).pickup_store_id || "");
      setIsDelivery((editingOrder as any).is_delivery || false);
      setPixCode("");
    } else {
      resetForm();
      if (prefillName && open) setFullName(prefillName);
      if (prefillInstagram && open) {
        setInstagramHandle(prefillInstagram.replace(/^@/, ""));
      }
      if (prefillWhatsapp && open) {
        const normalized = normalizeBRPhone(prefillWhatsapp);
        setWhatsapp(normalized);
        const known = findCustomerByWhatsApp(normalized);
        if (known?.instagram_handle) {
          setInstagramHandle(known.instagram_handle.replace(/^@/, ""));
        } else if (!prefillInstagram) {
          const slug = (prefillName || "")
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
          setInstagramHandle(slug || normalized);
        }
      }
    }
  }, [editingOrder, open, prefillInstagram, prefillWhatsapp, prefillName]);


  // Auto-fill whatsapp when existing customer is found
  useEffect(() => {
    if (existingCustomer && !editingOrder) {
      if (existingCustomer.whatsapp) {
        setWhatsapp(existingCustomer.whatsapp);
      }
      if ((existingCustomer as any).full_name && !fullName.trim()) {
        setFullName((existingCustomer as any).full_name);
      }
    }
  }, [existingCustomer, editingOrder]);

  // Fallback no banco (com debounce) quando o @ digitado não está no cache
  // local — cobre cadastros legados "@ handle" e cache ainda não carregado.
  useEffect(() => {
    if (editingOrder || !open) return;
    const handle = instagramHandle.trim();
    if (handle.length < 3 || existingCustomer) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const found = await lookupCustomerByInstagram(handle);
      if (cancelled || !found) return;
      // O lookup insere no cache → existingCustomer recalcula e auto-preenche.
      if (found.whatsapp && !whatsapp.trim()) setWhatsapp(found.whatsapp);
      if ((found as any).full_name && !fullName.trim()) setFullName((found as any).full_name);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instagramHandle, existingCustomer, editingOrder, open]);

  // Pedido em edição cujo cliente ficou sem telefone: sugere o telefone do
  // cadastro homônimo (duplicata legada) para a vendedora só confirmar.
  useEffect(() => {
    if (!editingOrder || !open) return;
    const cust = editingOrder.customer;
    if (!cust || cust.whatsapp || whatsapp.trim()) return;
    let cancelled = false;
    (async () => {
      const found = await lookupCustomerByInstagram(cust.instagram_handle || "");
      if (cancelled || !found || found.id === cust.id || !found.whatsapp) return;
      setWhatsapp(found.whatsapp);
      if ((found as any).full_name && !fullName.trim()) setFullName((found as any).full_name);
      toast.info("Telefone recuperado do cadastro anterior desta cliente. Salve para confirmar.");
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingOrder?.id, open]);

  const resetForm = () => {
    setInstagramHandle("");
    setWhatsapp("");
    setFullName("");
    setCartLink("");
    setNotes("");
    setStage("new");
    setLocalProducts([]);
    setBanReason("");
    setPixCode("");
    setDiscountType("");
    setDiscountValue(0);
    setFreeShipping(false);
    setHasGift(false);
    setGiftDescription("");
    setCouponCode("");
    setPaidExternally(false);
    setCustomShippingCost("");
    setIsPickup(false);
    setPickupStoreId("");
    setIsDelivery(false);
  };

  const handleAddLocalProduct = (product: DbOrderProduct) => {
    setLocalProducts((prev) => {
      const existing = prev.find((p) => p.id === product.id);
      if (existing) {
        return prev.map((p) =>
          p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p
        );
      }
      return [...prev, product];
    });
  };

  const handleRemoveLocalProduct = (productId: string) => {
    setLocalProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  const handleUpdateLocalQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveLocalProduct(productId);
      return;
    }
    setLocalProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, quantity } : p))
    );
  };

  const generateCartLink = useCallback(async () => {
    if (localProducts.length === 0) {
      toast.error("Adicione produtos antes de gerar o link");
      return;
    }
    setIsGeneratingCartLink(true);
    try {
      const link = await createShopifyCartFromOrder(localProducts);
      if (link) {
        setCartLink(link);
        toast.success("Link do carrinho gerado!");
      } else {
        toast.error("Erro ao gerar link do carrinho");
      }
    } catch (error) {
      console.error("Error generating cart link:", error);
      toast.error("Erro ao gerar link do carrinho");
    } finally {
      setIsGeneratingCartLink(false);
    }
  }, [localProducts]);

  const generateYampiLink = useCallback(async () => {
    if (localProducts.length === 0) {
      toast.error("Adicione produtos antes de gerar o link");
      return;
    }

    setIsGeneratingYampiLink(true);
    try {
      const link = await createYampiPaymentLinkFromOrder(localProducts, {
        orderId: editingOrder?.id,
        customerPhone: whatsapp || undefined,
        discountType: discountType || undefined,
        discountValue: discountValue || undefined,
        freeShipping: freeShipping,
        couponCode: couponCode || undefined,
      });
      if (link) {
        setCartLink(link);
        toast.success("Link de pagamento Yampi gerado!");
      }
    } catch (error) {
      console.error("Error generating Yampi link:", error);
      const errorMessage = error instanceof Error ? error.message : "Erro ao gerar link Yampi";
      toast.error(errorMessage, { duration: 6000 });
    } finally {
      setIsGeneratingYampiLink(false);
    }
  }, [localProducts, editingOrder?.id, whatsapp, discountType, discountValue, freeShipping, couponCode]);

  const generatePayPalLink = useCallback(async () => {
    if (localProducts.length === 0) {
      toast.error("Adicione produtos antes de gerar o link");
      return;
    }

    if (!editingOrder) {
      toast.error("Salve o pedido primeiro antes de gerar o link PayPal");
      return;
    }

    setIsGeneratingPayPalLink(true);
    try {
      const { data, error } = await supabase.functions.invoke("paypal-create-order", {
        body: { orderId: editingOrder.id },
      });

      if (error) throw error;

      if (data?.approvalUrl) {
        setCartLink(data.approvalUrl);
        toast.success(`Link PayPal gerado! Valor: R$ ${data.amount}`);
      } else if (data?.checkoutUrl) {
        setCartLink(data.checkoutUrl);
        toast.success(`Link PayPal gerado! Valor: R$ ${data.amount}`);
      } else {
        throw new Error("No PayPal URL returned");
      }
    } catch (error) {
      console.error("Error generating PayPal link:", error);
      const errorMessage = error instanceof Error ? error.message : "Erro ao gerar link PayPal";
      toast.error(errorMessage, { duration: 6000 });
    } finally {
      setIsGeneratingPayPalLink(false);
    }
  }, [localProducts, editingOrder]);

  const generatePixLink = useCallback(async () => {
    if (localProducts.length === 0) {
      toast.error("Adicione produtos antes de gerar o PIX");
      return;
    }

    if (!editingOrder) {
      toast.error("Salve o pedido primeiro antes de gerar o PIX");
      return;
    }

    setIsGeneratingPixLink(true);
    try {
      const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
        body: { orderId: editingOrder.id },
      });

      if (error) throw error;

      if (data?.qrCode) {
        setPixCode(data.qrCode);
        try {
          await navigator.clipboard.writeText(data.qrCode);
          toast.success(`PIX gerado! Código copiado. Valor: R$ ${data.amount}`, { duration: 6000 });
        } catch {
          toast.success(`PIX gerado! Valor: R$ ${data.amount}`, {
            description: "Clique para copiar o código PIX",
            duration: 10000,
            action: {
              label: "Copiar",
              onClick: () => {
                navigator.clipboard.writeText(data.qrCode).catch(() => {
                  window.prompt("Copie o código PIX:", data.qrCode);
                });
              },
            },
          });
        }
      } else {
        throw new Error("No PIX data returned");
      }
    } catch (error) {
      console.error("Error generating PIX:", error);
      const errorMessage = error instanceof Error ? error.message : "Erro ao gerar PIX";
      toast.error(errorMessage, { duration: 6000 });
    } finally {
      setIsGeneratingPixLink(false);
    }
  }, [localProducts, editingOrder]);

  const handleBanCustomer = async () => {
    if (editingOrder?.customer) {
      await banCustomer(editingOrder.customer.id, banReason);
      onOpenChange(false);
    }
  };

  const handleCreateShopifyOrder = useCallback(async () => {
    if (!editingOrder) {
      toast.error("Salve o pedido primeiro");
      return;
    }
    setIsCreatingShopifyOrder(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-create-order", {
        body: { orderId: editingOrder.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const createdOrderName = data?.shopifyOrderName || null;

      try {
        const storageKey = `shopify-verify-${eventId}`;
        const cached = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
        const next = Array.isArray(cached)
          ? cached.filter((entry: any) => entry?.orderId !== editingOrder.id)
          : [];

        next.push({
          orderId: editingOrder.id,
          hasShopify: true,
          shopifyOrderName: createdOrderName || undefined,
        });

        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch (storageError) {
        console.warn('Erro ao atualizar cache da Shopify:', storageError);
      }

      window.dispatchEvent(new CustomEvent('shopify-order-created', {
        detail: {
          orderId: editingOrder.id,
          shopifyOrderName: createdOrderName,
        },
      }));

      toast.success(`Pedido criado na Shopify! ${createdOrderName || ""}`, { duration: 6000 });
    } catch (error) {
      console.error("Error creating Shopify order:", error);
      const msg = error instanceof Error ? error.message : "Erro ao criar pedido na Shopify";
      toast.error(msg, { duration: 8000 });
    } finally {
      setIsCreatingShopifyOrder(false);
    }
  }, [editingOrder, eventId]);

  const handleSubmit = async (forceChargeback = false) => {
    if (isSubmitting) return;
    const nameWords = fullName.trim().split(/\s+/).filter(Boolean);
    const hasValidFullName = nameWords.length >= 2;
    // Sem @? Derivamos um identificador a partir do nome completo, para que a
    // vendedora possa montar o pedido sem pedir o telefone em público na live.
    let effectiveHandle = instagramHandle.trim();
    if (!effectiveHandle && hasValidFullName) {
      effectiveHandle = fullName
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
      setInstagramHandle(effectiveHandle);
    }
    if (!effectiveHandle) {
      toast.error("Informe o @ do Instagram ou o nome completo do cliente");
      return;
    }
    if (!editingOrder && !whatsapp.trim() && !hasValidFullName) {
      toast.error("Informe o WhatsApp ou o nome completo (nome e sobrenome)");
      return;
    }

    // Chargeback: avisa e exige confirmação antes de montar o pedido (Etapa 5)
    if (orderChargebacks.length > 0 && !forceChargeback && !chargebackConfirmed) {
      setShowChargebackConfirm(true);
      return;
    }

    setIsSubmitting(true);

    // Check if customer is banned
    const customer = findCustomerByInstagram(effectiveHandle);
    if (customer?.is_banned) {
      toast.error(`Cliente ${customer.instagram_handle} está banido: ${customer.ban_reason || 'Sem motivo especificado'}`);
      return;
    }


    try {
      if (editingOrder) {
        // Update customer instagram handle if changed
        if (editingOrder.customer && editingHandle) {
          const raw = instagramHandle.trim().replace(/^@+/, "");
          const newHandle = raw ? `@${raw}` : "";
          const currentHandle = editingOrder.customer.instagram_handle || "";
          if (!newHandle) {
            toast.error("Informe o @ do Instagram");
            setIsSubmitting(false);
            return;
          }
          if (newHandle.toLowerCase() !== currentHandle.toLowerCase()) {
            const conflict = findCustomerByInstagram(newHandle);
            if (conflict && conflict.id !== editingOrder.customer.id) {
              toast.error(`O @ ${newHandle} já pertence a outro cliente cadastrado`);
              setIsSubmitting(false);
              return;
            }
            await updateCustomer(editingOrder.customer.id, { instagram_handle: newHandle } as Partial<DbCustomer>);
            (editingOrder.customer as any).instagram_handle = newHandle;
            toast.success("@ do Instagram atualizado");
          }
        }

        // Update customer whatsapp if changed
        if (editingOrder.customer && (whatsapp !== editingOrder.customer.whatsapp || fullName.trim() !== ((editingOrder.customer as any).full_name || ""))) {
          const normalizedWa = whatsapp ? normalizeBRPhone(whatsapp) : undefined;
          await createOrUpdateCustomer(editingOrder.customer.instagram_handle, normalizedWa, fullName);
        }


        // Update existing order
        const orderUpdates: Partial<DbOrder> = {
          cart_link: cartLink || null,
          notes: notes || null,
          stage,
          products: localProducts,
          discount_type: discountType || null,
          discount_value: discountType ? (discountValue ?? 0) : 0,
          free_shipping: freeShipping,
          has_gift: hasGift,
          gift_description: hasGift ? (giftDescription.trim() || null) : null,
          coupon_code: couponCode || null,
          paid_externally: paidExternally,
          is_pickup: isPickup,
          pickup_store_id: isPickup && pickupStoreId ? pickupStoreId : null,
          is_delivery: isDelivery,
        } as any;
        
        // If marking as paid externally, also mark as paid (manual source)
        if (paidExternally && !editingOrder.is_paid) {
          orderUpdates.is_paid = true;
          orderUpdates.paid_at = new Date().toISOString();
          (orderUpdates as any).payment_confirmed_source = 'manual';
        }
        // If unchecking paid_externally and payment wasn't confirmed by gateway → clear
        if (!paidExternally && editingOrder.paid_externally && (editingOrder as any).payment_confirmed_source !== 'gateway_webhook') {
          orderUpdates.is_paid = false;
          orderUpdates.paid_at = null;
          (orderUpdates as any).payment_confirmed_source = null;
        }

        
        await updateOrder(editingOrder.id, orderUpdates);

        // Refresh orders to reflect updated joined customer data
        await useDbOrderStore.getState().fetchOrdersByEvent(eventId);

        toast.success("Pedido atualizado!");
      } else {
        // Create or get customer
        const normalizedWa = whatsapp ? normalizeBRPhone(whatsapp) : undefined;
        const newCustomer = await createOrUpdateCustomer(effectiveHandle, normalizedWa, fullName);
        if (!newCustomer) {
          toast.error("Erro ao criar cliente");
          return;
        }

        // Check for existing active order in this event
        const activeOrder = findActiveOrderByCustomer(eventId, newCustomer.id);
        if (activeOrder) {
          for (const product of localProducts) {
            await useDbOrderStore.getState().addProductToOrder(activeOrder.id, product);
          }
          if (notes) {
            await updateOrder(activeOrder.id, { 
              notes: activeOrder.notes ? `${activeOrder.notes}\n${notes}` : notes 
            });
          }
          if (prefillCommentId) {
            await supabase
              .from("live_comments")
              .update({ order_id: activeOrder.id })
              .eq("comment_id", prefillCommentId);
            await useDbOrderStore.getState().fetchOrdersByEvent(eventId);
          }
          toast.success("Produtos adicionados ao pedido existente!");
        } else {
          const newOrder = await createOrder(eventId, newCustomer, localProducts);
          
          // Apply discount, shipping, and extras if set during creation
          if (newOrder) {
            const extraUpdates: Record<string, unknown> = {};
            if (discountType) {
              extraUpdates.discount_type = discountType;
              extraUpdates.discount_value = discountValue ?? 0;
            }
            if (freeShipping) extraUpdates.free_shipping = true;
            if (hasGift) {
              extraUpdates.has_gift = true;
              extraUpdates.gift_description = giftDescription.trim() || null;
            }
            if (couponCode) extraUpdates.coupon_code = couponCode;
            if (notes) extraUpdates.notes = notes;
            if (paidExternally) {
              extraUpdates.paid_externally = true;
              extraUpdates.is_paid = true;
              extraUpdates.paid_at = new Date().toISOString();
              (extraUpdates as any).payment_confirmed_source = 'manual';
            }

            if (isPickup) {
              extraUpdates.is_pickup = true;
              if (pickupStoreId) extraUpdates.pickup_store_id = pickupStoreId;
            }
            if (isDelivery) extraUpdates.is_delivery = true;
            if (customShippingCost) extraUpdates.shipping_cost = parseFloat(customShippingCost);

            if (Object.keys(extraUpdates).length > 0) {
              await updateOrder(newOrder.id, extraUpdates as Partial<DbOrder>);
            }

            if (prefillCommentId) {
              await supabase
                .from("live_comments")
                .update({ order_id: newOrder.id })
                .eq("comment_id", prefillCommentId);
              await useDbOrderStore.getState().fetchOrdersByEvent(eventId);
            }
          }
        }
      }

      onOpenChange(false);
      resetForm();
    } catch (error) {
      console.error('Error saving order:', error);
      toast.error("Erro ao salvar pedido. Tente novamente.");
      // Dialog stays open so the user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalValue = localProducts.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );

  const discountAmount = discountType && discountValue
    ? discountType === 'percentage'
      ? totalValue * (discountValue / 100)
      : discountValue
    : 0;
  
  const finalValue = Math.max(0, totalValue - discountAmount);

  const isBanned = editingOrder?.customer?.is_banned || existingCustomer?.is_banned;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-accent" />
            {editingOrder ? "Editar Pedido" : "Novo Pedido"}
          </DialogTitle>
          {editingOrder && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium">ID do pedido:</span>
              <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground break-all">
                {editingOrder.id}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(editingOrder.id);
                    toast.success("ID do pedido copiado!");
                  } catch {
                    window.prompt("Copie o ID do pedido:", editingOrder.id);
                  }
                }}
              >
                <Package className="h-4 w-4 mr-1" />
                Copiar ID
              </Button>
            </div>
          )}
        </DialogHeader>

        <div className="space-y-6 py-4 flex-1 overflow-y-auto">
          {orderChargebacks.length > 0 && (
            <Alert className="border-destructive bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-sm text-destructive flex items-center justify-between gap-3">
                <span>
                  <strong>CLIENTE COM CHARGEBACK!</strong> Este telefone/@ já pediu estorno em uma compra anterior.
                </span>
                <CustomerChargebackBadge chargebacks={orderChargebacks} size="sm" className="shrink-0" />
              </AlertDescription>
            </Alert>
          )}
          {isBanned && (

            <Alert className="border-destructive/50 bg-destructive/10">
              <Ban className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-sm text-destructive flex items-center justify-between gap-3">
                <span>
                  <strong>Cliente banido!</strong> {existingCustomer?.ban_reason || editingOrder?.customer?.ban_reason || 'Sem motivo especificado'}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={async () => {
                    const cid = editingOrder?.customer?.id || existingCustomer?.id;
                    if (!cid) return;
                    await unbanCustomer(cid);
                    toast.success("Cliente desbanido");
                  }}
                >
                  Desbanir
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="instagram" className="flex items-center gap-2">
                <Instagram className="h-4 w-4" />
                Instagram *
                {!!editingOrder && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setEditingHandle((v) => !v)}
                  >
                    {editingHandle ? "Cancelar" : "Editar @"}
                  </Button>
                )}
              </Label>
              <Input
                id="instagram"
                placeholder="@usuario"
                value={instagramHandle}
                onChange={(e) => setInstagramHandle(e.target.value)}
                disabled={!!editingOrder && !editingHandle}
              />
              {!!editingOrder && editingHandle && (
                <p className="text-xs text-muted-foreground">
                  O @ será alterado no cadastro do cliente ao salvar o pedido.
                </p>
              )}

              {existingCustomer && !editingOrder && (
                <Alert className="mt-2 border-accent/50 bg-accent/10">
                  <Info className="h-4 w-4 text-accent" />
                  <AlertDescription className="text-sm">
                    Cliente encontrado! WhatsApp: <strong>{existingCustomer.whatsapp || "não informado"}</strong>.
                    {existingOrderInEvent && (
                      <> Existe um pedido ativo neste evento - novos produtos serão adicionados a ele.</>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="whatsapp" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                WhatsApp
              </Label>
              <Input
                id="whatsapp"
                placeholder="5511999999999"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                onBlur={() => {
                  if (whatsapp.trim()) {
                    const digits = whatsapp.replace(/\D/g, '');
                    // Only auto-prefix 55 if number looks like a Brazilian number (10-11 digits without country code)
                    // If it already starts with a country code (e.g. 1, 34, 351, etc.), leave it as-is
                    const normalized = (digits.length <= 11 && !digits.startsWith('55')) ? '55' + digits : digits;
                    setWhatsapp(normalized);
                  }
                }}
                disabled={false}
              />
              {whatsapp.trim() && (() => {
                const digits = whatsapp.replace(/\D/g, '');
                const wouldNormalize = (digits.length <= 11 && !digits.startsWith('55')) ? '55' + digits : digits;
                if (wouldNormalize !== whatsapp) {
                  return (
                    <p className="text-xs text-muted-foreground mt-1">
                      📱 Será salvo como: <strong>{wouldNormalize}</strong>
                    </p>
                  );
                }
                if (digits.length > 11 && !digits.startsWith('55')) {
                  return (
                    <p className="text-xs text-muted-foreground mt-1">
                      🌍 Número internacional detectado: <strong>+{digits}</strong>
                    </p>
                  );
                }
                return null;
              })()}
              {existingCustomerByWhatsApp && (
                <Alert className="mt-2 border-stage-paid/50 bg-stage-paid/10">
                  <Info className="h-4 w-4 text-stage-paid" />
                  <AlertDescription className="text-sm">
                    WhatsApp encontrado em outro cliente: <strong>{existingCustomerByWhatsApp.instagram_handle}</strong>.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Nome completo do cliente
            </Label>
            <Input
              id="fullName"
              placeholder="Maria Aparecida da Silva"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Alternativa segura ao WhatsApp: com nome e sobrenome, a cliente
              acessa a área de membros pelo nome completo — sem precisar falar o
              telefone em público na live.
            </p>
          </div>

          {editingOrder && (
            <div className="space-y-2">
              <Label>Etapa do Pedido</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as OrderStage)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${s.color}`} />
                        {s.title}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Products + Discount/Extras + Notes tabs */}
          <Tabs defaultValue="products" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="products" className="flex-1">
                Produtos ({localProducts.length})
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex-1">
                Observações
              </TabsTrigger>
            </TabsList>
            <TabsContent value="products" className="mt-4 space-y-4">
              <ProductSelector
                selectedProducts={localProducts}
                onAddProduct={handleAddLocalProduct}
                onRemoveProduct={handleRemoveLocalProduct}
                onUpdateQuantity={handleUpdateLocalQuantity}
              />

              {/* Discount & Extras - inline below products */}
              {localProducts.length > 0 && (
                <div className="space-y-4 pt-2 border-t">
                  {/* Discount */}
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      <Percent className="h-4 w-4" />
                      Desconto
                    </Label>
                    <div className="grid grid-cols-2 gap-3">
                      <Select 
                        value={discountType} 
                        onValueChange={(v) => setDiscountType(v as DiscountType | "")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Tipo de desconto" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4" />
                              Valor fixo (R$)
                            </div>
                          </SelectItem>
                          <SelectItem value="percentage">
                            <div className="flex items-center gap-2">
                              <Percent className="h-4 w-4" />
                              Percentual (%)
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        placeholder={discountType === 'percentage' ? 'Ex: 10' : 'Ex: 15.00'}
                        value={discountValue || ''}
                        onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                        disabled={!discountType}
                      />
                    </div>
                    {discountType && discountValue > 0 && (
                      <p className="text-sm text-stage-contacted">
                        Desconto de R$ {discountAmount.toFixed(2)} aplicado
                      </p>
                    )}
                  </div>

                  {/* Extras */}
                  <div className="space-y-3 pt-3 border-t">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="hasGift" className="flex items-center gap-2 cursor-pointer">
                        <Gift className="h-4 w-4 text-accent" />
                        Incluir Brinde?
                      </Label>
                      <Switch
                        id="hasGift"
                        checked={hasGift}
                        onCheckedChange={(v) => {
                          setHasGift(v);
                          if (!v) setGiftDescription("");
                        }}
                      />
                    </div>
                    {hasGift && (
                      <div className="space-y-1">
                        <Label htmlFor="giftDescription">Qual o brinde?</Label>
                        <Input
                          id="giftDescription"
                          placeholder="Ex: Meia soquete, Necessaire, Chaveiro..."
                          value={giftDescription}
                          onChange={(e) => setGiftDescription(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Essa informação vai automaticamente para o pedido na Expedição do PDV.
                        </p>
                      </div>
                    )}
                  </div>





                  {/* Free Shipping Toggle */}
                  <div className="flex items-center justify-between pt-3 border-t">
                    <Label htmlFor="freeShipping" className="flex items-center gap-2 cursor-pointer">
                      <Truck className="h-4 w-4 text-stage-paid" />
                      Frete Grátis
                    </Label>
                    <Switch
                      id="freeShipping"
                      checked={freeShipping}
                      onCheckedChange={setFreeShipping}
                    />
                  </div>

                  {/* Summary */}
                  <div className="p-4 bg-secondary/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Subtotal</span>
                      <span className="text-muted-foreground">
                        R$ {totalValue.toFixed(2)}
                      </span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-stage-contacted">Desconto</span>
                        <span className="text-stage-contacted">
                          -R$ {discountAmount.toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="font-medium">Total</span>
                      <span className="text-lg font-bold text-accent">
                        R$ {finalValue.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2 pt-2 border-t">
                      {localProducts.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-start justify-between text-sm text-muted-foreground gap-2"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="truncate">
                              {p.quantity}x {p.title}
                            </p>
                            {p.variant && (
                              <p className="text-xs text-accent font-medium">
                                {p.variant}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 flex-shrink-0"
                            onClick={() => handleRemoveLocalProduct(p.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="notes" className="mt-4">
              <div className="space-y-2">
                <Label htmlFor="notes" className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4" />
                  Observações
                </Label>
                <Textarea
                  id="notes"
                  placeholder="Anotações sobre o pedido..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Gerar Link / Pagamento */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">
              Gerar Link / Pagamento
            </Label>

            <div className="space-y-2">
              {/* Yampi + PayPal — ocultos temporariamente (mantidos no código para retorno futuro) */}
              {false && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className="h-11 text-sm font-bold bg-[hsl(45,100%,50%)] hover:bg-[hsl(45,100%,45%)] text-black gap-2"
                    onClick={generateYampiLink}
                    disabled={isGeneratingYampiLink || localProducts.length === 0}
                  >
                    {isGeneratingYampiLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                    Yampi
                  </Button>
                  <Button
                    type="button"
                    className="h-11 text-sm font-bold bg-[hsl(220,80%,55%)] hover:opacity-90 text-white gap-2"
                    onClick={generatePayPalLink}
                    disabled={isGeneratingPayPalLink || localProducts.length === 0 || !editingOrder}
                  >
                    {isGeneratingPayPalLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                    PayPal
                  </Button>
                </div>
              )}


              {/* Na Entrega */}
              <Button
                type="button"
                className={`w-full h-11 text-sm font-bold gap-2 ${isDelivery ? 'bg-[hsl(30,80%,50%)] text-white ring-2 ring-[hsl(30,80%,50%)] ring-offset-2' : 'bg-[hsl(30,80%,50%)] hover:bg-[hsl(30,80%,45%)] text-white'}`}
                onClick={async () => {
                  if (!editingOrder) {
                    toast.error("Salve o pedido primeiro");
                    return;
                  }
                  setIsDelivery(!isDelivery);
                  setIsPickup(false);
                  setPickupStoreId("");
                  if (!isDelivery) {
                    // Generate registration link
                    const url = `${window.location.origin}/register/${editingOrder.id}`;
                    setCartLink(url);
                    // Save to DB
                    await updateOrder(editingOrder.id, {
                      is_delivery: true,
                      is_pickup: false,
                      pickup_store_id: null,
                    } as any);
                    toast.success("Link de cadastro gerado! Envie para o cliente preencher os dados.");
                  } else {
                    await updateOrder(editingOrder.id, { is_delivery: false } as any);
                  }
                }}
                disabled={localProducts.length === 0 || !editingOrder}
              >
                <Truck className="h-5 w-5" />
                Na Entrega {isDelivery && "✓"}
              </Button>



            </div>

            {/* Cart link */}
            <div className="space-y-2">
              <Label htmlFor="cartLink" className="flex items-center gap-2">
                <Link className="h-4 w-4" />
                Link do Carrinho
              </Label>
              <div className="flex gap-2">
                <Input
                  id="cartLink"
                  placeholder="https://..."
                  value={cartLink}
                  onChange={(e) => setCartLink(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={generateCartLink}
                  disabled={isGeneratingCartLink || localProducts.length === 0}
                  title="Gerar link Shopify"
                >
                  {isGeneratingCartLink ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Pago Fora */}
            <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
              <Label htmlFor="paidExternally" className="flex items-center gap-2 cursor-pointer">
                <Wallet className="h-4 w-4 text-primary" />
                <div>
                  <span className="font-semibold">Pago por fora</span>
                  <p className="text-xs text-muted-foreground font-normal">
                    {(editingOrder as any)?.payment_confirmed_source === 'gateway_webhook'
                      ? 'Pagamento confirmado pelo gateway — não pode ser alterado.'
                      : 'PIX direto, dinheiro, etc.'}
                  </p>
                </div>
              </Label>
              <Switch
                id="paidExternally"
                checked={paidExternally}
                onCheckedChange={setPaidExternally}
                disabled={(editingOrder as any)?.payment_confirmed_source === 'gateway_webhook'}
              />
            </div>

            {editingOrder?.id && (
              <div className="rounded-lg border p-3 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={runGatewayLookup}
                  disabled={lookupLoading}
                >
                  {lookupLoading ? (
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 mr-2" />
                  )}
                  Verificar pagamento no gateway
                </Button>
                {lookup && (
                  <div className="rounded-md bg-muted/40 p-2 text-xs space-y-2">
                    {lookup.warning && (
                      <p className="text-amber-600 flex items-start gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        {lookup.warning}
                      </p>
                    )}
                    {(lookup.gateways || []).map((g: any, i: number) => (
                      <div key={i} className="space-y-1 border rounded p-2 bg-background">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase text-[10px] tracking-wide">
                            {g.gateway} {g.account ? `· ${g.account}` : ""}
                          </span>
                          {g.status && (
                            <Badge
                              variant={
                                g.status === "approved"
                                  ? "default"
                                  : g.status === "not_found"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {g.status}
                            </Badge>
                          )}
                        </div>
                        {g.error && (
                          <p className="text-destructive flex items-start gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            {g.error}
                          </p>
                        )}
                        {typeof g.amount === "number" && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Valor no gateway</span>
                            <span className={g.amountMatches ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                              R$ {Number(g.amount).toFixed(2).replace(".", ",")} {g.amountMatches ? "✓" : `≠ R$ ${Number(lookup.expectedTotal || 0).toFixed(2).replace(".", ",")}`}
                            </span>
                          </div>
                        )}
                        {g.externalReference !== undefined && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Ref. externa</span>
                            <span className={g.referenceMatches ? "text-emerald-600" : "text-destructive"}>
                              {g.externalReference || "—"} {g.referenceMatches ? "✓" : "≠ order.id"}
                            </span>
                          </div>
                        )}
                        {g.dateApproved && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Aprovado em</span>
                            <span>{new Date(g.dateApproved).toLocaleString("pt-BR")}</span>
                          </div>
                        )}
                        {g.payer?.email && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Pagador</span>
                            <span className="truncate max-w-[60%] text-right">{g.payer.email}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ID</span>
                          <span className="font-mono">{g.paymentId}</span>
                        </div>
                        {g.receiptUrl && (
                          <a
                            href={g.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Abrir no {g.gateway}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}


            {editingOrder && editingOrder.is_paid && isPhysicalEvent && (
              <div className="text-xs text-center text-muted-foreground bg-secondary/40 rounded-md py-2 px-3">
                Evento de loja física — pedido é enviado automaticamente para o PDV ao ser pago. Sem criação na Shopify.
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            {editingOrder && editingOrder.customer && !editingOrder.customer.is_banned && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive hover:text-destructive">
                    <Ban className="h-4 w-4 mr-2" />
                    Banir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Banir cliente?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O cliente <strong>{editingOrder.customer.instagram_handle}</strong> não poderá mais fazer pedidos.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="py-4">
                    <Label htmlFor="banReason">Motivo (opcional)</Label>
                    <Input
                      id="banReason"
                      placeholder="Ex: Não paga, troll, etc."
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      className="mt-2"
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleBanCustomer}
                    >
                      Confirmar Banimento
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button 
              className="flex-1 btn-accent" 
              onClick={() => handleSubmit()}
              disabled={isBanned || isSubmitting}
            >
              {isSubmitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{editingOrder ? "Salvando..." : "Criando..."}</>
              ) : (
                editingOrder ? "Salvar Alterações" : "Criar Pedido"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Confirmação: cliente com chargeback (Etapa 5) */}
      <AlertDialog open={showChargebackConfirm} onOpenChange={setShowChargebackConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">CLIENTE COM CHARGEBACK</AlertDialogTitle>
            <AlertDialogDescription>
              Este cliente já pediu estorno (chargeback) em uma compra anterior
              {orderChargebacks[0]?.source_order_name ? ` — ${orderChargebacks[0].source_order_name}` : ""}.
              Deseja prosseguir com o pedido assim mesmo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não montar pedido</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setChargebackConfirmed(true);
                setShowChargebackConfirm(false);
                setTimeout(() => handleSubmit(true), 0);
              }}
            >
              Prosseguir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>

  );
}

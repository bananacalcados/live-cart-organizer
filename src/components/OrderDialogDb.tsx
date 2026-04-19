import { useState, useEffect, useMemo, useCallback } from "react";
import { Instagram, Phone, StickyNote, X, Link, Info, Loader2, RefreshCw, Ban, Gift, Truck, Percent, DollarSign, ShoppingBag, Tag, Wallet, CreditCard, QrCode, Lock, Store, MapPin, Package } from "lucide-react";
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
}

export function OrderDialogDb({ open, onOpenChange, editingOrder, eventId, prefillInstagram }: OrderDialogDbProps) {
  const { findCustomerByInstagram, findCustomerByWhatsApp, createOrUpdateCustomer, banCustomer, customers } = useCustomerStore();
  const { createOrder, updateOrder, findActiveOrderByCustomer, orders } = useDbOrderStore();

  const [instagramHandle, setInstagramHandle] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cartLink, setCartLink] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<OrderStage>("new");
  const [localProducts, setLocalProducts] = useState<DbOrderProduct[]>([]);
  const [isGeneratingCartLink, setIsGeneratingCartLink] = useState(false);
  const [isGeneratingYampiLink, setIsGeneratingYampiLink] = useState(false);
  const [isGeneratingPayPalLink, setIsGeneratingPayPalLink] = useState(false);
  const [isGeneratingPixLink, setIsGeneratingPixLink] = useState(false);
  const [isCreatingShopifyOrder, setIsCreatingShopifyOrder] = useState(false);
  const [banReason, setBanReason] = useState("");
  
  // Discount and extras
  const [discountType, setDiscountType] = useState<DiscountType | "">("");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [freeShipping, setFreeShipping] = useState(false);
  const [hasGift, setHasGift] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [customShippingCost, setCustomShippingCost] = useState<string>("");
  const [paidExternally, setPaidExternally] = useState(false);

  // Pickup & delivery
  const [isPickup, setIsPickup] = useState(false);
  const [pickupStoreId, setPickupStoreId] = useState<string>("");
  const [isDelivery, setIsDelivery] = useState(false);
  const [pickupStores, setPickupStores] = useState<{id: string; name: string}[]>([]);
  const [isCreatingPickup, setIsCreatingPickup] = useState(false);

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

  // Check if there's an active order for this customer in current event
  const existingOrderInEvent = useMemo(() => {
    if (!existingCustomer || !eventId) return null;
    return findActiveOrderByCustomer(eventId, existingCustomer.id);
  }, [existingCustomer, eventId, findActiveOrderByCustomer, orders]);

  useEffect(() => {
    if (editingOrder) {
      setInstagramHandle(editingOrder.customer?.instagram_handle || "");
      setWhatsapp(editingOrder.customer?.whatsapp || "");
      setCartLink(editingOrder.cart_link || "");
      setNotes(editingOrder.notes || "");
      setStage(editingOrder.stage as OrderStage);
      setLocalProducts([...editingOrder.products]);
      setDiscountType(editingOrder.discount_type || "");
      setDiscountValue(editingOrder.discount_value || 0);
      setFreeShipping(editingOrder.free_shipping || false);
      setHasGift(editingOrder.has_gift || false);
      setCouponCode(editingOrder.coupon_code || "");
      setPaidExternally(editingOrder.paid_externally || false);
      setCustomShippingCost((editingOrder as any).custom_shipping_cost != null ? String((editingOrder as any).custom_shipping_cost) : "");
      setIsPickup((editingOrder as any).is_pickup || false);
      setPickupStoreId((editingOrder as any).pickup_store_id || "");
      setIsDelivery((editingOrder as any).is_delivery || false);
    } else {
      resetForm();
      if (prefillInstagram && open) {
        setInstagramHandle(prefillInstagram.replace(/^@/, ""));
      }
    }
  }, [editingOrder, open, prefillInstagram]);

  // Auto-fill whatsapp when existing customer is found
  useEffect(() => {
    if (existingCustomer && !editingOrder) {
      if (existingCustomer.whatsapp) {
        setWhatsapp(existingCustomer.whatsapp);
      }
    }
  }, [existingCustomer, editingOrder]);

  const resetForm = () => {
    setInstagramHandle("");
    setWhatsapp("");
    setCartLink("");
    setNotes("");
    setStage("new");
    setLocalProducts([]);
    setBanReason("");
    setDiscountType("");
    setDiscountValue(0);
    setFreeShipping(false);
    setHasGift(false);
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

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!instagramHandle.trim()) {
      toast.error("Informe o @ do Instagram");
      return;
    }
    setIsSubmitting(true);

    // Check if customer is banned
    const customer = findCustomerByInstagram(instagramHandle);
    if (customer?.is_banned) {
      toast.error(`Cliente ${customer.instagram_handle} está banido: ${customer.ban_reason || 'Sem motivo especificado'}`);
      return;
    }

    try {
      if (editingOrder) {
        // Update customer whatsapp if changed
        if (editingOrder.customer && whatsapp !== editingOrder.customer.whatsapp) {
          const normalizedWa = whatsapp ? normalizeBRPhone(whatsapp) : undefined;
          await createOrUpdateCustomer(editingOrder.customer.instagram_handle, normalizedWa);
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
          coupon_code: couponCode || null,
          paid_externally: paidExternally,
          is_pickup: isPickup,
          pickup_store_id: isPickup && pickupStoreId ? pickupStoreId : null,
          is_delivery: isDelivery,
        } as any;
        
        // If marking as paid externally, also mark as paid
        if (paidExternally && !editingOrder.is_paid) {
          orderUpdates.is_paid = true;
          orderUpdates.paid_at = new Date().toISOString();
        }
        
        await updateOrder(editingOrder.id, orderUpdates);

        // Refresh orders to reflect updated joined customer data
        await useDbOrderStore.getState().fetchOrdersByEvent(eventId);

        toast.success("Pedido atualizado!");
      } else {
        // Create or get customer
        const normalizedWa = whatsapp ? normalizeBRPhone(whatsapp) : undefined;
        const newCustomer = await createOrUpdateCustomer(instagramHandle, normalizedWa);
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
            if (hasGift) extraUpdates.has_gift = true;
            if (couponCode) extraUpdates.coupon_code = couponCode;
            if (notes) extraUpdates.notes = notes;
            if (paidExternally) {
              extraUpdates.paid_externally = true;
              extraUpdates.is_paid = true;
              extraUpdates.paid_at = new Date().toISOString();
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
          {isBanned && (
            <Alert className="border-destructive/50 bg-destructive/10">
              <Ban className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-sm text-destructive">
                <strong>Cliente banido!</strong> {existingCustomer?.ban_reason || editingOrder?.customer?.ban_reason || 'Sem motivo especificado'}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="instagram" className="flex items-center gap-2">
                <Instagram className="h-4 w-4" />
                Instagram *
              </Label>
              <Input
                id="instagram"
                placeholder="@usuario"
                value={instagramHandle}
                onChange={(e) => setInstagramHandle(e.target.value)}
                disabled={!!editingOrder}
              />
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
                        onCheckedChange={setHasGift}
                      />
                    </div>
                  </div>

                  {/* Coupon Code */}
                  <div className="space-y-2 pt-3 border-t">
                    <Label className="flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      Cupom de Desconto (Yampi)
                    </Label>
                    <Input
                      placeholder="Código do cupom (ex: DESCONTO20)"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    />
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
              {/* Checkout Loja */}
              <Button
                type="button"
                className="w-full h-12 text-base font-bold bg-accent hover:bg-accent/90 text-accent-foreground gap-2"
                onClick={async () => {
                  if (!editingOrder) {
                    toast.error("Salve o pedido primeiro");
                    return;
                  }
                  try {
                    const parsedShipping = customShippingCost ? parseFloat(customShippingCost) : null;
                    const orderUpdates: Partial<DbOrder> = {
                      products: localProducts,
                      discount_type: discountType || null,
                      discount_value: discountType ? (discountValue ?? 0) : 0,
                      free_shipping: freeShipping,
                      has_gift: hasGift,
                      coupon_code: couponCode || null,
                      notes: notes || null,
                      shipping_cost: editingOrder.shipping_cost ?? null,
                      custom_shipping_cost: parsedShipping,
                    } as any;
                    await updateOrder(editingOrder.id, orderUpdates);
                    const url = `${window.location.origin}/checkout/order/${editingOrder.id}`;
                    setCartLink(url);
                    toast.success("Pedido salvo e link do checkout gerado!");
                  } catch (error) {
                    console.error("Error saving order before checkout link:", error);
                    toast.error("Erro ao salvar pedido antes de gerar link");
                  }
                }}
                disabled={localProducts.length === 0 || !editingOrder}
              >
                <Lock className="h-5 w-5" />
                Checkout Loja (+10 pts)
              </Button>

              {/* Yampi + PayPal */}
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

              {/* PIX */}
              <Button
                type="button"
                className="w-full h-11 text-sm font-bold bg-[hsl(160,70%,40%)] hover:opacity-90 text-white gap-2"
                onClick={generatePixLink}
                disabled={isGeneratingPixLink || localProducts.length === 0 || !editingOrder}
              >
                {isGeneratingPixLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                PIX
              </Button>

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

              {/* Retirar na Loja */}
              <div className="space-y-2">
                <Button
                  type="button"
                  className={`w-full h-11 text-sm font-bold gap-2 ${isPickup ? 'bg-[hsl(170,60%,40%)] text-white ring-2 ring-[hsl(170,60%,40%)] ring-offset-2' : 'bg-[hsl(170,60%,40%)] hover:bg-[hsl(170,60%,35%)] text-white'}`}
                  onClick={() => {
                    if (!editingOrder) {
                      toast.error("Salve o pedido primeiro");
                      return;
                    }
                    setIsPickup(!isPickup);
                    setIsDelivery(false);
                    if (!isPickup) {
                      setCustomShippingCost("0");
                      setFreeShipping(true);
                    }
                  }}
                  disabled={localProducts.length === 0 || !editingOrder}
                >
                  <Package className="h-5 w-5" />
                  Retirar na Loja {isPickup && "✓"}
                </Button>

                {isPickup && (
                  <div className="grid grid-cols-2 gap-2">
                    {pickupStores.map((store) => (
                      <Button
                        key={store.id}
                        type="button"
                        variant={pickupStoreId === store.id ? "default" : "outline"}
                        className={`h-12 text-sm font-bold gap-2 ${pickupStoreId === store.id ? 'bg-[hsl(170,60%,40%)] text-white' : 'border-2 border-[hsl(170,60%,40%)] text-[hsl(170,60%,40%)]'}`}
                        onClick={async () => {
                          setPickupStoreId(store.id);
                          setCustomShippingCost("0");
                          setFreeShipping(true);
                          // Generate registration link for pickup
                          const url = `${window.location.origin}/register/${editingOrder!.id}`;
                          setCartLink(url);
                          // Save to DB
                          await updateOrder(editingOrder!.id, {
                            is_pickup: true,
                            pickup_store_id: store.id,
                            is_delivery: false,
                            custom_shipping_cost: 0,
                            free_shipping: true,
                          } as any);
                          toast.success(`Retirada na ${store.name} selecionada! Frete zerado.`);
                        }}
                      >
                        <Store className="h-4 w-4" />
                        {store.name.replace('Loja ', '')}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
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
                  <span>Pago Fora (Yampi/Shopify)</span>
                  <p className="text-xs text-muted-foreground font-normal">PIX direto, dinheiro, etc.</p>
                </div>
              </Label>
              <Switch
                id="paidExternally"
                checked={paidExternally}
                onCheckedChange={setPaidExternally}
              />
            </div>
            {editingOrder && editingOrder.is_paid && (
              <Button
                type="button"
                variant="outline"
                className="w-full text-primary hover:bg-primary/10"
                onClick={handleCreateShopifyOrder}
                disabled={isCreatingShopifyOrder || localProducts.length === 0}
              >
                {isCreatingShopifyOrder ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ShoppingBag className="h-4 w-4 mr-2" />
                )}
                Criar Pedido na Shopify
              </Button>
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
              onClick={handleSubmit}
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
    </Dialog>
  );
}

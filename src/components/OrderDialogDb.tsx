import { useState, useEffect, useMemo, useCallback } from "react";
import { Instagram, Phone, StickyNote, X, Link, Info, Loader2, RefreshCw, Ban, Gift, Truck, Percent, DollarSign } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createShopifyCartFromOrder } from "@/lib/shopifyCart";
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
}

export function OrderDialogDb({ open, onOpenChange, editingOrder, eventId }: OrderDialogDbProps) {
  const { findCustomerByInstagram, findCustomerByWhatsApp, createOrUpdateCustomer, banCustomer, customers } = useCustomerStore();
  const { createOrder, updateOrder, findActiveOrderByCustomer, orders } = useDbOrderStore();

  const [instagramHandle, setInstagramHandle] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cartLink, setCartLink] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<OrderStage>("new");
  const [localProducts, setLocalProducts] = useState<DbOrderProduct[]>([]);
  const [isGeneratingCartLink, setIsGeneratingCartLink] = useState(false);
  const [banReason, setBanReason] = useState("");
  
  // Discount and extras
  const [discountType, setDiscountType] = useState<DiscountType | "">("");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [freeShipping, setFreeShipping] = useState(false);
  const [hasGift, setHasGift] = useState(false);

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
    } else {
      resetForm();
    }
  }, [editingOrder, open]);

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

  const handleBanCustomer = async () => {
    if (editingOrder?.customer) {
      await banCustomer(editingOrder.customer.id, banReason);
      onOpenChange(false);
    }
  };

  const handleSubmit = async () => {
    if (!instagramHandle.trim()) {
      toast.error("Informe o @ do Instagram");
      return;
    }

    // Check if customer is banned
    const customer = findCustomerByInstagram(instagramHandle);
    if (customer?.is_banned) {
      toast.error(`Cliente ${customer.instagram_handle} está banido: ${customer.ban_reason || 'Sem motivo especificado'}`);
      return;
    }

    if (editingOrder) {
      // Update customer whatsapp if changed
      if (editingOrder.customer && whatsapp !== editingOrder.customer.whatsapp) {
        await createOrUpdateCustomer(editingOrder.customer.instagram_handle, whatsapp || undefined);
      }

      // Update existing order
      await updateOrder(editingOrder.id, {
        cart_link: cartLink || undefined,
        notes: notes || undefined,
        stage,
        products: localProducts,
        discount_type: discountType || undefined,
        discount_value: discountValue || undefined,
        free_shipping: freeShipping,
        has_gift: hasGift,
      });

      // Refresh orders to reflect updated joined customer data (e.g. whatsapp) in the cards/chat buttons
      await useDbOrderStore.getState().fetchOrdersByEvent(eventId);

      toast.success("Pedido atualizado!");
    } else {
      // Create or get customer
      const newCustomer = await createOrUpdateCustomer(instagramHandle, whatsapp || undefined);
      if (!newCustomer) {
        toast.error("Erro ao criar cliente");
        return;
      }

      // Check for existing active order in this event
      const activeOrder = findActiveOrderByCustomer(eventId, newCustomer.id);
      if (activeOrder) {
        // Add products to existing order instead of creating new one
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
        // Create new order
        await createOrder(eventId, newCustomer, localProducts);
      }
    }

    onOpenChange(false);
    resetForm();
  };

  const totalValue = localProducts.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );

  // Calculate discount
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
                placeholder="(11) 99999-9999"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                disabled={!!existingCustomer?.whatsapp && !editingOrder}
              />
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
                title="Gerar link do carrinho automaticamente"
              >
                {isGeneratingCartLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
            {localProducts.length > 0 && !cartLink && (
              <p className="text-xs text-muted-foreground">
                Clique no ícone para gerar o link automaticamente
              </p>
            )}
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

          <Tabs defaultValue="products" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="products" className="flex-1">
                Produtos ({localProducts.length})
              </TabsTrigger>
              <TabsTrigger value="extras" className="flex-1">
                Desconto/Extras
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex-1">
                Observações
              </TabsTrigger>
            </TabsList>
            <TabsContent value="products" className="mt-4">
              <ProductSelector
                selectedProducts={localProducts}
                onAddProduct={handleAddLocalProduct}
                onRemoveProduct={handleRemoveLocalProduct}
                onUpdateQuantity={handleUpdateLocalQuantity}
              />

              {localProducts.length > 0 && (
                <div className="mt-4 p-4 bg-secondary/50 rounded-lg space-y-2">
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
                  <div className="mt-2 space-y-1 pt-2 border-t">
                    {localProducts.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-sm text-muted-foreground"
                      >
                        <span>
                          {p.quantity}x {p.title}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemoveLocalProduct(p.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="extras" className="mt-4 space-y-4">
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

              {/* Free Shipping & Gift */}
              <div className="space-y-3 pt-4 border-t">
                <div className="flex items-center justify-between">
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
                
                <div className="flex items-center justify-between">
                  <Label htmlFor="hasGift" className="flex items-center gap-2 cursor-pointer">
                    <Gift className="h-4 w-4 text-accent" />
                    Incluir Brinde
                  </Label>
                  <Switch
                    id="hasGift"
                    checked={hasGift}
                    onCheckedChange={setHasGift}
                  />
                </div>
              </div>
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
              disabled={isBanned}
            >
              {editingOrder ? "Salvar Alterações" : "Criar Pedido"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

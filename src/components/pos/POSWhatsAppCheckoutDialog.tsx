import { useState, useEffect } from "react";
import {
  Search, Plus, Minus, ShoppingCart, Loader2, Copy, Check,
  Link2, X, Send,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts } from "@/lib/shopify";
import { toast } from "sonner";

interface CartItem {
  id: string;
  title: string;
  variantLabel: string;
  sku: string;
  price: number;
  quantity: number;
  imageUrl: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  phone: string;
  customerName?: string;
  sendVia: "zapi" | "meta";
  selectedNumberId: string | null;
}

export function POSWhatsAppCheckoutDialog({
  open, onOpenChange, storeId, phone, customerName, sendVia, selectedNumberId,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [products, setProducts] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [discountValue, setDiscountValue] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [shippingValue, setShippingValue] = useState("");
  const [freeShipping, setFreeShipping] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!open) return;
    loadProducts();
  }, [debouncedSearch, open]);

  const loadProducts = async () => {
    setLoading(true);
    const query = debouncedSearch.trim() ? `title:*${debouncedSearch}*` : undefined;
    const shopifyProducts = await fetchProducts(50, query);
    const items: CartItem[] = [];
    for (const sp of shopifyProducts) {
      const node = sp.node;
      const fallbackImg = node.images.edges[0]?.node.url || null;
      for (const ve of node.variants.edges) {
        const v = ve.node;
        if (!v.availableForSale) continue;
        const variantParts = v.selectedOptions.filter((o: any) => o.value !== "Default Title").map((o: any) => o.value);
        items.push({
          id: `${node.id}::${v.id}`,
          title: node.title,
          variantLabel: variantParts.join(" / "),
          sku: v.sku || "",
          price: parseFloat(v.price.amount),
          quantity: 1,
          imageUrl: v.image?.url || fallbackImg,
        });
      }
    }
    setProducts(items);
    setLoading(false);
  };

  const addToCart = (item: CartItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.map(c => c.id !== id ? c : { ...c, quantity: Math.max(1, c.quantity + delta) }));
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));

  const cartSubtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const discountAmount = (() => {
    const val = parseFloat(discountValue);
    if (!val || val <= 0) return 0;
    return discountType === "percent" ? Math.min(cartSubtotal, cartSubtotal * (val / 100)) : Math.min(cartSubtotal, val);
  })();
  const shippingAmount = freeShipping ? 0 : (parseFloat(shippingValue) || 0);
  const orderTotal = Math.max(0, cartSubtotal - discountAmount) + shippingAmount;

  const handleGenerate = async () => {
    if (cart.length === 0) { toast.error("Adicione produtos"); return; }
    setGenerating(true);
    try {
      const salePayload = {
        store_id: storeId,
        subtotal: cartSubtotal,
        discount: discountAmount > 0 ? discountAmount : 0,
        total: orderTotal,
        status: "online_pending",
        sale_type: "online",
        payment_gateway: "store-checkout",
        payment_details: {
          customer_name: customerName || null,
          customer_phone: phone,
          discount_amount: discountAmount,
          discount_type: discountType,
          discount_value: discountValue,
          shipping_amount: shippingAmount,
          free_shipping: freeShipping,
          items_detail: cart.map(c => ({
            title: c.title, variant: c.variantLabel, unit_price: c.price, quantity: c.quantity,
          })),
        },
      };
      const { data: sale, error } = await supabase.from("pos_sales").insert(salePayload as any).select("id").single();
      if (error || !sale) throw new Error(error?.message || "Erro ao criar venda");

      const saleItems = cart.map(c => ({
        sale_id: sale.id, sku: c.sku || null, product_name: c.title,
        variant_name: c.variantLabel || null, unit_price: c.price,
        quantity: c.quantity, total_price: c.price * c.quantity,
      }));
      await supabase.from("pos_sale_items").insert(saleItems as any);

      const link = `https://checkout.bananacalcados.com.br/checkout-loja/${storeId}/${sale.id}`;
      setGeneratedLink(link);

      // Add to awaiting payment
      await supabase.from("chat_awaiting_payment").upsert({
        phone,
        sale_id: sale.id,
        type: 'checkout',
      } as any, { onConflict: 'phone' });

      // Create follow-up timer (first reminder in 30 min)
      const nextReminder = new Date();
      nextReminder.setMinutes(nextReminder.getMinutes() + 30);
      await supabase.from("chat_payment_followups").insert({
        phone,
        sale_id: sale.id,
        type: 'checkout',
        next_reminder_at: nextReminder.toISOString(),
        whatsapp_number_id: sendVia === "meta" ? selectedNumberId : null,
      } as any);

      toast.success("Link gerado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar link");
    } finally {
      setGenerating(false);
    }
  };

  const handleSendLink = async () => {
    if (!generatedLink) return;
    setSending(true);
    try {
      const message = `Olá${customerName ? ` ${customerName.split(' ')[0]}` : ''}! 🛍️\n\nSeu link de compra está pronto:\n${generatedLink}\n\nÉ só clicar, conferir e finalizar! 😊`;
      if (sendVia === "meta" && selectedNumberId) {
        await supabase.functions.invoke("meta-whatsapp-send", { body: { phone, message, whatsapp_number_id: selectedNumberId } });
      } else {
        await supabase.functions.invoke("zapi-send-message", { body: { phone, message, whatsapp_number_id: selectedNumberId } });
      }
      await supabase.from("whatsapp_messages").insert({
        phone, message, direction: "outgoing", status: "sent",
        whatsapp_number_id: selectedNumberId || null,
      });
      toast.success("Link enviado!");
      onOpenChange(false);
      setCart([]);
      setGeneratedLink("");
      setDiscountValue("");
      setShippingValue("");
    } catch {
      toast.error("Erro ao enviar");
    } finally {
      setSending(false);
    }
  };

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Gerar Link de Checkout
          </DialogTitle>
        </DialogHeader>

        {generatedLink ? (
          <div className="space-y-4 p-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800 text-center space-y-3">
              <Check className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="font-bold text-lg">Link Gerado!</p>
              <p className="text-sm font-bold">{fmt(orderTotal)}</p>
              <div className="bg-white dark:bg-background p-3 rounded text-xs font-mono break-all border">{generatedLink}</div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={async () => {
                  await navigator.clipboard.writeText(generatedLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}>
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? "Copiado!" : "Copiar"}
                </Button>
                <Button className="flex-1 bg-[#00a884] hover:bg-[#008c6f]" onClick={handleSendLink} disabled={sending}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Enviar via WhatsApp
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden gap-3">
            {/* Search */}
            <div className="relative px-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar produto..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-9" />
            </div>

            <div className="flex flex-1 overflow-hidden gap-3 min-h-0">
              {/* Product List */}
              <ScrollArea className="flex-1 border rounded-lg">
                <div className="p-2 space-y-1">
                  {loading ? (
                    <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
                  ) : products.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-4">Nenhum produto</p>
                  ) : products.map(item => (
                    <div key={item.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => addToCart(item)}>
                      {item.imageUrl && <img src={item.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{item.title}</p>
                        {item.variantLabel && <p className="text-[10px] text-muted-foreground">{item.variantLabel}</p>}
                      </div>
                      <span className="text-xs font-bold text-primary shrink-0">{fmt(item.price)}</span>
                      <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Cart */}
              <div className="w-[280px] border rounded-lg p-3 flex flex-col gap-2 shrink-0">
                <h4 className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1">
                  <ShoppingCart className="h-3 w-3" /> Carrinho ({cart.reduce((s, c) => s + c.quantity, 0)})
                </h4>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-2">
                    {cart.map(item => (
                      <div key={item.id} className="p-2 bg-muted/30 rounded space-y-1">
                        <div className="flex items-start justify-between">
                          <p className="text-xs font-medium flex-1">{item.title}</p>
                          <button onClick={() => removeFromCart(item.id)}><X className="h-3 w-3 text-destructive" /></button>
                        </div>
                        {item.variantLabel && <p className="text-[10px] text-muted-foreground">{item.variantLabel}</p>}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <button onClick={() => updateQty(item.id, -1)} className="h-5 w-5 rounded bg-muted flex items-center justify-center"><Minus className="h-3 w-3" /></button>
                            <span className="text-xs w-6 text-center">{item.quantity}</span>
                            <button onClick={() => updateQty(item.id, 1)} className="h-5 w-5 rounded bg-muted flex items-center justify-center"><Plus className="h-3 w-3" /></button>
                          </div>
                          <span className="text-xs font-bold">{fmt(item.price * item.quantity)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {/* Discount & Shipping */}
                <div className="space-y-2 border-t pt-2">
                  <div className="flex gap-1">
                    <div className="flex-1">
                      <Label className="text-[10px]">Desconto</Label>
                      <div className="flex gap-1">
                        <Input value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="0" className="h-7 text-xs" type="number" />
                        <button onClick={() => setDiscountType(discountType === "fixed" ? "percent" : "fixed")} className="h-7 px-2 rounded bg-muted text-[10px] font-bold shrink-0">
                          {discountType === "fixed" ? "R$" : "%"}
                        </button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <Label className="text-[10px]">Frete</Label>
                      <Input value={shippingValue} onChange={(e) => setShippingValue(e.target.value)} placeholder="0" className="h-7 text-xs" type="number" disabled={freeShipping} />
                    </div>
                    <div className="flex items-end gap-1.5 pb-0.5">
                      <Checkbox checked={freeShipping} onCheckedChange={(v) => { setFreeShipping(!!v); if (v) setShippingValue(""); }} id="free-ship" />
                      <Label htmlFor="free-ship" className="text-[10px] cursor-pointer">Frete Grátis</Label>
                    </div>
                  </div>

                {/* Totals */}
                <div className="border-t pt-2 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>Subtotal</span><span>{fmt(cartSubtotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-xs text-destructive">
                      <span>Desconto</span><span>-{fmt(discountAmount)}</span>
                    </div>
                  )}
                   {freeShipping ? (
                     <div className="flex justify-between text-xs">
                       <span>Frete</span><span className="text-green-600 font-medium">GRÁTIS ✅</span>
                     </div>
                   ) : shippingAmount > 0 ? (
                     <div className="flex justify-between text-xs">
                       <span>Frete</span><span>{fmt(shippingAmount)}</span>
                     </div>
                   ) : null}
                  <div className="flex justify-between text-sm font-bold">
                    <span>Total</span><span className="text-primary">{fmt(orderTotal)}</span>
                  </div>
                </div>
                </div>

                <Button onClick={handleGenerate} disabled={generating || cart.length === 0} className="w-full h-9 text-sm bg-[#00a884] hover:bg-[#008c6f]">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
                  Gerar Link
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

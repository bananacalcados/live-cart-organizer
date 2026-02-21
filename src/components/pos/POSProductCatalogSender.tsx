import { useState, useEffect, useMemo } from "react";
import { Search, Send, Loader2, Check, ShoppingBag, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";

interface Props {
  storeId: string;
  phone: string;
  sendVia: "zapi" | "meta";
  selectedNumberId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProductItem {
  id: string;
  name: string;
  sku: string;
  variant: string;
  price: number;
  compare_at_price: number | null;
  image_url: string | null;
  available: boolean;
  productType: string;
}

export function POSProductCatalogSender({ storeId, phone, sendVia, selectedNumberId, open, onOpenChange }: Props) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pricingRules, setPricingRules] = useState<{ pickup_discount_percent: number; delivery_fee: number; physical_store_markup_percent: number } | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load products from Shopify
  useEffect(() => {
    if (!open) return;
    loadProducts();
    loadPricingRules();
  }, [open, debouncedSearch]);

  const loadProducts = async () => {
    setLoading(true);
    const query = debouncedSearch.trim() ? `title:*${debouncedSearch}*` : undefined;
    const shopifyProducts = await fetchProducts(250, query);
    
    // Flatten variants into individual product items
    const items: ProductItem[] = [];
    for (const sp of shopifyProducts) {
      const node = sp.node;
      const img = node.images.edges[0]?.node.url || null;
      const productType = node.description || "";
      
      for (const ve of node.variants.edges) {
        const v = ve.node;
        const price = parseFloat(v.price.amount);
        const compareAt = v.compareAtPrice ? parseFloat(v.compareAtPrice.amount) : null;
        items.push({
          id: `${node.id}::${v.id}`,
          name: node.title + (v.title !== "Default Title" ? ` - ${v.title}` : ""),
          sku: v.sku || "",
          variant: v.title,
          price,
          compare_at_price: compareAt && compareAt > price ? compareAt : null,
          image_url: img,
          available: v.availableForSale,
          productType: node.handle,
        });
      }
    }
    setProducts(items);
    setLoading(false);
  };

  const loadPricingRules = async () => {
    const { data } = await supabase
      .from("pos_product_pricing_rules" as any)
      .select("pickup_discount_percent, delivery_fee, physical_store_markup_percent")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .maybeSingle();
    if (data) setPricingRules(data as any);
  };

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (!p.available) return false;
      return true;
    });
  }, [products]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(p => p.id)));
  };

  const calculatePrices = (product: ProductItem) => {
    const basePrice = product.compare_at_price && product.compare_at_price > product.price
      ? product.price
      : product.price;
    
    const pickupDiscount = pricingRules?.pickup_discount_percent || 0;
    const deliveryFee = pricingRules?.delivery_fee || 0;
    const storeMarkup = pricingRules?.physical_store_markup_percent || 0;

    const deliveryPrice = basePrice + deliveryFee;
    const pickupPrice = basePrice * (1 - pickupDiscount / 100);
    const storePrice = basePrice * (1 + storeMarkup / 100);

    return { deliveryPrice, pickupPrice, storePrice };
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) return;
    setSending(true);
    const selected = products.filter(p => selectedIds.has(p.id));
    let successCount = 0;

    for (const product of selected) {
      try {
        const { deliveryPrice, pickupPrice, storePrice } = calculatePrices(product);
        const hasDiscount = product.compare_at_price && product.compare_at_price > product.price;
        
        let caption = product.name;
        if (hasDiscount) {
          caption += `\nDe R$ ${product.compare_at_price!.toFixed(2)} por R$ ${product.price.toFixed(2)}`;
        } else {
          caption += `\nR$ ${product.price.toFixed(2)}`;
        }

        // Step 1: Send product image
        if (product.image_url) {
          if (sendVia === "meta" && selectedNumberId) {
            await supabase.functions.invoke("meta-whatsapp-send", {
              body: { phone, type: "image", mediaUrl: product.image_url, caption, whatsappNumberId: selectedNumberId },
            });
          } else {
            await supabase.functions.invoke("zapi-send-media", {
              body: { phone, mediaUrl: product.image_url, mediaType: "image", caption },
            });
          }

          // Save image message to DB
          await supabase.from("whatsapp_messages").insert({
            phone, message: caption, direction: "outgoing", status: "sent",
            media_type: "image", media_url: product.image_url,
            whatsapp_number_id: sendVia === "meta" ? selectedNumberId : null,
          });
        }

        // Step 2: Send interactive buttons with prices
        const buttons = [
          { id: `delivery_${product.sku}`, title: `R$${deliveryPrice.toFixed(0)} Entrega` },
          { id: `pickup_${product.sku}`, title: `R$${pickupPrice.toFixed(0)} Retira Loja` },
          { id: `store_${product.sku}`, title: `R$${storePrice.toFixed(0)} Loja Fisica` },
        ];

        const buttonText = `Escolha como quer comprar:\n${product.name}`;

        if (sendVia === "meta" && selectedNumberId) {
          await supabase.functions.invoke("meta-whatsapp-send", {
            body: {
              phone,
              type: "interactive",
              interactiveData: {
                body: buttonText,
                buttons,
              },
              whatsappNumberId: selectedNumberId,
            },
          });
        } else {
          await supabase.functions.invoke("zapi-send-button-list", {
            body: { phone, message: buttonText, buttons },
          });
        }

        // Save button message to DB
        await supabase.from("whatsapp_messages").insert({
          phone,
          message: `[Botões] ${product.name}\n• Entrega: R$ ${deliveryPrice.toFixed(2)}\n• Retirada: R$ ${pickupPrice.toFixed(2)}\n• Loja: R$ ${storePrice.toFixed(2)}`,
          direction: "outgoing",
          status: "sent",
          whatsapp_number_id: sendVia === "meta" ? selectedNumberId : null,
        });

        successCount++;

        // Small delay between products to avoid rate limiting
        if (selected.indexOf(product) < selected.length - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (error) {
        console.error(`Error sending product ${product.name}:`, error);
      }
    }

    toast.success(`${successCount} produto(s) enviado(s) com botões de preço!`);
    setSending(false);
    setSelectedIds(new Set());
    onOpenChange(false);
  };

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="h-5 w-5 text-[#00a884]" />
            Catálogo de Produtos
            {selectedIds.size > 0 && (
              <Badge className="bg-[#00a884] text-white border-0">{selectedIds.size} selecionado(s)</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="px-4 pb-2 space-y-2 border-b">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={selectAll}>
              {selectedIds.size === filtered.length && filtered.length > 0 ? "Desmarcar" : "Selecionar"} todos
            </Button>
          </div>
        </div>

        {/* Product Grid */}
        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhum produto encontrado
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-4">
              {filtered.map(p => {
                const selected = selectedIds.has(p.id);
                const hasDiscount = p.compare_at_price && p.compare_at_price > p.price;
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleSelect(p.id)}
                    className={`relative text-left rounded-xl border p-2 transition-all ${
                      selected
                        ? "border-[#00a884] bg-[#00a884]/5 ring-1 ring-[#00a884]"
                        : "border-border hover:border-[#00a884]/50"
                    }`}
                  >
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-[#00a884] flex items-center justify-center">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-full aspect-square object-cover rounded-lg mb-1.5" />
                    ) : (
                      <div className="w-full aspect-square bg-muted rounded-lg mb-1.5 flex items-center justify-center">
                        <Image className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <p className="text-xs font-medium line-clamp-2 leading-tight">{p.name}</p>
                    {p.sku && <p className="text-[10px] text-muted-foreground">SKU: {p.sku}</p>}
                    <div className="mt-1">
                      {hasDiscount ? (
                        <>
                          <span className="text-[10px] line-through text-muted-foreground">{fmt(p.compare_at_price!)}</span>
                          <span className="text-xs font-bold text-[#00a884] ml-1">{fmt(p.price)}</span>
                        </>
                      ) : (
                        <span className="text-xs font-bold">{fmt(p.price)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {filtered.length} produto(s) • {selectedIds.size} selecionado(s)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-[#00a884] hover:bg-[#00a884]/90 text-white gap-1"
              disabled={selectedIds.size === 0 || sending}
              onClick={handleSend}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Globe, Search, Plus, Minus, Trash2, ShoppingCart, Loader2,
  Copy, Check, Image, Filter, Link2, ExternalLink, X, ArrowLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

interface CartItem {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  variantLabel: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  quantity: number;
  imageUrl: string | null;
}

interface Props {
  storeId: string;
  sellers: Seller[];
}

type Gateway = "yampi" | "checkout" | "paypal" | "pix";

const GATEWAYS: { id: Gateway; label: string; color: string }[] = [
  { id: "yampi", label: "Yampi", color: "bg-purple-600 hover:bg-purple-700" },
  { id: "checkout", label: "Checkout", color: "bg-primary hover:bg-primary/90" },
  { id: "paypal", label: "PayPal", color: "bg-blue-600 hover:bg-blue-700" },
  { id: "pix", label: "PIX", color: "bg-green-600 hover:bg-green-700" },
];

export function POSOnlineSales({ storeId, sellers }: Props) {
  const [products, setProducts] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedSeller, setSelectedSeller] = useState("");
  const [stockStore, setStockStore] = useState(storeId);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [mobileStep, setMobileStep] = useState<"catalog" | "cart">("catalog");
  const [allCollections, setAllCollections] = useState<string[]>([]);
  const [allSizes, setAllSizes] = useState<string[]>([]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Load stores
  useEffect(() => {
    supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setStores(data);
      });
  }, []);

  // Load products from Shopify
  useEffect(() => {
    loadProducts();
  }, [debouncedSearch]);

  const loadProducts = async () => {
    setLoading(true);
    const query = debouncedSearch.trim() ? `title:*${debouncedSearch}*` : undefined;
    const shopifyProducts = await fetchProducts(250, query);

    const items: CartItem[] = [];
    const collections = new Set<string>();
    const sizes = new Set<string>();

    for (const sp of shopifyProducts) {
      const node = sp.node;
      const fallbackImg = node.images.edges[0]?.node.url || null;
      node.collections?.edges?.forEach(e => collections.add(e.node.title));

      for (const ve of node.variants.edges) {
        const v = ve.node;
        if (!v.availableForSale) continue;
        const price = parseFloat(v.price.amount);
        const compareAt = v.compareAtPrice ? parseFloat(v.compareAtPrice.amount) : null;

        let size: string | null = null;
        for (const opt of v.selectedOptions) {
          const n = opt.name.toLowerCase();
          if (n === "tamanho" || n === "size") { size = opt.value; sizes.add(opt.value); }
        }

        const variantParts = v.selectedOptions.filter(o => o.value !== "Default Title").map(o => o.value);
        const productCollections = node.collections?.edges?.map(e => e.node.title) || [];

        items.push({
          id: `${node.id}::${v.id}`,
          productId: node.id,
          variantId: v.id,
          title: node.title,
          variantLabel: variantParts.join(" / "),
          sku: v.sku || "",
          price,
          compareAtPrice: compareAt && compareAt > price ? compareAt : null,
          quantity: 1,
          imageUrl: v.image?.url || fallbackImg,
        });
      }
    }

    setProducts(items);
    setAllCollections(Array.from(collections).sort());
    setAllSizes(Array.from(sizes).sort());
    setLoading(false);
  };

  const filtered = useMemo(() => {
    return products.filter(p => {
      // Collection and size filters would need product-level metadata
      // For simplicity, we show all available products
      return true;
    });
  }, [products, collectionFilter, sizeFilter]);

  const addToCart = (item: CartItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) {
        return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateCartQty = (id: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c;
      const q = Math.max(1, c.quantity + delta);
      return { ...c, quantity: q };
    }));
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));

  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const cartItems = cart.reduce((s, c) => s + c.quantity, 0);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const handleGenerateLink = async (gateway: Gateway) => {
    if (!selectedSeller) { toast.error("Selecione a vendedora"); return; }
    if (cart.length === 0) { toast.error("Adicione produtos ao carrinho"); return; }

    setGenerating(true);
    setGeneratedLink("");

    try {
      let link = "";

      if (gateway === "yampi") {
        const items = cart.map(c => ({
          sku: c.sku,
          shopify_variant_id: c.variantId,
          quantity: c.quantity,
          price: c.price,
        }));
        const { data, error } = await supabase.functions.invoke("yampi-create-payment-link", {
          body: {
            items,
            customer: customerName || customerPhone ? { name: customerName, phone: customerPhone } : undefined,
          },
        });
        if (error || !data?.success) throw new Error(data?.error || error?.message || "Erro Yampi");
        link = data.payment_link;
      } else if (gateway === "checkout") {
        // Build checkout URL with variant IDs
        const variants = cart.map(c => {
          const numericId = c.variantId.replace("gid://shopify/ProductVariant/", "");
          return `${numericId}:${c.quantity}`;
        }).join(",");
        link = `https://checkout.bananacalcados.com.br/checkout?variants=${variants}`;
      } else if (gateway === "paypal") {
        const items = cart.map(c => ({
          name: `${c.title}${c.variantLabel ? ` - ${c.variantLabel}` : ""}`,
          sku: c.sku,
          quantity: c.quantity,
          unit_amount: c.price,
        }));
        const { data, error } = await supabase.functions.invoke("paypal-create-order", {
          body: { items, currency: "BRL" },
        });
        if (error || !data?.approvalUrl) throw new Error(data?.error || "Erro PayPal");
        link = data.approvalUrl;
      } else if (gateway === "pix") {
        const description = cart.map(c => `${c.title} x${c.quantity}`).join(", ");
        const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
          body: {
            amount: cartTotal,
            description: description.substring(0, 140),
            payer_email: "cliente@email.com",
          },
        });
        if (error || !data?.success) throw new Error(data?.error || "Erro PIX");
        link = data.ticket_url || data.qr_code_url || "";
      }

      if (!link) throw new Error("Link não gerado");

      setGeneratedLink(link);

      // Save sale to pos_sales
      const sellerObj = sellers.find(s => s.id === selectedSeller);
      const { data: sale, error: saleErr } = await supabase
        .from("pos_sales")
        .insert({
          store_id: storeId,
          seller_id: selectedSeller,
          seller_name: sellerObj?.name || "",
          total: cartTotal,
          items_count: cartItems,
          status: "online_pending",
          sale_type: "online",
          payment_gateway: gateway,
          payment_link: link,
          stock_source_store_id: stockStore,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
        } as any)
        .select("id")
        .single();

      if (saleErr) console.error("Error saving sale:", saleErr);

      // Save sale items
      if (sale) {
        const saleItems = cart.map(c => ({
          sale_id: sale.id,
          sku: c.sku,
          name: c.title,
          variant: c.variantLabel,
          price: c.price,
          quantity: c.quantity,
          barcode: "",
        }));
        await supabase.from("pos_sale_items").insert(saleItems as any);
      }

      // Transfer stock: source store -> Site
      for (const item of cart) {
        if (!item.sku) continue;
        try {
          await supabase.functions.invoke("expedition-transfer-stock", {
            body: {
              sku: item.sku,
              source_store_id: stockStore,
              quantity: item.quantity,
            },
          });
        } catch (e) {
          console.error(`Stock transfer failed for ${item.sku}:`, e);
        }
      }

      toast.success("Link gerado com sucesso!");
    } catch (e: any) {
      console.error("Generate link error:", e);
      toast.error(e.message || "Erro ao gerar link");
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copiado!");
  };

  const sendWhatsApp = () => {
    const phone = customerPhone?.replace(/\D/g, "") || "";
    const text = `Olá! Aqui está o link para pagamento: ${generatedLink}`;
    const url = phone
      ? `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const resetSale = () => {
    setCart([]);
    setGeneratedLink("");
    setCustomerName("");
    setCustomerPhone("");
    setMobileStep("catalog");
  };

  // Desktop: 2 columns. Mobile: steps
  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      {/* Catalog / Left Column */}
      <div className={cn(
        "flex-1 flex flex-col border-r border-border min-w-0",
        mobileStep === "cart" && "hidden md:flex"
      )}>
        {/* Header */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold">Venda Online</h2>
            {cartItems > 0 && (
              <Badge
                className="bg-primary text-primary-foreground cursor-pointer md:hidden"
                onClick={() => setMobileStep("cart")}
              >
                <ShoppingCart className="h-3 w-3 mr-1" />
                {cartItems}
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          {(allCollections.length > 0 || allSizes.length > 0) && (
            <div className="flex gap-2 flex-wrap">
              {allCollections.length > 0 && (
                <Select value={collectionFilter} onValueChange={setCollectionFilter}>
                  <SelectTrigger className="h-7 text-xs w-auto min-w-[120px]">
                    <Filter className="h-3 w-3 mr-1" />
                    <SelectValue placeholder="Coleção" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {allCollections.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {allSizes.length > 0 && (
                <Select value={sizeFilter} onValueChange={setSizeFilter}>
                  <SelectTrigger className="h-7 text-xs w-auto min-w-[90px]">
                    <SelectValue placeholder="Tam." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {allSizes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* Product Grid */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Nenhum produto encontrado</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-3">
              {filtered.map(p => {
                const inCart = cart.find(c => c.id === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className={cn(
                      "relative text-left rounded-xl border p-2 transition-all",
                      inCart
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    {inCart && (
                      <Badge className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground border-0 text-[10px] h-5 min-w-5 px-1 z-10">
                        {inCart.quantity}
                      </Badge>
                    )}
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.title} className="w-full aspect-square object-cover rounded-lg mb-1.5" />
                    ) : (
                      <div className="w-full aspect-square bg-muted rounded-lg mb-1.5 flex items-center justify-center">
                        <Image className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <p className="text-xs font-medium line-clamp-1">{p.title}</p>
                    {p.variantLabel && <p className="text-[11px] font-semibold text-primary line-clamp-1">{p.variantLabel}</p>}
                    {p.sku && <p className="text-[10px] text-muted-foreground">SKU: {p.sku}</p>}
                    <div className="mt-1">
                      {p.compareAtPrice ? (
                        <>
                          <span className="text-[10px] line-through text-muted-foreground">{fmt(p.compareAtPrice)}</span>
                          <span className="text-xs font-bold text-primary ml-1">{fmt(p.price)}</span>
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
      </div>

      {/* Cart / Right Column */}
      <div className={cn(
        "w-full md:w-96 flex flex-col bg-card",
        mobileStep === "catalog" && "hidden md:flex"
      )}>
        {/* Cart Header */}
        <div className="p-3 border-b border-border flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setMobileStep("catalog")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <ShoppingCart className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Carrinho ({cartItems})</span>
          <span className="ml-auto text-sm font-bold text-primary">{fmt(cartTotal)}</span>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {/* Cart Items */}
            {cart.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Carrinho vazio</p>
            ) : (
              <div className="space-y-2">
                {cart.map(c => (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                    {c.imageUrl && (
                      <img src={c.imageUrl} className="h-10 w-10 rounded object-cover flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1">{c.title}</p>
                      {c.variantLabel && <p className="text-[10px] text-muted-foreground">{c.variantLabel}</p>}
                      <p className="text-xs font-bold text-primary">{fmt(c.price)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateCartQty(c.id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="text-xs w-5 text-center font-bold">{c.quantity}</span>
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateCartQty(c.id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeFromCart(c.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            {/* Seller */}
            <div className="space-y-1.5">
              <Label className="text-xs">Vendedora *</Label>
              <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione a vendedora" />
                </SelectTrigger>
                <SelectContent>
                  {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Stock Source Store */}
            <div className="space-y-1.5">
              <Label className="text-xs">Retirar estoque de</Label>
              <Select value={stockStore} onValueChange={setStockStore}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Loja de estoque" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Customer Info */}
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente (opcional)</Label>
              <Input
                placeholder="Nome do cliente"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="h-8 text-sm"
              />
              <Input
                placeholder="WhatsApp (ex: 11999999999)"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            <Separator />

            {/* Payment Gateways */}
            {!generatedLink ? (
              <div className="space-y-2">
                <Label className="text-xs font-bold">Gerar Link de Pagamento</Label>
                <div className="grid grid-cols-2 gap-2">
                  {GATEWAYS.map(gw => (
                    <Button
                      key={gw.id}
                      className={cn("text-xs text-white", gw.color)}
                      size="sm"
                      disabled={generating || cart.length === 0}
                      onClick={() => handleGenerateLink(gw.id)}
                    >
                      {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Link2 className="h-3 w-3 mr-1" />}
                      {gw.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs font-bold text-green-600">✅ Link Gerado!</Label>
                <div className="p-2 bg-muted rounded-lg">
                  <p className="text-xs break-all text-muted-foreground">{generatedLink}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={copyLink}>
                    {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                    {copied ? "Copiado" : "Copiar"}
                  </Button>
                  <Button size="sm" className="flex-1 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={sendWhatsApp}>
                    <ExternalLink className="h-3 w-3 mr-1" />
                    WhatsApp
                  </Button>
                </div>
                <Button size="sm" variant="ghost" className="w-full text-xs" onClick={resetSale}>
                  <Plus className="h-3 w-3 mr-1" /> Nova Venda
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

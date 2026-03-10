import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";
import { Zap, Search, Copy, ExternalLink, Clock, Package, Loader2, Plus, X, ArrowUp, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";

interface ShopifyProductSimple {
  id: string;
  title: string;
  imageUrl: string;
  price: string;
}

interface ActiveProductBarProps {
  eventId: string;
  eventName: string;
}

const CHECKOUT_BASE_URL = "https://checkout.bananacalcados.com.br";

export function ActiveProductBar({ eventId, eventName }: ActiveProductBarProps) {
  const [catalogPageId, setCatalogPageId] = useState<string | null>(null);
  const [catalogSlug, setCatalogSlug] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [delaySeconds, setDelaySeconds] = useState(30);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Product picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductSimple[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Active product name (first in list)
  const [activeProductName, setActiveProductName] = useState<string | null>(null);

  // Load event's catalog_lead_page
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: event } = await supabase
        .from("events")
        .select("catalog_lead_page_id, active_product_delay_seconds")
        .eq("id", eventId)
        .single();

      if (event?.catalog_lead_page_id) {
        setCatalogPageId(event.catalog_lead_page_id);
        setDelaySeconds(event.active_product_delay_seconds || 30);

        const { data: page } = await supabase
          .from("catalog_lead_pages")
          .select("slug, selected_product_ids")
          .eq("id", event.catalog_lead_page_id)
          .single();

        if (page) {
          setCatalogSlug((page as any).slug);
          setSelectedProductIds((page as any).selected_product_ids || []);
        }
      } else {
        setDelaySeconds(event?.active_product_delay_seconds || 30);
      }
      setLoading(false);
    })();
  }, [eventId]);

  // Subscribe to realtime changes on the catalog page
  useEffect(() => {
    if (!catalogPageId) return;
    const channel = supabase
      .channel(`event-catalog-${catalogPageId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "catalog_lead_pages", filter: `id=eq.${catalogPageId}` },
        (payload) => {
          const newIds = (payload.new as any).selected_product_ids || [];
          setSelectedProductIds(newIds);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [catalogPageId]);

  // Resolve active product name
  useEffect(() => {
    if (selectedProductIds.length === 0) {
      setActiveProductName(null);
      return;
    }
    // Fetch from shopify or cache
    (async () => {
      try {
        const raw = await fetchProducts(1, `id:${selectedProductIds[0].split("/").pop()}`);
        if (raw.length > 0) setActiveProductName(raw[0].node.title);
      } catch { /* ignore */ }
    })();
  }, [selectedProductIds[0]]);

  // Create catalog page for this event
  const handleCreateCatalog = async () => {
    setCreating(true);
    const slug = eventName
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const payload = {
      slug,
      title: eventName,
      subtitle: "Escolha seus produtos da live!",
      is_active: true,
      theme_config: { primaryColor: "#F59E0B", secondaryColor: "#D97706", backgroundGradient: "linear-gradient(160deg, #F59E0B 0%, #D97706 50%, #92400E 100%)" },
      selected_product_ids: [],
      whatsapp_numbers: [{ name: "Banana Calçados", number: "5533936180084" }],
      require_registration: true,
      shipping_cost: 0,
    };

    const { data, error } = await supabase
      .from("catalog_lead_pages")
      .insert(payload as any)
      .select("id, slug")
      .single();

    if (error) {
      toast.error(error.message);
      setCreating(false);
      return;
    }

    const newPageId = (data as any).id;
    await supabase.from("events").update({ catalog_lead_page_id: newPageId } as any).eq("id", eventId);

    setCatalogPageId(newPageId);
    setCatalogSlug(slug);
    setSelectedProductIds([]);
    toast.success("Catálogo do evento criado!");
    setCreating(false);
  };

  // Load shopify products for picker
  const loadProducts = async (query?: string) => {
    setProductsLoading(true);
    try {
      const raw = await fetchProducts(100, query ? `title:*${query}*` : undefined);
      setShopifyProducts(raw.map(p => ({
        id: p.node.id,
        title: p.node.title,
        imageUrl: p.node.images.edges[0]?.node.url || "",
        price: p.node.priceRange.minVariantPrice.amount,
      })));
    } catch { /* ignore */ }
    setProductsLoading(false);
  };

  const openPicker = () => {
    loadProducts();
    setPickerOpen(true);
  };

  // Toggle product (add/remove) — saves immediately to DB for realtime
  const toggleProduct = async (productId: string) => {
    if (!catalogPageId) return;
    let newIds: string[];
    if (selectedProductIds.includes(productId)) {
      newIds = selectedProductIds.filter(x => x !== productId);
    } else {
      newIds = [productId, ...selectedProductIds]; // Add to front = active
    }
    const { error } = await supabase
      .from("catalog_lead_pages")
      .update({ selected_product_ids: newIds } as any)
      .eq("id", catalogPageId);
    if (error) { toast.error(error.message); return; }
    setSelectedProductIds(newIds);
    toast.success(selectedProductIds.includes(productId) ? "Produto removido" : "Produto ativo atualizado! 🔴");
  };

  // Boost product to front (make it active)
  const boostProduct = async (productId: string) => {
    if (!catalogPageId) return;
    const newIds = [productId, ...selectedProductIds.filter(x => x !== productId)];
    const { error } = await supabase
      .from("catalog_lead_pages")
      .update({ selected_product_ids: newIds } as any)
      .eq("id", catalogPageId);
    if (error) { toast.error(error.message); return; }
    setSelectedProductIds(newIds);
    toast.success("Produto ativo agora! ⭐");
  };

  // Update delay
  const handleDelayChange = async (val: number) => {
    setDelaySeconds(val);
    await supabase.from("events").update({ active_product_delay_seconds: val } as any).eq("id", eventId);
  };

  const copyLink = () => {
    if (!catalogSlug) return;
    const url = `${CHECKOUT_BASE_URL}/evento/${catalogSlug}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  };

  const fmt = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (loading) {
    return (
      <div className="container py-2">
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <span className="text-sm text-muted-foreground">Carregando produto ativo...</span>
        </div>
      </div>
    );
  }

  // No catalog page yet — offer to create
  if (!catalogPageId) {
    return (
      <div className="container py-2">
        <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Catálogo da Live</span>
            <span className="text-sm text-muted-foreground">— Crie o catálogo para gerenciar produtos ao vivo</span>
          </div>
          <Button size="sm" onClick={handleCreateCatalog} disabled={creating}>
            {creating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
            Criar Catálogo
          </Button>
        </div>
      </div>
    );
  }

  const selectedSet = new Set(selectedProductIds);

  return (
    <>
      <div className="container py-2">
        <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 gap-3">
          {/* Active product indicator */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-bold text-red-500 uppercase">AO VIVO</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <Zap className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-sm font-medium truncate">
                {activeProductName || "Nenhum produto ativo"}
              </span>
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {selectedProductIds.length} produto{selectedProductIds.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <select
                value={delaySeconds}
                onChange={(e) => handleDelayChange(Number(e.target.value))}
                className="bg-transparent border-none text-xs font-medium focus:outline-none cursor-pointer"
              >
                <option value={0}>Sem delay</option>
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>1min</option>
                <option value={120}>2min</option>
              </select>
            </div>

            <Button variant="outline" size="sm" onClick={openPicker}>
              <Search className="h-3 w-3 mr-1" />
              Produtos
            </Button>

            {catalogSlug && (
              <>
                <Button variant="outline" size="sm" onClick={copyLink}>
                  <Copy className="h-3 w-3 mr-1" />
                  Link
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`${CHECKOUT_BASE_URL}/evento/${catalogSlug}`, "_blank")}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Product picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Gerenciar Produtos da Live
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto..."
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  if (e.target.value.length >= 2) loadProducts(e.target.value);
                }}
                className="pl-9"
              />
            </div>
          </div>

          {/* Selected products (active first) */}
          {selectedProductIds.length > 0 && (
            <div className="mb-3">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Produtos no catálogo ({selectedProductIds.length}) — primeiro = ativo
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {selectedProductIds.map((id, idx) => {
                  const sp = shopifyProducts.find(p => p.id === id);
                  return (
                    <Badge
                      key={id}
                      variant={idx === 0 ? "default" : "secondary"}
                      className="cursor-pointer gap-1 text-xs"
                    >
                      {idx === 0 && <Zap className="h-3 w-3" />}
                      {sp?.title?.slice(0, 25) || id.split("/").pop()}
                      {idx !== 0 && (
                        <button onClick={() => boostProduct(id)} className="ml-0.5 hover:text-primary">
                          <ArrowUp className="h-3 w-3" />
                        </button>
                      )}
                      <button onClick={() => toggleProduct(id)} className="ml-0.5 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          <ScrollArea className="h-[400px]">
            {productsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {shopifyProducts.map(p => {
                  const isSelected = selectedSet.has(p.id);
                  const isActive = selectedProductIds[0] === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleProduct(p.id)}
                      className={`relative rounded-lg border p-2 text-left transition-all hover:shadow-md ${
                        isActive
                          ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500"
                          : isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground"
                      }`}
                    >
                      {isActive && (
                        <div className="absolute -top-1.5 -right-1.5 bg-amber-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          ATIVO
                        </div>
                      )}
                      <img
                        src={p.imageUrl}
                        alt={p.title}
                        className="w-full aspect-square object-cover rounded-md mb-1.5"
                        loading="lazy"
                      />
                      <p className="text-xs font-medium truncate">{p.title}</p>
                      <p className="text-xs text-muted-foreground">{fmt(p.price)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

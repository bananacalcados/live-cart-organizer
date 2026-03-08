import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";
import {
  Plus, Save, Trash2, Loader2, Search, Check, X, ExternalLink, Copy, Eye,
  ShoppingBag, Users, ShoppingCart, CheckCircle, XCircle, Instagram, Phone,
  ArrowUp, Star, GripVertical, MessageSquare, Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CatalogLeadPage {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  is_active: boolean;
  theme_config: any;
  selected_product_ids: string[];
  whatsapp_numbers: Array<{ name: string; number: string }>;
  require_registration: boolean;
  shipping_cost: number;
  views: number;
  leads_count: number;
  created_at: string;
}

interface Registration {
  id: string;
  instagram_handle: string;
  whatsapp: string;
  cart_items: any[];
  cart_total: number;
  status: string;
  checkout_sale_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ShopifyProductSimple {
  id: string;
  title: string;
  imageUrl: string;
  price: string;
}

export function CatalogLeadPageCreator() {
  const [pages, setPages] = useState<CatalogLeadPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPage, setEditingPage] = useState<Partial<CatalogLeadPage> | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashboardPage, setDashboardPage] = useState<CatalogLeadPage | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regsLoading, setRegsLoading] = useState(false);

  // Live-mode: quick add products to existing page
  const [livePageId, setLivePageId] = useState<string | null>(null);
  const [liveAddOpen, setLiveAddOpen] = useState(false);

  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductSimple[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const fetchPages = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("catalog_lead_pages")
      .select("*")
      .order("created_at", { ascending: false });
    setPages((data as any[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  const loadShopifyProducts = async (query?: string) => {
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

  const openEditor = (page?: CatalogLeadPage) => {
    setEditingPage(page || {
      slug: "",
      title: "",
      subtitle: null,
      is_active: true,
      theme_config: { primaryColor: "#00BFA6", secondaryColor: "#00897B", backgroundGradient: "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)" },
      selected_product_ids: [],
      whatsapp_numbers: [{ name: "Banana Calçados", number: "5533936180084" }],
      require_registration: true,
      shipping_cost: 0,
    });
    loadShopifyProducts();
    setEditorOpen(true);
  };

  const toggleProduct = (id: string) => {
    if (!editingPage) return;
    const ids = editingPage.selected_product_ids || [];
    if (ids.includes(id)) {
      // Remove
      setEditingPage({ ...editingPage, selected_product_ids: ids.filter(x => x !== id) });
    } else {
      // Add to FRONT (newest first)
      setEditingPage({ ...editingPage, selected_product_ids: [id, ...ids] });
    }
  };

  // Move a product to the front of the list (boost)
  const boostProduct = (id: string) => {
    if (!editingPage) return;
    const ids = editingPage.selected_product_ids || [];
    if (!ids.includes(id)) return;
    setEditingPage({ ...editingPage, selected_product_ids: [id, ...ids.filter(x => x !== id)] });
    toast.success("Produto movido para o topo!");
  };

  const handleSave = async () => {
    if (!editingPage?.slug?.trim() || !editingPage?.title?.trim()) {
      toast.error("Preencha slug e título");
      return;
    }
    if ((editingPage.selected_product_ids || []).length === 0) {
      toast.error("Selecione pelo menos 1 produto");
      return;
    }
    setSaving(true);
    const payload = {
      slug: editingPage.slug.trim().toLowerCase().replace(/\s+/g, "-"),
      title: editingPage.title.trim(),
      subtitle: editingPage.subtitle || null,
      is_active: editingPage.is_active ?? true,
      theme_config: editingPage.theme_config,
      selected_product_ids: editingPage.selected_product_ids,
      whatsapp_numbers: editingPage.whatsapp_numbers,
      require_registration: editingPage.require_registration ?? true,
      shipping_cost: editingPage.shipping_cost ?? 0,
    };

    if ((editingPage as any).id) {
      const { error } = await supabase.from("catalog_lead_pages").update(payload as any).eq("id", (editingPage as any).id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Página atualizada! (atualiza em tempo real para visitantes)");
    } else {
      const { error } = await supabase.from("catalog_lead_pages").insert(payload as any);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Página criada!");
    }
    setSaving(false);
    setEditorOpen(false);
    fetchPages();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta página?")) return;
    await supabase.from("catalog_lead_pages").delete().eq("id", id);
    toast.success("Excluída");
    fetchPages();
  };

  // ── Live Quick-Add: add product to an existing page instantly ──
  const openLiveAdd = (page: CatalogLeadPage) => {
    setLivePageId(page.id);
    setEditingPage(page);
    loadShopifyProducts();
    setLiveAddOpen(true);
  };

  const liveToggleProduct = async (productId: string) => {
    if (!editingPage || !livePageId) return;
    const ids = editingPage.selected_product_ids || [];
    let newIds: string[];
    if (ids.includes(productId)) {
      newIds = ids.filter(x => x !== productId);
    } else {
      newIds = [productId, ...ids]; // Add to front
    }
    // Save immediately to DB (triggers realtime)
    const { error } = await supabase.from("catalog_lead_pages")
      .update({ selected_product_ids: newIds } as any)
      .eq("id", livePageId);
    if (error) { toast.error(error.message); return; }
    setEditingPage({ ...editingPage, selected_product_ids: newIds });
    toast.success(ids.includes(productId) ? "Produto removido" : "Produto adicionado ao vivo! 🔴");
    // Refresh pages list
    fetchPages();
  };

  const liveBoostProduct = async (productId: string) => {
    if (!editingPage || !livePageId) return;
    const ids = editingPage.selected_product_ids || [];
    if (!ids.includes(productId)) return;
    const newIds = [productId, ...ids.filter(x => x !== productId)];
    const { error } = await supabase.from("catalog_lead_pages")
      .update({ selected_product_ids: newIds } as any)
      .eq("id", livePageId);
    if (error) { toast.error(error.message); return; }
    setEditingPage({ ...editingPage, selected_product_ids: newIds });
    toast.success("Produto destacado ao vivo! ⭐");
  };

  const openDashboard = async (page: CatalogLeadPage) => {
    setDashboardPage(page);
    setDashboardOpen(true);
    setRegsLoading(true);
    const { data } = await supabase
      .from("catalog_lead_registrations")
      .select("*")
      .eq("catalog_page_id", page.id)
      .order("created_at", { ascending: false });
    setRegistrations((data as any[]) || []);
    setRegsLoading(false);
  };

  const baseUrl = "https://checkout.bananacalcados.com.br";
  const selectedIds = new Set(editingPage?.selected_product_ids || []);
  const selectedIdsArray = editingPage?.selected_product_ids || [];

  const filteredProducts = productSearch
    ? shopifyProducts.filter(p => p.title.toLowerCase().includes(productSearch.toLowerCase()))
    : shopifyProducts;

  // Sort products: selected ones first in their array order, then unselected
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    const aIdx = selectedIdsArray.indexOf(a.id);
    const bIdx = selectedIdsArray.indexOf(b.id);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return 0;
  });

  // Dashboard stats
  const totalLeads = registrations.length;
  const withCart = registrations.filter(r => (r.cart_items || []).length > 0);
  const checkoutStarted = registrations.filter(r => r.status === "checkout_started" || r.status === "completed");
  const completed = registrations.filter(r => r.status === "completed");
  const abandoned = withCart.filter(r => r.status !== "completed" && r.status !== "checkout_started");

  // Selected products in order for the live panel
  const liveSelectedProducts = selectedIdsArray
    .map(id => shopifyProducts.find(p => p.id === id))
    .filter(Boolean) as ShopifyProductSimple[];

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Catálogo com Captação de Lead</CardTitle>
              <CardDescription className="text-xs">Links de catálogo com carrinho + checkout transparente (atualização em tempo real)</CardDescription>
            </div>
            <Button size="sm" className="gap-1" onClick={() => openEditor()}>
              <Plus className="h-3.5 w-3.5" />Criar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : pages.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Nenhuma página criada</p>
          ) : (
            pages.map(p => {
              const url = `${baseUrl}/cat/${p.slug}`;
              return (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{p.title}</p>
                      <Badge variant={p.is_active ? "default" : "secondary"} className="text-[10px]">{p.is_active ? "Ativa" : "Inativa"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.selected_product_ids?.length || 0} produtos • {p.views} views • {p.leads_count} leads</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{url}</p>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2 flex-wrap">
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copiado!"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => window.open(url, "_blank")}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="default" size="sm" className="gap-1 bg-red-600 hover:bg-red-700 text-white" onClick={() => openLiveAdd(p)}>
                      🔴 Live
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => openDashboard(p)}>
                      <Eye className="h-3.5 w-3.5" />Dashboard
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEditor(p)}>Editar</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>{(editingPage as any)?.id ? "Editar" : "Criar"} Catálogo Lead</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 px-6 pb-4">
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Slug (URL)</Label>
                  <Input placeholder="verao-2026" value={editingPage?.slug || ""} onChange={e => setEditingPage({ ...editingPage, slug: e.target.value })} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Título</Label>
                  <Input placeholder="Coleção Verão" value={editingPage?.title || ""} onChange={e => setEditingPage({ ...editingPage, title: e.target.value })} className="h-9 text-sm" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Subtítulo (opcional)</Label>
                <Input placeholder="Os melhores calçados..." value={editingPage?.subtitle || ""} onChange={e => setEditingPage({ ...editingPage, subtitle: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editingPage?.require_registration ?? true} onCheckedChange={v => setEditingPage({ ...editingPage, require_registration: v })} />
                <Label className="text-xs">Exigir cadastro (@ Instagram + WhatsApp)</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editingPage?.is_active ?? true} onCheckedChange={v => setEditingPage({ ...editingPage, is_active: v })} />
                <Label className="text-xs">Ativa</Label>
              </div>
              <div>
                <Label className="text-xs">📦 Valor do Frete (R$)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={editingPage?.shipping_cost || ""} 
                  onChange={e => setEditingPage({ ...editingPage, shipping_cost: Number(e.target.value) || 0 })} className="h-9 text-sm w-40" />
                <p className="text-[10px] text-muted-foreground mt-1">Será adicionado ao total do carrinho e cobrado no pagamento</p>
              </div>

              {/* Selected products in order */}
              {selectedIdsArray.length > 0 && (
                <div>
                  <Label className="text-xs font-semibold">Ordem dos produtos (arraste ⭐ para destacar)</Label>
                  <div className="mt-2 space-y-1 max-h-[200px] overflow-auto">
                    {liveSelectedProducts.map((p, idx) => (
                      <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg border bg-card text-xs">
                        <span className="text-muted-foreground w-5 text-center">{idx + 1}</span>
                        {p.imageUrl && <img src={p.imageUrl} className="w-8 h-8 rounded object-cover" />}
                        <span className="flex-1 truncate font-medium">{p.title}</span>
                        {idx > 0 && (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => boostProduct(p.id)} title="Mover para o topo">
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => toggleProduct(p.id)} title="Remover">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs font-semibold">Produtos ({selectedIds.size} selecionados)</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar produto..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="pl-8 h-9 text-sm" />
                </div>
                <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[300px] overflow-auto">
                  {productsLoading ? (
                    <div className="col-span-full flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : (
                    sortedProducts.map(p => {
                      const selected = selectedIds.has(p.id);
                      return (
                        <button key={p.id} onClick={() => toggleProduct(p.id)}
                          className={`relative text-left rounded-lg border p-1.5 transition-all ${selected ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                          {selected && <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center z-10"><Check className="h-3 w-3 text-primary-foreground" /></div>}
                          {p.imageUrl ? <img src={p.imageUrl} alt={p.title} className="w-full aspect-square object-cover rounded" /> : <div className="w-full aspect-square bg-muted rounded" />}
                          <p className="text-[11px] font-medium line-clamp-2 mt-1">{p.title}</p>
                          <p className="text-[10px] text-muted-foreground">R$ {Number(p.price).toFixed(2)}</p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter className="px-6 py-3 border-t">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Live Mode Dialog */}
      <Dialog open={liveAddOpen} onOpenChange={setLiveAddOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              Modo Live — Atualização em Tempo Real
            </DialogTitle>
            <p className="text-xs text-muted-foreground">Adicione, remova e destaque produtos. Visitantes verão as mudanças instantaneamente.</p>
          </DialogHeader>

          <div className="px-6 py-3">
            {/* Currently selected - reorder */}
            <Label className="text-xs font-semibold">Produtos no catálogo ({selectedIdsArray.length})</Label>
            <div className="mt-2 space-y-1 max-h-[200px] overflow-auto mb-4">
              {liveSelectedProducts.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhum produto selecionado</p>
              )}
              {liveSelectedProducts.map((p, idx) => (
                <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg border bg-card text-xs">
                  <span className={`w-5 text-center font-bold ${idx === 0 ? "text-amber-500" : "text-muted-foreground"}`}>
                    {idx === 0 ? "⭐" : idx + 1}
                  </span>
                  {p.imageUrl && <img src={p.imageUrl} className="w-8 h-8 rounded object-cover" />}
                  <span className="flex-1 truncate font-medium">{p.title}</span>
                  {idx > 0 && (
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => liveBoostProduct(p.id)}>
                      <Star className="h-3 w-3" />Destacar
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => liveToggleProduct(p.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1 px-6 pb-4">
            <Label className="text-xs font-semibold">Adicionar produtos</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar produto..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="pl-8 h-9 text-sm" />
            </div>
            <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[300px] overflow-auto">
              {productsLoading ? (
                <div className="col-span-full flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                filteredProducts.map(p => {
                  const selected = selectedIds.has(p.id);
                  return (
                    <button key={p.id} onClick={() => liveToggleProduct(p.id)}
                      className={`relative text-left rounded-lg border p-1.5 transition-all ${selected ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                      {selected && <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center z-10"><Check className="h-3 w-3 text-primary-foreground" /></div>}
                      {p.imageUrl ? <img src={p.imageUrl} alt={p.title} className="w-full aspect-square object-cover rounded" /> : <div className="w-full aspect-square bg-muted rounded" />}
                      <p className="text-[11px] font-medium line-clamp-2 mt-1">{p.title}</p>
                      <p className="text-[10px] text-muted-foreground">R$ {Number(p.price).toFixed(2)}</p>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 py-3 border-t">
            <Button variant="outline" onClick={() => setLiveAddOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dashboard Dialog */}
      <Dialog open={dashboardOpen} onOpenChange={setDashboardOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              Dashboard: {dashboardPage?.title}
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl border bg-card text-center">
                <Users className="h-5 w-5 mx-auto text-primary mb-1" />
                <p className="text-2xl font-bold">{totalLeads}</p>
                <p className="text-[10px] text-muted-foreground">Cadastros</p>
              </div>
              <div className="p-3 rounded-xl border bg-card text-center">
                <ShoppingCart className="h-5 w-5 mx-auto text-orange-500 mb-1" />
                <p className="text-2xl font-bold">{withCart.length}</p>
                <p className="text-[10px] text-muted-foreground">Com Carrinho</p>
              </div>
              <div className="p-3 rounded-xl border bg-card text-center">
                <XCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
                <p className="text-2xl font-bold">{abandoned.length}</p>
                <p className="text-[10px] text-muted-foreground">Abandonados</p>
              </div>
              <div className="p-3 rounded-xl border bg-card text-center">
                <CheckCircle className="h-5 w-5 mx-auto text-emerald-500 mb-1" />
                <p className="text-2xl font-bold">{checkoutStarted.length}</p>
                <p className="text-[10px] text-muted-foreground">Checkout Iniciado</p>
              </div>
            </div>

            {/* Quick shipping cost editor */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Label className="text-xs font-medium whitespace-nowrap">Frete (R$):</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0.00"
                className="h-8 text-sm w-28"
                defaultValue={dashboardPage?.shipping_cost || ""}
                onBlur={async (e) => {
                  const val = Number(e.target.value) || 0;
                  if (!dashboardPage) return;
                  await supabase.from("catalog_lead_pages").update({ shipping_cost: val } as any).eq("id", dashboardPage.id);
                  setDashboardPage({ ...dashboardPage, shipping_cost: val });
                  toast.success(`Frete atualizado para R$ ${val.toFixed(2)}`);
                }}
              />
              <span className="text-[10px] text-muted-foreground">Altere durante o evento</span>
            </div>
          </div>

          <ScrollArea className="flex-1 px-6 pb-6">
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="mb-3">
                <TabsTrigger value="all">Todos ({totalLeads})</TabsTrigger>
                <TabsTrigger value="cart">Com Carrinho ({withCart.length})</TabsTrigger>
                <TabsTrigger value="abandoned">Abandonados ({abandoned.length})</TabsTrigger>
                <TabsTrigger value="checkout">Checkout ({checkoutStarted.length})</TabsTrigger>
              </TabsList>

              {["all", "cart", "abandoned", "checkout"].map(tab => {
                const filtered = tab === "all" ? registrations
                  : tab === "cart" ? withCart
                  : tab === "abandoned" ? abandoned
                  : checkoutStarted;

                return (
                  <TabsContent key={tab} value={tab}>
                    {regsLoading ? (
                      <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ) : filtered.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">Nenhum registro</p>
                    ) : (
                      <Table>
                        <TableHeader>
                           <TableRow>
549:                             <TableHead>Instagram</TableHead>
550:                             <TableHead>WhatsApp</TableHead>
551:                             <TableHead>Status</TableHead>
552:                             <TableHead>Produtos</TableHead>
553:                             <TableHead>Total</TableHead>
554:                             <TableHead>Data</TableHead>
555:                             <TableHead>Ações</TableHead>
556:                           </TableRow>
                        </TableHeader>
                        <TableBody>
                           {filtered.map(r => {
                            const cartItems = r.cart_items || [];
                            const statusBadge = r.status === "completed" ? "default"
                              : r.status === "checkout_started" ? "secondary"
                              : r.status === "cart_created" ? "outline"
                              : "outline";
                            const statusLabel = r.status === "completed" ? "✅ Pago"
                              : r.status === "checkout_started" ? "🔄 Checkout"
                              : r.status === "cart_created" ? "🛒 Carrinho"
                              : "👀 Navegando";

                            const phoneClean = r.whatsapp?.replace(/\D/g, "") || "";
                            const fullPhone = phoneClean.startsWith("55") ? phoneClean : `55${phoneClean}`;

                            return (
                              <TableRow key={r.id}>
                                <TableCell className="font-medium text-sm">
                                  <div className="flex items-center gap-1">
                                    <Instagram className="h-3.5 w-3.5 text-muted-foreground" />
                                    @{r.instagram_handle}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <div className="flex items-center gap-1">
                                    <Phone className="h-3 w-3 text-muted-foreground" />
                                    {r.whatsapp}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={statusBadge as any} className="text-[10px]">{statusLabel}</Badge>
                                </TableCell>
                                <TableCell className="text-xs max-w-[200px]">
                                  {cartItems.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {cartItems.map((item: any, i: number) => (
                                        <p key={i} className="truncate">
                                          {item.quantity}x {item.title} {item.variant && `(${item.variant})`}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs font-semibold">
                                  {r.cart_total > 0 ? `R$ ${Number(r.cart_total).toFixed(2)}` : "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(r.created_at).toLocaleDateString("pt-BR")}
                                  <br />
                                  {new Date(r.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                </TableCell>
                                <TableCell>
                                  {phoneClean && (
                                    <div className="flex items-center gap-1">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir WhatsApp Web"
                                        onClick={() => window.open(`https://wa.me/${fullPhone}`, "_blank")}>
                                        <ExternalLink className="h-3.5 w-3.5 text-emerald-600" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir no Chat interno"
                                        onClick={() => window.open(`/chat?phone=${fullPhone}`, "_blank")}>
                                        <MessageSquare className="h-3.5 w-3.5 text-primary" />
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

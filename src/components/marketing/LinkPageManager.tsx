import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus, Trash2, GripVertical, Eye, Copy, ExternalLink, Link,
  Phone, MapPin, ShoppingBag, Globe, Instagram, Mail, ChevronUp,
  ChevronDown, Image, Type, Minus, BarChart3, MousePointer, Users, Loader2,
  Search, Check
} from "lucide-react";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LinkPage {
  id: string;
  store_id: string | null;
  slug: string;
  title: string;
  subtitle: string | null;
  avatar_url: string | null;
  background_type: string;
  background_value: string;
  theme_config: any;
  meta_pixel_id: string | null;
  is_active: boolean;
  total_views: number;
  total_clicks: number;
  created_at: string;
}

interface LinkPageItem {
  id: string;
  page_id: string;
  item_type: string;
  label: string;
  url: string | null;
  icon: string | null;
  description: string | null;
  thumbnail_url: string | null;
  style_config: any;
  sort_order: number;
  is_active: boolean;
  clicks: number;
}

interface Store {
  id: string;
  name: string;
}

const ITEM_TYPES = [
  { value: 'link', label: 'Link', icon: Link },
  { value: 'whatsapp', label: 'WhatsApp', icon: Phone },
  { value: 'address', label: 'Endereço', icon: MapPin },
  { value: 'catalog', label: 'Catálogo', icon: ShoppingBag },
  { value: 'website', label: 'Site', icon: Globe },
  { value: 'instagram', label: 'Instagram', icon: Instagram },
  { value: 'email', label: 'E-mail', icon: Mail },
  { value: 'header', label: 'Cabeçalho', icon: Type },
  { value: 'divider', label: 'Divisor', icon: Minus },
];

const GRADIENT_PRESETS = [
  { label: 'Roxo', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { label: 'Rosa', value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { label: 'Azul', value: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { label: 'Dourado', value: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { label: 'Verde', value: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { label: 'Escuro', value: 'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%)' },
  { label: 'Sunset', value: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  { label: 'Ocean', value: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
];

const BUTTON_STYLES = [
  { value: 'filled', label: 'Preenchido' },
  { value: 'outline', label: 'Contorno' },
  { value: 'soft', label: 'Suave' },
  { value: 'rounded', label: 'Arredondado' },
];

interface CatalogProduct {
  id: string;
  title: string;
  image: string;
  price: string;
  handle: string;
}

export function LinkPageManager() {
  const [pages, setPages] = useState<LinkPage[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedPage, setSelectedPage] = useState<LinkPage | null>(null);
  const [items, setItems] = useState<LinkPageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [analyticsPageId, setAnalyticsPageId] = useState<string | null>(null);

  // Catalog product picker state
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [catalogPickerItemId, setCatalogPickerItemId] = useState<string | null>(null);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [shopifySearch, setShopifySearch] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedCatalogProducts, setSelectedCatalogProducts] = useState<CatalogProduct[]>([]);

  // New page form
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newStoreId, setNewStoreId] = useState<string>("");

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('link_pages')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPages((data || []) as LinkPage[]);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar páginas");
    }
    setLoading(false);
  }, []);

  const fetchStores = useCallback(async () => {
    const { data } = await supabase.from('pos_stores').select('id, name').eq('is_active', true);
    setStores((data || []) as Store[]);
  }, []);

  const fetchItems = useCallback(async (pageId: string) => {
    const { data, error } = await supabase
      .from('link_page_items')
      .select('*')
      .eq('page_id', pageId)
      .order('sort_order', { ascending: true });
    if (error) { console.error(error); return; }
    setItems((data || []) as LinkPageItem[]);
  }, []);

  useEffect(() => { fetchPages(); fetchStores(); }, [fetchPages, fetchStores]);

  useEffect(() => {
    if (selectedPage) fetchItems(selectedPage.id);
    else setItems([]);
  }, [selectedPage, fetchItems]);

  const createPage = async () => {
    if (!newTitle || !newSlug) { toast.error("Título e slug são obrigatórios"); return; }
    try {
      const { data, error } = await supabase
        .from('link_pages')
        .insert({
          title: newTitle,
          slug: newSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          store_id: newStoreId || null,
          theme_config: { buttonStyle: 'filled', buttonColor: '#ffffff', buttonTextColor: '#000000', fontFamily: 'Inter' },
        })
        .select()
        .single();
      if (error) throw error;
      toast.success("Página criada!");
      setNewPageOpen(false);
      setNewTitle("");
      setNewSlug("");
      setNewStoreId("");
      fetchPages();
      setSelectedPage(data as LinkPage);
    } catch (err: any) {
      toast.error(err.message?.includes('duplicate') ? "Slug já em uso" : "Erro ao criar página");
    }
  };

  const updatePage = async (updates: Partial<LinkPage>) => {
    if (!selectedPage) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('link_pages')
        .update(updates)
        .eq('id', selectedPage.id);
      if (error) throw error;
      setSelectedPage(prev => prev ? { ...prev, ...updates } : null);
      setPages(prev => prev.map(p => p.id === selectedPage.id ? { ...p, ...updates } : p));
      toast.success("Salvo!");
    } catch { toast.error("Erro ao salvar"); }
    setSaving(false);
  };

  const addItem = async (itemType: string) => {
    if (!selectedPage) return;
    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) + 1 : 0;
    const defaults: Record<string, any> = {
      link: { label: 'Novo Link', url: 'https://' },
      whatsapp: { label: 'WhatsApp', url: 'https://wa.me/55' },
      address: { label: 'Nossa Loja', url: 'https://maps.google.com' },
      catalog: { label: 'Ver Catálogo', url: '/' },
      website: { label: 'Nosso Site', url: 'https://' },
      instagram: { label: 'Instagram', url: 'https://instagram.com/' },
      email: { label: 'E-mail', url: 'mailto:' },
      header: { label: 'Seção', url: null },
      divider: { label: '—', url: null },
    };
    const d = defaults[itemType] || defaults.link;
    try {
      const { data, error } = await supabase
        .from('link_page_items')
        .insert({ page_id: selectedPage.id, item_type: itemType, label: d.label, url: d.url, sort_order: maxOrder, style_config: {} })
        .select()
        .single();
      if (error) throw error;
      setItems(prev => [...prev, data as LinkPageItem]);
    } catch { toast.error("Erro ao adicionar item"); }
  };

  const updateItem = async (itemId: string, updates: Partial<LinkPageItem>) => {
    try {
      const { error } = await supabase.from('link_page_items').update(updates).eq('id', itemId);
      if (error) throw error;
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i));
    } catch { toast.error("Erro ao atualizar item"); }
  };

  const deleteItem = async (itemId: string) => {
    try {
      const { error } = await supabase.from('link_page_items').delete().eq('id', itemId);
      if (error) throw error;
      setItems(prev => prev.filter(i => i.id !== itemId));
    } catch { toast.error("Erro ao excluir item"); }
  };

  const moveItem = async (itemId: string, direction: 'up' | 'down') => {
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const newItems = [...items];
    [newItems[idx], newItems[swapIdx]] = [newItems[swapIdx], newItems[idx]];
    newItems.forEach((item, i) => item.sort_order = i);
    setItems(newItems);
    await Promise.all(newItems.map((item, i) =>
      supabase.from('link_page_items').update({ sort_order: i }).eq('id', item.id)
    ));
  };

  const deletePage = async (pageId: string) => {
    if (!confirm("Excluir esta página?")) return;
    try {
      const { error } = await supabase.from('link_pages').delete().eq('id', pageId);
      if (error) throw error;
      setPages(prev => prev.filter(p => p.id !== pageId));
      if (selectedPage?.id === pageId) setSelectedPage(null);
      toast.success("Página excluída");
    } catch { toast.error("Erro ao excluir"); }
  };

  const fetchAnalytics = async (pageId: string) => {
    setAnalyticsPageId(pageId);
    const { data } = await supabase
      .from('link_page_visits')
      .select('*')
      .eq('page_id', pageId)
      .order('created_at', { ascending: false })
      .limit(500);
    setAnalytics((data || []) as any[]);
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/l/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  };

  // ─── Catalog Product Picker ───
  const openCatalogPicker = async (itemId: string) => {
    setCatalogPickerItemId(itemId);
    const item = items.find(i => i.id === itemId);
    const existing = (item?.style_config?.products || []) as CatalogProduct[];
    setSelectedCatalogProducts(existing);
    setCatalogPickerOpen(true);
    if (shopifyProducts.length === 0) {
      setLoadingProducts(true);
      try {
        const products = await fetchProducts(250);
        setShopifyProducts(products);
      } catch { toast.error("Erro ao carregar produtos da Shopify"); }
      setLoadingProducts(false);
    }
  };

  const searchShopifyProducts = async () => {
    setLoadingProducts(true);
    try {
      const products = await fetchProducts(250, shopifySearch || undefined);
      setShopifyProducts(products);
    } catch { toast.error("Erro ao buscar produtos"); }
    setLoadingProducts(false);
  };

  const toggleCatalogProduct = (product: ShopifyProduct) => {
    const node = product.node;
    const id = node.id;
    const exists = selectedCatalogProducts.find(p => p.id === id);
    if (exists) {
      setSelectedCatalogProducts(prev => prev.filter(p => p.id !== id));
    } else {
      setSelectedCatalogProducts(prev => [...prev, {
        id: node.id,
        title: node.title,
        image: node.images?.edges?.[0]?.node?.url || '',
        price: node.priceRange?.minVariantPrice?.amount || '0',
        handle: node.handle,
      }]);
    }
  };

  const saveCatalogProducts = async () => {
    if (!catalogPickerItemId) return;
    const item = items.find(i => i.id === catalogPickerItemId);
    const newConfig = { ...(item?.style_config || {}), products: selectedCatalogProducts };
    await updateItem(catalogPickerItemId, { style_config: newConfig });
    setCatalogPickerOpen(false);
    toast.success(`${selectedCatalogProducts.length} produtos selecionados`);
  };

  const filteredShopifyProducts = shopifyProducts.filter(p =>
    !shopifySearch || p.node.title.toLowerCase().includes(shopifySearch.toLowerCase())
  );

  const previewUrl = selectedPage ? `${window.location.origin}/l/${selectedPage.slug}` : '';

  // ─── List View ───
  if (!selectedPage) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Link Pages</h2>
            <p className="text-sm text-muted-foreground">Crie páginas estilo Linktree para cada loja</p>
          </div>
          <Dialog open={newPageOpen} onOpenChange={setNewPageOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" />Nova Página</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova Link Page</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Título</Label>
                  <Input value={newTitle} onChange={e => { setNewTitle(e.target.value); setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')); }} placeholder="Banana Store GV" />
                </div>
                <div>
                  <Label>Slug (URL)</Label>
                  <Input value={newSlug} onChange={e => setNewSlug(e.target.value)} placeholder="banana-store-gv" />
                  <p className="text-xs text-muted-foreground mt-1">{window.location.origin}/l/{newSlug || '...'}</p>
                </div>
                {stores.length > 0 && (
                  <div>
                    <Label>Loja (opcional)</Label>
                    <Select value={newStoreId} onValueChange={setNewStoreId}>
                      <SelectTrigger><SelectValue placeholder="Selecionar loja" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={createPage} className="w-full">Criar Página</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : pages.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Link className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhuma Link Page criada ainda</p>
            <Button size="sm" className="mt-3 gap-1" onClick={() => setNewPageOpen(true)}>
              <Plus className="h-3.5 w-3.5" />Criar primeira página
            </Button>
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pages.map(page => (
              <Card key={page.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedPage(page)}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white">{page.title}</h3>
                      <p className="text-xs text-muted-foreground">/l/{page.slug}</p>
                    </div>
                    <Badge variant={page.is_active ? "default" : "secondary"} className="text-xs">
                      {page.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <div className="h-16 rounded-lg" style={{ background: page.background_value }} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{page.total_views} views</span>
                    <span className="flex items-center gap-1"><MousePointer className="h-3 w-3" />{page.total_clicks} cliques</span>
                  </div>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => copyLink(page.slug)} className="gap-1 text-xs"><Copy className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => window.open(`/l/${page.slug}`, '_blank')} className="gap-1 text-xs"><ExternalLink className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => fetchAnalytics(page.id)} className="gap-1 text-xs"><BarChart3 className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deletePage(page.id)} className="gap-1 text-xs text-destructive hover:text-destructive"><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Analytics Dialog */}
        <Dialog open={!!analyticsPageId} onOpenChange={() => setAnalyticsPageId(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Analytics</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {(() => {
                const views = analytics.filter(a => a.event_type === 'page_view');
                const clicks = analytics.filter(a => a.event_type === 'click');
                const sources = views.reduce((acc: any, v: any) => {
                  const s = v.utm_source || 'direto';
                  acc[s] = (acc[s] || 0) + 1;
                  return acc;
                }, {});
                return (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Views</p><p className="text-2xl font-bold text-white">{views.length}</p></CardContent></Card>
                      <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Cliques</p><p className="text-2xl font-bold text-white">{clicks.length}</p></CardContent></Card>
                      <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">CTR</p><p className="text-2xl font-bold text-white">{views.length > 0 ? ((clicks.length / views.length) * 100).toFixed(1) : 0}%</p></CardContent></Card>
                    </div>
                    <Card><CardContent className="p-3">
                      <p className="text-xs font-semibold text-white mb-2">Fontes de Tráfego</p>
                      {Object.entries(sources).sort(([, a]: any, [, b]: any) => b - a).map(([source, count]: any) => (
                        <div key={source} className="flex justify-between text-sm py-1">
                          <span className="text-muted-foreground">{source}</span>
                          <span className="text-white font-medium">{count}</span>
                        </div>
                      ))}
                    </CardContent></Card>
                  </>
                );
              })()}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── Editor View ───
  const themeConfig = selectedPage.theme_config || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedPage(null)} className="text-white">← Voltar</Button>
          <h2 className="text-lg font-bold text-white">{selectedPage.title}</h2>
          <Badge variant={selectedPage.is_active ? "default" : "secondary"} className="text-xs">
            {selectedPage.is_active ? "Ativa" : "Inativa"}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => copyLink(selectedPage.slug)} className="gap-1"><Copy className="h-3.5 w-3.5" />Copiar Link</Button>
          <Button variant="outline" size="sm" onClick={() => window.open(previewUrl, '_blank')} className="gap-1"><ExternalLink className="h-3.5 w-3.5" />Preview</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Editor */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-white">Configurações</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-white">Título</Label>
                  <Input value={selectedPage.title} onChange={e => updatePage({ title: e.target.value })} />
                </div>
                <div>
                  <Label className="text-white">Slug</Label>
                  <Input value={selectedPage.slug} onChange={e => updatePage({ slug: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-white">Subtítulo</Label>
                <Input value={selectedPage.subtitle || ''} onChange={e => updatePage({ subtitle: e.target.value })} placeholder="Uma frase de impacto..." />
              </div>
              <div>
                <Label className="text-white">Avatar URL</Label>
                <Input value={selectedPage.avatar_url || ''} onChange={e => updatePage({ avatar_url: e.target.value })} placeholder="https://..." />
              </div>
              <div>
                <Label className="text-white">Meta Pixel ID</Label>
                <Input value={selectedPage.meta_pixel_id || ''} onChange={e => updatePage({ meta_pixel_id: e.target.value })} placeholder="123456789" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={selectedPage.is_active} onCheckedChange={v => updatePage({ is_active: v })} />
                <Label className="text-white">Página ativa</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-white">Background</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {GRADIENT_PRESETS.map(g => (
                  <button
                    key={g.label}
                    className={`h-12 rounded-lg border-2 transition-all ${selectedPage.background_value === g.value ? 'border-primary scale-105' : 'border-transparent'}`}
                    style={{ background: g.value }}
                    onClick={() => updatePage({ background_value: g.value, background_type: 'gradient' })}
                    title={g.label}
                  />
                ))}
              </div>
              <div>
                <Label className="text-white">Ou cor/gradiente customizado</Label>
                <Input value={selectedPage.background_value} onChange={e => updatePage({ background_value: e.target.value })} placeholder="linear-gradient(...) ou #hex" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-white">Links e Botões ({items.length})</CardTitle>
                <Select onValueChange={v => addItem(v)}>
                  <SelectTrigger className="w-40 h-8">
                    <SelectValue placeholder="+ Adicionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="flex items-center gap-2"><t.icon className="h-3.5 w-3.5" />{t.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[500px]">
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={item.id} className="border rounded-lg p-3 space-y-2 bg-card">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="outline" className="text-xs">{ITEM_TYPES.find(t => t.value === item.item_type)?.label || item.item_type}</Badge>
                          <span className="text-xs text-muted-foreground">{item.clicks} cliques</span>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveItem(item.id, 'up')} disabled={idx === 0}><ChevronUp className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveItem(item.id, 'down')} disabled={idx === items.length - 1}><ChevronDown className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteItem(item.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </div>
                      <Input value={item.label} onChange={e => updateItem(item.id, { label: e.target.value })} placeholder="Label" className="h-8 text-sm" />
                      {item.item_type !== 'header' && item.item_type !== 'divider' && item.item_type !== 'catalog' && (
                        <Input value={item.url || ''} onChange={e => updateItem(item.id, { url: e.target.value })} placeholder="URL" className="h-8 text-sm" />
                      )}
                      {item.item_type !== 'header' && item.item_type !== 'divider' && (
                        <Input value={item.description || ''} onChange={e => updateItem(item.id, { description: e.target.value })} placeholder="Descrição (opcional)" className="h-8 text-sm" />
                      )}
                      {item.item_type === 'catalog' && (
                        <div className="space-y-2">
                          <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => openCatalogPicker(item.id)}>
                            <ShoppingBag className="h-3.5 w-3.5" />
                            Selecionar Produtos ({(item.style_config?.products || []).length})
                          </Button>
                          {(item.style_config?.products || []).length > 0 && (
                            <div className="grid grid-cols-4 gap-1">
                              {(item.style_config.products as CatalogProduct[]).slice(0, 8).map((p: CatalogProduct) => (
                                <div key={p.id} className="aspect-square rounded overflow-hidden bg-muted">
                                  {p.image && <img src={p.image} alt={p.title} className="w-full h-full object-cover" />}
                                </div>
                              ))}
                              {(item.style_config.products as CatalogProduct[]).length > 8 && (
                                <div className="aspect-square rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                                  +{(item.style_config.products as CatalogProduct[]).length - 8}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Switch checked={item.is_active} onCheckedChange={v => updateItem(item.id, { is_active: v })} />
                        <span className="text-xs text-muted-foreground">{item.is_active ? 'Visível' : 'Oculto'}</span>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-6">Adicione links usando o botão acima</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-white">Estilo dos Botões</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-white">Estilo</Label>
                <Select value={themeConfig.buttonStyle || 'filled'} onValueChange={v => updatePage({ theme_config: { ...themeConfig, buttonStyle: v } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BUTTON_STYLES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-white">Cor do botão</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={themeConfig.buttonColor || '#ffffff'} onChange={e => updatePage({ theme_config: { ...themeConfig, buttonColor: e.target.value } })} className="w-8 h-8 rounded border-0 cursor-pointer" />
                    <Input value={themeConfig.buttonColor || '#ffffff'} onChange={e => updatePage({ theme_config: { ...themeConfig, buttonColor: e.target.value } })} className="h-8" />
                  </div>
                </div>
                <div>
                  <Label className="text-white">Cor do texto</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={themeConfig.buttonTextColor || '#000000'} onChange={e => updatePage({ theme_config: { ...themeConfig, buttonTextColor: e.target.value } })} className="w-8 h-8 rounded border-0 cursor-pointer" />
                    <Input value={themeConfig.buttonTextColor || '#000000'} onChange={e => updatePage({ theme_config: { ...themeConfig, buttonTextColor: e.target.value } })} className="h-8" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Live Preview */}
        <div className="sticky top-20">
          <Card className="overflow-hidden">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-white">Preview</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="mx-auto max-w-[375px] rounded-2xl overflow-hidden shadow-2xl border" style={{ height: '667px' }}>
                <div className="h-full overflow-y-auto" style={{ background: selectedPage.background_value }}>
                  <div className="flex flex-col items-center pt-12 px-6 pb-8">
                    {selectedPage.avatar_url && (
                      <img src={selectedPage.avatar_url} alt="" className="w-20 h-20 rounded-full border-2 border-white/30 mb-4 object-cover" />
                    )}
                    <h1 className="text-xl font-bold text-white text-center drop-shadow">{selectedPage.title}</h1>
                    {selectedPage.subtitle && <p className="text-sm text-white/80 text-center mt-1 drop-shadow">{selectedPage.subtitle}</p>}

                    <div className="w-full mt-8 space-y-3">
                      {items.filter(i => i.is_active).map(item => {
                        if (item.item_type === 'divider') return <hr key={item.id} className="border-white/20" />;
                        if (item.item_type === 'header') return <p key={item.id} className="text-xs font-semibold text-white/70 uppercase tracking-wider text-center mt-4">{item.label}</p>;

                        // Catalog: render as product grid
                        if (item.item_type === 'catalog' && (item.style_config?.products || []).length > 0) {
                          const products = item.style_config.products as CatalogProduct[];
                          return (
                            <div key={item.id} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                              <div className="grid grid-cols-3 gap-0.5 p-1">
                                {products.slice(0, 6).map((p: CatalogProduct) => (
                                  <div key={p.id} className="aspect-square overflow-hidden rounded-sm">
                                    {p.image && <img src={p.image} alt={p.title} className="w-full h-full object-cover" />}
                                  </div>
                                ))}
                              </div>
                              <div className="text-center py-2">
                                <p className="text-white font-semibold text-sm">{item.label}</p>
                                <p className="text-white/50 text-xs">{products.length} products</p>
                              </div>
                            </div>
                          );
                        }

                        const Icon = ITEM_TYPES.find(t => t.value === item.item_type)?.icon || Link;
                        const style = themeConfig.buttonStyle || 'filled';
                        const btnColor = themeConfig.buttonColor || '#ffffff';
                        const txtColor = themeConfig.buttonTextColor || '#000000';

                        let btnClass = 'w-full py-3 px-4 rounded-xl flex items-center gap-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]';
                        let btnStyle: React.CSSProperties = {};

                        if (style === 'filled') {
                          btnStyle = { backgroundColor: btnColor, color: txtColor };
                        } else if (style === 'outline') {
                          btnStyle = { border: `2px solid ${btnColor}`, color: btnColor, backgroundColor: 'transparent' };
                        } else if (style === 'soft') {
                          btnStyle = { backgroundColor: `${btnColor}22`, color: btnColor, backdropFilter: 'blur(10px)' };
                        } else if (style === 'rounded') {
                          btnClass += ' !rounded-full';
                          btnStyle = { backgroundColor: btnColor, color: txtColor };
                        }

                        return (
                          <div key={item.id} className={btnClass} style={btnStyle}>
                            <Icon className="h-5 w-5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{item.label}</p>
                              {item.description && <p className="text-xs opacity-70 truncate">{item.description}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-xs text-white/40 mt-8">Powered by Banana Store</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Catalog Product Picker Dialog */}
      <Dialog open={catalogPickerOpen} onOpenChange={setCatalogPickerOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Selecionar Produtos do Catálogo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar produtos..."
                value={shopifySearch}
                onChange={e => setShopifySearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchShopifyProducts()}
                className="flex-1"
              />
              <Button size="sm" onClick={searchShopifyProducts} disabled={loadingProducts}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedCatalogProducts.length} produto(s) selecionado(s)
            </p>
            <ScrollArea className="h-[400px]">
              {loadingProducts ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filteredShopifyProducts.map(product => {
                    const node = product.node;
                    const isSelected = selectedCatalogProducts.some(p => p.id === node.id);
                    const imageUrl = node.images?.edges?.[0]?.node?.url || '';
                    const price = parseFloat(node.priceRange?.minVariantPrice?.amount || '0');
                    return (
                      <div
                        key={node.id}
                        className={`border rounded-lg p-2 cursor-pointer transition-all ${isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'hover:border-muted-foreground/50'}`}
                        onClick={() => toggleCatalogProduct(product)}
                      >
                        <div className="flex gap-2">
                          <div className="w-16 h-16 rounded overflow-hidden bg-muted flex-shrink-0">
                            {imageUrl && <img src={imageUrl} alt={node.title} className="w-full h-full object-cover" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{node.title}</p>
                            <p className="text-xs text-muted-foreground">R$ {price.toFixed(2)}</p>
                            {isSelected && <Check className="h-4 w-4 text-primary mt-1" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCatalogPickerOpen(false)}>Cancelar</Button>
              <Button onClick={saveCatalogProducts}>
                Salvar ({selectedCatalogProducts.length} produtos)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

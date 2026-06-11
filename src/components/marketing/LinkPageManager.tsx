import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import QRCode from "react-qr-code";
import {
  Plus, Trash2, GripVertical, ExternalLink, Copy, Link as LinkIcon,
  Phone, MapPin, ShoppingBag, Globe, Instagram, Mail, ChevronUp, ChevronDown,
  Type, Minus, BarChart3, MousePointer, Eye, Loader2, Upload, Users, Video,
  Star, Music2, QrCode, RefreshCw, Check, Search, Wifi, WifiOff, Image as ImageIcon
} from "lucide-react";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LinkPage {
  id: string; store_id: string | null; slug: string; title: string;
  subtitle: string | null; avatar_url: string | null; logo_url: string | null;
  background_type: string; background_value: string; theme_config: any;
  meta_pixel_id: string | null; is_active: boolean; total_views: number;
  total_clicks: number; created_at: string; seller_id: string | null;
  require_lead_capture: boolean; catalog_mode: string; catalog_auto_sync: boolean;
}
interface LinkPageItem {
  id: string; page_id: string; item_type: string; label: string; url: string | null;
  description: string | null; style_config: any; sort_order: number; is_active: boolean;
  clicks: number; whatsapp_number_id: string | null; prefill_message: string | null;
  card_style: string; social_network: string | null;
}
interface Store { id: string; name: string; }
interface Seller { id: string; name: string; store_id: string | null; }
interface WaInstance {
  id: string; label: string; provider: string; is_online: boolean | null;
  is_active: boolean; phone_display: string | null;
  wasender_phone_number: string | null; uazapi_owner: string | null;
}
interface CatalogRow {
  id: string; shopify_product_id: string; handle: string | null; title: string;
  image_url: string | null; price: number | null; compare_at_price: number | null;
  grade_pct: number; grade_available: number; grade_total: number; is_active: boolean;
}

const ITEM_TYPES = [
  { value: "whatsapp", label: "WhatsApp", icon: Phone },
  { value: "catalog", label: "Catálogo", icon: ShoppingBag },
  { value: "vip", label: "Grupo VIP", icon: Users },
  { value: "live", label: "Live", icon: Video },
  { value: "review", label: "Avaliação", icon: Star },
  { value: "website", label: "Site", icon: Globe },
  { value: "instagram", label: "Instagram", icon: Instagram },
  { value: "social", label: "Rede Social", icon: Music2 },
  { value: "address", label: "Localização", icon: MapPin },
  { value: "email", label: "E-mail", icon: Mail },
  { value: "link", label: "Link", icon: LinkIcon },
  { value: "header", label: "Cabeçalho", icon: Type },
  { value: "divider", label: "Divisor", icon: Minus },
];

const PALETTES = [
  { label: "Verde Vendas", bg: "linear-gradient(135deg,#0f3d2e,#16a34a)", accent: "#22c55e", accent2: "#16a34a" },
  { label: "Banana", bg: "linear-gradient(135deg,#ea580c,#fde047)", accent: "#f59e0b", accent2: "#ea580c" },
  { label: "Coral", bg: "linear-gradient(135deg,#ff5858,#f857a6)", accent: "#ff5858", accent2: "#f857a6" },
  { label: "Roxo Neon", bg: "linear-gradient(135deg,#7c3aed,#ec4899)", accent: "#a855f7", accent2: "#ec4899" },
  { label: "Oceano", bg: "linear-gradient(135deg,#0369a1,#22d3ee)", accent: "#06b6d4", accent2: "#0ea5e9" },
  { label: "Pôr do Sol", bg: "linear-gradient(135deg,#f97316,#db2777)", accent: "#fb923c", accent2: "#db2777" },
  { label: "Noite", bg: "linear-gradient(135deg,#0f172a,#334155)", accent: "#38bdf8", accent2: "#818cf8" },
  { label: "Floresta", bg: "linear-gradient(135deg,#064e3b,#34d399)", accent: "#34d399", accent2: "#10b981" },
];

const SOCIAL_NETWORKS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
];

const SIZE_RE = /tamanho|numera|n[uú]mero|size/i;
function computeGradeClient(node: ShopifyProduct["node"]): { total: number; available: number; pct: number } {
  const sizeOpt = (node.options || []).find((o) => SIZE_RE.test(o.name));
  const variants = (node.variants?.edges || []).map((e) => e.node);
  if (sizeOpt) {
    const total = sizeOpt.values.length;
    const set = new Set<string>();
    for (const v of variants) {
      if (!v.availableForSale) continue;
      const so = (v.selectedOptions || []).find((s) => SIZE_RE.test(s.name));
      if (so) set.add(so.value);
    }
    return { total, available: set.size, pct: total ? set.size / total : 0 };
  }
  const total = variants.length;
  const available = variants.filter((v) => v.availableForSale).length;
  return { total, available, pct: total ? available / total : 0 };
}

const SITE_URL = "https://bananacalcados.com.br/";

export function LinkPageManager() {
  const [pages, setPages] = useState<LinkPage[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [selectedPage, setSelectedPage] = useState<LinkPage | null>(null);
  const [items, setItems] = useState<LinkPageItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [analyticsPageId, setAnalyticsPageId] = useState<string | null>(null);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [qrPageId, setQrPageId] = useState<string | null>(null);

  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [shopifySearch, setShopifySearch] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  const [uploading, setUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newSellerId, setNewSellerId] = useState("");
  const [newRequireCapture, setNewRequireCapture] = useState(false);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("link_pages").select("*").order("created_at", { ascending: false });
    setPages((data || []) as any);
    setLoading(false);
  }, []);
  const fetchRefs = useCallback(async () => {
    const [s, se, wa] = await Promise.all([
      supabase.from("pos_stores").select("id, name").eq("is_active", true),
      supabase.from("pos_sellers").select("id, name, store_id").eq("is_active", true),
      supabase.from("whatsapp_numbers").select("id, label, provider, is_online, is_active, phone_display, wasender_phone_number, uazapi_owner").eq("is_active", true),
    ]);
    setStores((s.data || []) as any);
    setSellers((se.data || []) as any);
    setInstances((wa.data || []) as any);
  }, []);
  const fetchItems = useCallback(async (pageId: string) => {
    const { data } = await supabase.from("link_page_items").select("*").eq("page_id", pageId).order("sort_order");
    setItems((data || []) as any);
  }, []);
  const fetchCatalog = useCallback(async (pageId: string) => {
    const { data } = await supabase.from("link_page_catalog_products").select("*").eq("page_id", pageId).order("sort_order");
    setCatalog((data || []) as any);
  }, []);

  useEffect(() => { fetchPages(); fetchRefs(); }, [fetchPages, fetchRefs]);
  useEffect(() => {
    if (selectedPage) { fetchItems(selectedPage.id); fetchCatalog(selectedPage.id); }
    else { setItems([]); setCatalog([]); }
  }, [selectedPage, fetchItems, fetchCatalog]);

  const createPage = async () => {
    if (!newTitle || !newSlug) { toast.error("Título e slug obrigatórios"); return; }
    const pal = PALETTES[0];
    const { data, error } = await supabase.from("link_pages").insert({
      title: newTitle,
      slug: newSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      seller_id: newSellerId || null,
      require_lead_capture: newRequireCapture,
      background_value: pal.bg,
      theme_config: { accentColor: pal.accent, accent2Color: pal.accent2 },
    }).select().single();
    if (error) { toast.error(error.message?.includes("duplicate") ? "Slug em uso" : "Erro ao criar"); return; }
    toast.success("Página criada!");
    setNewPageOpen(false); setNewTitle(""); setNewSlug(""); setNewSellerId(""); setNewRequireCapture(false);
    fetchPages(); setSelectedPage(data as any);
  };

  const updatePage = async (updates: Partial<LinkPage>) => {
    if (!selectedPage) return;
    const { error } = await supabase.from("link_pages").update(updates as any).eq("id", selectedPage.id);
    if (error) { toast.error("Erro ao salvar"); return; }
    setSelectedPage((p) => p ? { ...p, ...updates } : null);
    setPages((prev) => prev.map((p) => p.id === selectedPage.id ? { ...p, ...updates } : p));
  };

  const addItem = async (itemType: string, extra: Partial<LinkPageItem> = {}) => {
    if (!selectedPage) return;
    const maxOrder = items.length ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0;
    const defaults: Record<string, any> = {
      whatsapp: { label: "Fale conosco", card_style: "card", prefill_message: "Olá! Vim pela bio e quero saber mais 😊" },
      catalog: { label: "Nossos Produtos", card_style: "card", url: null },
      vip: { label: "Grupo VIP", card_style: "card", url: "https://" },
      live: { label: "Nossa Live", card_style: "card", url: "https://" },
      review: { label: "Avalie a loja", card_style: "compact", url: "https://" },
      website: { label: "Loja Online", card_style: "card", url: SITE_URL },
      instagram: { label: "Instagram", card_style: "compact", url: "https://instagram.com/" },
      social: { label: "Rede Social", card_style: "compact", url: "https://", social_network: "tiktok" },
      address: { label: "Onde estamos", card_style: "compact", url: "https://maps.google.com" },
      email: { label: "E-mail", card_style: "compact", url: "mailto:" },
      link: { label: "Novo Link", card_style: "compact", url: "https://" },
      header: { label: "Seção", card_style: "compact", url: null },
      divider: { label: "—", card_style: "compact", url: null },
    };
    const d = { ...(defaults[itemType] || defaults.link), ...extra };
    const { data, error } = await supabase.from("link_page_items").insert({
      page_id: selectedPage.id, item_type: itemType, label: d.label, url: d.url,
      sort_order: maxOrder, style_config: {}, card_style: d.card_style,
      prefill_message: d.prefill_message || null, whatsapp_number_id: d.whatsapp_number_id || null,
      social_network: d.social_network || null,
    }).select().single();
    if (error) { toast.error("Erro ao adicionar"); return; }
    setItems((prev) => [...prev, data as any]);
  };

  const addWhatsAppInstance = (inst: WaInstance) => {
    if (items.some((i) => i.whatsapp_number_id === inst.id)) { toast.info("Instância já adicionada"); return; }
    addItem("whatsapp", { label: inst.label, whatsapp_number_id: inst.id });
    toast.success(`"${inst.label}" adicionada`);
  };

  const updateItem = async (id: string, updates: Partial<LinkPageItem>) => {
    const { error } = await supabase.from("link_page_items").update(updates as any).eq("id", id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...updates } : i));
  };
  const deleteItem = async (id: string) => {
    await supabase.from("link_page_items").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };
  const moveItem = async (id: string, dir: "up" | "down") => {
    const idx = items.findIndex((i) => i.id === id);
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= items.length) return;
    const arr = [...items];
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    arr.forEach((it, i) => (it.sort_order = i));
    setItems(arr);
    await Promise.all(arr.map((it, i) => supabase.from("link_page_items").update({ sort_order: i }).eq("id", it.id)));
  };

  const deletePage = async (id: string) => {
    if (!confirm("Excluir esta página?")) return;
    await supabase.from("link_pages").delete().eq("id", id);
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (selectedPage?.id === id) setSelectedPage(null);
  };

  const fetchAnalytics = async (pageId: string) => {
    setAnalyticsPageId(pageId);
    const { data } = await supabase.from("link_page_visits").select("*, link_page_items(label)").eq("page_id", pageId).order("created_at", { ascending: false }).limit(1000);
    setAnalytics((data || []) as any);
  };

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/l/${slug}`);
    toast.success("Link copiado!");
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: "logo_url" | "avatar_url") => {
    const file = e.target.files?.[0];
    if (!file || !selectedPage) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Máximo 5MB"); return; }
    setUploading(true);
    try {
      const path = `link-pages/${selectedPage.id}-${field}-${Date.now()}.${file.name.split(".").pop()}`;
      const { error } = await supabase.storage.from("marketing-attachments").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("marketing-attachments").getPublicUrl(path);
      await updatePage({ [field]: data.publicUrl } as any);
      toast.success("Imagem atualizada!");
    } catch { toast.error("Erro no upload"); }
    setUploading(false);
    e.target.value = "";
  };

  const syncCatalog = async () => {
    if (!selectedPage) return;
    setSyncingCatalog(true);
    try {
      const { data, error } = await supabase.functions.invoke("link-page-catalog-sync", { body: { pageId: selectedPage.id } });
      if (error) throw error;
      toast.success(`Catálogo sincronizado (${data?.activated || 0} ativos)`);
      await fetchCatalog(selectedPage.id);
    } catch { toast.error("Erro ao sincronizar catálogo"); }
    setSyncingCatalog(false);
  };

  // ─── Manual catalog picker ───
  const openCatalogPicker = async () => {
    setCatalogPickerOpen(true);
    setPickerSelected(new Set(catalog.map((c) => c.shopify_product_id)));
    if (shopifyProducts.length === 0) {
      setLoadingProducts(true);
      try { setShopifyProducts(await fetchProducts(250)); } catch { toast.error("Erro Shopify"); }
      setLoadingProducts(false);
    }
  };
  const togglePicker = (id: string) => {
    setPickerSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const saveManualCatalog = async () => {
    if (!selectedPage) return;
    const chosen = shopifyProducts.filter((p) => pickerSelected.has(p.node.id));
    // upsert chosen
    let order = 0;
    for (const p of chosen) {
      const g = computeGradeClient(p.node);
      const img = p.node.images?.edges?.[0]?.node?.url || null;
      await supabase.from("link_page_catalog_products").upsert({
        page_id: selectedPage.id, shopify_product_id: p.node.id, handle: p.node.handle, title: p.node.title,
        image_url: img, price: Number(p.node.priceRange?.minVariantPrice?.amount || 0),
        product_type: p.node.productType, grade_total: g.total, grade_available: g.available,
        grade_pct: Number(g.pct.toFixed(3)), is_active: !!img && g.pct >= 0.6, sort_order: order++,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "page_id,shopify_product_id" });
    }
    // remove unchosen
    const removeIds = catalog.filter((c) => !pickerSelected.has(c.shopify_product_id)).map((c) => c.id);
    if (removeIds.length) await supabase.from("link_page_catalog_products").delete().in("id", removeIds);
    setCatalogPickerOpen(false);
    await fetchCatalog(selectedPage.id);
    toast.success("Catálogo atualizado");
  };

  const filteredProducts = shopifyProducts.filter((p) => !shopifySearch || p.node.title.toLowerCase().includes(shopifySearch.toLowerCase()));

  // ═══════════ LIST VIEW ═══════════
  if (!selectedPage) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Link Pages</h2>
            <p className="text-sm text-muted-foreground">Páginas de bio com botões grandes, catálogo automático e captação por vendedora</p>
          </div>
          <Dialog open={newPageOpen} onOpenChange={setNewPageOpen}>
            <DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" />Nova Página</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova Link Page</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Título</Label>
                  <Input value={newTitle} onChange={(e) => { setNewTitle(e.target.value); setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")); }} placeholder="Banana Calçados GV" />
                </div>
                <div>
                  <Label>Slug (URL)</Label>
                  <Input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="banana-gv" />
                  <p className="text-xs text-muted-foreground mt-1">{window.location.origin}/l/{newSlug || "..."}</p>
                </div>
                <div>
                  <Label>Vincular a vendedora (opcional)</Label>
                  <Select value={newSellerId || "none"} onValueChange={(v) => setNewSellerId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {sellers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={newRequireCapture} onCheckedChange={setNewRequireCapture} />
                  <Label>Pedir Nome + Telefone antes de ver os botões</Label>
                </div>
                <Button onClick={createPage} className="w-full">Criar Página</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : pages.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <LinkIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhuma Link Page criada ainda</p>
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pages.map((page) => {
              const seller = sellers.find((s) => s.id === page.seller_id);
              return (
                <Card key={page.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedPage(page)}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-white">{page.title}</h3>
                        <p className="text-xs text-muted-foreground">/l/{page.slug}</p>
                        {seller && <Badge variant="outline" className="text-[10px] mt-1 gap-1"><Users className="h-2.5 w-2.5" />{seller.name}</Badge>}
                      </div>
                      <Badge variant={page.is_active ? "default" : "secondary"} className="text-xs">{page.is_active ? "Ativa" : "Inativa"}</Badge>
                    </div>
                    <div className="h-16 rounded-lg" style={{ background: page.background_value }} />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{page.total_views}</span>
                      <span className="flex items-center gap-1"><MousePointer className="h-3 w-3" />{page.total_clicks}</span>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => copyLink(page.slug)}><Copy className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => window.open(`/l/${page.slug}`, "_blank")}><ExternalLink className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setQrPageId(page.id)}><QrCode className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => fetchAnalytics(page.id)}><BarChart3 className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deletePage(page.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <QrDialog pageId={qrPageId} pages={pages} onClose={() => setQrPageId(null)} />
        <AnalyticsDialog analytics={analytics} pageId={analyticsPageId} onClose={() => setAnalyticsPageId(null)} />
      </div>
    );
  }

  // ═══════════ EDITOR VIEW ═══════════
  const theme = selectedPage.theme_config || {};
  const accent = theme.accentColor || "#22c55e";
  const accent2 = theme.accent2Color || "#16a34a";
  const usedInstanceIds = new Set(items.filter((i) => i.whatsapp_number_id).map((i) => i.whatsapp_number_id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedPage(null)} className="text-white">← Voltar</Button>
          <h2 className="text-lg font-bold text-white">{selectedPage.title}</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => copyLink(selectedPage.slug)} className="gap-1"><Copy className="h-3.5 w-3.5" />Link</Button>
          <Button variant="outline" size="sm" onClick={() => setQrPageId(selectedPage.id)} className="gap-1"><QrCode className="h-3.5 w-3.5" />QR Code</Button>
          <Button variant="outline" size="sm" onClick={() => window.open(`/l/${selectedPage.slug}`, "_blank")} className="gap-1"><ExternalLink className="h-3.5 w-3.5" />Preview</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {/* Config */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-white">Configurações</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-white">Título</Label><Input value={selectedPage.title} onChange={(e) => updatePage({ title: e.target.value })} /></div>
                <div><Label className="text-white">Slug</Label><Input value={selectedPage.slug} onChange={(e) => updatePage({ slug: e.target.value })} /></div>
              </div>
              <div><Label className="text-white">Subtítulo</Label><Input value={selectedPage.subtitle || ""} onChange={(e) => updatePage({ subtitle: e.target.value })} placeholder="Frase de impacto..." /></div>
              <div>
                <Label className="text-white">Logo (impacto no topo)</Label>
                <div className="flex gap-2 items-center">
                  <Input value={selectedPage.logo_url || ""} onChange={(e) => updatePage({ logo_url: e.target.value })} placeholder="https://..." className="flex-1" />
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoUpload(e, "logo_url")} />
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => logoInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-white">Vendedora vinculada</Label>
                <Select value={selectedPage.seller_id || ""} onValueChange={(v) => updatePage({ seller_id: v || null })}>
                  <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Nenhuma</SelectItem>
                    {sellers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={selectedPage.require_lead_capture} onCheckedChange={(v) => updatePage({ require_lead_capture: v })} />
                <Label className="text-white text-sm">Pedir Nome + Telefone antes dos botões</Label>
              </div>
              <div><Label className="text-white">Meta Pixel ID</Label><Input value={selectedPage.meta_pixel_id || ""} onChange={(e) => updatePage({ meta_pixel_id: e.target.value })} placeholder="123456789" /></div>
              <div className="flex items-center gap-2">
                <Switch checked={selectedPage.is_active} onCheckedChange={(v) => updatePage({ is_active: v })} />
                <Label className="text-white">Página ativa</Label>
              </div>
            </CardContent>
          </Card>

          {/* Palette */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-white">Cores Vibrantes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {PALETTES.map((p) => (
                  <button key={p.label} title={p.label}
                    className={`h-12 rounded-lg border-2 transition-all ${selectedPage.background_value === p.bg ? "border-white scale-105" : "border-transparent"}`}
                    style={{ background: p.bg }}
                    onClick={() => updatePage({ background_value: p.bg, theme_config: { ...theme, accentColor: p.accent, accent2Color: p.accent2 } })}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-white text-xs">Destaque</Label>
                  <input type="color" value={accent} onChange={(e) => updatePage({ theme_config: { ...theme, accentColor: e.target.value } })} className="w-full h-8 rounded cursor-pointer" />
                </div>
                <div>
                  <Label className="text-white text-xs">Destaque 2</Label>
                  <input type="color" value={accent2} onChange={(e) => updatePage({ theme_config: { ...theme, accent2Color: e.target.value } })} className="w-full h-8 rounded cursor-pointer" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp instances */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-white flex items-center gap-2"><Phone className="h-4 w-4" />Instâncias de WhatsApp</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Instâncias conectadas no sistema. Clique para adicionar como botão (você renomeia depois). Offline some automaticamente da página pública.</p>
              {instances.length === 0 && <p className="text-xs text-muted-foreground py-2">Nenhuma instância ativa.</p>}
              {instances.map((inst) => {
                const used = usedInstanceIds.has(inst.id);
                const online = inst.is_online !== false;
                return (
                  <div key={inst.id} className="flex items-center justify-between border rounded-lg px-3 py-2 bg-card">
                    <div className="flex items-center gap-2 min-w-0">
                      {online ? <Wifi className="h-3.5 w-3.5 text-green-500" /> : <WifiOff className="h-3.5 w-3.5 text-destructive" />}
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{inst.label}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">{inst.provider} · {online ? "online" : "offline"}</p>
                      </div>
                    </div>
                    <Button size="sm" variant={used ? "secondary" : "outline"} disabled={used} onClick={() => addWhatsAppInstance(inst)} className="h-7 gap-1 text-xs">
                      {used ? <><Check className="h-3 w-3" />Adicionada</> : <><Plus className="h-3 w-3" />Adicionar</>}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Catalog */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-white flex items-center gap-2"><ShoppingBag className="h-4 w-4" />Catálogo</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-white text-xs">Modo de atualização</Label>
                <Select value={selectedPage.catalog_mode || "manual"} onValueChange={(v) => updatePage({ catalog_mode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual (eu escolho)</SelectItem>
                    <SelectItem value="lancamentos">Lançamentos (automático)</SelectItem>
                    <SelectItem value="mais_vendidos">Mais Vendidos (automático)</SelectItem>
                    <SelectItem value="todos">Todos os produtos (automático)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">Só entram produtos com foto e grade de tamanhos ≥ 60% disponível. Abaixo disso saem sozinhos.</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={syncCatalog} disabled={syncingCatalog}>
                  {syncingCatalog ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Sincronizar agora
                </Button>
                {(selectedPage.catalog_mode || "manual") === "manual" && (
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={openCatalogPicker}><Search className="h-3.5 w-3.5" />Escolher produtos</Button>
                )}
              </div>
              {catalog.length > 0 && (
                <div className="grid grid-cols-4 gap-1">
                  {catalog.slice(0, 8).map((c) => (
                    <div key={c.id} className="aspect-square rounded overflow-hidden bg-muted relative">
                      {c.image_url && <img src={c.image_url} alt={c.title} className="w-full h-full object-cover" />}
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white text-center">{Math.round(c.grade_pct * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">{catalog.filter((c) => c.is_active).length} produtos ativos · adicione um botão "Catálogo" para exibi-los.</p>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-white">Botões ({items.length})</CardTitle>
                <Dialog>
                  <DialogTrigger asChild><Button size="sm" className="gap-1 h-8"><Plus className="h-3.5 w-3.5" />Adicionar</Button></DialogTrigger>
                  <DialogContent className="max-w-xs">
                    <DialogHeader><DialogTitle>Adicionar Botão</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-2">
                      {ITEM_TYPES.filter((t) => t.value !== "whatsapp").map((t) => (
                        <Button key={t.value} variant="outline" className="gap-2 justify-start h-10" onClick={() => addItem(t.value)}>
                          <t.icon className="h-4 w-4" />{t.label}
                        </Button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">WhatsApp é adicionado pela seção de instâncias acima.</p>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[460px]">
                <div className="space-y-2 pr-3">
                  {items.map((item, idx) => {
                    const inst = instances.find((i) => i.id === item.whatsapp_number_id);
                    return (
                      <div key={item.id} className="border rounded-lg p-3 space-y-2 bg-card">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                            <Badge variant="outline" className="text-xs">{ITEM_TYPES.find((t) => t.value === item.item_type)?.label || item.item_type}</Badge>
                            <span className="text-xs text-muted-foreground">{item.clicks} cliques</span>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveItem(item.id, "up")} disabled={idx === 0}><ChevronUp className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveItem(item.id, "down")} disabled={idx === items.length - 1}><ChevronDown className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteItem(item.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </div>
                        <Input value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} placeholder="Texto do botão" className="h-8 text-sm" />

                        {item.item_type === "whatsapp" ? (
                          <>
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                              {inst ? <>{inst.is_online !== false ? <Wifi className="h-3 w-3 text-green-500" /> : <WifiOff className="h-3 w-3 text-destructive" />}{inst.label} ({inst.provider})</> : "Instância não vinculada"}
                            </div>
                            <Textarea value={item.prefill_message || ""} onChange={(e) => updateItem(item.id, { prefill_message: e.target.value })} placeholder="Mensagem que o cliente envia automaticamente..." className="text-sm min-h-[60px]" />
                          </>
                        ) : item.item_type === "social" ? (
                          <>
                            <Select value={item.social_network || "tiktok"} onValueChange={(v) => updateItem(item.id, { social_network: v })}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>{SOCIAL_NETWORKS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Input value={item.url || ""} onChange={(e) => updateItem(item.id, { url: e.target.value })} placeholder="https://..." className="h-8 text-sm" />
                          </>
                        ) : item.item_type !== "header" && item.item_type !== "divider" && item.item_type !== "catalog" ? (
                          <Input value={item.url || ""} onChange={(e) => updateItem(item.id, { url: e.target.value })} placeholder="URL" className="h-8 text-sm" />
                        ) : null}

                        {item.item_type !== "header" && item.item_type !== "divider" && (
                          <Input value={item.description || ""} onChange={(e) => updateItem(item.id, { description: e.target.value })} placeholder="Descrição (opcional)" className="h-8 text-sm" />
                        )}

                        {item.item_type !== "header" && item.item_type !== "divider" && item.item_type !== "catalog" && (
                          <>
                            <div className="flex items-center gap-2">
                              <Switch checked={item.card_style === "card"} onCheckedChange={(v) => updateItem(item.id, { card_style: v ? "card" : "compact" })} />
                              <span className="text-xs text-muted-foreground">Botão grande (card)</span>
                            </div>
                            {item.card_style === "card" && (
                              <Input value={item.style_config?.coverImage || ""} onChange={(e) => updateItem(item.id, { style_config: { ...(item.style_config || {}), coverImage: e.target.value } })} placeholder="URL imagem de fundo (opcional)" className="h-8 text-sm" />
                            )}
                          </>
                        )}

                        <div className="flex items-center gap-2">
                          <Switch checked={item.is_active} onCheckedChange={(v) => updateItem(item.id, { is_active: v })} />
                          <span className="text-xs text-muted-foreground">{item.is_active ? "Visível" : "Oculto"}</span>
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && <p className="text-center text-sm text-muted-foreground py-6">Adicione instâncias de WhatsApp ou botões.</p>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        <div className="lg:sticky lg:top-20 self-start">
          <Card className="overflow-hidden">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-white">Preview</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="mx-auto max-w-[375px] rounded-2xl overflow-hidden shadow-2xl border" style={{ height: "667px" }}>
                <div className="h-full overflow-y-auto" style={{ background: selectedPage.background_value }}>
                  <div className="flex flex-col items-center pt-10 px-5 pb-8">
                    {(selectedPage.logo_url || selectedPage.avatar_url) && (
                      <img src={selectedPage.logo_url || selectedPage.avatar_url || ""} alt="" className="h-20 object-contain drop-shadow-xl mb-3" />
                    )}
                    <h1 className="text-2xl font-black text-white text-center drop-shadow">{selectedPage.title}</h1>
                    {selectedPage.subtitle && <p className="text-sm text-white/85 text-center mt-1">{selectedPage.subtitle}</p>}
                    <div className="w-full mt-6 space-y-3">
                      {items.filter((i) => i.is_active).map((item) => {
                        if (item.item_type === "divider") return <hr key={item.id} className="border-white/20" />;
                        if (item.item_type === "header") return <p key={item.id} className="text-xs font-bold text-white/70 uppercase tracking-wider text-center mt-3">{item.label}</p>;
                        if (item.item_type === "catalog") {
                          return (
                            <div key={item.id} className="grid grid-cols-2 gap-2">
                              {catalog.filter((c) => c.is_active).slice(0, 4).map((c) => (
                                <div key={c.id} className="rounded-xl overflow-hidden bg-white">
                                  <div className="aspect-square bg-gray-100">{c.image_url && <img src={c.image_url} alt={c.title} className="w-full h-full object-cover" />}</div>
                                  <p className="text-[10px] font-semibold text-gray-800 truncate px-1.5 py-1">{c.title}</p>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        const cover = item.style_config?.coverImage;
                        if (item.card_style === "card") {
                          return (
                            <div key={item.id} className="rounded-2xl overflow-hidden shadow-lg min-h-[80px] flex items-end p-4"
                              style={cover ? { backgroundImage: `url(${cover})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: `linear-gradient(135deg,${accent},${accent2})` }}>
                              <p className="text-white font-extrabold text-base drop-shadow">{item.label}</p>
                            </div>
                          );
                        }
                        return (
                          <div key={item.id} className="py-3 px-4 rounded-2xl bg-white/95 shadow"><p className="font-bold text-sm text-gray-900">{item.label}</p></div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Manual catalog picker */}
      <Dialog open={catalogPickerOpen} onOpenChange={setCatalogPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Escolher Produtos (Shopify)</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input value={shopifySearch} onChange={(e) => setShopifySearch(e.target.value)} placeholder="Buscar..." className="flex-1" />
            <Button onClick={saveManualCatalog} className="gap-1"><Check className="h-4 w-4" />Salvar ({pickerSelected.size})</Button>
          </div>
          <ScrollArea className="h-[400px]">
            {loadingProducts ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <div className="grid grid-cols-3 gap-2 pr-3">
                {filteredProducts.map((p) => {
                  const g = computeGradeClient(p.node);
                  const img = p.node.images?.edges?.[0]?.node?.url;
                  const selected = pickerSelected.has(p.node.id);
                  const ok = !!img && g.pct >= 0.6;
                  return (
                    <button key={p.node.id} onClick={() => togglePicker(p.node.id)}
                      className={`relative rounded-lg overflow-hidden border-2 ${selected ? "border-primary" : "border-transparent"} ${!ok ? "opacity-50" : ""}`}>
                      <div className="aspect-square bg-muted">{img && <img src={img} alt={p.node.title} className="w-full h-full object-cover" />}</div>
                      <p className="text-[10px] truncate p-1 text-white">{p.node.title}</p>
                      <span className={`absolute top-1 right-1 text-[9px] px-1 rounded text-white ${ok ? "bg-green-600" : "bg-red-600"}`}>{Math.round(g.pct * 100)}%</span>
                      {selected && <Check className="absolute top-1 left-1 h-4 w-4 text-primary bg-white rounded-full p-0.5" />}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <QrDialog pageId={qrPageId} pages={pages.length ? pages : [selectedPage]} onClose={() => setQrPageId(null)} />
      <AnalyticsDialog analytics={analytics} pageId={analyticsPageId} onClose={() => setAnalyticsPageId(null)} />
    </div>
  );
}

// ─── QR Dialog ───
function QrDialog({ pageId, pages, onClose }: { pageId: string | null; pages: any[]; onClose: () => void }) {
  const page = pages.find((p) => p.id === pageId);
  const url = page ? `${window.location.origin}/l/${page.slug}` : "";
  const downloadQr = () => {
    const svg = document.getElementById("lp-qr-svg");
    if (!svg) return;
    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([data], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qr-${page.slug}.svg`;
    a.click();
  };
  return (
    <Dialog open={!!pageId} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>QR Code — {page?.title}</DialogTitle></DialogHeader>
        {page && (
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-4 rounded-xl">
              <QRCode id="lp-qr-svg" value={url} size={200} />
            </div>
            <p className="text-xs text-muted-foreground break-all text-center">{url}</p>
            <Button onClick={downloadQr} className="w-full gap-1"><Upload className="h-4 w-4 rotate-180" />Baixar QR (SVG)</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Analytics Dialog ───
function AnalyticsDialog({ analytics, pageId, onClose }: { analytics: any[]; pageId: string | null; onClose: () => void }) {
  const views = analytics.filter((a) => a.event_type === "page_view");
  const clicks = analytics.filter((a) => a.event_type === "click");
  const byButton: Record<string, number> = {};
  for (const c of clicks) {
    const label = c.link_page_items?.label || "—";
    byButton[label] = (byButton[label] || 0) + 1;
  }
  return (
    <Dialog open={!!pageId} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Analytics</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Views</p><p className="text-2xl font-bold text-white">{views.length}</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Cliques</p><p className="text-2xl font-bold text-white">{clicks.length}</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Engajamento</p><p className="text-2xl font-bold text-white">{views.length ? ((clicks.length / views.length) * 100).toFixed(1) : 0}%</p></CardContent></Card>
          </div>
          <Card><CardContent className="p-3">
            <p className="text-xs font-semibold text-white mb-2">Cliques por botão</p>
            {Object.entries(byButton).sort(([, a], [, b]) => b - a).map(([label, count]) => (
              <div key={label} className="flex justify-between text-sm py-1">
                <span className="text-muted-foreground">{label}</span><span className="text-white font-medium">{count}</span>
              </div>
            ))}
            {!Object.keys(byButton).length && <p className="text-xs text-muted-foreground">Sem cliques ainda.</p>}
          </CardContent></Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

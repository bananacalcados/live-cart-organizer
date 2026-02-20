import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";
import {
  Plus, Save, Trash2, Loader2, Search, Check, X, ExternalLink,
  Copy, Palette, MessageSquare, Store, Eye, EyeOff, ChevronDown, ChevronUp, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";

// ─── Types ───────────────────────────────────────

interface CatalogLP {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  is_active: boolean;
  theme_config: ThemeConfig;
  welcome_title: string;
  welcome_subtitle: string | null;
  combo_tiers: ComboTier[];
  payment_info: string | null;
  cta_text: string;
  categories: Category[];
  whatsapp_numbers: WhatsAppNumber[];
  selected_product_ids: string[];
  product_filter: ProductFilter;
  store_base_url: string;
  views: number;
  clicks: number;
  created_at: string;
}

interface ThemeConfig {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  buttonWhatsappColor: string;
  buttonStoreColor: string;
  backgroundGradient: string;
}

interface ComboTier { qty: string; price: string; }
interface Category { key: string; label: string; emoji: string; }
interface WhatsAppNumber { name: string; number: string; }
interface ProductFilter { sizeFilter: string; filterBySize: boolean; }

interface ShopifyProductSimple {
  id: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: string;
}

// ─── Theme Presets ───────────────────────────────────────

const THEME_PRESETS: Array<{ name: string; theme: ThemeConfig }> = [
  {
    name: "Esmeralda (Padrão)",
    theme: {
      primaryColor: "#00BFA6",
      secondaryColor: "#00897B",
      accentColor: "#004D40",
      buttonWhatsappColor: "#25D366",
      buttonStoreColor: "#7C3AED",
      backgroundGradient: "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)",
    },
  },
  {
    name: "Rosa Quente",
    theme: {
      primaryColor: "#E91E63",
      secondaryColor: "#C2185B",
      accentColor: "#880E4F",
      buttonWhatsappColor: "#25D366",
      buttonStoreColor: "#7C3AED",
      backgroundGradient: "linear-gradient(160deg, #E91E63 0%, #C2185B 50%, #880E4F 100%)",
    },
  },
  {
    name: "Azul Royal",
    theme: {
      primaryColor: "#1565C0",
      secondaryColor: "#0D47A1",
      accentColor: "#0A1929",
      buttonWhatsappColor: "#25D366",
      buttonStoreColor: "#7C3AED",
      backgroundGradient: "linear-gradient(160deg, #1976D2 0%, #1565C0 50%, #0D47A1 100%)",
    },
  },
  {
    name: "Dourado Premium",
    theme: {
      primaryColor: "#D4A017",
      secondaryColor: "#B8860B",
      accentColor: "#5C4300",
      buttonWhatsappColor: "#25D366",
      buttonStoreColor: "#7C3AED",
      backgroundGradient: "linear-gradient(160deg, #D4A017 0%, #B8860B 50%, #5C4300 100%)",
    },
  },
  {
    name: "Coral Sunset",
    theme: {
      primaryColor: "#FF6B6B",
      secondaryColor: "#EE5A24",
      accentColor: "#6D214F",
      buttonWhatsappColor: "#25D366",
      buttonStoreColor: "#7C3AED",
      backgroundGradient: "linear-gradient(160deg, #FF6B6B 0%, #EE5A24 50%, #6D214F 100%)",
    },
  },
];

const DEFAULT_THEME = THEME_PRESETS[0].theme;

const DEFAULT_CATEGORIES: Category[] = [
  { key: "todos", label: "Todos", emoji: "👟" },
  { key: "tenis", label: "Tênis", emoji: "👟" },
  { key: "salto", label: "Salto", emoji: "👠" },
  { key: "papete", label: "Papete", emoji: "🩴" },
  { key: "rasteira", label: "Rasteira", emoji: "🥿" },
  { key: "sandalia", label: "Sandália", emoji: "👡" },
  { key: "bota", label: "Bota", emoji: "🥾" },
];

const DEFAULT_COMBOS: ComboTier[] = [
  { qty: "1 par", price: "R$ 150" },
  { qty: "2 pares", price: "R$ 240" },
  { qty: "3 pares", price: "R$ 300" },
];

const DEFAULT_WHATSAPP: WhatsAppNumber[] = [
  { name: "Banana Calçados", number: "5533936180084" },
  { name: "Zoppy", number: "5533935050288" },
];

// ─── Color Palette ───────────────────────────────────────

const COLOR_PALETTE = [
  "#E91E63", "#F44336", "#FF5722", "#FF9800", "#FFC107",
  "#CDDC39", "#8BC34A", "#4CAF50", "#009688", "#00BCD4",
  "#03A9F4", "#2196F3", "#3F51B5", "#673AB7", "#9C27B0",
  "#795548", "#607D8B", "#D4A017", "#B8860B", "#000000",
];

function ColorPickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`w-6 h-6 rounded-full border-2 transition-all ${value === c ? "border-foreground scale-110 ring-2 ring-primary/30" : "border-transparent hover:scale-110"}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="w-6 h-6 rounded border" style={{ background: value }} />
        <span className="text-[10px] text-muted-foreground font-mono">{value}</span>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────

export function CatalogLandingPageCreator() {
  const [pages, setPages] = useState<CatalogLP[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPage, setEditingPage] = useState<Partial<CatalogLP> | null>(null);

  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductSimple[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("catalog_landing_pages")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPages((data || []) as unknown as CatalogLP[]);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar catálogos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  const loadShopifyProducts = async (forceReload = false) => {
    if (shopifyProducts.length > 0 && !forceReload) return;
    setProductsLoading(true);
    try {
      const raw = await fetchProducts(250);
      setShopifyProducts(
        raw.map((p) => ({
          id: p.node.id,
          title: p.node.title,
          handle: p.node.handle,
          imageUrl: p.node.images.edges[0]?.node.url || "",
          price: p.node.priceRange.minVariantPrice.amount,
        }))
      );
    } catch {
      toast.error("Erro ao carregar produtos da Shopify");
    } finally {
      setProductsLoading(false);
    }
  };

  const openNew = () => {
    setEditingPage({
      slug: "",
      title: "",
      subtitle: "",
      is_active: true,
      theme_config: { ...DEFAULT_THEME },
      welcome_title: "Confira nossos produtos!",
      welcome_subtitle: "",
      combo_tiers: [...DEFAULT_COMBOS],
      payment_info: "Até 6x sem juros no cartão ou 15% cashback no Pix",
      cta_text: "Ver Produtos 👀",
      categories: [...DEFAULT_CATEGORIES],
      whatsapp_numbers: [...DEFAULT_WHATSAPP],
      selected_product_ids: [],
      product_filter: { sizeFilter: "34", filterBySize: true },
      store_base_url: "https://bananacalcados.com.br",
    });
    loadShopifyProducts();
    setEditorOpen(true);
  };

  const openEdit = (page: CatalogLP) => {
    setEditingPage({ ...page });
    loadShopifyProducts();
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!editingPage) return;
    if (!editingPage.slug || !editingPage.title) {
      toast.error("Slug e título são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        slug: editingPage.slug,
        title: editingPage.title,
        subtitle: editingPage.subtitle || null,
        is_active: editingPage.is_active ?? true,
        theme_config: JSON.parse(JSON.stringify(editingPage.theme_config)),
        welcome_title: editingPage.welcome_title || "Confira!",
        welcome_subtitle: editingPage.welcome_subtitle || null,
        combo_tiers: JSON.parse(JSON.stringify(editingPage.combo_tiers)),
        payment_info: editingPage.payment_info || null,
        cta_text: editingPage.cta_text || "Ver Produtos 👀",
        categories: JSON.parse(JSON.stringify(editingPage.categories)),
        whatsapp_numbers: JSON.parse(JSON.stringify(editingPage.whatsapp_numbers)),
        selected_product_ids: editingPage.selected_product_ids || [],
        product_filter: JSON.parse(JSON.stringify(editingPage.product_filter)),
        store_base_url: editingPage.store_base_url || "https://bananacalcados.com.br",
      };

      if (editingPage.id) {
        const { error } = await supabase.from("catalog_landing_pages").update(payload).eq("id", editingPage.id);
        if (error) throw error;
        toast.success("Catálogo atualizado!");
      } else {
        const { error } = await supabase.from("catalog_landing_pages").insert(payload);
        if (error) throw error;
        toast.success("Catálogo criado!");
      }
      setEditorOpen(false);
      setEditingPage(null);
      fetchPages();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message?.includes("duplicate") ? "Esse slug já existe" : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta landing page?")) return;
    try {
      const { error } = await supabase.from("catalog_landing_pages").delete().eq("id", id);
      if (error) throw error;
      toast.success("Excluída!");
      fetchPages();
    } catch {
      toast.error("Erro ao excluir");
    }
  };

  const toggleProduct = (productId: string) => {
    if (!editingPage) return;
    const ids = editingPage.selected_product_ids || [];
    setEditingPage({
      ...editingPage,
      selected_product_ids: ids.includes(productId)
        ? ids.filter((id) => id !== productId)
        : [...ids, productId],
    });
  };

  const filteredShopifyProducts = productSearch
    ? shopifyProducts.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase()))
    : shopifyProducts;

  const updateField = <K extends keyof CatalogLP>(key: K, value: CatalogLP[K]) => {
    if (!editingPage) return;
    setEditingPage({ ...editingPage, [key]: value });
  };

  const updateTheme = (key: keyof ThemeConfig, value: string) => {
    if (!editingPage?.theme_config) return;
    const newTheme = { ...editingPage.theme_config, [key]: value };
    // Auto-update gradient when primary/secondary/accent change
    if (key === "primaryColor" || key === "secondaryColor" || key === "accentColor") {
      const p = key === "primaryColor" ? value : newTheme.primaryColor;
      const s = key === "secondaryColor" ? value : newTheme.secondaryColor;
      const a = key === "accentColor" ? value : newTheme.accentColor;
      newTheme.backgroundGradient = `linear-gradient(160deg, ${p} 0%, ${s} 50%, ${a} 100%)`;
    }
    setEditingPage({ ...editingPage, theme_config: newTheme });
  };

  const applyPreset = (preset: ThemeConfig) => {
    if (!editingPage) return;
    setEditingPage({ ...editingPage, theme_config: { ...preset } });
  };

  // ─── Render ───────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Catálogos Interativos</h3>
          <p className="text-xs text-muted-foreground">Landing pages com seleção de produtos da Shopify</p>
        </div>
        <Button onClick={openNew} size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> Criar Catálogo
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : pages.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum catálogo criado. Clique em "Criar Catálogo" para começar.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => {
            const publishedUrl = `https://checkout.bananacalcados.com.br/catalogo/${page.slug}`;
            return (
              <Card key={page.id} className="overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{page.title}</p>
                      <Badge variant={page.is_active ? "default" : "secondary"} className="text-[10px]">
                        {page.is_active ? "Ativa" : "Inativa"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {(page.selected_product_ids || []).length} produtos
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{publishedUrl}</p>
                    <p className="text-xs text-muted-foreground">{page.views} views · {page.clicks} clicks</p>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(publishedUrl); toast.success("Link copiado!"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(page)}>Editar</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(page.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Editor Dialog ── */}
      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) { setEditorOpen(false); setEditingPage(null); } }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingPage?.id ? "Editar" : "Criar"} Catálogo Interativo</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-2">
            {editingPage && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-4">
                {/* Left column: Config */}
                <div className="space-y-6">
                {/* Basic Info */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Informações Básicas</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Título</Label>
                      <Input value={editingPage.title || ""} onChange={(e) => updateField("title", e.target.value)} placeholder="Dose Tripla - Tamanho 34" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Slug (URL)</Label>
                      <Input value={editingPage.slug || ""} onChange={(e) => updateField("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="dose-tripla" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Subtítulo</Label>
                    <Input value={editingPage.subtitle || ""} onChange={(e) => updateField("subtitle", e.target.value)} placeholder="Os melhores calçados no tamanho 34" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={editingPage.is_active ?? true} onCheckedChange={(v) => updateField("is_active", v)} />
                    <Label className="text-xs">Página ativa</Label>
                  </div>
                </div>

                <Accordion type="multiple" className="w-full">
                  {/* Welcome screen */}
                  <AccordionItem value="welcome">
                    <AccordionTrigger className="text-xs font-bold uppercase tracking-wider">Tela de Boas-vindas</AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Título da boas-vindas</Label>
                        <Input value={editingPage.welcome_title || ""} onChange={(e) => updateField("welcome_title", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Subtítulo da boas-vindas</Label>
                        <Input value={editingPage.welcome_subtitle || ""} onChange={(e) => updateField("welcome_subtitle", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Texto do botão CTA</Label>
                        <Input value={editingPage.cta_text || ""} onChange={(e) => updateField("cta_text", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Info de pagamento</Label>
                        <Input value={editingPage.payment_info || ""} onChange={(e) => updateField("payment_info", e.target.value)} />
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Combo Tiers */}
                  <AccordionItem value="combos">
                    <AccordionTrigger className="text-xs font-bold uppercase tracking-wider">Preços do Combo</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-2">
                      {(editingPage.combo_tiers || []).map((tier, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Input className="flex-1" placeholder="Qtd" value={tier.qty} onChange={(e) => {
                            const tiers = [...(editingPage.combo_tiers || [])];
                            tiers[i] = { ...tiers[i], qty: e.target.value };
                            updateField("combo_tiers", tiers as any);
                          }} />
                          <Input className="flex-1" placeholder="Preço" value={tier.price} onChange={(e) => {
                            const tiers = [...(editingPage.combo_tiers || [])];
                            tiers[i] = { ...tiers[i], price: e.target.value };
                            updateField("combo_tiers", tiers as any);
                          }} />
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                            const tiers = (editingPage.combo_tiers || []).filter((_, idx) => idx !== i);
                            updateField("combo_tiers", tiers as any);
                          }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => {
                        updateField("combo_tiers", [...(editingPage.combo_tiers || []), { qty: "", price: "" }] as any);
                      }}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar faixa
                      </Button>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Theme */}
                  <AccordionItem value="theme">
                    <AccordionTrigger className="text-xs font-bold uppercase tracking-wider">
                      <span className="flex items-center gap-1"><Palette className="h-3.5 w-3.5" /> Cores e Tema</span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                      {/* Presets */}
                      <div className="space-y-2">
                        <Label className="text-xs font-bold">Temas Prontos</Label>
                        <div className="flex flex-wrap gap-2">
                          {THEME_PRESETS.map((preset) => (
                            <button
                              key={preset.name}
                              type="button"
                              onClick={() => applyPreset(preset.theme)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium hover:ring-2 ring-primary/30 transition-all"
                            >
                              <div className="flex -space-x-1">
                                <div className="w-4 h-4 rounded-full border border-white" style={{ background: preset.theme.primaryColor }} />
                                <div className="w-4 h-4 rounded-full border border-white" style={{ background: preset.theme.secondaryColor }} />
                                <div className="w-4 h-4 rounded-full border border-white" style={{ background: preset.theme.accentColor }} />
                              </div>
                              <span>{preset.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Preview */}
                      {editingPage.theme_config && (
                        <>
                          <div className="h-10 rounded-lg" style={{ background: editingPage.theme_config.backgroundGradient }} />
                          
                          <div className="space-y-4">
                            <ColorPickerField label="Cor Primária" value={editingPage.theme_config.primaryColor} onChange={(v) => updateTheme("primaryColor", v)} />
                            <ColorPickerField label="Cor Secundária" value={editingPage.theme_config.secondaryColor} onChange={(v) => updateTheme("secondaryColor", v)} />
                            <ColorPickerField label="Cor de Fundo" value={editingPage.theme_config.accentColor} onChange={(v) => updateTheme("accentColor", v)} />
                            <ColorPickerField label="Botão WhatsApp" value={editingPage.theme_config.buttonWhatsappColor} onChange={(v) => updateTheme("buttonWhatsappColor", v)} />
                            <ColorPickerField label="Botão Loja" value={editingPage.theme_config.buttonStoreColor} onChange={(v) => updateTheme("buttonStoreColor", v)} />
                          </div>

                          <Button variant="outline" size="sm" className="gap-1" onClick={() => applyPreset(THEME_PRESETS[0].theme)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Voltar às cores padrão
                          </Button>
                        </>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* WhatsApp Numbers */}
                  <AccordionItem value="whatsapp">
                    <AccordionTrigger className="text-xs font-bold uppercase tracking-wider">
                      <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> Números WhatsApp (Round-Robin)</span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-2">
                      {(editingPage.whatsapp_numbers || []).map((wn, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Input className="flex-1" placeholder="Nome" value={wn.name} onChange={(e) => {
                            const nums = [...(editingPage.whatsapp_numbers || [])];
                            nums[i] = { ...nums[i], name: e.target.value };
                            updateField("whatsapp_numbers", nums as any);
                          }} />
                          <Input className="flex-1" placeholder="5533..." value={wn.number} onChange={(e) => {
                            const nums = [...(editingPage.whatsapp_numbers || [])];
                            nums[i] = { ...nums[i], number: e.target.value.replace(/\D/g, "") };
                            updateField("whatsapp_numbers", nums as any);
                          }} />
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                            const nums = (editingPage.whatsapp_numbers || []).filter((_, idx) => idx !== i);
                            updateField("whatsapp_numbers", nums as any);
                          }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => {
                        updateField("whatsapp_numbers", [...(editingPage.whatsapp_numbers || []), { name: "", number: "" }] as any);
                      }}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar número
                      </Button>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Product Filter */}
                  <AccordionItem value="filter">
                    <AccordionTrigger className="text-xs font-bold uppercase tracking-wider">Filtro de Produtos</AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={editingPage.product_filter?.filterBySize ?? true}
                          onCheckedChange={(v) => updateField("product_filter", { ...(editingPage.product_filter || {}), filterBySize: v } as any)}
                        />
                        <Label className="text-xs">Filtrar por tamanho</Label>
                      </div>
                      {editingPage.product_filter?.filterBySize && (
                        <div className="space-y-1">
                          <Label className="text-xs">Tamanho</Label>
                          <Input
                            value={editingPage.product_filter?.sizeFilter || ""}
                            onChange={(e) => updateField("product_filter", { ...(editingPage.product_filter || {}), sizeFilter: e.target.value } as any)}
                            placeholder="34"
                            className="w-24"
                          />
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">URL base da loja</Label>
                        <Input
                          value={editingPage.store_base_url || ""}
                          onChange={(e) => updateField("store_base_url", e.target.value)}
                          placeholder="https://bananacalcados.com.br"
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Categories */}
                  <AccordionItem value="categories">
                    <AccordionTrigger className="text-xs font-bold uppercase tracking-wider">Categorias</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-2">
                      {(editingPage.categories || []).map((cat, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Input className="w-12" value={cat.emoji} onChange={(e) => {
                            const cats = [...(editingPage.categories || [])];
                            cats[i] = { ...cats[i], emoji: e.target.value };
                            updateField("categories", cats as any);
                          }} />
                          <Input className="w-20" placeholder="key" value={cat.key} onChange={(e) => {
                            const cats = [...(editingPage.categories || [])];
                            cats[i] = { ...cats[i], key: e.target.value };
                            updateField("categories", cats as any);
                          }} />
                          <Input className="flex-1" placeholder="Label" value={cat.label} onChange={(e) => {
                            const cats = [...(editingPage.categories || [])];
                            cats[i] = { ...cats[i], label: e.target.value };
                            updateField("categories", cats as any);
                          }} />
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                            const cats = (editingPage.categories || []).filter((_, idx) => idx !== i);
                            updateField("categories", cats as any);
                          }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => {
                        updateField("categories", [...(editingPage.categories || []), { key: "", label: "", emoji: "📦" }] as any);
                      }}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar categoria
                      </Button>
                    </AccordionContent>
                  </AccordionItem>

                </Accordion>
                </div>

              {/* Right column: Product Selection */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase text-muted-foreground tracking-wider">
                  Seleção de Produtos ({(editingPage.selected_product_ids || []).length} selecionados)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Selecione os produtos que aparecerão neste catálogo. Se nenhum for selecionado, todos com o filtro serão exibidos.
                </p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Buscar produto..."
                    className="pl-9"
                  />
                </div>
                {productsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : (
                  <div className="overflow-y-auto max-h-[55vh] border rounded-lg p-2">
                    <div className="grid grid-cols-2 gap-2">
                      {filteredShopifyProducts.map((product) => {
                        const isSelected = (editingPage.selected_product_ids || []).includes(product.id);
                        return (
                          <button
                            key={product.id}
                            onClick={() => toggleProduct(product.id)}
                            className={`relative flex gap-2 p-2 rounded-lg border text-left transition-all ${
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                : "border-border hover:border-muted-foreground/30"
                            }`}
                          >
                            {isSelected && (
                              <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </div>
                            )}
                            {product.imageUrl && (
                              <img src={product.imageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium line-clamp-2">{product.title}</p>
                              <p className="text-[10px] text-muted-foreground">R$ {Number(product.price).toFixed(0)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>

          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={() => { setEditorOpen(false); setEditingPage(null); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Tag, DollarSign, AlertTriangle, Save, Award, Eye, ArrowRightLeft, Palette, Ruler } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ManageLinkedProductsDialog } from "@/components/inventory/ManageLinkedProductsDialog";
import { TransferProductsDialog } from "@/components/inventory/TransferProductsDialog";
import { ColorSizeManager } from "@/components/inventory/ColorSizeManager";

interface Category {
  id: string;
  name: string;
  slug: string;
  keywords: string[];
  default_gender: string | null;
  priority: number;
  is_active: boolean;
}

interface PriceTier {
  id: string;
  label: string;
  min_price: number | string | null;
  max_price: number | string | null;
  color: string;
  sort_order: number;
}

interface ReviewProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  category_id: string | null;
  gender: string | null;
  age_group: string | null;
  classification_confidence: number | null;
}

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const fixed = (value: unknown, digits = 2) => toNumber(value).toFixed(digits);

const GENDER_OPTIONS = ["masculino", "feminino", "unissex", "infantil"];
const AGE_OPTIONS = ["adulto", "infantil"];

interface Brand {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export default function InventoryCategories() {
  const [tab, setTab] = useState("categories");
  const [categories, setCategories] = useState<Category[]>([]);
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandCounts, setBrandCounts] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [editingCat, setEditingCat] = useState<Partial<Category> | null>(null);
  const [editingTier, setEditingTier] = useState<Partial<PriceTier> | null>(null);
  const [editingBrand, setEditingBrand] = useState<Partial<Brand> | null>(null);
  const [manage, setManage] = useState<{ mode: "category" | "brand"; id: string; name: string } | null>(null);
  const [transferBrand, setTransferBrand] = useState<Brand | null>(null);
  const [transferCat, setTransferCat] = useState<Category | null>(null);

  const [reviewItems, setReviewItems] = useState<ReviewProduct[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewing, setReviewing] = useState<ReviewProduct | null>(null);

  async function loadAll() {
    setLoading(true);
    const [{ data: cats }, { data: tr }, { data: brs }] = await Promise.all([
      supabase.from("product_categories").select("*").order("priority"),
      supabase.from("price_tiers").select("*").order("sort_order"),
      supabase.from("product_brands" as any).select("*").order("name"),
    ]);
    setCategories((cats || []) as any);
    setTiers((tr || []) as any);
    setBrands(((brs || []) as any) as Brand[]);

    // counts via RPCs (baseadas em category_id/brand_id em product_master_data)
    const [{ data: catRpc }, { data: brandRpc }] = await Promise.all([
      supabase.rpc("count_products_by_category" as any),
      supabase.rpc("count_products_by_brand" as any),
    ]);
    const catMap: Record<string, number> = {};
    (catRpc as any[] || []).forEach((r: any) => { catMap[r.category_id] = Number(r.total) || 0; });
    const brandMap: Record<string, number> = {};
    (brandRpc as any[] || []).forEach((r: any) => { brandMap[r.brand_id] = Number(r.total) || 0; });
    setCounts(catMap);
    setBrandCounts(brandMap);
    setLoading(false);
  }

  async function saveBrand() {
    if (!editingBrand?.name) { toast.error("Nome obrigatório"); return; }
    const name = editingBrand.name.trim();
    const slug = (editingBrand.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    const payload: any = { name, slug, is_active: editingBrand.is_active ?? true };
    const { error } = editingBrand.id
      ? await supabase.from("product_brands" as any).update(payload).eq("id", editingBrand.id)
      : await supabase.from("product_brands" as any).insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Salvo");
    setEditingBrand(null);
    loadAll();
  }

  async function deleteBrand(b: Brand) {
    const inUse = brandCounts[b.id] || 0;
    const msg = inUse > 0
      ? `A marca "${b.name}" está em ${inUse} produto(s). Excluir mesmo assim? Os produtos ficarão sem marca vinculada.`
      : `Excluir a marca "${b.name}"?`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from("product_brands" as any).delete().eq("id", b.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marca excluída");
    loadAll();
  }


  async function loadReview() {
    setReviewLoading(true);
    const { data } = await supabase
      .from("pos_products")
      .select("id, name, sku, price, category_id, gender, age_group, classification_confidence")
      .or("classification_confidence.lt.0.75,category_id.is.null")
      .eq("is_active", true)
      .limit(200);
    setReviewItems((data || []) as any);
    setReviewLoading(false);
  }

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (tab === "review") loadReview(); }, [tab]);

  async function saveCategory() {
    if (!editingCat?.name) { toast.error("Nome obrigatório"); return; }
    const payload: any = {
      name: editingCat.name,
      slug: editingCat.slug || editingCat.name.toLowerCase().replace(/\s+/g, "-"),
      keywords: editingCat.keywords || [],
      default_gender: editingCat.default_gender || null,
      priority: editingCat.priority ?? 100,
      is_active: editingCat.is_active ?? true,
    };
    const { error } = editingCat.id
      ? await supabase.from("product_categories").update(payload).eq("id", editingCat.id)
      : await supabase.from("product_categories").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Salvo");
    setEditingCat(null);
    loadAll();
  }

  async function deleteCategory(id: string) {
    if (!confirm("Excluir categoria? Produtos atribuídos a ela ficarão sem categoria.")) return;
    const { error } = await supabase.from("product_categories").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Excluída");
    loadAll();
  }

  async function saveTier() {
    if (!editingTier?.label) { toast.error("Label obrigatório"); return; }
    const payload: any = {
      label: editingTier.label,
      min_price: editingTier.min_price ?? 0,
      max_price: editingTier.max_price ?? null,
      color: editingTier.color || "#94a3b8",
      sort_order: editingTier.sort_order ?? 0,
    };
    const { error } = editingTier.id
      ? await supabase.from("price_tiers").update(payload).eq("id", editingTier.id)
      : await supabase.from("price_tiers").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Salvo");
    setEditingTier(null);
    loadAll();
  }

  async function deleteTier(id: string) {
    if (!confirm("Excluir faixa de preço?")) return;
    const { error } = await supabase.from("price_tiers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    loadAll();
  }

  async function saveReview() {
    if (!reviewing) return;
    const { error } = await supabase
      .from("pos_products")
      .update({
        category_id: reviewing.category_id,
        gender: reviewing.gender,
        age_group: reviewing.age_group,
        auto_classified: false,
        classification_confidence: 1.0,
      })
      .eq("id", reviewing.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atualizado");
    setReviewing(null);
    loadReview();
  }

  async function reclassifyAll() {
    toast.info("Reclassificação em massa deve ser executada via migração. Use a tela de Revisar Classificação para ajustes manuais.");
  }

  const totalProducts = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts]
  );
  const totalBrandLinked = useMemo(
    () => Object.values(brandCounts).reduce((a, b) => a + b, 0),
    [brandCounts]
  );

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/inventory">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Categorias & Classificação</h1>
            <p className="text-sm text-muted-foreground">
              {totalProducts.toLocaleString("pt-BR")} produtos vinculados em categorias · {totalBrandLinked.toLocaleString("pt-BR")} em marcas
            </p>
          </div>
        </div>
        <Button onClick={reclassifyAll} variant="outline" size="sm">
          Reclassificar produtos sem categoria
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="categories"><Tag className="h-4 w-4 mr-2" />Categorias ({categories.length})</TabsTrigger>
          <TabsTrigger value="brands"><Award className="h-4 w-4 mr-2" />Marcas ({brands.length})</TabsTrigger>
          <TabsTrigger value="tiers"><DollarSign className="h-4 w-4 mr-2" />Faixas de Preço ({tiers.length})</TabsTrigger>
          <TabsTrigger value="review"><AlertTriangle className="h-4 w-4 mr-2" />Revisar Classificação</TabsTrigger>
        </TabsList>

        {/* ===== CATEGORIES ===== */}
        <TabsContent value="categories" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setEditingCat({ keywords: [], priority: 100, is_active: true })}>
              <Plus className="h-4 w-4 mr-1" /> Nova categoria
            </Button>
          </div>
          {loading ? <Loader2 className="animate-spin" /> : (
            <div className="grid gap-2">
              {categories.map(c => (
                <Card key={c.id}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{c.name}</span>
                        {c.default_gender && <Badge variant="secondary">{c.default_gender}</Badge>}
                        <Badge variant="outline">{(counts[c.id] || 0).toLocaleString("pt-BR")} produtos</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        Palavras-chave: {c.keywords.join(", ") || "—"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setManage({ mode: "category", id: c.id, name: c.name })}>
                        <Eye className="h-4 w-4 mr-1" /> Produtos
                      </Button>
                      <Button size="icon" variant="ghost" title="Transferir todos" onClick={() => setTransferCat(c)}>
                        <ArrowRightLeft className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingCat(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteCategory(c.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ===== BRANDS ===== */}
        <TabsContent value="brands" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setEditingBrand({ is_active: true })}>
              <Plus className="h-4 w-4 mr-1" /> Nova marca
            </Button>
          </div>
          {loading ? <Loader2 className="animate-spin" /> : (
            <div className="grid gap-2">
              {brands.map(b => {
                const used = brandCounts[b.id] || 0;
                return (
                  <Card key={b.id}>
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{b.name}</span>
                          <Badge variant="outline">{used.toLocaleString("pt-BR")} produtos</Badge>
                          {!b.is_active && <Badge variant="secondary">inativa</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">slug: {b.slug}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setManage({ mode: "brand", id: b.id, name: b.name })}>
                          <Eye className="h-4 w-4 mr-1" /> Produtos
                        </Button>
                        <Button size="icon" variant="ghost" title="Transferir todos para outra marca" onClick={() => setTransferBrand(b)}>
                          <ArrowRightLeft className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingBrand(b)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteBrand(b)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {brands.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">Nenhuma marca cadastrada.</p>
              )}
            </div>
          )}
        </TabsContent>

        {/* ===== PRICE TIERS ===== */}
        <TabsContent value="tiers" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setEditingTier({ min_price: 0, sort_order: tiers.length + 1, color: "#94a3b8" })}>
              <Plus className="h-4 w-4 mr-1" /> Nova faixa
            </Button>
          </div>
          <div className="grid gap-2">
            {tiers.map(t => (
              <Card key={t.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-4 h-10 rounded" style={{ background: t.color }} />
                    <div>
                      <p className="font-semibold">{t.label}</p>
                      <p className="text-xs text-muted-foreground">
                        R$ {fixed(t.min_price)} — {t.max_price != null ? `R$ ${fixed(t.max_price)}` : "sem limite"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditingTier(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteTier(t.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ===== REVIEW QUEUE ===== */}
        <TabsContent value="review" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Produtos com baixa confiança ou sem categoria</CardTitle>
              <p className="text-xs text-muted-foreground">Top 200 — revise para refinar a base do agente de IA.</p>
            </CardHeader>
            <CardContent>
              {reviewLoading ? <Loader2 className="animate-spin" /> : (
                <div className="space-y-1 max-h-[600px] overflow-auto">
                  {reviewItems.map(p => {
                    const cat = categories.find(c => c.id === p.category_id);
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-2 p-2 border rounded hover:bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{p.name}</p>
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">{cat?.name || "sem categoria"}</Badge>
                            {p.gender && <Badge variant="outline" className="text-[10px]">{p.gender}</Badge>}
                            {p.classification_confidence != null && (
                              <Badge variant={p.classification_confidence < 0.7 ? "destructive" : "secondary"} className="text-[10px]">
                                {fixed(toNumber(p.classification_confidence) * 100, 0)}%
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setReviewing({ ...p })}>
                          <Pencil className="h-3 w-3 mr-1" /> Corrigir
                        </Button>
                      </div>
                    );
                  })}
                  {reviewItems.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-8">Nenhum produto para revisar 🎉</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== CATEGORY EDIT DIALOG ===== */}
      <Dialog open={!!editingCat} onOpenChange={(o) => !o && setEditingCat(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat?.id ? "Editar" : "Nova"} categoria</DialogTitle></DialogHeader>
          {editingCat && (
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input value={editingCat.name || ""} onChange={e => setEditingCat({ ...editingCat, name: e.target.value })} />
              </div>
              <div>
                <Label>Palavras-chave (separadas por vírgula)</Label>
                <Input
                  value={(editingCat.keywords || []).join(", ")}
                  onChange={e => setEditingCat({ ...editingCat, keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="TENIS, SNEAKER"
                />
              </div>
              <div>
                <Label>Gênero padrão (opcional)</Label>
                <Select value={editingCat.default_gender || "none"} onValueChange={v => setEditingCat({ ...editingCat, default_gender: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Nenhum (determinado pela grade) —</SelectItem>
                    {GENDER_OPTIONS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Prioridade (menor número = match primeiro)</Label>
                <Input type="number" value={editingCat.priority ?? 100} onChange={e => setEditingCat({ ...editingCat, priority: Number(e.target.value) })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCat(null)}>Cancelar</Button>
            <Button onClick={saveCategory}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== TIER EDIT DIALOG ===== */}
      <Dialog open={!!editingTier} onOpenChange={(o) => !o && setEditingTier(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingTier?.id ? "Editar" : "Nova"} faixa de preço</DialogTitle></DialogHeader>
          {editingTier && (
            <div className="space-y-3">
              <div>
                <Label>Rótulo</Label>
                <Input value={editingTier.label || ""} onChange={e => setEditingTier({ ...editingTier, label: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Preço mínimo</Label>
                  <Input type="number" step="0.01" value={editingTier.min_price ?? 0} onChange={e => setEditingTier({ ...editingTier, min_price: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Preço máximo (vazio = sem limite)</Label>
                  <Input type="number" step="0.01" value={editingTier.max_price ?? ""} onChange={e => setEditingTier({ ...editingTier, max_price: e.target.value ? Number(e.target.value) : null })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cor</Label>
                  <Input type="color" value={editingTier.color || "#94a3b8"} onChange={e => setEditingTier({ ...editingTier, color: e.target.value })} />
                </div>
                <div>
                  <Label>Ordem</Label>
                  <Input type="number" value={editingTier.sort_order ?? 0} onChange={e => setEditingTier({ ...editingTier, sort_order: Number(e.target.value) })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTier(null)}>Cancelar</Button>
            <Button onClick={saveTier}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== REVIEW EDIT DIALOG ===== */}
      <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Corrigir classificação</DialogTitle></DialogHeader>
          {reviewing && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">{reviewing.name}</p>
              <div>
                <Label>Categoria</Label>
                <Select value={reviewing.category_id || "none"} onValueChange={v => setReviewing({ ...reviewing, category_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sem categoria —</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Gênero</Label>
                  <Select value={reviewing.gender || "none"} onValueChange={v => setReviewing({ ...reviewing, gender: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {GENDER_OPTIONS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Faixa etária</Label>
                  <Select value={reviewing.age_group || "none"} onValueChange={v => setReviewing({ ...reviewing, age_group: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {AGE_OPTIONS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancelar</Button>
            <Button onClick={saveReview}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== BRAND EDIT DIALOG ===== */}
      <Dialog open={!!editingBrand} onOpenChange={(o) => !o && setEditingBrand(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingBrand?.id ? "Editar" : "Nova"} marca</DialogTitle></DialogHeader>
          {editingBrand && (
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input
                  value={editingBrand.name || ""}
                  onChange={e => setEditingBrand({ ...editingBrand, name: e.target.value })}
                  placeholder="Ex: Modare"
                />
              </div>
              <div>
                <Label>Ativa</Label>
                <Select
                  value={(editingBrand.is_active ?? true) ? "yes" : "no"}
                  onValueChange={v => setEditingBrand({ ...editingBrand, is_active: v === "yes" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Sim</SelectItem>
                    <SelectItem value="no">Não (oculta do seletor)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBrand(null)}>Cancelar</Button>
            <Button onClick={saveBrand}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manage && (
        <ManageLinkedProductsDialog
          open={!!manage}
          onOpenChange={(o) => !o && setManage(null)}
          mode={manage.mode}
          entityId={manage.id}
          entityName={manage.name}
          onChanged={loadAll}
        />
      )}
      {transferBrand && (
        <TransferProductsDialog
          open={!!transferBrand}
          onOpenChange={(o) => !o && setTransferBrand(null)}
          mode="brand"
          from={{ id: transferBrand.id, name: transferBrand.name }}
          candidates={brands.map(b => ({ id: b.id, name: b.name }))}
          onDone={loadAll}
        />
      )}
      {transferCat && (
        <TransferProductsDialog
          open={!!transferCat}
          onOpenChange={(o) => !o && setTransferCat(null)}
          mode="category"
          from={{ id: transferCat.id, name: transferCat.name }}
          candidates={categories.map(c => ({ id: c.id, name: c.name }))}
          onDone={loadAll}
        />
      )}
    </div>
  );
}

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Search, Package, Loader2, Pencil, AlertCircle, Boxes, Save, Filter, ChevronDown, ChevronRight, Store as StoreIcon,
} from "lucide-react";
import { toast } from "sonner";

interface MasterData {
  parent_sku: string;
  name: string | null;
  description: string | null;
  brand: string | null;
  category: string | null;
  ncm: string | null;
  cfop: string | null;
  cest: string | null;
  cost_price: number | null;
  sale_price: number | null;
  images: string[] | null;
  is_active: boolean;
  needs_review: boolean;
  review_reason: string | null;
}

interface PosSku {
  id: string;
  parent_sku: string | null;
  store_id: string;
  sku: string | null;
  barcode: string | null;
  name: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
  image_url: string | null;
  cost_price: number | null;
  price: number | null;
  stock: number | null;
  is_active: boolean;
}

const PAGE_SIZE = 50;

interface Store {
  id: string;
  name: string;
}

interface GroupRow {
  parent_sku: string;
  master: MasterData | null;
  skus: PosSku[];
  totalStock: number;
  storesPresent: number;
}

const CFOP_OPTIONS = [
  { value: "5102", label: "5102 — Venda dentro do estado" },
  { value: "6102", label: "6102 — Venda interestadual" },
  { value: "5405", label: "5405 — ST dentro do estado" },
  { value: "6404", label: "6404 — ST interestadual" },
];

export function UnifiedProductsList() {
  const [masters, setMasters] = useState<MasterData[]>([]);
  const [posProducts, setPosProducts] = useState<PosSku[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "review" | "ok">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<MasterData | null>(null);
  const [editingSku, setEditingSku] = useState<PosSku | null>(null);
  const [page, setPage] = useState(0);

  async function load() {
    setLoading(true);
    // Batch pos_products in chunks of 1000 to bypass PostgREST default cap
    async function fetchAllPos(): Promise<PosSku[]> {
      const all: PosSku[] = [];
      const CHUNK = 1000;
      for (let from = 0; from < 50000; from += CHUNK) {
        const { data, error } = await supabase
          .from("pos_products")
          .select("id, parent_sku, store_id, sku, barcode, name, variant, size, color, image_url, cost_price, price, stock, is_active")
          .eq("is_active", true)
          .order("id")
          .range(from, from + CHUNK - 1);
        if (error) { toast.error("pos_products: " + error.message); break; }
        if (!data || data.length === 0) break;
        all.push(...(data as any));
        if (data.length < CHUNK) break;
      }
      return all;
    }
    const [{ data: m }, pp, { data: st }] = await Promise.all([
      supabase.from("product_master_data").select("*").eq("is_active", true).order("name").limit(5000),
      fetchAllPos(),
      supabase.from("pos_stores").select("id, name").order("name"),
    ]);
    setMasters((m || []) as any);
    setPosProducts(pp);
    setStores((st || []) as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo<GroupRow[]>(() => {
    const byParent = new Map<string, GroupRow>();
    // seed with masters
    for (const m of masters) {
      byParent.set(m.parent_sku, { parent_sku: m.parent_sku, master: m, skus: [], totalStock: 0, storesPresent: 0 });
    }
    // attach skus
    for (const p of posProducts) {
      const key = p.parent_sku || p.sku || p.barcode || p.id;
      let g = byParent.get(key);
      if (!g) {
        g = { parent_sku: key, master: null, skus: [], totalStock: 0, storesPresent: 0 };
        byParent.set(key, g);
      }
      g.skus.push(p);
      g.totalStock += p.stock || 0;
    }
    // count stores
    for (const g of byParent.values()) {
      g.storesPresent = new Set(g.skus.map((s) => s.store_id)).size;
    }
    let arr = Array.from(byParent.values());
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter((g) =>
        g.parent_sku.toLowerCase().includes(q) ||
        (g.master?.name || "").toLowerCase().includes(q) ||
        (g.master?.brand || "").toLowerCase().includes(q) ||
        g.skus.some((s) => (s.sku || "").toLowerCase().includes(q) || (s.barcode || "").includes(q))
      );
    }
    if (filter === "review") arr = arr.filter((g) => g.master?.needs_review);
    if (filter === "ok") arr = arr.filter((g) => g.master && !g.master.needs_review);
    return arr.sort((a, b) => (a.master?.name || a.parent_sku).localeCompare(b.master?.name || b.parent_sku));
  }, [masters, posProducts, search, filter]);

  function toggleExpand(key: string) {
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  }

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name || id.slice(0, 6);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
        <Package className="h-4 w-4 text-primary" />
        <div className="text-xs flex-1">
          <strong>Catálogo Unificado</strong> — produtos agrupados por <code>parent_sku</code> (modelo-pai).
          Estoque calculado em tempo real a partir de <code>pos_products</code>. Edição de catálogo grava em <code>product_master_data</code>.
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-col md:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por nome, parent_sku, SKU, código de barras ou marca..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {(["all", "review", "ok"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "Todos" : f === "review" ? "🔴 Revisar" : "✓ OK"}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {grouped.length} produtos · {grouped.reduce((s, g) => s + g.skus.length, 0)} SKUs · {grouped.reduce((s, g) => s + g.totalStock, 0)} unidades
          </div>
          {grouped.slice(0, 200).map((g) => (
            <Card key={g.parent_sku}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 mt-0.5"
                    onClick={() => toggleExpand(g.parent_sku)}
                  >
                    {expanded[g.parent_sku] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => g.master && setEditing(g.master)}>
                    <div className="font-semibold truncate hover:text-primary">{g.master?.name || g.parent_sku}</div>
                    <div className="text-xs text-muted-foreground font-mono">{g.parent_sku}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {g.master?.brand && <Badge variant="outline" className="text-[10px]">{g.master.brand}</Badge>}
                      {g.master?.category && <Badge variant="outline" className="text-[10px]">{g.master.category}</Badge>}
                      {g.master?.ncm && <Badge variant="outline" className="text-[10px]">NCM {g.master.ncm}</Badge>}
                      {g.master?.cfop && <Badge variant="outline" className="text-[10px]">CFOP {g.master.cfop}</Badge>}
                      <Badge variant="secondary" className="text-[10px]">
                        {g.skus.length} SKUs · {g.totalStock} un · {g.storesPresent} loja(s)
                      </Badge>
                      {g.master?.needs_review && (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <AlertCircle className="h-2.5 w-2.5" />
                          Revisar: {g.master.review_reason}
                        </Badge>
                      )}
                      {!g.master && (
                        <Badge variant="destructive" className="text-[10px]">
                          Sem cadastro fiscal (master_data)
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-muted-foreground">Custo / Venda</div>
                    <div className="font-semibold">
                      R$ {(g.master?.cost_price || 0).toFixed(2)} / R$ {(g.master?.sale_price || 0).toFixed(2)}
                    </div>
                  </div>
                  {g.master && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(g.master!)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {expanded[g.parent_sku] && (
                  <div className="ml-9 mt-2 border-l-2 pl-3 space-y-1">
                    <div className="grid grid-cols-12 gap-2 text-[10px] uppercase text-muted-foreground font-semibold pb-1 border-b">
                      <div className="col-span-3">Loja</div>
                      <div className="col-span-2">SKU</div>
                      <div className="col-span-3">Barcode</div>
                      <div className="col-span-2 text-right">Estoque</div>
                      <div className="col-span-2 text-right">Preço</div>
                    </div>
                    {g.skus.map((s) => (
                      <div
                        key={s.id}
                        className="grid grid-cols-12 gap-2 text-xs items-center py-1 hover:bg-muted/30 rounded cursor-pointer"
                        onClick={() => setEditingSku(s)}
                      >
                        <div className="col-span-3 flex items-center gap-1">
                          <StoreIcon className="h-3 w-3 text-muted-foreground" />
                          {storeName(s.store_id)}
                        </div>
                        <div className="col-span-2 font-mono truncate">{s.sku || "—"}</div>
                        <div className="col-span-3 font-mono truncate">{s.barcode || "—"}</div>
                        <div className={`col-span-2 text-right font-semibold ${(s.stock || 0) <= 0 ? "text-destructive" : ""}`}>
                          {s.stock || 0}
                        </div>
                        <div className="col-span-2 text-right">
                          R$ {(s.price || 0).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {grouped.length > 200 && (
            <p className="text-center text-xs text-muted-foreground">Mostrando 200 de {grouped.length}. Refine a busca.</p>
          )}
        </div>
      )}

      {/* Edit master dialog */}
      <MasterEditDialog
        master={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />

      {/* Edit pos sku dialog */}
      <PosSkuEditDialog
        sku={editingSku}
        onClose={() => setEditingSku(null)}
        onSaved={() => { setEditingSku(null); load(); }}
        storeName={editingSku ? storeName(editingSku.store_id) : ""}
      />
    </div>
  );
}

/* ============ Master Edit Dialog ============ */
function MasterEditDialog({
  master, onClose, onSaved,
}: { master: MasterData | null; onClose: () => void; onSaved: () => void; }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [ncm, setNcm] = useState("");
  const [cfop, setCfop] = useState("");
  const [cest, setCest] = useState("");
  const [cost, setCost] = useState("");
  const [sale, setSale] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!master) return;
    setName(master.name || "");
    setDescription(master.description || "");
    setBrand(master.brand || "");
    setCategory(master.category || "");
    setNcm(master.ncm || "");
    setCfop(master.cfop || "");
    setCest(master.cest || "");
    setCost(master.cost_price?.toString() || "");
    setSale(master.sale_price?.toString() || "");
  }, [master]);

  async function save() {
    if (!master) return;
    setSaving(true);
    const patch: any = {
      name: name.trim() || null,
      description: description.trim() || null,
      brand: brand.trim() || null,
      category: category.trim() || null,
      ncm: ncm.trim() || null,
      cfop: cfop.trim() || null,
      cest: cest.trim() || null,
      cost_price: cost ? parseFloat(cost) : null,
      sale_price: sale ? parseFloat(sale) : null,
    };
    const reasons: string[] = [];
    if (!patch.ncm || patch.ncm.length < 8) reasons.push("NCM ausente/inválido");
    if (!patch.cfop || patch.cfop.length < 4) reasons.push("CFOP ausente");
    if (!patch.cost_price || patch.cost_price <= 0) reasons.push("Custo ausente");
    if (!patch.sale_price || patch.sale_price <= 0) reasons.push("Preço de venda ausente");
    patch.needs_review = reasons.length > 0;
    patch.review_reason = reasons.length > 0 ? reasons.join("; ") : null;

    const { error } = await supabase
      .from("product_master_data")
      .update(patch)
      .eq("parent_sku", master.parent_sku);
    setSaving(false);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("Catálogo atualizado."); onSaved(); }
  }

  return (
    <Dialog open={!!master} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar dados do catálogo (modelo-pai)</DialogTitle>
        </DialogHeader>
        {master && (
          <Tabs defaultValue="catalog">
            <TabsList>
              <TabsTrigger value="catalog">Catálogo</TabsTrigger>
              <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
              <TabsTrigger value="pricing">Preços</TabsTrigger>
            </TabsList>
            <TabsContent value="catalog" className="space-y-3">
              <div className="text-xs text-muted-foreground font-mono">{master.parent_sku}</div>
              <div>
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Marca</Label>
                  <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Input value={category} onChange={(e) => setCategory(e.target.value)} />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="fiscal" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>NCM *</Label>
                  <Input value={ncm} onChange={(e) => setNcm(e.target.value.replace(/\D/g, "").slice(0, 8))} />
                </div>
                <div>
                  <Label>CEST</Label>
                  <Input value={cest} onChange={(e) => setCest(e.target.value.replace(/\D/g, "").slice(0, 7))} />
                </div>
                <div className="col-span-2">
                  <Label>CFOP de venda *</Label>
                  <select
                    className="w-full h-10 px-3 rounded border bg-background text-sm"
                    value={cfop}
                    onChange={(e) => setCfop(e.target.value)}
                  >
                    <option value="">— escolher —</option>
                    {CFOP_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="pricing" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Custo (R$) *</Label>
                  <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
                <div>
                  <Label>Preço de venda (R$) *</Label>
                  <Input type="number" step="0.01" value={sale} onChange={(e) => setSale(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Preços por SKU/loja podem ser ajustados clicando em uma variação na lista.
              </p>
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ Pos Sku Edit Dialog ============ */
function PosSkuEditDialog({
  sku, storeName, onClose, onSaved,
}: { sku: PosSku | null; storeName: string; onClose: () => void; onSaved: () => void; }) {
  const [skuCode, setSkuCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [promo, setPromo] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sku) return;
    setSkuCode(sku.sku || "");
    setBarcode(sku.barcode || "");
    setPrice(sku.price?.toString() || "");
    setPromo(sku.promo_price?.toString() || "");
    setCost(sku.cost_price?.toString() || "");
    setStock(sku.stock?.toString() || "0");
  }, [sku]);

  async function save() {
    if (!sku) return;
    setSaving(true);
    const { error } = await supabase
      .from("pos_products")
      .update({
        sku: skuCode.trim() || null,
        barcode: barcode.trim() || null,
        price: price ? parseFloat(price) : null,
        promo_price: promo ? parseFloat(promo) : null,
        cost_price: cost ? parseFloat(cost) : null,
        stock: stock ? parseInt(stock) : 0,
      })
      .eq("id", sku.id);
    setSaving(false);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("SKU atualizado."); onSaved(); }
  }

  return (
    <Dialog open={!!sku} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar SKU em {storeName}</DialogTitle>
        </DialogHeader>
        {sku && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              parent_sku: <code>{sku.parent_sku || "—"}</code>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>SKU</Label>
                <Input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} />
              </div>
              <div>
                <Label>Código de barras</Label>
                <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              </div>
              <div>
                <Label>Preço (R$)</Label>
                <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <Label>Preço promo (R$)</Label>
                <Input type="number" step="0.01" value={promo} onChange={(e) => setPromo(e.target.value)} />
              </div>
              <div>
                <Label>Custo (R$)</Label>
                <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
              <div>
                <Label>Estoque</Label>
                <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

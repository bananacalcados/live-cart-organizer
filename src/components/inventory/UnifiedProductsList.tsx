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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, Package, Loader2, Pencil, AlertCircle, Boxes, Save, Filter, ChevronDown, ChevronRight, Store as StoreIcon, Tag, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ProductLabelPrintDialog, type LabelItem } from "./ProductLabelPrintDialog";

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

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const fixed = (value: unknown, digits = 2) => toNumber(value).toFixed(digits);

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

/** Monta itens de etiqueta (uma por variação cor+tamanho) a partir de um grupo. */
function buildLabelGroup(g: GroupRow): { name: string; items: LabelItem[] } {
  const seen = new Map<string, LabelItem>();
  for (const s of g.skus) {
    const color = s.color || s.variant || "";
    const size = s.size || "";
    const code = (s.barcode && s.barcode.trim()) || s.sku || "";
    const key = `${color}||${size}`;
    if (!seen.has(key)) {
      seen.set(key, {
        id: key,
        sku: s.sku || "",
        gtin: s.barcode || null,
        size: size || null,
        color: color || null,
      });
    } else if (code && !seen.get(key)!.gtin && !seen.get(key)!.sku) {
      seen.set(key, { ...seen.get(key)!, sku: s.sku || "", gtin: s.barcode || null });
    }
  }
  const items = Array.from(seen.values()).sort((a, b) =>
    (a.color || "").localeCompare(b.color || "") ||
    (a.size || "").localeCompare(b.size || "", undefined, { numeric: true })
  );
  return { name: g.master?.name || g.parent_sku, items };
}

export function UnifiedProductsList() {
  const [masters, setMasters] = useState<MasterData[]>([]);
  const [posProducts, setPosProducts] = useState<PosSku[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "review" | "ok">("all");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<MasterData | null>(null);
  const [editingSku, setEditingSku] = useState<PosSku | null>(null);
  const [editingVariation, setEditingVariation] = useState<
    { parentSku: string; productName: string; color: string; size: string; ids: string[] } | null
  >(null);
  const [labelGroup, setLabelGroup] = useState<{ name: string; items: LabelItem[] } | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

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
          // NÃO filtrar por is_active: produtos inativos e suas grades de tamanho
          // devem continuar aparecendo no controle de estoque.
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
      // Inclui também masters inativos para não esconder o produto-pai.
      supabase.from("product_master_data").select("*").order("name").limit(8000),
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
    // when a specific store is selected, only consider its SKUs
    const sourceProducts = storeFilter === "all"
      ? posProducts
      : posProducts.filter((p) => p.store_id === storeFilter);
    // attach skus
    for (const p of sourceProducts) {
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
    // when filtering by store, hide products that don't exist in that store
    if (storeFilter !== "all") {
      arr = arr.filter((g) => g.skus.length > 0);
    }
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
  }, [masters, posProducts, search, filter, storeFilter]);

  // Reset to first page when filter/search changes
  useEffect(() => { setPage(0); }, [search, filter, storeFilter]);

  const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const pageItems = grouped.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-full md:w-[200px]">
              <div className="flex items-center gap-2 min-w-0">
                <StoreIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Loja" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((st) => (
                <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {storeFilter !== "all" && (
        <div className="flex items-center gap-2 text-xs px-1 text-muted-foreground">
          <Filter className="h-3 w-3" />
          Mostrando apenas o estoque da loja <strong className="text-foreground">{storeName(storeFilter)}</strong>. Produtos sem estoque cadastrado nessa loja ficam ocultos.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {grouped.length} produtos · {grouped.reduce((s, g) => s + g.skus.length, 0)} SKUs · {grouped.reduce((s, g) => s + g.totalStock, 0)} unidades
          </div>
          {pageItems.map((g) => (
            <Card key={g.parent_sku}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 mt-0.5"
                    onClick={() => toggleExpand(g.parent_sku)}
                  >
                    {expanded[g.parent_sku] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(g.parent_sku)}>
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
                      {g.skus.length > 0 && g.skus.every((s) => !s.is_active) && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Inativo</Badge>
                      )}
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
                      R$ {fixed(g.master?.cost_price)} / R$ {fixed(g.master?.sale_price)}
                    </div>
                  </div>
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7"
                    title="Imprimir etiquetas com código de barras (8×5cm, folha A4)"
                    onClick={() => setLabelGroup(buildLabelGroup(g))}
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </Button>
                  {g.master && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(g.master!)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {expanded[g.parent_sku] && (() => {
                  // Group SKUs by variation (color + size)
                  const variationMap = new Map<string, { color: string; size: string; byStore: Record<string, PosSku> }>();
                  for (const s of g.skus) {
                    const color = s.color || s.variant || "—";
                    const size = s.size || "—";
                    const key = `${color}||${size}`;
                    let row = variationMap.get(key);
                    if (!row) {
                      row = { color, size, byStore: {} };
                      variationMap.set(key, row);
                    }
                    row.byStore[s.store_id] = s;
                  }
                  const variations = Array.from(variationMap.values()).sort((a, b) =>
                    a.color.localeCompare(b.color) ||
                    a.size.localeCompare(b.size, undefined, { numeric: true })
                  );
                  // Only show stores that actually have this product
                  const storeIdsPresent = Array.from(new Set(g.skus.map((s) => s.store_id)));
                  const orderedStores = stores.filter((st) => storeIdsPresent.includes(st.id));

                  return (
                    <div className="ml-9 mt-2 border-l-2 pl-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase text-muted-foreground font-semibold border-b">
                            <th className="text-left py-1 pr-2">Cor</th>
                            <th className="text-left py-1 pr-2">Tam</th>
                            {orderedStores.map((st) => (
                              <th key={st.id} className="text-right py-1 px-2 whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1">
                                  <StoreIcon className="h-3 w-3" />
                                  {st.name}
                                </div>
                              </th>
                            ))}
                            <th className="text-right py-1 pl-2">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {variations.map((v) => {
                            const total = orderedStores.reduce((sum, st) => sum + (v.byStore[st.id]?.stock || 0), 0);
                            return (
                              <tr key={`${v.color}||${v.size}`} className="border-b last:border-0 hover:bg-muted/30">
                                <td className="py-1 pr-2 truncate max-w-[120px]">{v.color}</td>
                                <td className="py-1 pr-2 font-semibold">{v.size}</td>
                                {orderedStores.map((st) => {
                                  const sku = v.byStore[st.id];
                                  if (!sku) {
                                    return <td key={st.id} className="py-1 px-2 text-right text-muted-foreground">—</td>;
                                  }
                                  const stock = sku.stock || 0;
                                  return (
                                    <td
                                      key={st.id}
                                      className={`py-1 px-2 text-right cursor-pointer hover:underline ${stock <= 0 ? "text-destructive" : "font-semibold"}`}
                                      onClick={() => setEditingSku(sku)}
                                      title={`SKU: ${sku.sku || "—"}\nBarcode: ${sku.barcode || "—"}\nR$ ${fixed(sku.price)}`}
                                    >
                                      {stock}
                                    </td>
                                  );
                                })}
                                <td className={`py-1 pl-2 text-right font-bold ${total <= 0 ? "text-destructive" : ""}`}>
                                  {total}
                                </td>
                              </tr>
                            );
                          })}
                          {variations.length === 0 && (
                            <tr>
                              <td colSpan={orderedStores.length + 3} className="text-xs text-muted-foreground py-2">
                                Sem variações cadastradas no PDV.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Clique no estoque de uma loja para editar o SKU. Passe o mouse para ver SKU/barcode/preço.
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
          {grouped.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                size="sm" variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Anterior
              </Button>
              <div className="text-xs text-muted-foreground">
                Página {page + 1} de {totalPages} · {grouped.length} produtos
              </div>
              <Button
                size="sm" variant="outline"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Próxima →
              </Button>
            </div>
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

      {/* Print labels dialog */}
      <ProductLabelPrintDialog
        open={!!labelGroup}
        onOpenChange={(v) => !v && setLabelGroup(null)}
        productName={labelGroup?.name}
        items={labelGroup?.items || []}
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
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sku) return;
    setSkuCode(sku.sku || "");
    setBarcode(sku.barcode || "");
    setPrice(sku.price?.toString() || "");
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

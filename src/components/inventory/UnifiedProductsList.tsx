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
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ProductLabelPrintDialog, type LabelItem } from "./ProductLabelPrintDialog";
import { ProductFiltersBar, matchesProductFilters, emptyProductFilters, type ProductFilters } from "./ProductFiltersBar";

interface MasterData {
  parent_sku: string;
  name: string | null;
  description: string | null;
  brand: string | null;
  brand_id: string | null;
  category: string | null;
  category_id: string | null;
  ncm: string | null;
  cfop: string | null;
  cest: string | null;
  cost_price: number | null;
  sale_price: number | null;
  images: string[] | null;
  is_active: boolean;
  needs_review: boolean;
  review_reason: string | null;
  shopify_product_id: string | null;
  created_at: string | null;
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

  // Seleção múltipla + exclusão em massa
  const [selectedParents, setSelectedParents] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function toggleParent(sku: string) {
    setSelectedParents((prev) => {
      const n = new Set(prev);
      n.has(sku) ? n.delete(sku) : n.add(sku);
      return n;
    });
  }

  async function bulkDeleteSelected() {
    if (selectedParents.size === 0) return;
    setBulkDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-master-products", {
        body: { parent_skus: Array.from(selectedParents) },
      });
      if (error) throw error;
      const d = (data as any)?.deleted || {};
      const b = (data as any)?.blocked || [];
      toast.success(
        `${d.unified || 0} do Unificado · ${d.legacy || 0} do Legacy · ${d.pos_products || 0} do PDV${b.length ? ` · ${b.length} bloqueados (histórico)` : ""}`,
        { duration: 8000 },
      );
      setSelectedParents(new Set());
      setBulkDeleteOpen(false);
      await load();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

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
      supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
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

  // Todos os SKUs (todas as lojas) que pertencem a este grupo — usa a lista
  // completa (posProducts), ignorando o filtro de loja, para excluir de fato tudo.
  function groupSkuIds(g: GroupRow): string[] {
    return posProducts
      .filter((p) => (p.parent_sku || p.sku || p.barcode || p.id) === g.parent_sku)
      .map((p) => p.id);
  }

  function variationSkuIds(g: GroupRow, color: string, size: string): string[] {
    return posProducts
      .filter(
        (p) =>
          (p.parent_sku || p.sku || p.barcode || p.id) === g.parent_sku &&
          (p.color || p.variant || "—") === color &&
          (p.size || "—") === size,
      )
      .map((p) => p.id);
  }

  async function deleteInChunks(ids: string[]) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from("pos_products").delete().in("id", ids.slice(i, i + 200));
      if (error) throw error;
    }
  }

  async function deleteGroup(g: GroupRow) {
    const label = g.master?.name || g.parent_sku;
    if (!confirm(
      `Excluir o cadastro "${label}"?\n\nRemove o produto do catálogo e TODAS as variações/estoque em todas as lojas. Esta ação não pode ser desfeita.`
    )) return;
    setBusy(true);
    try {
      await deleteInChunks(groupSkuIds(g));
      if (g.master) {
        const { error } = await supabase.from("product_master_data").delete().eq("parent_sku", g.parent_sku);
        if (error) throw error;
      }
      toast.success("Cadastro excluído.");
      await load();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteVariation(g: GroupRow, color: string, size: string) {
    if (!confirm(`Excluir a variação ${color} / ${size} em todas as lojas? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await deleteInChunks(variationSkuIds(g, color, size));
      toast.success("Variação excluída.");
      await load();
    } catch (err: any) {
      toast.error("Erro ao excluir variação: " + err.message);
    } finally {
      setBusy(false);
    }
  }

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
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>
              {grouped.length} produtos · {grouped.reduce((s, g) => s + g.skus.length, 0)} SKUs · {grouped.reduce((s, g) => s + g.totalStock, 0)} unidades
            </div>
            {selectedParents.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{selectedParents.size} selecionados</span>
                <Button size="sm" variant="ghost" onClick={() => setSelectedParents(new Set())}>Limpar</Button>
                <Button size="sm" variant="destructive" className="gap-1" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Excluir selecionados
                </Button>
              </div>
            )}
          </div>
          {pageItems.map((g) => (
            <Card key={g.parent_sku}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selectedParents.has(g.parent_sku)}
                    onCheckedChange={() => toggleParent(g.parent_sku)}
                    className="mt-1.5 shrink-0"
                  />
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
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                    title="Excluir cadastro (produto + todas as variações/estoque)"
                    disabled={busy}
                    onClick={() => deleteGroup(g)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
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
                            <th className="text-right py-1 pl-2 w-[70px]">Ações</th>
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
                                <td className="py-1 pl-2 text-right whitespace-nowrap">
                                  <Button
                                    size="icon" variant="ghost" className="h-6 w-6"
                                    title="Editar cor/tamanho desta variação (todas as lojas)"
                                    onClick={() => setEditingVariation({
                                      parentSku: g.parent_sku,
                                      productName: g.master?.name || g.parent_sku,
                                      color: v.color === "—" ? "" : v.color,
                                      size: v.size === "—" ? "" : v.size,
                                      ids: variationSkuIds(g, v.color, v.size),
                                    })}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                                    title="Excluir esta variação (todas as lojas)"
                                    disabled={busy}
                                    onClick={() => deleteVariation(g, v.color, v.size)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                          {variations.length === 0 && (
                            <tr>
                              <td colSpan={orderedStores.length + 4} className="text-xs text-muted-foreground py-2">
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
        storeName={editingSku ? storeName(editingSku.store_id) : ""}
        stores={stores}
        onLocalUpdate={(patch) =>
          setPosProducts((prev) =>
            prev.map((p) => (p.id === patch.id ? { ...p, ...patch } as PosSku : p))
          )
        }
        onLocalCreate={(row) =>
          setPosProducts((prev) => [...prev, row])
        }
      />

      {/* Edit variation (color/size) dialog */}
      <VariationEditDialog
        data={editingVariation}
        onClose={() => setEditingVariation(null)}
        onSaved={() => { setEditingVariation(null); load(); }}
      />

      {/* Print labels dialog */}
      <ProductLabelPrintDialog
        open={!!labelGroup}
        onOpenChange={(v) => !v && setLabelGroup(null)}
        productName={labelGroup?.name}
        items={labelGroup?.items || []}
      />

      {/* Bulk delete confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(v) => !bulkDeleting && setBulkDeleteOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {selectedParents.size} produto(s)?</DialogTitle>
            <DialogDescription>
              Vai apagar do Catálogo Unificado, do Legacy (quando existir vínculo) e do PDV.
              Produtos com histórico de venda são bloqueados automaticamente.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-auto text-xs text-muted-foreground border rounded p-2 space-y-0.5">
            {grouped.filter((g) => selectedParents.has(g.parent_sku)).slice(0, 15).map((g) => (
              <div key={g.parent_sku}>• {g.master?.name || g.parent_sku}</div>
            ))}
            {selectedParents.size > 15 && <div>... e mais {selectedParents.size - 15}</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>Cancelar</Button>
            <Button variant="destructive" onClick={bulkDeleteSelected} disabled={bulkDeleting} className="gap-1">
              {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir {selectedParents.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VariationEditDialog({
  data, onClose, onSaved,
}: {
  data: { parentSku: string; productName: string; color: string; size: string; ids: string[] } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) { setColor(data.color); setSize(data.size); }
  }, [data]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const variant = [color.trim(), size.trim()].filter(Boolean).join(" ");
      for (let i = 0; i < data.ids.length; i += 200) {
        const { error } = await supabase
          .from("pos_products")
          .update({
            color: color.trim() || null,
            size: size.trim() || null,
            variant: variant || null,
          })
          .in("id", data.ids.slice(i, i + 200));
        if (error) throw error;
      }
      toast.success("Variação atualizada.");
      onSaved();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!data} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar variação</DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {data.productName} · aplicado a {data.ids.length} SKU(s) em todas as lojas.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Cor</Label>
                <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Ex.: Preto" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tamanho</Label>
                <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Ex.: 38" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ Master Edit Dialog ============ */
function MasterEditDialog({
  master, onClose, onSaved,
}: { master: MasterData | null; onClose: () => void; onSaved: () => void; }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [newBrandMode, setNewBrandMode] = useState(false);
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [ncm, setNcm] = useState("");
  const [cfop, setCfop] = useState("");
  const [cest, setCest] = useState("");
  const [cost, setCost] = useState("");
  const [sale, setSale] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("product_brands" as any).select("id,name").eq("is_active", true).order("name"),
      supabase.from("product_categories").select("id,name").eq("is_active", true).order("name"),
    ]).then(([b, c]) => {
      setBrands(((b.data || []) as any) as { id: string; name: string }[]);
      setCategories(((c.data || []) as any) as { id: string; name: string }[]);
    });
  }, []);

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
    const bName = (master.brand || "").toString();
    setNewBrandMode(!!bName && !brands.some((b) => b.name.toLowerCase() === bName.toLowerCase()));
    const cName = (master.category || "").toString();
    setNewCategoryMode(!!cName && !categories.some((c) => c.name.toLowerCase() === cName.toLowerCase()));
  }, [master, brands, categories]);

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
    if (error) { setSaving(false); toast.error("Erro: " + error.message); return; }

    // Propaga automaticamente para o PDV (pos_products) — todas as SKUs com este parent_sku.
    try {
      const posPatch: Record<string, any> = {
        category: patch.category,
      };
      if (patch.cost_price && patch.cost_price > 0) posPatch.cost_price = patch.cost_price;
      if (patch.sale_price && patch.sale_price > 0) posPatch.price = patch.sale_price;
      await supabase.from("pos_products").update(posPatch).eq("parent_sku", master.parent_sku);
    } catch (syncErr: any) {
      console.warn("Falha ao propagar edição ao PDV:", syncErr?.message);
    }

    setSaving(false);
    toast.success("Catálogo atualizado e sincronizado com o PDV.");
    onSaved();
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
                  {newBrandMode ? (
                    <div className="flex gap-1">
                      <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Nova marca" autoFocus />
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setNewBrandMode(false); setBrand(""); }}>Cancelar</Button>
                    </div>
                  ) : (
                    <Select
                      value={brand ? (brands.find((b) => b.name.toLowerCase() === brand.toLowerCase())?.id || "__custom__") : ""}
                      onValueChange={(v) => {
                        if (v === "__new__") { setNewBrandMode(true); setBrand(""); return; }
                        const b = brands.find((x) => x.id === v);
                        if (b) setBrand(b.name);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione a marca" /></SelectTrigger>
                      <SelectContent>
                        {brand && !brands.some((b) => b.name.toLowerCase() === brand.toLowerCase()) && (
                          <SelectItem value="__custom__">{brand} (atual)</SelectItem>
                        )}
                        {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                        <SelectItem value="__new__" className="text-primary font-medium">+ Criar nova marca</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Categoria</Label>
                  {newCategoryMode ? (
                    <div className="flex gap-1">
                      <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Nova categoria" autoFocus />
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setNewCategoryMode(false); setCategory(""); }}>Cancelar</Button>
                    </div>
                  ) : (
                    <Select
                      value={category ? (categories.find((c) => c.name.toLowerCase() === category.toLowerCase())?.id || "__custom__") : ""}
                      onValueChange={(v) => {
                        if (v === "__new__") { setNewCategoryMode(true); setCategory(""); return; }
                        const c = categories.find((x) => x.id === v);
                        if (c) setCategory(c.name);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                      <SelectContent>
                        {category && !categories.some((c) => c.name.toLowerCase() === category.toLowerCase()) && (
                          <SelectItem value="__custom__">{category} (atual)</SelectItem>
                        )}
                        {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        <SelectItem value="__new__" className="text-primary font-medium">+ Criar nova categoria</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
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
type MovementRow = {
  id: string;
  created_at: string;
  movement_type: string | null;
  direction: string;
  quantity: number;
  previous_stock: number | null;
  new_stock: number | null;
  reason: string | null;
  sale_id: string | null;
  exchange_id: string | null;
  exchange_number: string | null;
  count_id: string | null;
  user_name: string | null;
  seller_name: string | null;
};

const MOVE_LABEL: Record<string, { label: string; className: string }> = {
  entrada: { label: "Entrada", className: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  saida: { label: "Saída", className: "bg-rose-100 text-rose-700 border-rose-300" },
  balanco: { label: "Balanço", className: "bg-blue-100 text-blue-700 border-blue-300" },
  venda: { label: "Venda", className: "bg-violet-100 text-violet-700 border-violet-300" },
  troca: { label: "Troca", className: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300" },
  devolucao: { label: "Devolução", className: "bg-orange-100 text-orange-700 border-orange-300" },
  transferencia: { label: "Transferência", className: "bg-cyan-100 text-cyan-700 border-cyan-300" },
  ajuste: { label: "Ajuste", className: "bg-amber-100 text-amber-800 border-amber-300" },
};

function PosSkuEditDialog({
  sku, storeName, stores, onClose, onLocalUpdate, onLocalCreate,
}: {
  sku: PosSku | null;
  storeName: string;
  stores: Store[];
  onClose: () => void;
  onLocalUpdate: (patch: Partial<PosSku> & { id: string }) => void;
  onLocalCreate: (row: PosSku) => void;
}) {
  // Cadastro
  const [skuCode, setSkuCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  // Movimentação
  const [moveType, setMoveType] = useState<"entrada" | "saida" | "balanco">("entrada");
  const [moveQty, setMoveQty] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moving, setMoving] = useState(false);

  // Transferir
  const [tab, setTab] = useState<"edit" | "transfer" | "history">("edit");
  const [destStoreId, setDestStoreId] = useState<string>("");
  const [transferQty, setTransferQty] = useState<string>("");
  const [transferReason, setTransferReason] = useState<string>("");
  const [transferring, setTransferring] = useState(false);

  // Histórico
  const [history, setHistory] = useState<MovementRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>("all");

  useEffect(() => {
    if (!sku) return;
    setSkuCode(sku.sku || "");
    setBarcode(sku.barcode || "");
    setPrice(sku.price?.toString() || "");
    setCost(sku.cost_price?.toString() || "");
    setTab("edit");
    setMoveType("entrada");
    setMoveQty("");
    setMoveReason("");
    setDestStoreId("");
    setTransferQty("");
    setTransferReason("");
    setHistory([]);
  }, [sku]);

  async function loadHistory() {
    if (!sku) return;
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from("pos_stock_adjustments")
      .select("id, created_at, movement_type, direction, quantity, previous_stock, new_stock, reason, sale_id, exchange_id, exchange_number, count_id, user_name, seller_name")
      .eq("product_id", sku.id)
      .order("created_at", { ascending: false })
      .limit(200);
    setHistoryLoading(false);
    if (error) { toast.error("Erro ao carregar histórico: " + error.message); return; }
    setHistory((data as MovementRow[]) || []);
  }

  useEffect(() => {
    if (tab === "history") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sku?.id]);

  const destStores = useMemo(
    () => stores.filter((s) => s.id !== sku?.store_id),
    [stores, sku?.store_id]
  );

  const filteredHistory = useMemo(() => {
    if (historyFilter === "all") return history;
    return history.filter((h) => (h.movement_type || "") === historyFilter);
  }, [history, historyFilter]);

  async function saveCadastro() {
    if (!sku) return;
    setSaving(true);
    const patch = {
      sku: skuCode.trim() || null,
      barcode: barcode.trim() || null,
      price: price ? parseFloat(price) : null,
      cost_price: cost ? parseFloat(cost) : null,
    };
    const { error } = await supabase
      .from("pos_products")
      .update(patch)
      .eq("id", sku.id);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    onLocalUpdate({ id: sku.id, ...patch });
    toast.success("Cadastro atualizado.");
  }

  async function submitMovement() {
    if (!sku) return;
    const qty = parseFloat(moveQty);
    if (!Number.isFinite(qty) || qty < 0) { toast.error("Quantidade inválida"); return; }
    if (moveType !== "balanco" && qty <= 0) { toast.error("Quantidade deve ser maior que zero"); return; }
    if (moveType === "balanco" && !moveReason.trim()) { toast.error("Informe o motivo do balanço"); return; }

    setMoving(true);
    try {
      const { data, error } = await supabase.functions.invoke("pos-stock-movement", {
        body: {
          product_id: sku.id,
          movement_type: moveType,
          quantity: qty,
          reason: moveReason.trim() || null,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Falha na movimentação");

      onLocalUpdate({ id: sku.id, stock: data.new_stock });
      toast.success(`Estoque: ${data.previous_stock} → ${data.new_stock}`);
      setMoveQty("");
      setMoveReason("");
      // Se histórico já carregado, recarrega
      if (tab === "history" || history.length > 0) loadHistory();
    } catch (err: any) {
      toast.error("Erro: " + err.message, { duration: 8000 });
    } finally {
      setMoving(false);
    }
  }

  async function transfer() {
    if (!sku) return;
    const qty = parseInt(transferQty, 10);
    if (!destStoreId) { toast.error("Escolha a loja destino"); return; }
    if (!Number.isFinite(qty) || qty <= 0) { toast.error("Quantidade inválida"); return; }
    const available = sku.stock || 0;
    if (qty > available) { toast.error(`Origem só tem ${available} un.`); return; }
    setTransferring(true);
    try {
      const { data, error } = await supabase.functions.invoke("pos-stock-transfer", {
        body: {
          source_product_id: sku.id,
          dest_store_id: destStoreId,
          quantity: qty,
          reason: transferReason,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Falha ao transferir");

      onLocalUpdate({ id: sku.id, stock: data.source.new_stock });
      if (data.dest.created && data.dest.product) {
        onLocalCreate(data.dest.product as PosSku);
      } else {
        onLocalUpdate({ id: data.dest.product_id, stock: data.dest.new_stock });
      }
      toast.success(
        `Transferido: ${data.source.store_name} (${data.source.new_stock}) → ${data.dest.store_name} (${data.dest.new_stock})`
      );
      onClose();
    } catch (err: any) {
      toast.error("Erro: " + err.message, { duration: 8000 });
    } finally {
      setTransferring(false);
    }
  }

  const destPreview = useMemo(() => {
    if (!sku || !destStoreId) return null;
    return { id: destStoreId, name: stores.find((s) => s.id === destStoreId)?.name || "" };
  }, [sku, destStoreId, stores]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Dialog open={!!sku} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sku?.name || "SKU"} — {storeName}</DialogTitle>
        </DialogHeader>
        {sku && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="edit">Editar</TabsTrigger>
              <TabsTrigger value="transfer">Transferir</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="space-y-4 pt-3">
              <div className="text-xs text-muted-foreground">
                parent_sku: <code>{sku.parent_sku || "—"}</code> · estoque atual{" "}
                <Badge variant="secondary">{sku.stock ?? 0} un</Badge>
              </div>

              {/* Cadastro */}
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
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={saveCadastro} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Salvar cadastro
                </Button>
              </div>

              {/* Movimentação de estoque */}
              <div className="rounded-md border p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Movimentar estoque</Label>
                  <span className="text-[11px] text-muted-foreground">Registro auditável</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Select value={moveType} onValueChange={(v) => setMoveType(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entrada">Entrada</SelectItem>
                        <SelectItem value="saida">Saída</SelectItem>
                        <SelectItem value="balanco">Balanço</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">
                      {moveType === "balanco" ? "Novo total" : "Quantidade"}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={moveQty}
                      onChange={(e) => setMoveQty(e.target.value)}
                      placeholder={moveType === "balanco" ? "Ex: 3" : "Ex: 1"}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Novo estoque</Label>
                    <Input
                      readOnly
                      value={(() => {
                        const q = parseFloat(moveQty);
                        if (!Number.isFinite(q)) return sku.stock ?? 0;
                        const cur = sku.stock ?? 0;
                        if (moveType === "entrada") return cur + q;
                        if (moveType === "saida") return Math.max(0, cur - q);
                        return q;
                      })()}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">
                    Motivo {moveType === "balanco" && <span className="text-rose-600">*</span>}
                  </Label>
                  <Input
                    value={moveReason}
                    onChange={(e) => setMoveReason(e.target.value)}
                    placeholder={moveType === "balanco" ? "Ex: Balanço mensal loja Centro" : "Ex: Reposição de fornecedor / quebra / avaria"}
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={submitMovement} disabled={moving || !moveQty}>
                    {moving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Boxes className="h-4 w-4 mr-1" />}
                    Aplicar {MOVE_LABEL[moveType]?.label.toLowerCase()}
                  </Button>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="transfer" className="space-y-3 pt-3">
              <div className="text-xs bg-muted/40 rounded-md p-2 space-y-1">
                <div>
                  <span className="text-muted-foreground">Origem: </span>
                  <strong>{storeName}</strong> · estoque atual{" "}
                  <Badge variant="secondary">{sku.stock ?? 0} un</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Variação: </span>
                  {sku.color || "—"} / {sku.size || "—"}
                </div>
              </div>

              <div>
                <Label>Loja destino</Label>
                <Select value={destStoreId} onValueChange={setDestStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a loja destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {destStores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Quantidade a transferir</Label>
                <Input
                  type="number"
                  min={1}
                  max={sku.stock ?? 0}
                  value={transferQty}
                  onChange={(e) => setTransferQty(e.target.value)}
                  placeholder={`Máx: ${sku.stock ?? 0}`}
                />
              </div>

              <div>
                <Label>Motivo (opcional)</Label>
                <Textarea
                  rows={2}
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Ex: repor grade da Loja Centro"
                />
              </div>

              {destPreview && (
                <p className="text-[11px] text-muted-foreground">
                  Se a variação não existir em <strong>{destPreview.name}</strong>, será criada
                  automaticamente com o mesmo cadastro (SKU/barcode/preço).
                </p>
              )}

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={onClose}>Cancelar</Button>
                <Button onClick={transfer} disabled={transferring || !destStoreId || !transferQty}>
                  {transferring ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Boxes className="h-4 w-4 mr-1" />}
                  Transferir
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="history" className="space-y-3 pt-3">
              <div className="flex items-center justify-between gap-2">
                <Select value={historyFilter} onValueChange={setHistoryFilter}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="entrada">Entrada</SelectItem>
                    <SelectItem value="saida">Saída</SelectItem>
                    <SelectItem value="balanco">Balanço</SelectItem>
                    <SelectItem value="venda">Venda</SelectItem>
                    <SelectItem value="troca">Troca</SelectItem>
                    <SelectItem value="devolucao">Devolução</SelectItem>
                    <SelectItem value="transferencia">Transferência</SelectItem>
                    <SelectItem value="ajuste">Ajuste</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={loadHistory} disabled={historyLoading}>
                  {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
                </Button>
              </div>

              <div className="border rounded-md max-h-[420px] overflow-auto">
                {historyLoading ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...
                  </div>
                ) : filteredHistory.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Nenhuma movimentação registrada.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr className="text-left">
                        <th className="p-2">Data/hora</th>
                        <th className="p-2">Tipo</th>
                        <th className="p-2 text-right">Qtd</th>
                        <th className="p-2 text-right">De → Para</th>
                        <th className="p-2">Referência</th>
                        <th className="p-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((h) => {
                        const mt = h.movement_type || "ajuste";
                        const cfg = MOVE_LABEL[mt] ?? MOVE_LABEL.ajuste;
                        const ref = h.exchange_number
                          ? h.exchange_number
                          : h.sale_id
                          ? `#${h.sale_id.slice(0, 8)}`
                          : h.count_id
                          ? `Balanço ${h.count_id.slice(0, 6)}`
                          : "—";
                        return (
                          <tr key={h.id} className="border-t">
                            <td className="p-2 whitespace-nowrap">{fmtDate(h.created_at)}</td>
                            <td className="p-2">
                              <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                            </td>
                            <td className="p-2 text-right font-medium">
                              {h.direction === "in" ? "+" : "−"}{h.quantity}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {h.previous_stock ?? "?"} → {h.new_stock ?? "?"}
                            </td>
                            <td className="p-2 text-muted-foreground">{ref}</td>
                            <td className="p-2 text-muted-foreground">
                              {h.reason || "—"}
                              {(h.user_name || h.seller_name) && (
                                <span className="block text-[10px] opacity-70">
                                  por {h.user_name || h.seller_name}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus, Search, Package, Store as StoreIcon, Loader2, Pencil, RefreshCw,
  Boxes, Tag, Unlink, MoreVertical, ChevronRight, ChevronDown, GitMerge,
  ShoppingBag, Link2, FolderPlus, Trash2, Save,
} from "lucide-react";
import { ProductMasterForm } from "./ProductMasterForm";
import { ProductEditDialog } from "./ProductEditDialog";
import { ProductLabelPrintDialog } from "./ProductLabelPrintDialog";
import { toast } from "sonner";

interface Master {
  id: string;
  sku_root: string;
  name: string;
  brand: string | null;
  category: string | null;
  cost_price: number | string | null;
  sale_price: number | string | null;
  is_active: boolean;
  shopify_product_id: string | null;
  tiny_product_id: string | null;
  created_at: string;
}

interface Summary {
  variant_count: number;
  total_stock: number;
}

interface VariantRow {
  id: string;
  sku: string;
  gtin: string | null;
  color: string | null;
  size: string | null;
  is_active: boolean;
  stock: number;
}

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const brl = (value: unknown) =>
  `R$ ${toNumber(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function LegacyProductsList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Master[]>([]);
  const [summary, setSummary] = useState<Record<string, Summary>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelPrintId, setLabelPrintId] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  // seleção p/ unificar
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // expand
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [variants, setVariants] = useState<Record<string, VariantRow[] | "loading">>({});
  const [editingVariant, setEditingVariant] = useState<{ masterId: string; v: VariantRow } | null>(null);

  // diálogo de unificação
  const [unifyOpen, setUnifyOpen] = useState(false);
  const [unifyMode, setUnifyMode] = useState<"new" | "existing">("new");
  const [newParentName, setNewParentName] = useState("");
  const [parentSearch, setParentSearch] = useState("");
  const [parentResults, setParentResults] = useState<Master[]>([]);
  const [parentTargetId, setParentTargetId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  async function load() {
    setLoading(true);
    const term = search.trim();
    let query = supabase.from("products_master").select("*");

    if (term) {
      const { data: variantHits } = await supabase
        .from("product_variants")
        .select("master_id")
        .or(`sku.ilike.%${term}%,gtin.ilike.%${term}%`)
        .limit(200);
      const masterIds = Array.from(new Set((variantHits || []).map((v: any) => v.master_id).filter(Boolean)));
      const orParts = [`name.ilike.%${term}%`, `sku_root.ilike.%${term}%`, `brand.ilike.%${term}%`];
      if (masterIds.length > 0) orParts.push(`id.in.(${masterIds.join(",")})`);
      query = query.or(orParts.join(","));
    }

    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) {
      toast.error("Erro ao carregar produtos: " + error.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as Master[];
    setItems(list);
    setExpanded(new Set());
    setVariants({});

    // resumo (variações + estoque REAL em pares)
    if (list.length > 0) {
      const ids = list.map((d) => d.id);
      const { data: sum } = await (supabase.rpc as any)("legacy_masters_summary", { p_master_ids: ids });
      const map: Record<string, Summary> = {};
      (sum || []).forEach((r: any) => {
        map[r.master_id] = { variant_count: r.variant_count || 0, total_stock: toNumber(r.total_stock) };
      });
      setSummary(map);
    } else {
      setSummary({});
    }
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => { load(); }, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // busca de pai existente (products_master) para vincular
  useEffect(() => {
    if (!unifyOpen || unifyMode !== "existing") return;
    const term = parentSearch.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) { setParentResults([]); return; }
      const { data } = await supabase
        .from("products_master")
        .select("*")
        .or(`name.ilike.%${term}%,sku_root.ilike.%${term}%,brand.ilike.%${term}%`)
        .order("created_at", { ascending: false })
        .limit(30);
      setParentResults((data || []) as Master[]);
    }, 300);
    return () => clearTimeout(t);
  }, [parentSearch, unifyOpen, unifyMode]);

  async function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
      setExpanded(next);
      return;
    }
    next.add(id);
    setExpanded(next);
    if (!variants[id]) {
      setVariants((p) => ({ ...p, [id]: "loading" }));
      const { data } = await (supabase.rpc as any)("legacy_master_variants", { p_master_id: id });
      setVariants((p) => ({ ...p, [id]: (data || []) as VariantRow[] }));
    }
  }

  async function refreshVariants(masterId: string) {
    const { data } = await (supabase.rpc as any)("legacy_master_variants", { p_master_id: masterId });
    setVariants((p) => ({ ...p, [masterId]: (data || []) as VariantRow[] }));
    const { data: sum } = await (supabase.rpc as any)("legacy_masters_summary", { p_master_ids: [masterId] });
    if (sum && sum[0]) {
      setSummary((prev) => ({
        ...prev,
        [masterId]: {
          ...(prev[masterId] as any),
          variant_count: toNumber(sum[0].variant_count),
          total_stock: toNumber(sum[0].total_stock),
        } as Summary,
      }));
    }
  }

  async function deleteMaster(m: Master) {
    if (!confirm(
      `Excluir o produto "${m.name}" e TODAS as suas variações?\n\nEsta ação não pode ser desfeita.`
    )) return;
    setSendingTo(m.id);
    try {
      const { error: vErr } = await supabase.from("product_variants").delete().eq("master_id", m.id);
      if (vErr) throw vErr;
      const { error } = await supabase.from("products_master").delete().eq("id", m.id);
      if (error) throw error;
      toast.success("Produto excluído.");
      await load();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  async function deleteVariant(masterId: string, v: VariantRow) {
    const label = [v.size, v.color].filter(Boolean).join(" · ") || v.sku;
    if (!confirm(`Excluir a variação ${label}? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("product_variants").delete().eq("id", v.id);
    if (error) { toast.error("Erro ao excluir variação: " + error.message); return; }
    toast.success("Variação excluída.");
    await refreshVariants(masterId);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function backfillCosts() {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.rpc("backfill_master_costs_from_pos");
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      toast.success(
        `Custos importados do estoque local: ${row?.masters_updated ?? 0} produtos e ${row?.variants_updated ?? 0} variações`,
        { duration: 8000 }
      );
      load();
    } catch (err: any) {
      toast.error("Erro ao importar custos: " + err.message);
    } finally {
      setBackfilling(false);
    }
  }

  async function sendToPos(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("create-master-product-pos", { body: { master_id: masterId } });
      if (error) throw error;
      toast.success("Enviado ao PDV: " + (data?.message || "OK"));
      load();
    } catch (err: any) {
      toast.error("Erro ao enviar ao PDV: " + err.message);
    } finally { setSendingTo(null); }
  }

  async function sendToShopify(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("create-master-product-shopify", { body: { master_id: masterId } });
      if (error) throw error;
      toast.success("Criado na Shopify! ID: " + (data?.shopify_product_id || "?"));
      load();
    } catch (err: any) {
      toast.error("Erro ao criar na Shopify: " + err.message);
    } finally { setSendingTo(null); }
  }

  async function unlinkShopify(masterId: string) {
    if (!confirm("Desvincular este produto da Shopify? Isso limpa o vínculo local (não apaga nada na Shopify).")) return;
    setSendingTo(masterId);
    try {
      await supabase.from("products_master").update({ shopify_product_id: null } as any).eq("id", masterId);
      await supabase.from("product_variants").update({ shopify_variant_id: null } as any).eq("master_id", masterId);
      toast.success("Produto desvinculado da Shopify.");
      load();
    } catch (err: any) {
      toast.error("Erro ao desvincular: " + err.message);
    } finally { setSendingTo(null); }
  }

  async function updateShopify(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("update-master-product-shopify", { body: { master_id: masterId } });
      if (error) throw error;
      toast.success(data?.message || "Produto atualizado na Shopify");
    } catch (err: any) {
      toast.error("Erro ao atualizar Shopify: " + err.message);
    } finally { setSendingTo(null); }
  }

  async function syncStock(masterId: string, target: "pos" | "shopify") {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("sync-master-product-stock", { body: { master_id: masterId, target } });
      if (error) throw error;
      const r = data?.result || {};
      const parts: string[] = [];
      if (r.pos) parts.push(`PDV: ${r.pos.updated} atualizados em ${r.pos.stores} loja(s)`);
      if (r.shopify) parts.push(`Shopify: ${r.shopify.updated || 0} variantes`);
      toast.success("Estoque sincronizado — " + parts.join(" · "));
    } catch (err: any) {
      toast.error("Erro ao sincronizar estoque: " + err.message);
    } finally { setSendingTo(null); }
  }

  function openUnify() {
    if (selected.size < 1) {
      toast.error("Selecione ao menos um produto para unificar.");
      return;
    }
    setUnifyMode("new");
    setNewParentName("");
    setParentSearch("");
    setParentResults([]);
    setParentTargetId(null);
    setUnifyOpen(true);
  }

  async function doUnify() {
    const sources = Array.from(selected);
    if (sources.length === 0) return;
    setMerging(true);
    try {
      let targetId: string;
      if (unifyMode === "new") {
        const name = newParentName.trim();
        if (!name) { toast.error("Informe o nome do produto pai."); setMerging(false); return; }
        const { data: created, error: cErr } = await supabase
          .from("products_master")
          .insert({ name } as any)
          .select("id")
          .single();
        if (cErr) throw cErr;
        targetId = (created as any).id;
      } else {
        if (!parentTargetId) { toast.error("Escolha um produto pai existente."); setMerging(false); return; }
        targetId = parentTargetId;
      }

      const { data, error } = await (supabase.rpc as any)("merge_selected_masters", {
        p_target_id: targetId,
        p_source_ids: sources,
      });
      if (error) throw error;
      const res: any = data || {};
      let msg = `Unificado! ${res.moved || 0} variações movidas, ${res.deleted || 0} cadastros removidos.`;
      if (res.conflicts > 0) msg += ` ${res.conflicts} variação(ões) duplicada(s) ignorada(s).`;
      toast.success(msg, { duration: 8000 });
      setUnifyOpen(false);
      setSelected(new Set());
      await load();
    } catch (err: any) {
      toast.error("Erro ao unificar: " + (err.message || err));
    } finally {
      setMerging(false);
    }
  }

  const selectedCount = selected.size;
  const allVisibleSelected = useMemo(
    () => items.length > 0 && items.every((i) => selected.has(i.id)),
    [items, selected]
  );

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, SKU, GTIN ou marca..."
            className="pl-8"
          />
        </div>
        <Button variant="outline" onClick={backfillCosts} disabled={backfilling} className="gap-1">
          {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Importar custos do estoque
        </Button>
        <Button onClick={() => setShowForm(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Novo Produto
        </Button>
      </div>

      {/* barra de seleção / unificar */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">{selectedCount} produto(s) selecionado(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
            <Button size="sm" className="gap-1" onClick={openUnify}>
              <GitMerge className="h-4 w-4" /> Unificar selecionados
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <Package className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
          <h2 className="text-lg font-semibold text-muted-foreground">
            {search ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
          </h2>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* cabeçalho */}
          <div className="hidden md:flex items-center gap-3 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
            <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} className="shrink-0" />
            <span className="w-6 shrink-0" />
            <span className="flex-1">Produto</span>
            <span className="w-24 text-right shrink-0">Custo</span>
            <span className="w-24 text-right shrink-0">Venda</span>
            <span className="w-16 text-center shrink-0">Var.</span>
            <span className="w-20 text-center shrink-0">Pares</span>
            <span className="w-9 shrink-0" />
          </div>

          <div className="divide-y">
            {items.map((p) => {
              const s = summary[p.id];
              const isOpen = expanded.has(p.id);
              const vrows = variants[p.id];
              return (
                <div key={p.id}>
                  <div className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/40 transition-colors ${selected.has(p.id) ? "bg-primary/5" : ""}`}>
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleSelect(p.id)}
                      className="shrink-0"
                    />
                    <button
                      onClick={() => toggleExpand(p.id)}
                      className="w-6 h-6 shrink-0 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                      title="Expandir variações"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>

                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingId(p.id)}>
                      <div className="font-medium leading-tight hover:text-primary transition-colors">{p.name}</div>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="text-[11px] text-muted-foreground font-mono">SKU: {p.sku_root}</span>
                        {p.brand && <Badge variant="outline" className="text-[10px] py-0">{p.brand}</Badge>}
                        {!p.is_active && <Badge variant="secondary" className="text-[10px] py-0">Inativo</Badge>}
                        {p.tiny_product_id && <Badge variant="secondary" className="text-[10px] py-0">PDV ✓</Badge>}
                        {p.shopify_product_id && <Badge variant="secondary" className="text-[10px] py-0">Shopify ✓</Badge>}
                      </div>
                    </div>

                    <div className="w-24 text-right shrink-0 hidden md:block text-sm">{brl(p.cost_price)}</div>
                    <div className="w-24 text-right shrink-0 hidden md:block text-sm font-semibold text-primary">{brl(p.sale_price)}</div>
                    <div className="w-16 text-center shrink-0 hidden md:block text-sm">{s?.variant_count ?? "—"}</div>
                    <div className="w-20 text-center shrink-0 hidden md:block text-sm font-semibold">
                      {s ? s.total_stock : <Loader2 className="h-3 w-3 animate-spin inline" />}
                    </div>

                    {/* ações rápidas */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Editar" onClick={() => setEditingId(p.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Estoque" onClick={() => navigate(`/inventory/produto/${p.id}/estoque`)}>
                        <Boxes className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Etiqueta" onClick={() => setLabelPrintId(p.id)}>
                        <Tag className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={sendingTo === p.id}>
                            {sendingTo === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onClick={() => setEditingId(p.id)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/inventory/produto/${p.id}/estoque`)}>
                            <Boxes className="h-3.5 w-3.5 mr-2" /> Estoque
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLabelPrintId(p.id)}>
                            <Tag className="h-3.5 w-3.5 mr-2" /> Etiqueta
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <StoreIcon className="h-3.5 w-3.5 mr-2" /> PDV (todas as lojas)
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuSubContent>
                                <DropdownMenuItem onClick={() => sendToPos(p.id)}>
                                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> Atualizar dados (nome/preço)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => syncStock(p.id, "pos")}>
                                  <Boxes className="h-3.5 w-3.5 mr-2" /> Sincronizar estoque
                                </DropdownMenuItem>
                              </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                          </DropdownMenuSub>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <ShoppingBag className="h-3.5 w-3.5 mr-2" /> Shopify
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuSubContent>
                                {!p.shopify_product_id && (
                                  <DropdownMenuItem onClick={() => sendToShopify(p.id)}>
                                    <ShoppingBag className="h-3.5 w-3.5 mr-2" /> Criar na Shopify
                                  </DropdownMenuItem>
                                )}
                                {p.shopify_product_id && (
                                  <>
                                    <DropdownMenuItem onClick={() => updateShopify(p.id)}>
                                      <RefreshCw className="h-3.5 w-3.5 mr-2" /> Atualizar dados
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => syncStock(p.id, "shopify")}>
                                      <Boxes className="h-3.5 w-3.5 mr-2" /> Sincronizar estoque
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => unlinkShopify(p.id)}>
                                      <Unlink className="h-3.5 w-3.5 mr-2" /> Desvincular da Shopify
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deleteMaster(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir produto
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* expand: pai à direita, filhos à esquerda */}
                  {isOpen && (
                    <div className="bg-muted/30 border-t px-3 py-2 pl-12">
                      {vrows === "loading" || !vrows ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando variações...
                        </div>
                      ) : vrows.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-2">Sem variações cadastradas.</div>
                      ) : (
                        <div className="flex flex-col md:flex-row gap-3">
                          {/* filhos (esquerda) */}
                          <div className="flex-1 space-y-1">
                            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Variações (filhos)
                            </div>
                            {vrows.map((v) => (
                              <div key={v.id} className="flex items-center gap-2 text-sm bg-background rounded border px-2 py-1">
                                <span className="font-medium">
                                  {[v.size, v.color].filter(Boolean).join(" · ") || v.sku}
                                </span>
                                <span className="text-[11px] text-muted-foreground font-mono">{v.gtin || v.sku}</span>
                                <span className="ml-auto font-semibold">{toNumber(v.stock)} {toNumber(v.stock) === 1 ? "par" : "pares"}</span>
                                <Button
                                  size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                                  title="Editar cor/tamanho desta variação"
                                  onClick={() => setEditingVariant({ masterId: p.id, v })}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                                  title="Excluir esta variação"
                                  onClick={() => deleteVariant(p.id, v)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                          {/* pai (direita) */}
                          <div className="md:w-64 shrink-0">
                            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Produto pai</div>
                            <div className="bg-background rounded border p-2 space-y-1">
                              <div className="font-medium text-sm leading-tight">{p.name}</div>
                              <div className="text-[11px] text-muted-foreground font-mono">SKU: {p.sku_root}</div>
                              <div className="flex justify-between text-xs pt-1 border-t">
                                <span className="text-muted-foreground">Total</span>
                                <span className="font-semibold">{s?.total_stock ?? 0} pares · {s?.variant_count ?? vrows.length} var.</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DIÁLOGO UNIFICAR */}
      <Dialog open={unifyOpen} onOpenChange={setUnifyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5" /> Unificar {selectedCount} produto(s)
            </DialogTitle>
            <DialogDescription>
              Todas as variações dos produtos selecionados serão movidas para um único produto pai.
              Os cadastros que ficarem vazios serão removidos.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 p-1 rounded-lg border bg-muted/40">
            <Button
              size="sm" className="flex-1 gap-1"
              variant={unifyMode === "new" ? "default" : "ghost"}
              onClick={() => setUnifyMode("new")}
            >
              <FolderPlus className="h-4 w-4" /> Criar novo pai
            </Button>
            <Button
              size="sm" className="flex-1 gap-1"
              variant={unifyMode === "existing" ? "default" : "ghost"}
              onClick={() => setUnifyMode("existing")}
            >
              <Link2 className="h-4 w-4" /> Vincular a pai existente
            </Button>
          </div>

          {unifyMode === "new" ? (
            <div className="space-y-2">
              <Label>Nome do produto pai</Label>
              <Input
                autoFocus
                placeholder="Ex.: TAMANCO FEMININO TERAPÊUTICO MAIRA"
                value={newParentName}
                onChange={(e) => setNewParentName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Um novo produto pai será criado e as variações selecionadas ficarão abaixo dele.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar produto pai por nome, SKU ou marca..."
                  value={parentSearch}
                  onChange={(e) => setParentSearch(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {parentSearch.trim().length < 2 && (
                  <p className="text-center text-xs text-muted-foreground py-4">Digite ao menos 2 caracteres.</p>
                )}
                {parentResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setParentTargetId(r.id)}
                    className={`w-full text-left flex items-center gap-2 p-2 rounded border transition ${
                      parentTargetId === r.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">SKU: {r.sku_root}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setUnifyOpen(false)} disabled={merging}>Cancelar</Button>
            <Button onClick={doUnify} disabled={merging} className="gap-1">
              {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              Unificar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductMasterForm open={showForm} onOpenChange={setShowForm} onCreated={() => load()} />
      <ProductEditDialog masterId={editingId} open={!!editingId} onOpenChange={(v) => !v && setEditingId(null)} onSaved={() => load()} />
      <ProductLabelPrintDialog masterId={labelPrintId} open={!!labelPrintId} onOpenChange={(v) => !v && setLabelPrintId(null)} />
    </div>
  );
}

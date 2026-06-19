import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Package, ShoppingBag, Store as StoreIcon, Loader2, Pencil, ChevronDown, RefreshCw, Boxes, Sparkles, Tag, Unlink } from "lucide-react";
import { ProductMasterForm } from "./ProductMasterForm";
import { ProductEditDialog } from "./ProductEditDialog";

import { ProductLabelPrintDialog } from "./ProductLabelPrintDialog";
import { UnifiedProductsList } from "./UnifiedProductsList";
import { toast } from "sonner";

interface Master {
  id: string;
  sku_root: string;
  name: string;
  brand: string | null;
  category: string | null;
  cost_price: number;
  sale_price: number;
  is_active: boolean;
  shopify_product_id: string | null;
  tiny_product_id: string | null;
  created_at: string;
}

interface VariantSummary {
  master_id: string;
  variant_count: number;
  total_stock: number;
}

export function ProductsList() {
  const [view, setView] = useState<"unified" | "legacy">(() => {
    if (typeof window === "undefined") return "unified";
    return (localStorage.getItem("products_view") as any) || "unified";
  });
  const [items, setItems] = useState<Master[]>([]);
  const [variantSummary, setVariantSummary] = useState<Record<string, VariantSummary>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [labelPrintId, setLabelPrintId] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  function setViewPersist(v: "unified" | "legacy") {
    setView(v);
    try { localStorage.setItem("products_view", v); } catch {}
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

  async function load() {
    setLoading(true);
    const term = search.trim();
    let query = supabase.from("products_master").select("*");

    if (term) {
      // 1) Look up matching variants by SKU/GTIN to find their master_ids
      const { data: variantHits } = await supabase
        .from("product_variants")
        .select("master_id")
        .or(`sku.ilike.%${term}%,gtin.ilike.%${term}%`)
        .limit(200);
      const masterIds = Array.from(new Set((variantHits || []).map((v: any) => v.master_id).filter(Boolean)));

      // 2) Match on master fields (name, sku_root, brand) OR ids found via variants
      const orParts = [
        `name.ilike.%${term}%`,
        `sku_root.ilike.%${term}%`,
        `brand.ilike.%${term}%`,
      ];
      if (masterIds.length > 0) {
        orParts.push(`id.in.(${masterIds.join(",")})`);
      }
      query = query.or(orParts.join(","));
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Erro ao carregar produtos: " + error.message);
    } else {
      setItems((data || []) as any);
      // Sumário de variações
      if (data && data.length > 0) {
        const ids = data.map((d: any) => d.id);
        const { data: vars } = await supabase
          .from("product_variants")
          .select("master_id, initial_stock")
          .in("master_id", ids);
        const summary: Record<string, VariantSummary> = {};
        (vars || []).forEach((v: any) => {
          const cur = summary[v.master_id] || { master_id: v.master_id, variant_count: 0, total_stock: 0 };
          cur.variant_count += 1;
          cur.total_stock += v.initial_stock || 0;
          summary[v.master_id] = cur;
        });
        setVariantSummary(summary);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => { load(); }, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function sendToPos(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("create-master-product-pos", {
        body: { master_id: masterId },
      });
      if (error) throw error;
      toast.success("Enviado ao PDV: " + (data?.message || "OK"));
      load();
    } catch (err: any) {
      toast.error("Erro ao enviar ao PDV: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  async function sendToShopify(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("create-master-product-shopify", {
        body: { master_id: masterId },
      });
      if (error) throw error;
      toast.success("Criado na Shopify! ID: " + (data?.shopify_product_id || "?"));
      load();
    } catch (err: any) {
      toast.error("Erro ao criar na Shopify: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  // Desvincula o produto da Shopify (limpa os IDs locais) para permitir reenviar
  // como produto novo — usado quando o anúncio foi APAGADO na Shopify mas o sistema
  // ainda acha que existe vínculo.
  async function unlinkShopify(masterId: string) {
    if (!confirm("Desvincular este produto da Shopify? Isso limpa o vínculo local (IDs Shopify do produto e variações) para você poder criar um novo produto na Shopify. Não apaga nada na Shopify.")) return;
    setSendingTo(masterId);
    try {
      const { error: e1 } = await supabase
        .from("products_master")
        .update({ shopify_product_id: null } as any)
        .eq("id", masterId);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("product_variants")
        .update({ shopify_variant_id: null } as any)
        .eq("master_id", masterId);
      if (e2) throw e2;
      toast.success("Produto desvinculado da Shopify. Agora você pode criar um novo produto.");
      load();
    } catch (err: any) {
      toast.error("Erro ao desvincular: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  async function updateShopify(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("update-master-product-shopify", {
        body: { master_id: masterId },
      });
      if (error) throw error;
      toast.success(data?.message || "Produto atualizado na Shopify");
    } catch (err: any) {
      toast.error("Erro ao atualizar Shopify: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  async function syncStock(masterId: string, target: "pos" | "shopify" | "both") {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("sync-master-product-stock", {
        body: { master_id: masterId, target },
      });
      if (error) throw error;
      const r = data?.result || {};
      const parts: string[] = [];
      if (r.pos) parts.push(`PDV: ${r.pos.updated} atualizados em ${r.pos.stores} loja(s)`);
      if (r.shopify) parts.push(`Shopify: ${r.shopify.updated || 0} variantes`);
      toast.success("Estoque sincronizado — " + parts.join(" · "));
    } catch (err: any) {
      toast.error("Erro ao sincronizar estoque: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  const filtered = items;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-1 rounded-lg border bg-muted/40 w-fit">
        <Button size="sm" variant={view === "unified" ? "default" : "ghost"} onClick={() => setViewPersist("unified")} className="gap-1">
          <Sparkles className="h-3.5 w-3.5" /> Catálogo Unificado
        </Button>
        <Button size="sm" variant={view === "legacy" ? "default" : "ghost"} onClick={() => setViewPersist("legacy")}>
          Legacy
        </Button>
      </div>

      {view === "unified" ? <UnifiedProductsList /> : (
      <div className="space-y-4">
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
        <Button
          variant="outline"
          onClick={backfillCosts}
          disabled={backfilling}
          className="gap-1"
          title="Preenche o custo dos produtos zerados usando o custo já cadastrado no estoque (pos_products)"
        >
          {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Importar custos do estoque
        </Button>
        <Button onClick={() => setShowForm(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Novo Produto
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Package className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
          <h2 className="text-lg font-semibold text-muted-foreground">
            {search ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Clique em "Novo Produto" para começar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => {
            const summary = variantSummary[p.id];
            return (
              <Card key={p.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingId(p.id)}>
                      <div className="font-semibold truncate hover:text-primary transition-colors">{p.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">SKU: {p.sku_root}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!p.is_active && <Badge variant="secondary">Inativo</Badge>}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditingId(p.id)}
                        title="Editar produto"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.brand && <Badge variant="outline" className="text-[10px]">{p.brand}</Badge>}
                    {p.category && <Badge variant="outline" className="text-[10px]">{p.category}</Badge>}
                    {summary && (
                      <Badge variant="secondary" className="text-[10px]">
                        {summary.variant_count} var · {summary.total_stock} un
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Custo</span>
                      <div className="font-semibold">R$ {p.cost_price.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Venda</span>
                      <div className="font-semibold text-primary">R$ {p.sale_price.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="flex gap-1 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs h-8"
                      onClick={() => setEditingId(p.id)}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs h-8"
                      onClick={() => navigate(`/inventory/produto/${p.id}/estoque`)}
                      title="Gerenciar estoque por variação (entrada / saída / balanço)"
                    >
                      <Boxes className="h-3 w-3 mr-1" />
                      Estoque
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs h-8"
                      onClick={() => setLabelPrintId(p.id)}
                      title="Imprimir etiquetas com código de barras (8×5cm em folha A4)"
                    >
                      <Tag className="h-3 w-3 mr-1" />
                      Etiqueta
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant={p.tiny_product_id ? "secondary" : "outline"}
                          className="flex-1 text-xs h-8"
                          disabled={sendingTo === p.id}
                        >
                          {sendingTo === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <StoreIcon className="h-3 w-3 mr-1" />
                          )}
                          {p.tiny_product_id ? "PDV ✓" : "PDV"}
                          <ChevronDown className="h-3 w-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-xs">PDV (todas as lojas)</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => sendToPos(p.id)}>
                          <RefreshCw className="h-3 w-3 mr-2" />
                          Atualizar dados (nome/preço)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => syncStock(p.id, "pos")}>
                          <Boxes className="h-3 w-3 mr-2" />
                          Sincronizar estoque
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant={p.shopify_product_id ? "secondary" : "outline"}
                          className="flex-1 text-xs h-8"
                          disabled={sendingTo === p.id}
                        >
                          {sendingTo === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ShoppingBag className="h-3 w-3 mr-1" />
                          )}
                          {p.shopify_product_id ? "Shopify ✓" : "Shopify"}
                          <ChevronDown className="h-3 w-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-xs">Shopify</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {!p.shopify_product_id && (
                          <DropdownMenuItem onClick={() => sendToShopify(p.id)}>
                            <ShoppingBag className="h-3 w-3 mr-2" />
                            Criar produto na Shopify
                          </DropdownMenuItem>
                        )}
                        {p.shopify_product_id && (
                          <>
                            <DropdownMenuItem onClick={() => updateShopify(p.id)}>
                              <RefreshCw className="h-3 w-3 mr-2" />
                              Atualizar dados (nome/preço/imagens)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => syncStock(p.id, "shopify")}>
                              <Boxes className="h-3 w-3 mr-2" />
                              Sincronizar estoque
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => unlinkShopify(p.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Unlink className="h-3 w-3 mr-2" />
                              Desvincular da Shopify (apagado lá)
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProductMasterForm
        open={showForm}
        onOpenChange={setShowForm}
        onCreated={() => load()}
      />

      <ProductEditDialog
        masterId={editingId}
        open={!!editingId}
        onOpenChange={(v) => !v && setEditingId(null)}
        onSaved={() => load()}
      />


      <ProductLabelPrintDialog
        masterId={labelPrintId}
        open={!!labelPrintId}
        onOpenChange={(v) => !v && setLabelPrintId(null)}
      />
    </div>
      )}
    </div>
  );
}

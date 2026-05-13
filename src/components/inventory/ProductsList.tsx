import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Package, ShoppingBag, Store as StoreIcon, Loader2, Pencil, ChevronDown, RefreshCw, Boxes } from "lucide-react";
import { ProductMasterForm } from "./ProductMasterForm";
import { ProductEditDialog } from "./ProductEditDialog";
import { ProductStockManagerDialog } from "./ProductStockManagerDialog";
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
  const [items, setItems] = useState<Master[]>([]);
  const [variantSummary, setVariantSummary] = useState<Record<string, VariantSummary>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stockManagerId, setStockManagerId] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

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
    const { data, error } = await supabase
      .from("products_master")
      .select("*")
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
    load();
  }, []);

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

  const filtered = items.filter((i) =>
    !search ||
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.sku_root.includes(search) ||
    (i.brand || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, SKU, marca..."
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
                      onClick={() => setStockManagerId(p.id)}
                      title="Gerenciar estoque por variação (entrada / saída / balanço)"
                    >
                      <Boxes className="h-3 w-3 mr-1" />
                      Estoque
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

      <ProductStockManagerDialog
        masterId={stockManagerId}
        open={!!stockManagerId}
        onOpenChange={(v) => !v && setStockManagerId(null)}
      />
    </div>
  );
}

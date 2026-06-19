import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, Search, X, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

interface UnmatchedItem {
  id: string;
  sale_id: string;
  item_code: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  store_id: string | null;
  external_source: string | null;
  status: string;
  created_at: string;
}

interface ProductHit {
  id: string;
  store_id: string;
  name: string;
  sku: string;
  barcode: string;
  color: string | null;
  size: string | null;
  stock: number;
  tiny_id: number | null;
}

export function SaleUnmatchedItems() {
  const [items, setItems] = useState<UnmatchedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState<UnmatchedItem | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_sale_unmatched_items")
      .select("*")
      .eq("status", "pending")
      .order("product_name", { ascending: true });
    if (error) {
      toast.error("Erro ao carregar itens sem correspondência");
    } else {
      setItems((data as UnmatchedItem[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runSearch = useCallback(async (term: string) => {
    if (!term || term.trim().length < 2) { setHits([]); return; }
    setSearching(true);
    const { data, error } = await supabase
      .from("pos_products")
      .select("id, store_id, name, sku, barcode, color, size, stock, tiny_id")
      .or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
      .limit(40);
    if (error) {
      toast.error("Erro na busca de produtos");
      setHits([]);
    } else {
      setHits((data as ProductHit[]) || []);
    }
    setSearching(false);
  }, []);

  const openLink = (item: UnmatchedItem) => {
    setLinking(item);
    setSearch(item.product_name || "");
    setHits([]);
    runSearch(item.product_name || "");
  };

  const linkTo = async (product: ProductHit) => {
    if (!linking) return;
    setSaving(true);
    try {
      // 1) Cria/atualiza o de-para (apelido de código)
      const { error: aliasErr } = await supabase
        .from("inventory_barcode_aliases")
        .upsert({
          store_id: product.store_id,
          original_barcode: linking.item_code,
          product_tiny_id: product.tiny_id ?? 0,
          product_name: product.name,
          product_sku: product.sku,
          notes: `De-para vinculado em ${new Date().toLocaleDateString("pt-BR")} (venda Site/Loja)`,
        }, { onConflict: "store_id,original_barcode" });
      if (aliasErr) throw aliasErr;

      // 2) Reprocessa a venda para abater o estoque agora
      const { error: rpcErr } = await supabase.rpc("process_pos_sale_sale_event", {
        p_sale_id: linking.sale_id,
      });
      if (rpcErr) throw rpcErr;

      // 3) Marca como resolvido
      const { error: updErr } = await supabase
        .from("inventory_sale_unmatched_items")
        .update({
          status: "resolved",
          resolved_product_id: product.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", linking.id);
      if (updErr) throw updErr;

      toast.success("Vinculado e estoque abatido!");
      setLinking(null);
      load();
    } catch (e: any) {
      toast.error(`Erro ao vincular: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const ignore = async (item: UnmatchedItem) => {
    const { error } = await supabase
      .from("inventory_sale_unmatched_items")
      .update({ status: "ignored" })
      .eq("id", item.id);
    if (error) { toast.error("Erro ao ignorar"); return; }
    toast.success("Item ignorado");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Itens de venda sem correspondência (De-para)
          </h2>
          <p className="text-sm text-muted-foreground">
            Vendas do Site/Loja de produtos que não existem no estoque interno. Vincule cada código ao produto certo para abater o estoque.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500 mb-3" />
          <p className="text-muted-foreground">Nenhum item pendente. Tudo casado! 🎉</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Badge variant="secondary">{items.length} pendentes</Badge>
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-medium text-sm">{item.product_name || "(sem nome)"}</p>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    <span>Cód: <span className="font-mono">{item.item_code || "—"}</span></span>
                    {item.variant_name && <span>· {item.variant_name}</span>}
                    <span>· Qtd: {item.quantity}</span>
                    {item.external_source && (
                      <Badge variant="outline" className="text-[10px] py-0">{item.external_source}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => openLink(item)} className="gap-1">
                    <Link2 className="h-3.5 w-3.5" /> Vincular
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => ignore(item)} className="gap-1">
                    <X className="h-3.5 w-3.5" /> Ignorar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!linking} onOpenChange={(o) => !o && setLinking(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vincular ao produto do estoque</DialogTitle>
            <DialogDescription>
              {linking?.product_name} · Cód: <span className="font-mono">{linking?.item_code}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch(search)}
                placeholder="Buscar por nome, SKU ou código de barras..."
                className="pl-8"
              />
            </div>
            <Button onClick={() => runSearch(search)} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            {hits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                {searching ? "Buscando..." : "Nenhum produto encontrado. Refine a busca."}
              </p>
            ) : (
              hits.map((p) => (
                <button
                  key={p.id + p.store_id}
                  onClick={() => linkTo(p)}
                  disabled={saving}
                  className="w-full text-left p-2 rounded-md border hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <p className="text-sm font-medium">{p.name}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono">{p.barcode || p.sku}</span>
                    {p.color && <span>· {p.color}</span>}
                    {p.size && <span>· {p.size}</span>}
                    <Badge variant={p.stock > 0 ? "secondary" : "destructive"} className="text-[10px] py-0">
                      Estoque: {p.stock}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

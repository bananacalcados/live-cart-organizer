import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Package, Plus, Minus, Equal, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Props {
  masterId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface Variant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  tiny_variant_id: string | null;
}

interface Store {
  id: string;
  name: string;
}

interface StockRow {
  storeId: string;
  storeName: string;
  posProductId: string | null;
  tinyId: string | null;
  stock: number;
}

type Mode = "in" | "out" | "balance";

export function ProductStockManagerDialog({ masterId, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [master, setMaster] = useState<{ name: string; sku_root: string } | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  // stockMap[variantId][storeId] = StockRow
  const [stockMap, setStockMap] = useState<Record<string, Record<string, StockRow>>>({});
  // editing state per variant+store
  const [edits, setEdits] = useState<Record<string, { qty: string; mode: Mode; reason: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!masterId) return;
    setLoading(true);
    try {
      const { data: m } = await supabase
        .from("products_master")
        .select("name, sku_root")
        .eq("id", masterId)
        .single();
      setMaster(m as any);

      const { data: vs } = await supabase
        .from("product_variants")
        .select("id, sku, size, color, tiny_variant_id")
        .eq("master_id", masterId)
        .eq("is_active", true)
        .order("size");
      const variantsData = (vs || []) as Variant[];
      setVariants(variantsData);

      const { data: storesData } = await supabase
        .from("pos_stores")
        .select("id, name")
        .eq("is_active", true)
        .eq("is_simulation", false)
        .order("name");
      const storeList = (storesData || []) as Store[];
      setStores(storeList);

      // Build stock map via pos_products lookup by tiny_id
      const tinyIds = variantsData.map((v) => v.tiny_variant_id).filter(Boolean) as string[];
      const skus = variantsData.map((v) => v.sku).filter(Boolean);
      const { data: posProds } = await supabase
        .from("pos_products")
        .select("id, store_id, tiny_id, sku, stock")
        .or(
          [
            tinyIds.length ? `tiny_id.in.(${tinyIds.join(",")})` : "",
            skus.length ? `sku.in.(${skus.join(",")})` : "",
          ].filter(Boolean).join(",")
        );

      const map: Record<string, Record<string, StockRow>> = {};
      for (const v of variantsData) {
        map[v.id] = {};
        for (const s of storeList) {
          const pp = (posProds || []).find(
            (p: any) =>
              p.store_id === s.id &&
              ((v.tiny_variant_id && String(p.tiny_id) === String(v.tiny_variant_id)) ||
                (v.sku && p.sku === v.sku))
          );
          map[v.id][s.id] = {
            storeId: s.id,
            storeName: s.name,
            posProductId: pp?.id || null,
            tinyId: pp?.tiny_id ? String(pp.tiny_id) : v.tiny_variant_id,
            stock: pp?.stock ?? 0,
          };
        }
      }
      setStockMap(map);
      setEdits({});
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [masterId]);

  useEffect(() => {
    if (open && masterId) load();
  }, [open, masterId, load]);

  const keyOf = (vId: string, sId: string) => `${vId}::${sId}`;

  const setEdit = (vId: string, sId: string, patch: Partial<{ qty: string; mode: Mode; reason: string }>) => {
    const k = keyOf(vId, sId);
    setEdits((prev) => ({
      ...prev,
      [k]: { qty: "", mode: "out", reason: "", ...prev[k], ...patch },
    }));
  };

  const handleApply = async (variant: Variant, row: StockRow) => {
    const k = keyOf(variant.id, row.storeId);
    const e = edits[k];
    if (!e || e.qty === "") {
      toast.error("Informe a quantidade");
      return;
    }
    const inputQty = parseInt(e.qty, 10);
    if (isNaN(inputQty) || inputQty < 0) {
      toast.error("Quantidade inválida");
      return;
    }
    if (!row.posProductId) {
      toast.error("Variação sem cadastro no estoque desta loja — não dá pra ajustar");
      return;
    }

    let direction: "in" | "out";
    let qty: number;
    if (e.mode === "balance") {
      const diff = inputQty - row.stock;
      if (diff === 0) {
        toast.info("Estoque já está em " + inputQty);
        return;
      }
      direction = diff > 0 ? "in" : "out";
      qty = Math.abs(diff);
    } else {
      direction = e.mode;
      qty = inputQty;
    }

    setSavingKey(k);
    try {
      const { data, error } = await supabase.functions.invoke("pos-stock-balance", {
        body: {
          store_id: row.storeId,
          tiny_id: row.tinyId,
          quantity: qty,
          direction,
          reason: e.reason || (e.mode === "balance" ? `Balanço para ${inputQty}` : "Ajuste manual via Estoque"),
          product_name: master?.name || variant.sku,
          sku: variant.sku,
          product_id: row.posProductId,
        },
      });
      if (error) {
        const { extractEdgeError } = await import("@/lib/edgeFunctionError");
        throw new Error(await extractEdgeError(error));
      }
      if (!data?.success) throw new Error(data?.error || "Falha ao ajustar");
      toast.success(`OK: ${row.storeName} ${row.stock} → ${data.new_stock}`);
      // Update local
      setStockMap((prev) => ({
        ...prev,
        [variant.id]: {
          ...prev[variant.id],
          [row.storeId]: { ...row, stock: data.new_stock },
        },
      }));
      setEdit(variant.id, row.storeId, { qty: "", reason: "" });
    } catch (err: any) {
      toast.error("Erro: " + err.message, { duration: 10000 });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Gerenciar Estoque por Variação
          </DialogTitle>
          {master && (
            <DialogDescription>
              <span className="font-medium text-foreground">{master.name}</span>
              <span className="ml-2 font-mono text-xs">{master.sku_root}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Recarregar
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : variants.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Nenhuma variação cadastrada para este produto.
          </div>
        ) : (
          <div className="space-y-3">
            {variants.map((v) => (
              <Card key={v.id}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{v.size || "—"}</Badge>
                    {v.color && <Badge variant="outline">{v.color}</Badge>}
                    <span className="text-xs font-mono text-muted-foreground">SKU: {v.sku}</span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                    {stores.map((s) => {
                      const row = stockMap[v.id]?.[s.id];
                      if (!row) return null;
                      const k = keyOf(v.id, s.id);
                      const e = edits[k] || { qty: "", mode: "out" as Mode, reason: "" };
                      return (
                        <div key={s.id} className="border rounded-md p-2 space-y-2 bg-muted/30">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{s.name}</span>
                            <Badge
                              className={
                                row.stock > 0
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : row.stock < 0
                                  ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                  : "bg-muted text-muted-foreground"
                              }
                              variant="secondary"
                            >
                              {row.stock} un
                            </Badge>
                          </div>

                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={e.mode === "in" ? "default" : "outline"}
                              className="flex-1 h-7 text-xs px-1"
                              onClick={() => setEdit(v.id, s.id, { mode: "in" })}
                            >
                              <Plus className="h-3 w-3" /> Entrada
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={e.mode === "out" ? "default" : "outline"}
                              className="flex-1 h-7 text-xs px-1"
                              onClick={() => setEdit(v.id, s.id, { mode: "out" })}
                            >
                              <Minus className="h-3 w-3" /> Saída
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={e.mode === "balance" ? "default" : "outline"}
                              className="flex-1 h-7 text-xs px-1"
                              onClick={() => setEdit(v.id, s.id, { mode: "balance" })}
                            >
                              <Equal className="h-3 w-3" /> Balanço
                            </Button>
                          </div>

                          <Input
                            type="number"
                            min="0"
                            placeholder={e.mode === "balance" ? "Qtde real (absoluta)" : "Qtde a ajustar"}
                            value={e.qty}
                            onChange={(ev) => setEdit(v.id, s.id, { qty: ev.target.value })}
                            className="h-8 text-sm"
                          />
                          <Input
                            placeholder="Motivo (opcional)"
                            value={e.reason}
                            onChange={(ev) => setEdit(v.id, s.id, { reason: ev.target.value })}
                            className="h-7 text-xs"
                          />
                          <Button
                            size="sm"
                            className="w-full h-7 text-xs"
                            disabled={savingKey === k || !row.tinyId}
                            onClick={() => handleApply(v, row)}
                          >
                            {savingKey === k ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Aplicar"
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Loader2, Package, Plus, Minus, Equal, RefreshCw,
  ArrowDownCircle, ArrowUpCircle, History, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

interface PosRow {
  id: string;
  store_id: string;
  tiny_id: string | null;
  sku: string | null;
  stock: number;
}

interface HistoryRow {
  id: string;
  direction: "in" | "out";
  quantity: number;
  previous_stock: number | null;
  new_stock: number | null;
  reason: string | null;
  seller_name: string | null;
  sale_id: string | null;
  sale_event: string | null;
  created_at: string;
  order_label?: string | null;
  customer_name?: string | null;
}

type Mode = "in" | "out" | "balance";

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ProductStockManager() {
  const { masterId } = useParams<{ masterId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [master, setMaster] = useState<{ name: string; sku_root: string } | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [posRows, setPosRows] = useState<PosRow[]>([]);
  const [storeId, setStoreId] = useState<string>("");
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // adjust form
  const [mode, setMode] = useState<Mode>("out");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // history
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    if (!masterId) return;
    setLoading(true);
    try {
      const [{ data: m }, { data: vs }, { data: storesData }] = await Promise.all([
        supabase.from("products_master").select("name, sku_root").eq("id", masterId).single(),
        supabase
          .from("product_variants")
          .select("id, sku, size, color, tiny_variant_id")
          .eq("master_id", masterId)
          .eq("is_active", true)
          .order("size"),
        supabase
          .from("pos_stores")
          .select("id, name")
          .eq("is_active", true)
          .eq("is_simulation", false)
          .order("name"),
      ]);

      setMaster(m as any);
      const variantsData = (vs || []) as Variant[];
      setVariants(variantsData);
      const storeList = (storesData || []) as Store[];
      setStores(storeList);
      setStoreId((prev) => prev || storeList[0]?.id || "");

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
      setPosRows((posProds || []).map((p: any) => ({
        id: p.id,
        store_id: p.store_id,
        tiny_id: p.tiny_id ? String(p.tiny_id) : null,
        sku: p.sku,
        stock: Number(p.stock) || 0,
      })));
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [masterId]);

  useEffect(() => { load(); }, [load]);

  // resolve pos_products row for a variant in selected store
  const rowFor = useCallback((variant: Variant): PosRow | null => {
    if (!storeId) return null;
    return posRows.find(
      (p) =>
        p.store_id === storeId &&
        ((variant.tiny_variant_id && p.tiny_id && p.tiny_id === String(variant.tiny_variant_id)) ||
          (variant.sku && p.sku === variant.sku))
    ) || null;
  }, [posRows, storeId]);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) || null,
    [variants, selectedVariantId]
  );
  const selectedRow = selectedVariant ? rowFor(selectedVariant) : null;

  const loadHistory = useCallback(async (posProductId: string) => {
    setHistoryLoading(true);
    try {
      const { data: adj } = await supabase
        .from("pos_stock_adjustments")
        .select("id, direction, quantity, previous_stock, new_stock, reason, seller_name, sale_id, sale_event, created_at")
        .eq("product_id", posProductId)
        .order("created_at", { ascending: false })
        .limit(200);

      const rows = (adj || []) as HistoryRow[];
      const saleIds = Array.from(new Set(rows.map((r) => r.sale_id).filter(Boolean))) as string[];
      let salesMap: Record<string, { label: string; customer: string | null }> = {};
      if (saleIds.length) {
        const { data: sales } = await supabase
          .from("pos_sales")
          .select("id, tiny_order_number, external_order_id, customer_name, total")
          .in("id", saleIds);
        for (const s of sales || []) {
          const label = (s as any).tiny_order_number || (s as any).external_order_id || `#${String((s as any).id).slice(0, 8)}`;
          salesMap[(s as any).id] = { label: String(label), customer: (s as any).customer_name || null };
        }
      }
      setHistory(rows.map((r) => ({
        ...r,
        order_label: r.sale_id ? salesMap[r.sale_id]?.label || `#${r.sale_id.slice(0, 8)}` : null,
        customer_name: r.sale_id ? salesMap[r.sale_id]?.customer || null : null,
      })));
    } catch (e: any) {
      toast.error("Erro ao carregar histórico: " + e.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const selectVariant = (variant: Variant) => {
    setSelectedVariantId(variant.id);
    setMode("out");
    setQty("");
    setReason("");
    setHistory([]);
    const row = rowFor(variant);
    if (row?.id) loadHistory(row.id);
  };

  // refresh history when store changes for selected variant
  useEffect(() => {
    if (selectedVariant) {
      const row = rowFor(selectedVariant);
      setHistory([]);
      if (row?.id) loadHistory(row.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const handleApply = async () => {
    if (!selectedVariant || !selectedRow) return;
    if (qty === "") { toast.error("Informe a quantidade"); return; }
    const inputQty = parseInt(qty, 10);
    if (isNaN(inputQty) || inputQty < 0) { toast.error("Quantidade inválida"); return; }
    if (!selectedRow.id) { toast.error("Variação sem cadastro nesta loja"); return; }

    let direction: "in" | "out";
    let q: number;
    if (mode === "balance") {
      const diff = inputQty - selectedRow.stock;
      if (diff === 0) { toast.info("Estoque já está em " + inputQty); return; }
      direction = diff > 0 ? "in" : "out";
      q = Math.abs(diff);
    } else {
      direction = mode;
      q = inputQty;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("pos-stock-balance", {
        body: {
          store_id: selectedRow.store_id,
          tiny_id: selectedRow.tiny_id,
          quantity: q,
          direction,
          reason: reason || (mode === "balance" ? `Balanço para ${inputQty}` : "Ajuste manual via Estoque"),
          product_name: master?.name || selectedVariant.sku,
          sku: selectedVariant.sku,
          product_id: selectedRow.id,
        },
      });
      if (error) {
        const { extractEdgeError } = await import("@/lib/edgeFunctionError");
        throw new Error(await extractEdgeError(error));
      }
      if (!data?.success) throw new Error(data?.error || "Falha ao ajustar");
      toast.success(`OK: ${selectedRow.stock} → ${data.new_stock}`);
      // update local stock
      setPosRows((prev) => prev.map((p) => (p.id === selectedRow.id ? { ...p, stock: data.new_stock } : p)));
      setQty("");
      setReason("");
      loadHistory(selectedRow.id);
    } catch (err: any) {
      toast.error("Erro: " + err.message, { duration: 10000 });
    } finally {
      setSaving(false);
    }
  };

  const stockBadgeClass = (stock: number) =>
    stock > 0
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
      : stock < 0
      ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
      : "bg-muted text-muted-foreground";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Package className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate">{master?.name || "Estoque"}</h1>
            {master && <p className="text-xs font-mono text-muted-foreground">{master.sku_root}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
            Recarregar
          </Button>
        </div>

        {/* Store selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Loja:</span>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Selecione a loja" />
            </SelectTrigger>
            <SelectContent>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <>
            {/* Horizontal variation list */}
            <Card>
              <CardContent className="p-2">
                <div className="text-xs font-medium text-muted-foreground px-1 pb-2">
                  Clique numa variação para ver histórico e ajustar
                </div>
                <div className="divide-y">
                  {variants.map((v) => {
                    const row = rowFor(v);
                    const stock = row?.stock ?? 0;
                    const active = v.id === selectedVariantId;
                    return (
                      <button
                        key={v.id}
                        onClick={() => selectVariant(v)}
                        className={cn(
                          "w-full flex items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-muted/50",
                          active && "bg-primary/10"
                        )}
                      >
                        <Badge variant="secondary" className="shrink-0 min-w-10 justify-center">{v.size || "—"}</Badge>
                        {v.color && <Badge variant="outline" className="shrink-0">{v.color}</Badge>}
                        <span className="text-xs font-mono text-muted-foreground truncate flex-1 hidden sm:block">{v.sku}</span>
                        <Badge variant="secondary" className={cn("shrink-0", stockBadgeClass(stock))}>
                          {row ? `${stock} un` : "s/ cadastro"}
                        </Badge>
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", active && "rotate-90")} />
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Detail panel */}
            {selectedVariant && (
              <Card>
                <CardContent className="p-3 space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{selectedVariant.size || "—"}</Badge>
                    {selectedVariant.color && <Badge variant="outline">{selectedVariant.color}</Badge>}
                    <span className="text-xs font-mono text-muted-foreground">{selectedVariant.sku}</span>
                    <Badge variant="secondary" className={cn("ml-auto", stockBadgeClass(selectedRow?.stock ?? 0))}>
                      {selectedRow ? `${selectedRow.stock} un` : "sem cadastro nesta loja"}
                    </Badge>
                  </div>

                  {/* Adjust controls */}
                  {selectedRow ? (
                    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                      <div className="flex gap-1">
                        <Button
                          type="button" size="sm"
                          variant={mode === "in" ? "default" : "outline"}
                          className="flex-1 h-8 text-xs"
                          onClick={() => setMode("in")}
                        >
                          <Plus className="h-3 w-3" /> Entrada
                        </Button>
                        <Button
                          type="button" size="sm"
                          variant={mode === "out" ? "default" : "outline"}
                          className="flex-1 h-8 text-xs"
                          onClick={() => setMode("out")}
                        >
                          <Minus className="h-3 w-3" /> Saída
                        </Button>
                        <Button
                          type="button" size="sm"
                          variant={mode === "balance" ? "default" : "outline"}
                          className="flex-1 h-8 text-xs"
                          onClick={() => setMode("balance")}
                        >
                          <Equal className="h-3 w-3" /> Balanço
                        </Button>
                      </div>
                      <Input
                        type="number" min="0"
                        placeholder={mode === "balance" ? "Qtde real (absoluta)" : "Qtde a ajustar"}
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="h-9"
                      />
                      <Input
                        placeholder="Motivo (opcional)"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="h-8 text-sm"
                      />
                      <Button className="w-full h-9" disabled={saving} onClick={handleApply}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
                      </Button>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground rounded-md border p-3">
                      Esta variação não tem cadastro de estoque nesta loja — não é possível ajustar aqui.
                    </div>
                  )}

                  {/* History */}
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <History className="h-4 w-4" /> Histórico de movimentações
                    </div>
                    {historyLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : history.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-4 text-center">
                        Nenhuma movimentação registrada.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {history.map((h) => (
                          <div key={h.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                            {h.direction === "in" ? (
                              <ArrowDownCircle className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                            ) : (
                              <ArrowUpCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn("font-semibold", h.direction === "in" ? "text-green-600" : "text-red-500")}>
                                  {h.direction === "in" ? "+" : "−"}{h.quantity}
                                </span>
                                {h.previous_stock != null && h.new_stock != null && (
                                  <span className="text-xs text-muted-foreground">
                                    {h.previous_stock} → {h.new_stock}
                                  </span>
                                )}
                                {h.sale_id && (
                                  <Badge variant="outline" className="text-[10px]">
                                    Pedido {h.order_label}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {fmtDateTime(h.created_at)}
                                {h.customer_name && ` · ${h.customer_name}`}
                                {h.seller_name && ` · ${h.seller_name}`}
                              </div>
                              {h.reason && <div className="text-xs text-muted-foreground italic">{h.reason}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

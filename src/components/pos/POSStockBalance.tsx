import { useState, useEffect } from "react";
import { ArrowDown, ArrowUp, Check, Loader2, Package, History, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { POSTinyProductPicker } from "./POSTinyProductPicker";

interface Props {
  storeId: string;
}

interface SelectedProduct {
  product_name: string;
  sku: string;
  unit_price: number;
  tiny_id?: number;
  barcode?: string;
  stock?: number;
  product_id?: string;
}

interface Adjustment {
  id: string;
  product_name: string;
  direction: string;
  quantity: number;
  previous_stock: number | null;
  new_stock: number | null;
  reason: string | null;
  seller_name: string | null;
  created_at: string;
}

export function POSStockBalance({ storeId }: Props) {
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [selectedSeller, setSelectedSeller] = useState("");
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [recentAdjustments, setRecentAdjustments] = useState<Adjustment[]>([]);

  useEffect(() => {
    loadSellers();
    loadRecentAdjustments();
  }, [storeId]);

  const loadSellers = async () => {
    const { data } = await supabase
      .from("pos_sellers")
      .select("id, name")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("name");
    if (data) setSellers(data);
  };

  const loadRecentAdjustments = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from("pos_stock_adjustments")
      .select("id, product_name, direction, quantity, previous_stock, new_stock, reason, seller_name, created_at")
      .eq("store_id", storeId)
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: false })
      .limit(20) as { data: Adjustment[] | null };
    if (data) setRecentAdjustments(data);
  };

  const handleProductSelect = async (product: { product_name: string; sku: string; unit_price: number; tiny_id?: number; barcode?: string }) => {
    if (!product.product_name) {
      setSelectedProduct(null);
      return;
    }

    // Find the local product record to get stock and product_id
    let stock = 0;
    let productId: string | undefined;

    if (product.tiny_id) {
      const { data } = await supabase
        .from("pos_products")
        .select("id, stock")
        .eq("store_id", storeId)
        .eq("tiny_id", product.tiny_id)
        .maybeSingle();
      if (data) {
        stock = parseFloat(data.stock as any || "0");
        productId = data.id;
      }
    }

    setSelectedProduct({
      ...product,
      stock,
      product_id: productId,
    });
  };

  const handleSubmit = async () => {
    if (!selectedProduct?.tiny_id) {
      toast.error("Selecione um produto válido");
      return;
    }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      toast.error("Informe uma quantidade válida");
      return;
    }

    setSaving(true);
    try {
      const sellerName = sellers.find(s => s.id === selectedSeller)?.name || null;

      const { data, error } = await supabase.functions.invoke("pos-stock-balance", {
        body: {
          store_id: storeId,
          tiny_id: selectedProduct.tiny_id,
          quantity: qty,
          direction,
          reason: reason || null,
          product_name: selectedProduct.product_name,
          sku: selectedProduct.sku,
          barcode: selectedProduct.barcode || null,
          product_id: selectedProduct.product_id || null,
          seller_id: selectedSeller || null,
          seller_name: sellerName,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Erro desconhecido");

      toast.success(
        `Estoque ajustado: ${data.previous_stock} → ${data.new_stock}`,
        { description: selectedProduct.product_name }
      );

      // Reset form
      setSelectedProduct(null);
      setQuantity("");
      setReason("");
      loadRecentAdjustments();
    } catch (err: any) {
      toast.error("Erro ao ajustar estoque", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-pos-orange" />
          <h2 className="text-lg font-bold text-pos-white">Balanço de Estoque</h2>
        </div>

        {/* Product Search */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardContent className="p-4 space-y-4">
            <POSTinyProductPicker
              storeId={storeId}
              label="Buscar Produto (nome, SKU ou código de barras)"
              value={selectedProduct?.product_name || ""}
              onSelect={handleProductSelect}
              placeholder="Bipe ou busque o produto..."
            />

            {/* Selected Product Info */}
            {selectedProduct && (
              <div className="bg-pos-white/5 rounded-lg p-3 border border-pos-orange/20">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-pos-white">{selectedProduct.product_name}</p>
                    <div className="flex gap-2 mt-1">
                      {selectedProduct.sku && (
                        <Badge variant="outline" className="text-[10px] border-pos-orange/30 text-pos-white/60">
                          SKU: {selectedProduct.sku}
                        </Badge>
                      )}
                      {selectedProduct.barcode && (
                        <Badge variant="outline" className="text-[10px] border-pos-orange/30 text-pos-white/60">
                          EAN: {selectedProduct.barcode}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-pos-white/40">Estoque local</p>
                    <p className="text-lg font-bold text-pos-orange">{selectedProduct.stock ?? 0}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Direction Toggle */}
            {selectedProduct && (
              <>
                <div>
                  <Label className="text-pos-white/50 text-xs">Tipo de Movimento</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <Button
                      type="button"
                      variant={direction === "in" ? "default" : "outline"}
                      className={direction === "in"
                        ? "bg-green-600 hover:bg-green-700 text-white h-10 gap-2"
                        : "border-pos-orange/30 text-pos-white/60 h-10 gap-2 hover:bg-pos-white/5"
                      }
                      onClick={() => setDirection("in")}
                    >
                      <ArrowUp className="h-4 w-4" />
                      Entrada (+)
                    </Button>
                    <Button
                      type="button"
                      variant={direction === "out" ? "default" : "outline"}
                      className={direction === "out"
                        ? "bg-red-600 hover:bg-red-700 text-white h-10 gap-2"
                        : "border-pos-orange/30 text-pos-white/60 h-10 gap-2 hover:bg-pos-white/5"
                      }
                      onClick={() => setDirection("out")}
                    >
                      <ArrowDown className="h-4 w-4" />
                      Saída (-)
                    </Button>
                  </div>
                </div>

                {/* Quantity */}
                <div>
                  <Label className="text-pos-white/50 text-xs">Quantidade</Label>
                  <Input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    placeholder="Ex: 1"
                    className="h-10 text-lg font-bold bg-pos-white/5 border-pos-orange/30 text-pos-white text-center"
                  />
                </div>

                {/* Reason */}
                <div>
                  <Label className="text-pos-white/50 text-xs">Motivo (opcional)</Label>
                  <Input
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Ex: Produto danificado, reposição..."
                    className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white"
                  />
                </div>

                {/* Seller */}
                <div>
                  <Label className="text-pos-white/50 text-xs">Vendedor(a)</Label>
                  <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                    <SelectTrigger className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white">
                      <SelectValue placeholder="Selecionar vendedor(a)..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Preview */}
                {quantity && parseFloat(quantity) > 0 && (
                  <div className="bg-pos-white/5 rounded-lg p-3 border border-pos-orange/20 text-center">
                    <p className="text-xs text-pos-white/40">Estoque após ajuste</p>
                    <p className="text-2xl font-bold text-pos-orange">
                      {direction === "in"
                        ? (selectedProduct.stock ?? 0) + parseFloat(quantity)
                        : Math.max(0, (selectedProduct.stock ?? 0) - parseFloat(quantity))
                      }
                    </p>
                    <p className="text-[10px] text-pos-white/30 mt-1">
                      {selectedProduct.stock ?? 0} {direction === "in" ? "+" : "-"} {quantity}
                      {" "}(valor final será recalculado com saldo real do Tiny)
                    </p>
                  </div>
                )}

                {/* Submit */}
                <Button
                  className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12 gap-2"
                  onClick={handleSubmit}
                  disabled={saving || !quantity || parseFloat(quantity) <= 0}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? "Ajustando estoque..." : "Confirmar Balanço"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent Adjustments */}
        {recentAdjustments.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <History className="h-4 w-4 text-pos-white/40" />
              <p className="text-xs text-pos-white/40 font-medium">Ajustes de hoje</p>
            </div>
            <div className="space-y-2">
              {recentAdjustments.map(adj => (
                <Card key={adj.id} className="bg-pos-white/5 border-pos-white/10">
                  <CardContent className="p-3">
                    <div className="flex justify-between items-start">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-pos-white truncate">{adj.product_name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge
                            variant="outline"
                            className={adj.direction === "in"
                              ? "text-[10px] border-green-500/30 text-green-400"
                              : "text-[10px] border-red-500/30 text-red-400"
                            }
                          >
                            {adj.direction === "in" ? `+${adj.quantity}` : `-${adj.quantity}`}
                          </Badge>
                          <span className="text-[10px] text-pos-white/30">
                            {adj.previous_stock} → {adj.new_stock}
                          </span>
                          {adj.seller_name && (
                            <span className="text-[10px] text-pos-white/20">{adj.seller_name}</span>
                          )}
                        </div>
                        {adj.reason && (
                          <p className="text-[10px] text-pos-white/20 mt-1">{adj.reason}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-pos-white/20 flex-shrink-0">
                        {new Date(adj.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

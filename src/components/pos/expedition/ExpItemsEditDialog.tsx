import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Plus, Trash2, Save, Package } from "lucide-react";
import { ExpOrder, brl } from "./expeditionTypes";

interface Props {
  order: ExpOrder;
  storeId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

interface EditItem {
  key: string;
  id: string | null;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  unit_price: number;
}

interface ProdRow {
  id: string;
  name: string;
  variant: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  price: number;
  stock: number;
}

/**
 * Edição dos PRODUTOS de um pedido já dentro da Expedição (novos pedidos,
 * preparação e conferência). O ajuste de estoque é feito no banco pela função
 * `expedition_update_sale_items`: remover/reduzir devolve estoque, adicionar/
 * aumentar dá baixa — sempre com registro no histórico de movimentação.
 */
export function ExpItemsEditDialog({ order, storeId, open, onOpenChange, onSaved }: Props) {
  const [items, setItems] = useState<EditItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProdRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(
      (order.items || []).map((i) => ({
        key: i.id,
        id: i.id,
        product_name: i.product_name || "",
        variant_name: i.variant_name,
        size: i.size,
        sku: i.sku,
        barcode: i.barcode,
        quantity: Number(i.quantity) || 1,
        unit_price: Number(i.unit_price) || 0,
      })),
    );
    setQuery("");
    setResults([]);
  }, [open, order.id, order.items]);

  const searchProducts = async () => {
    const q = query.trim();
    if (q.length < 2) return toast.error("Digite ao menos 2 caracteres");
    setSearching(true);
    try {
      const { data, error } = await supabase
        .from("pos_products")
        .select("id, name, variant, size, sku, barcode, price, stock, pos_stores!inner(is_simulation)")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .eq("pos_stores.is_simulation", false)
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`)
        .order("name")
        .limit(40);
      if (error) throw error;
      setResults((data || []) as any);
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar produtos");
    } finally {
      setSearching(false);
    }
  };

  const addProduct = (p: ProdRow) => {
    setItems((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        id: null,
        product_name: p.name,
        variant_name: p.variant || null,
        size: p.size || null,
        sku: p.sku || null,
        barcode: p.barcode || null,
        quantity: 1,
        unit_price: Number(p.price) || 0,
      },
    ]);
    toast.success("Produto adicionado ao pedido");
  };

  const setQty = (key: string, qty: number) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, qty || 1) } : i)));

  const setPrice = (key: string, price: number) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, unit_price: Math.max(0, price || 0) } : i)));

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const total = Math.max(subtotal - Number(order.discount || 0), 0) + Number(order.shipping_cost || 0);

  const save = async () => {
    if (!items.length) return toast.error("O pedido precisa ter ao menos um produto");
    setSaving(true);
    try {
      const { error } = await supabase.rpc("expedition_update_sale_items" as any, {
        p_sale_id: order.id,
        p_items: items.map((i) => ({
          id: i.id,
          product_name: i.product_name,
          variant_name: i.variant_name,
          size: i.size,
          sku: i.sku,
          barcode: i.barcode,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
      if (error) throw error;
      toast.success("Produtos do pedido atualizados (estoque ajustado)");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar produtos do pedido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            <Package className="h-6 w-6 text-exp-prep" /> Editar produtos — {order.customer_name || "Pedido"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg border-2 border-dashed border-muted p-3">
            <Label className="font-black">Adicionar produto</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchProducts()}
                placeholder="Nome, SKU ou código de barras..."
              />
              <Button type="button" onClick={searchProducts} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {results.length > 0 && (
              <div className="mt-3 max-h-56 overflow-y-auto space-y-1">
                {results.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <div className="min-w-0">
                      <p className="font-bold truncate">{p.name}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {[p.variant, p.size && `Tam ${p.size}`, p.sku].filter(Boolean).join(" • ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={p.stock > 0 ? "secondary" : "destructive"}>Estoque {p.stock}</Badge>
                      <span className="font-black">{brl(p.price)}</span>
                      <Button size="sm" onClick={() => addProduct(p)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-black">Produtos do pedido</h3>
            {items.map((i) => (
              <div key={i.key} className="flex items-center gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{i.product_name}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {[i.variant_name, i.size && `Tam ${i.size}`, i.sku || i.barcode].filter(Boolean).join(" • ")}
                  </p>
                </div>
                <div className="w-20">
                  <Label className="text-xs">Qtd</Label>
                  <Input
                    type="number"
                    min={1}
                    value={i.quantity}
                    onChange={(e) => setQty(i.key, Number(e.target.value))}
                  />
                </div>
                <div className="w-28">
                  <Label className="text-xs">Preço</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={i.unit_price}
                    onChange={(e) => setPrice(i.key, Number(e.target.value))}
                  />
                </div>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeItem(i.key)}>
                  <Trash2 className="h-5 w-5" />
                </Button>
              </div>
            ))}
            {!items.length && <p className="text-muted-foreground">Nenhum produto no pedido.</p>}
          </div>

          <div className="rounded-lg bg-muted p-3 text-right space-y-1">
            <p className="font-semibold">Subtotal: {brl(subtotal)}</p>
            {Number(order.discount || 0) > 0 && <p className="font-semibold">Desconto: -{brl(Number(order.discount))}</p>}
            {Number(order.shipping_cost || 0) > 0 && <p className="font-semibold">Frete: {brl(Number(order.shipping_cost))}</p>}
            <p className="text-xl font-black">Total: {brl(total)}</p>
          </div>

          <p className="text-sm text-muted-foreground">
            Ao salvar, o estoque é ajustado automaticamente: produtos retirados voltam para a loja e produtos
            adicionados são baixados — tudo registrado no histórico de movimentação. Se a NF-e já tiver sido emitida,
            cancele e emita novamente após a alteração.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving} className="bg-exp-prep hover:bg-exp-prep/90 text-white font-black">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              SALVAR PRODUTOS
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExpItemsEditDialog;

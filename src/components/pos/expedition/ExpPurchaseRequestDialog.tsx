import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ShoppingCart } from "lucide-react";

export interface PurchaseTarget {
  product_name: string;
  variant_name: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  suggestedQty: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storeId: string;
  target: PurchaseTarget | null;
  onDone?: () => void;
}

export function ExpPurchaseRequestDialog({ open, onOpenChange, storeId, target, onDone }: Props) {
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("0");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    setQty(String(Math.max(1, target.suggestedQty || 1)));
    setNotes("");
    setCost("0");
    (async () => {
      const code = (target.barcode || "").trim() || (target.sku || "").trim();
      if (!code) return;
      try {
        const { data } = await supabase
          .from("pos_products")
          .select("cost_price, barcode, sku")
          .or(`barcode.eq.${code},sku.eq.${code}`)
          .limit(5);
        const found = (data || []).find((p: any) => Number(p.cost_price) > 0);
        if (found) setCost(String(Number((found as any).cost_price)));
      } catch {
        /* custo é opcional */
      }
    })();
  }, [open, target]);

  const confirm = async () => {
    if (!target) return;
    const q = Math.max(1, Math.floor(Number(qty) || 0));
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("pos_purchase_requests").insert({
        store_id: storeId || null,
        product_name: target.product_name,
        variant_name: target.variant_name,
        size: target.size,
        sku: target.sku,
        barcode: target.barcode,
        quantity: q,
        cost_price: Number(cost) || 0,
        notes: notes.trim() || null,
        requested_by: auth?.user?.id ?? null,
        requested_by_name:
          (auth?.user?.user_metadata as any)?.full_name || auth?.user?.email || null,
        status: "pending",
      });
      if (error) throw error;
      toast.success("Produto adicionado à lista de solicitação de compra");
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      toast.error(e.message || "Erro ao solicitar compra");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> Solicitar compra
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-base font-bold text-pos-text">{target?.product_name}</p>
          <p className="text-sm font-semibold text-pos-muted-text">
            {[target?.variant_name, target?.size && `Tam ${target?.size}`, target?.sku, target?.barcode]
              .filter(Boolean)
              .join(" • ")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Pares a comprar</Label>
              <Input
                type="number"
                min={1}
                value={qty}
                autoFocus
                onChange={(e) => setQty(e.target.value)}
                className="h-12 text-lg font-bold"
              />
            </div>
            <div>
              <Label>Custo unitário (R$)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="h-12 text-lg font-bold"
              />
            </div>
          </div>
          <div>
            <Label>Observação (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fornecedor, urgência..." />
          </div>
          <Button className="w-full h-12 font-black" onClick={confirm} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} CONFIRMAR
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExpPurchaseRequestDialog;

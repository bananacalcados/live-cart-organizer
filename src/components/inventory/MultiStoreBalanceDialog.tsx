import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Store as StoreIcon, Scale } from "lucide-react";

export interface BalanceStoreRow {
  productId: string;
  storeId: string;
  storeName: string;
  currentStock: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productName: string;
  variationLabel: string;
  rows: BalanceStoreRow[];
  /** Recebe os saldos aplicados para atualização local (sem recarregar a lista). */
  onDone: (applied: { productId: string; stock: number }[]) => void;
}

/** Balanço de todas as lojas de uma variação (cor + tamanho) de uma só vez. */
export function MultiStoreBalanceDialog({ open, onOpenChange, productName, variationLabel, rows, onDone }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    for (const r of rows) init[r.productId] = String(r.currentStock);
    setValues(init);
    setReason("");
  }, [open, rows]);

  const newTotal = rows.reduce((sum, r) => {
    const n = Number(values[r.productId]);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const currentTotal = rows.reduce((sum, r) => sum + r.currentStock, 0);

  const submit = async () => {
    const changed = rows.filter((r) => {
      const n = Number(values[r.productId]);
      return Number.isFinite(n) && n >= 0 && n !== r.currentStock;
    });
    if (changed.length === 0) {
      toast.info("Nenhum saldo alterado");
      return;
    }
    setBusy(true);
    try {
      let ok = 0;
      for (const r of changed) {
        const qty = Number(values[r.productId]);
        const { data, error } = await supabase.functions.invoke("pos-stock-movement", {
          body: {
            product_id: r.productId,
            movement_type: "balanco",
            quantity: qty,
            reason: reason || "Balanço multi-loja (Catálogo Unificado)",
          },
        });
        if (error) throw new Error(error.message);
        if (!(data as any)?.success) throw new Error((data as any)?.error || `Falha em ${r.storeName}`);
        ok++;
      }
      toast.success(`Balanço aplicado em ${ok} loja(s). Novo total: ${newTotal}`);
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro no balanço: " + e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Balanço de todas as lojas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="font-semibold text-sm">{productName}</p>
            <p className="text-xs text-muted-foreground">{variationLabel}</p>
          </div>

          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.productId} className="flex items-center gap-2">
                <Label className="flex-1 flex items-center gap-1 text-xs">
                  <StoreIcon className="h-3 w-3" />
                  {r.storeName}
                  <span className="text-muted-foreground">(atual: {r.currentStock})</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  className="w-24 h-10 text-right font-bold"
                  value={values[r.productId] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [r.productId]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm border-t pt-2">
            <span className="text-muted-foreground">Total atual: <b>{currentTotal}</b></span>
            <span>Novo total: <b className="text-base">{newTotal}</b></span>
          </div>

          <div>
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" placeholder="Ex: contagem física" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Aplicar balanço
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MultiStoreBalanceDialog;

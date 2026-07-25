import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Store } from "lucide-react";

export interface StockRow {
  product_id: string;
  store_id: string;
  store: string;
  stock: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  rows: StockRow[];
  onDone: () => void;
}

type MoveType = "entrada" | "saida" | "balanco" | "transferencia";

/** Ajuste real de estoque (grava em pos_products via edge functions) a partir da Separação. */
export function ExpStockAdjustDialog({ open, onOpenChange, title, rows, onDone }: Props) {
  const [productId, setProductId] = useState("");
  const [moveType, setMoveType] = useState<MoveType>("entrada");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [destStoreId, setDestStoreId] = useState("");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProductId(rows[0]?.product_id || "");
    setMoveType("entrada");
    setQty("");
    setReason("");
    setDestStoreId("");
    supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_simulation", false)
      .order("name")
      .then(({ data }) => setStores((data as any[]) || []));
  }, [open, rows]);

  const current = useMemo(() => rows.find((r) => r.product_id === productId), [rows, productId]);

  const submit = async () => {
    if (!current) {
      toast.error("Selecione a loja de origem");
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q < 0) {
      toast.error("Quantidade inválida");
      return;
    }
    if (moveType !== "balanco" && q <= 0) {
      toast.error("Quantidade deve ser maior que zero");
      return;
    }
    setBusy(true);
    try {
      if (moveType === "transferencia") {
        if (!destStoreId) throw new Error("Escolha a loja destino");
        const { data, error } = await supabase.functions.invoke("pos-stock-transfer", {
          body: { source_product_id: current.product_id, dest_store_id: destStoreId, quantity: q, reason: reason || "Transferência via Expedição" },
        });
        if (error) throw new Error(error.message);
        if (!data?.success) throw new Error(data?.error || "Falha ao transferir");
        toast.success(`Transferido: ${data.source.store_name} (${data.source.new_stock}) → ${data.dest.store_name} (${data.dest.new_stock})`);
      } else {
        const { data, error } = await supabase.functions.invoke("pos-stock-movement", {
          body: { product_id: current.product_id, movement_type: moveType, quantity: q, reason: reason || `${moveType} via Expedição` },
        });
        if (error) throw new Error(error.message);
        if (!data?.success) throw new Error(data?.error || "Falha na movimentação");
        toast.success(`Estoque: ${data.previous_stock} → ${data.new_stock}`);
      }
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro: " + e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Ajustar estoque</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-base font-bold text-pos-text">{title}</p>

          <div>
            <Label>Loja (origem)</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="h-11 font-bold">
                <SelectValue placeholder="Selecione a loja" />
              </SelectTrigger>
              <SelectContent>
                {rows.map((r) => (
                  <SelectItem key={r.product_id} value={r.product_id}>
                    <span className="inline-flex items-center gap-2">
                      <Store className="h-3 w-3" /> {r.store}: {r.stock}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Tipo de movimentação</Label>
            <Select value={moveType} onValueChange={(v) => setMoveType(v as MoveType)}>
              <SelectTrigger className="h-11 font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="entrada">ENTRADA</SelectItem>
                <SelectItem value="saida">SAÍDA</SelectItem>
                <SelectItem value="balanco">BALANÇO (define o total)</SelectItem>
                <SelectItem value="transferencia">TRANSFERÊNCIA</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {moveType === "transferencia" && (
            <div>
              <Label>Loja destino</Label>
              <Select value={destStoreId} onValueChange={setDestStoreId}>
                <SelectTrigger className="h-11 font-bold">
                  <SelectValue placeholder="Selecione o destino" />
                </SelectTrigger>
                <SelectContent>
                  {stores
                    .filter((s) => s.id !== current?.store_id)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>{moveType === "balanco" ? "Estoque contado (total)" : "Quantidade"}</Label>
            <Input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-12 text-lg font-bold"
            />
          </div>

          <div>
            <Label>Motivo {moveType === "balanco" ? "(obrigatório)" : "(opcional)"}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-11" />
          </div>

          <Button className="w-full h-12 font-black bg-exp-pick text-white" disabled={busy} onClick={submit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} CONFIRMAR
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExpStockAdjustDialog;

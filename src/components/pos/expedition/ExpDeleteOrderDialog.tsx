import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2, AlertTriangle } from "lucide-react";
import { ExpOrder, brl } from "./expeditionTypes";

interface Props {
  order: ExpOrder | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}

/**
 * Exclusão (estorno) de pedido da Expedição.
 * Não apaga o histórico: a venda é CANCELADA (sai de todas as etapas) e,
 * opcionalmente, os produtos voltam ao estoque com registro de movimentação.
 */
export function ExpDeleteOrderDialog({ order, open, onOpenChange, onDeleted }: Props) {
  const [reason, setReason] = useState("");
  const [restoreStock, setRestoreStock] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!order) return null;

  const ids = order.group_order_ids?.length ? order.group_order_ids : [order.id];

  const run = async () => {
    setBusy(true);
    try {
      for (const id of ids) {
        const { error } = await supabase.rpc("expedition_cancel_sale" as any, {
          p_sale_id: id,
          p_reason: reason.trim() || null,
          p_restore_stock: restoreStock,
        });
        if (error) throw error;
      }
      toast.success(
        ids.length > 1 ? `${ids.length} pedidos excluídos da expedição` : "Pedido excluído da expedição",
      );
      setReason("");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message || "Erro ao excluir pedido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" /> Excluir pedido da expedição
          </DialogTitle>
          <DialogDescription className="text-base font-semibold">
            {order.customer_name || "Sem nome"} · {brl(order.total)}
            {ids.length > 1 ? ` · ${ids.length} pedidos unificados` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border-2 border-destructive/40 bg-destructive/10 p-3 text-sm font-semibold">
            A venda será <b>cancelada</b> e sai de todas as etapas da expedição. O histórico é
            preservado (nada é apagado do banco).
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox checked={restoreStock} onCheckedChange={(v) => setRestoreStock(!!v)} />
            <span className="text-base font-bold">Devolver produtos ao estoque</span>
          </label>

          <div className="space-y-1">
            <Label className="text-base font-bold">Motivo (opcional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: cliente desistiu / venda estornada"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="destructive" className="font-black" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin mr-1" /> : <Trash2 className="h-5 w-5 mr-1" />}
            EXCLUIR PEDIDO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

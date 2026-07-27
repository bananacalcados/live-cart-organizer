import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BadgeCheck, Loader2 } from "lucide-react";
import { MANUAL_PAYMENT_METHODS } from "@/components/MarkOrderPaidDialog";
import type { ExpOrder } from "./expeditionTypes";
import { brl } from "./expeditionTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: ExpOrder | null;
  onDone?: () => void;
}

/**
 * Confirma o recebimento do pagamento na entrega (mototaxista).
 * Quita a venda no PDV e, quando existe pedido de origem, também o pedido do CRM.
 */
export function ExpDeliveryPaymentDialog({ open, onOpenChange, order, onDone }: Props) {
  const [method, setMethod] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const chosen = method || order?.expected_payment_method || "Dinheiro";

  const handleConfirm = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const ids = order.group_order_ids?.length ? order.group_order_ids : [order.id];

      const { error } = await supabase
        .from("pos_sales")
        .update({
          status: "paid",
          paid_at: now,
          payment_method: chosen,
          payment_on_delivery: false,
          delivery_payment_received_at: now,
          delivery_payment_method: chosen,
        } as any)
        .in("id", ids);
      if (error) throw error;

      const { data: sales } = await supabase
        .from("pos_sales")
        .select("source_order_id")
        .in("id", ids);
      const orderIds = ((sales || []) as any[]).map((s) => s.source_order_id).filter(Boolean);
      if (orderIds.length) {
        await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_externally: true,
            paid_at: now,
            payment_method_label: chosen,
            payment_on_delivery: false,
          } as any)
          .in("id", orderIds);
      }

      toast.success(`Pagamento na entrega recebido (${chosen}).`);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível registrar o pagamento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-exp-done" />
            Recebido na entrega
          </DialogTitle>
          <DialogDescription>
            {order?.customer_name || "Cliente"} · {brl(order?.total)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Como o valor foi recebido?</Label>
            <Select value={chosen} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {order?.expected_payment_method && (
            <p className="text-[11px] text-muted-foreground">
              Previsto no pedido: <strong>{order.expected_payment_method}</strong>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
            Confirmar recebimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

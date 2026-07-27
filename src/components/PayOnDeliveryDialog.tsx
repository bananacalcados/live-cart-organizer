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
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { Bike, Loader2 } from "lucide-react";
import { MANUAL_PAYMENT_METHODS } from "./MarkOrderPaidDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  customerLabel?: string | null;
  total?: number;
}

/**
 * Libera o pedido para a Expedição SEM marcá-lo como pago.
 * O pagamento será recebido pelo mototaxista no ato da entrega.
 */
export function PayOnDeliveryDialog({ open, onOpenChange, orderId, customerLabel, total }: Props) {
  const { updateOrder } = useDbOrderStore();
  const [method, setMethod] = useState<string>("Dinheiro");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await updateOrder(orderId, {
        payment_on_delivery: true,
        expected_payment_method: method,
        release_to_expedition: true,
      } as any);
      toast.success("Pedido liberado para a Expedição como PAGAMENTO NA ENTREGA.");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível liberar o pedido para a Expedição.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bike className="h-4 w-4 text-stage-awaiting-mototaxi" />
            Pagar na entrega
          </DialogTitle>
          <DialogDescription>
            {customerLabel ? `${customerLabel} · ` : ""}
            {typeof total === "number"
              ? total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : "O mototaxista recebe no ato da entrega."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Forma de pagamento prevista</Label>
            <Select value={method} onValueChange={setMethod}>
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

          <p className="text-[11px] text-muted-foreground">
            O pedido NÃO é marcado como pago e não entra no faturamento. Ele vai para a Expedição
            com o aviso "PAGAMENTO NA ENTREGA" e só é quitado quando o valor for recebido.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bike className="h-4 w-4" />}
            Liberar para Expedição
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

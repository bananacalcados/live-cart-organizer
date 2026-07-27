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
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * Formas de pagamento aceitas no PDV. O `label` é gravado em
 * `orders.payment_method_label` e propagado para `pos_sales.payment_method`
 * pela rotina de roteamento (usado depois na emissão da NF-e).
 */
export const MANUAL_PAYMENT_METHODS: { value: string; label: string; installments?: boolean }[] = [
  { value: "PIX", label: "PIX" },
  { value: "Dinheiro", label: "Dinheiro" },
  { value: "Cartão de Débito", label: "Cartão de Débito" },
  { value: "Cartão de Crédito à vista", label: "Cartão de Crédito à vista" },
  { value: "Cartão de Crédito parcelado", label: "Cartão de Crédito parcelado", installments: true },
  { value: "VPS", label: "VPS" },
  { value: "Boleto", label: "Boleto" },
  { value: "Crediário", label: "Crediário", installments: true },
  { value: "Cashback", label: "Cashback" },
  { value: "Cheque", label: "Cheque" },
  { value: "Transferência / TED", label: "Transferência / TED" },
  { value: "Link de pagamento", label: "Link de pagamento" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  customerLabel?: string | null;
  total?: number;
}

export function MarkOrderPaidDialog({ open, onOpenChange, orderId, customerLabel, total }: Props) {
  const { updateOrder } = useDbOrderStore();
  const [method, setMethod] = useState<string>("PIX");
  const [installments, setInstallments] = useState<string>("2");
  const [saving, setSaving] = useState(false);

  const selected = MANUAL_PAYMENT_METHODS.find((m) => m.value === method);
  const needsInstallments = !!selected?.installments;

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const inst = needsInstallments ? Math.max(2, Number(installments) || 2) : 1;
      const label = needsInstallments ? `${method} ${inst}x` : method;

      await updateOrder(orderId, {
        is_paid: true,
        paid_externally: true,
        paid_at: new Date().toISOString(),
        stage: "paid",
        payment_method_label: label,
        installments: inst,
        payment_confirmed_source: "manual",
      } as any);

      toast.success(`Pedido marcado como pago (${label}) — enviado à Expedição.`);
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível marcar o pedido como pago.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-stage-paid" />
            Marcar pedido como PAGO
          </DialogTitle>
          <DialogDescription>
            {customerLabel ? `${customerLabel} · ` : ""}
            {typeof total === "number"
              ? total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : "Informe como o pagamento foi recebido."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Forma de pagamento</Label>
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

          {needsInstallments && (
            <div className="space-y-2">
              <Label>Parcelas</Label>
              <Select value={installments} onValueChange={setInstallments}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            A forma de pagamento vai junto para a Expedição do PDV e é usada na emissão da NF-e.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

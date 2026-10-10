import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  orderId: string;
  config: Record<string, any> | null;
  onSaved: (config: Record<string, any> | null) => void;
}

/**
 * Pré-seleciona as parcelas que já aparecem marcadas no link de pagamento.
 * Guardado em orders.checkout_installment_config.preselected_installments —
 * não altera a regra de parcelamento do link (teto/sem juros).
 */
export function LiveInstallmentPreselect({ orderId, config, onSaved }: Props) {
  const current = Number(config?.preselected_installments) || 0;
  const [saving, setSaving] = useState(false);

  const save = async (value: number) => {
    setSaving(true);
    const next: Record<string, any> = { ...(config || {}) };
    if (value > 0) next.preselected_installments = value;
    else delete next.preselected_installments;
    const payload = Object.keys(next).length ? next : null;
    const { error } = await supabase.from("orders").update({ checkout_installment_config: payload } as any).eq("id", orderId);
    setSaving(false);
    if (error) {
      toast.error("Não consegui salvar as parcelas");
      return;
    }
    onSaved(payload);
    toast.success(value > 0 ? `Link vai abrir com ${value}x selecionado` : "Pré-seleção removida");
  };

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border bg-background p-2">
      <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-xs font-semibold">Parcelas no link:</span>
      <select
        value={current}
        disabled={saving}
        onChange={(e) => void save(Number(e.target.value))}
        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value={0}>Cliente escolhe</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{n === 1 ? "1x (à vista)" : `${n}x`}</option>
        ))}
      </select>
      {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  orderId: string;
  value: number | null;
  onSaved?: (value: number | null) => void;
}

/** Parcelas que o link de pagamento já abre selecionadas (orders.preselected_installments). */
export function LiveInstallmentPreselect({ orderId, value, onSaved }: Props) {
  const [current, setCurrent] = useState<number>(Number(value) || 0);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCurrent(Number(value) || 0); }, [value]);

  const save = async (next: number) => {
    const prev = current;
    setCurrent(next);
    setSaving(true);
    const { error } = await supabase.from("orders").update({ preselected_installments: next > 0 ? next : null } as any).eq("id", orderId);
    setSaving(false);
    if (error) {
      console.error("[LiveInstallmentPreselect]", error);
      setCurrent(prev);
      toast.error("Não consegui salvar as parcelas");
      return;
    }
    onSaved?.(next > 0 ? next : null);
    toast.success(next > 0 ? `Link vai abrir com ${next}x selecionado` : "Pré-seleção removida");
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

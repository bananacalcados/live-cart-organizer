import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "sedex", label: "SEDEX", active: "bg-orange-500 text-white border-orange-500" },
  { value: "correios", label: "Correios", active: "bg-sky-600 text-white border-sky-600" },
  { value: "transportadora", label: "Transportadora", active: "bg-purple-600 text-white border-purple-600" },
] as const;

type ShippingType = (typeof OPTIONS)[number]["value"];

/**
 * Marcação de tipo de envio (SEDEX / Correios / Transportadora) de uma venda
 * do PDV (pos_sales). O trigger do banco propaga para a aba Expedição.
 * Clicar no tipo ativo desmarca.
 */
export function ShippingTypeButtons({ saleId }: { saleId: string }) {
  const [current, setCurrent] = useState<ShippingType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("pos_sales")
        .select("shipping_type")
        .eq("id", saleId)
        .maybeSingle();
      if (!cancelled) setCurrent((data?.shipping_type as ShippingType) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const mark = async (value: ShippingType | null) => {
    if (saving) return;
    setSaving(true);
    const prev = current;
    setCurrent(value);
    const { error } = await (supabase as any)
      .from("pos_sales")
      .update({ shipping_type: value })
      .eq("id", saleId);
    if (error) {
      setCurrent(prev);
      toast.error("Não foi possível marcar o tipo de envio");
    } else {
      // Espelha no pedido da live (orders), quando houver vínculo
      await (supabase as any)
        .from("orders")
        .update({ shipping_type: value })
        .eq("pos_sale_id", saleId);
      toast.success(
        value
          ? `Envio marcado: ${OPTIONS.find((o) => o.value === value)?.label} — já atualizado na Expedição`
          : "Marcação de envio removida",
      );
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <span className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Truck className="h-4 w-4" /> Tipo de envio:
      </span>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={saving}
          onClick={() => mark(current === opt.value ? null : opt.value)}
          title={current === opt.value ? "Clique para desmarcar" : `Marcar envio como ${opt.label}`}
          className={cn(
            "rounded-lg border-2 px-4 py-1.5 text-sm font-bold transition-colors disabled:opacity-50",
            current === opt.value
              ? opt.active
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

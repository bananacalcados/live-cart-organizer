import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Truck, Loader2 } from "lucide-react";

interface Props {
  /** Quando informado, mostra apenas os custos daquela loja. */
  storeId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  periodLabel?: string;
}

interface Row {
  amount: number;
  status: string;
  provider_type: string;
  notes: string | null;
}

const brl = (v: number) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

/** Card de custos de entrega/envio (mototáxi + transportadoras) por período. */
export function DeliveryCostsCard({ storeId, periodStart, periodEnd, periodLabel }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let q = supabase
          .from("delivery_costs" as any)
          .select("amount, status, provider_type, notes")
          .gte("created_at", periodStart.toISOString())
          .lte("created_at", periodEnd.toISOString());
        if (storeId) q = q.eq("store_id", storeId);
        const { data } = await q;
        if (!cancelled) setRows(((data as any) || []) as Row[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, periodStart.getTime(), periodEnd.getTime()]);

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const pending = rows.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.amount || 0), 0);
  const moto = rows.filter((r) => r.provider_type === "mototaxi").reduce((s, r) => s + Number(r.amount || 0), 0);
  const carrier = total - moto;

  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-center gap-2">
        <Truck className="h-5 w-5 text-emerald-400" />
        <h3 className="text-lg font-black text-zinc-100 uppercase">Custos de entrega/envio</h3>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>
      <p className="text-sm font-semibold text-zinc-400">{periodLabel || "Período selecionado"}</p>
      <p className="mt-2 text-3xl font-black text-zinc-50">{brl(total)}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-800/70 p-2">
          <p className="text-xs font-bold text-zinc-400 uppercase">Mototáxi</p>
          <p className="text-base font-black text-zinc-100">{brl(moto)}</p>
        </div>
        <div className="rounded-lg bg-zinc-800/70 p-2">
          <p className="text-xs font-bold text-zinc-400 uppercase">Transportadora</p>
          <p className="text-base font-black text-zinc-100">{brl(carrier)}</p>
        </div>
        <div className="rounded-lg bg-zinc-800/70 p-2">
          <p className="text-xs font-bold text-zinc-400 uppercase">A pagar</p>
          <p className="text-base font-black text-amber-400">{brl(pending)}</p>
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold text-zinc-400">
        {rows.length} lançamento(s) de envio no período
      </p>
    </div>

  );
}

export default DeliveryCostsCard;

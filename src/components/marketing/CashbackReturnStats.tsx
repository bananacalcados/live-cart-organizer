import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";

type Stats = { used_count: number; customers_used: number; customers_returned: number; return_sales: number; return_revenue: number };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Quantas clientes voltaram a comprar depois de usar um cashback. */
export function CashbackReturnStats() {
  const [days, setDays] = useState(90);
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    supabase.rpc("cashback_return_stats" as any, { p_days: days }).then(({ data }) => {
      const r = (data as any[])?.[0];
      setS(r ? { used_count: +r.used_count, customers_used: +r.customers_used, customers_returned: +r.customers_returned, return_sales: +r.return_sales, return_revenue: +r.return_revenue } : null);
    });
  }, [days]);

  const pct = s && s.customers_used ? Math.round((s.customers_returned / s.customers_used) * 100) : 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 text-xs justify-start">
          <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Voltaram após cashback: {s ? `${s.customers_returned}/${s.customers_used}` : "…"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs space-y-2">
        <div className="flex gap-1">
          {[30, 60, 90, 180, 365].map((d) => (
            <Button key={d} size="sm" variant={d === days ? "default" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => setDays(d)}>{d}d</Button>
          ))}
        </div>
        {s && (
          <div className="space-y-1">
            <p>Cashbacks usados: <b>{s.used_count}</b></p>
            <p>Clientes que usaram: <b>{s.customers_used}</b></p>
            <p>Voltaram a comprar depois: <b>{s.customers_returned}</b> ({pct}%)</p>
            <p>Compras de retorno: <b>{s.return_sales}</b> · {brl(s.return_revenue)}</p>
            <p className="text-muted-foreground">Conta compras feitas depois do uso do cashback, em todos os canais, pelo telefone.</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

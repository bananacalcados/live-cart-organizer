import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Repeat } from "lucide-react";

interface R {
  total: number; n1: number; rev1: number; n2: number; rev2: number; n3: number; rev3: number;
  target: number; rep_any: number; rep_live: number; rep_any_60: number; rep_live_60: number;
  event_age_days: number | null;
}

const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function EventLiveRepurchase({ eventId }: { eventId: string }) {
  const [prior, setPrior] = useState(false);
  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase
      .rpc("event_live_repurchase" as any, { p_event_id: eventId, p_only_prior_customers: prior })
      .then(({ data }) => { if (alive) { setData(data as any); setLoading(false); } });
    return () => { alive = false; };
  }, [eventId, prior]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Repeat className="h-4 w-4 text-primary" /> Recompra desta live
        </h3>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={prior} onCheckedChange={setPrior} />
          1ª compra em live · já era cliente fora da live
        </label>
      </div>
      {loading || !data ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Calculando...</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[["1ª compra", data.n1, data.rev1], ["2ª compra", data.n2, data.rev2], ["3ª+ compra", data.n3, data.rev3]].map(([l, n, r]) => (
              <div key={l as string} className="rounded-lg border p-2.5">
                <p className="text-[10px] text-muted-foreground">{l}</p>
                <p className="text-xl font-bold leading-tight">{n as number}</p>
                <p className="text-[10px] text-muted-foreground">{pct(n as number, data.total)}% · {brl(r as number)}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-secondary/40 p-3 text-xs space-y-1">
            <p className="text-muted-foreground">
              {prior ? "Destes compradores" : "Dos compradores de 1ª compra"} ({data.target}):
            </p>
            <p>Compraram de novo até hoje: <b>{data.rep_any}</b> ({pct(data.rep_any, data.target)}%) · em live: <b>{data.rep_live}</b> ({pct(data.rep_live, data.target)}%)</p>
            {(data.event_age_days ?? 0) > 60 && (
              <p>Em 60 dias: <b>{data.rep_any_60}</b> ({pct(data.rep_any_60, data.target)}%) · em live: <b>{data.rep_live_60}</b> ({pct(data.rep_live_60, data.target)}%)</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

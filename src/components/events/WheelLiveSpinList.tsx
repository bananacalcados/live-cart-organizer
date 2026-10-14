import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Radio } from "lucide-react";
import { toast } from "sonner";

interface Row {
  phone: string;
  handle: string | null;
  paid_total: number;
  first_paid_minutes: number | null;
  spins_used: number;
  prizes: string[];
  can_spin: boolean;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mask = (p: string) => p.replace(/\D/g, "").replace(/^(\d{4})\d+(\d{4})$/, "$1•••$2");

async function readError(error: any) {
  try { const b = await error?.context?.json?.(); if (b?.error) return String(b.error); } catch { /* ignora */ }
  return error?.message || "Erro";
}

/** Lista de quem pode girar a roleta + giro ao vivo (aparece no Overlay). Carrega só ao clicar. */
export function WheelLiveSpinList({ wheelId }: { wheelId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("event-prize-wheel", { body: { action: "eligible_list", wheel_id: wheelId } });
    setLoading(false);
    if (error || !data?.ok) { toast.error(error ? await readError(error) : data?.error || "Erro ao carregar"); return; }
    setRows(data.list || []);
  };

  const spin = async (r: Row) => {
    setBusy(r.phone);
    const { data, error } = await supabase.functions.invoke("event-prize-wheel", {
      body: { action: "staff_spin", wheel_id: wheelId, phone: r.phone, handle: r.handle, name: r.handle },
    });
    setBusy(null);
    if (error || !data?.ok) { toast.error(error ? await readError(error) : data?.error || "Não foi possível girar"); return; }
    toast.success(`@${r.handle || "cliente"} ganhou: ${data.prize?.label}`);
    setRows((prev) => (prev || []).map((x) => x.phone !== r.phone ? x : {
      ...x, spins_used: x.spins_used + 1, prizes: [...x.prizes, data.prize?.label], can_spin: false,
    }));
    load();
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-1"><Radio className="h-4 w-4" /> Girar ao vivo (aparece no Overlay)</p>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {rows ? "Atualizar lista" : "Ver quem pode girar"}
        </Button>
      </div>
      {rows && rows.length === 0 && <p className="text-xs text-muted-foreground">Ninguém se encaixa na regra desta roleta ainda.</p>}
      {rows && rows.length > 0 && (
        <div className="max-h-80 overflow-y-auto divide-y">
          {rows.map((r) => (
            <div key={r.phone} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-semibold truncate">@{r.handle || "sem @"} <span className="text-xs font-normal text-muted-foreground">{mask(r.phone)}</span></p>
                <p className="text-xs text-muted-foreground">
                  Pagou {brl(r.paid_total)}{r.first_paid_minutes !== null ? ` · 1º pedido pago em ${r.first_paid_minutes} min` : ""}
                </p>
                {r.prizes.length > 0 && <p className="text-xs">Ganhou: {r.prizes.join(", ")}</p>}
              </div>
              {r.can_spin ? (
                <Button size="sm" onClick={() => spin(r)} disabled={!!busy}>
                  {busy === r.phone ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🎰 Girar ao vivo"}
                </Button>
              ) : <Badge variant="secondary">Já girou</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

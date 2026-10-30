import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Alert {
  id: string;
  group_name: string | null;
  message: string;
  created_at: string;
}

/**
 * Alertas de troca de instância responsável pelos grupos (pendentes de "ciente").
 * Uma consulta ao abrir (até 50) e recarga a cada 60 s só com a aba visível.
 */
export function GroupResponsibleAlerts({ compact = false, onChange }: { compact?: boolean; onChange?: () => void }) {
  const [rows, setRows] = useState<Alert[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [offline, setOffline] = useState<{id: string; label: string; groups: number}[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("whatsapp_group_responsible_alerts")
      .select("id, group_name, message, created_at")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    const next = (data || []) as Alert[];
    setRows(prev => (prev.length === next.length && prev.every((r, i) => r.id === next[i].id) ? prev : next));
    const { data: waiting } = await supabase.rpc("group_send_offline_summary", { p_limit: 50, p_offset: 0 });
    const summary = (waiting || []) as unknown as {id: string; label: string; groups: number}[];
    setOffline(prev => JSON.stringify(prev) === JSON.stringify(summary) ? prev : summary);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const ack = async (id: string) => {
    setBusy(id);
    const { error } = await (supabase.rpc as any)("ack_group_responsible_alert", { p_id: id });
    setBusy(null);
    if (error) { toast.error("Não foi possível marcar como ciente"); return; }
    setRows(prev => prev.filter(r => r.id !== id));
    onChange?.();
  };

  if (rows.length === 0 && offline.length === 0) return compact ? null : (
    <p className="text-sm text-muted-foreground">Nenhum alerta de troca de responsável pendente.</p>
  );

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ArrowLeftRight className="h-4 w-4" />
        Alertas dos grupos ({rows.length})
      </div>
      {offline.map(n => <p key={n.id} className="text-sm font-medium">{n.label} desconectada — {n.groups} grupos aguardando</p>)}
      {rows.map(a => (
        <div key={a.id} className="flex items-start justify-between gap-2 text-sm">
          <div>
            <p>{a.message}</p>
            <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("pt-BR")}</p>
          </div>
          <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => ack(a.id)}>
            {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Ciente
          </Button>
        </div>
      ))}
    </div>
  );
}

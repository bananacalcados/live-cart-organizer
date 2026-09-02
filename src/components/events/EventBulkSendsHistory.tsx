import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, RotateCcw, XCircle, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BulkSend {
  id: string;
  kind: string;
  template_name: string;
  template_label: string | null;
  stages: string[];
  status: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_by_name: string | null;
  created_at: string;
}
interface BulkItem {
  id: string;
  phone: string;
  customer_name: string | null;
  status: string;
  reason: string | null;
  sent_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "na fila", processing: "enviando", done: "concluído", cancelled: "cancelado",
  pending: "pendente", sent: "enviado", failed: "falhou", skipped: "ignorado",
};

export function EventBulkSendsHistory({ eventId, onNew }: { eventId: string; onNew?: () => void }) {
  const [sends, setSends] = useState<BulkSend[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<BulkSend | null>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("event_bulk_sends")
      .select("id,kind,template_name,template_label,stages,status,total_count,sent_count,failed_count,skipped_count,created_by_name,created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(50);
    setSends((data || []) as BulkSend[]);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: contadores do disparo
  useEffect(() => {
    const ch = supabase
      .channel(`bulk-sends-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_bulk_sends", filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId, load]);

  const loadItems = useCallback(async (sendId: string) => {
    const { data } = await supabase
      .from("event_bulk_send_items")
      .select("id,phone,customer_name,status,reason,sent_at")
      .eq("send_id", sendId)
      .order("created_at");
    setItems((data || []) as BulkItem[]);
  }, []);

  useEffect(() => {
    if (!detail) return;
    loadItems(detail.id);
    const ch = supabase
      .channel(`bulk-items-${detail.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_bulk_send_items", filter: `send_id=eq.${detail.id}` }, () => loadItems(detail.id))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [detail, loadItems]);

  const cancel = async (s: BulkSend) => {
    setBusy(s.id);
    await supabase.from("event_bulk_sends").update({ status: "cancelled" }).eq("id", s.id);
    await supabase.from("event_bulk_send_items").update({ status: "skipped", reason: "disparo cancelado" }).eq("send_id", s.id).eq("status", "pending");
    await supabase.rpc("refresh_event_bulk_send_counts", { p_send_id: s.id });
    setBusy(null);
    toast.success("Disparo cancelado");
    load();
  };

  const retryFailed = async (s: BulkSend) => {
    setBusy(s.id);
    const { error } = await supabase
      .from("event_bulk_send_items")
      .update({ status: "pending", attempts: 0, locked_until: null, reason: null })
      .eq("send_id", s.id)
      .eq("status", "failed");
    if (error) toast.error("Erro ao reenfileirar", { description: error.message });
    else {
      await supabase.from("event_bulk_sends").update({ status: "processing" }).eq("id", s.id);
      await supabase.functions.invoke("event-bulk-send-worker", { body: { send_id: s.id } }).catch(() => {});
      toast.success("Falhas reenfileiradas");
    }
    setBusy(null);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Envios em massa</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-7" onClick={load}><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></Button>
          {onNew && <Button size="sm" className="h-7 text-xs" onClick={onNew}>Novo envio</Button>}
        </div>
      </div>

      {sends.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhum envio em massa neste evento ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {sends.map((s) => {
            const processed = s.sent_count + s.failed_count + s.skipped_count;
            const pct = s.total_count ? Math.round((processed / s.total_count) * 100) : 0;
            const running = s.status === "queued" || s.status === "processing";
            return (
              <li key={s.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {s.template_label || s.template_name}
                      <Badge variant="outline" className="ml-2 text-[10px]">{s.kind === "crossell" ? "Cross-sell" : "Template API"}</Badge>
                      <Badge variant={s.status === "done" ? "secondary" : running ? "default" : "destructive"} className="ml-1 text-[10px]">
                        {running && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}{STATUS_LABEL[s.status] || s.status}
                      </Badge>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(s.created_at).toLocaleString("pt-BR")} · {s.created_by_name || "—"} · etapas: {(s.stages || []).join(", ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDetail(s)}>Detalhes</Button>
                    {s.failed_count > 0 && !running && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy === s.id} onClick={() => retryFailed(s)}>
                        <RotateCcw className="h-3 w-3" /> Reenviar falhas
                      </Button>
                    )}
                    {running && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive" disabled={busy === s.id} onClick={() => cancel(s)}>
                        <XCircle className="h-3 w-3" /> Cancelar
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Progress value={pct} className="h-1.5 flex-1" />
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {s.sent_count} enviados · {s.failed_count} falhas · {s.skipped_count} ignorados / {s.total_count}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{detail?.template_label || detail?.template_name} — destinatários</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] rounded-md border border-border">
            <ul className="divide-y divide-border">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className={cn("h-2 w-2 rounded-full",
                    it.status === "sent" ? "bg-primary" : it.status === "failed" ? "bg-destructive" : it.status === "pending" ? "bg-muted-foreground animate-pulse" : "bg-muted-foreground/40")} />
                  <span className="min-w-0 flex-1 truncate">{it.customer_name || it.phone}</span>
                  <span className="text-muted-foreground">{it.phone}</span>
                  <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[it.status] || it.status}</Badge>
                  {it.reason && <span className="max-w-[220px] truncate text-[10px] text-muted-foreground" title={it.reason}>{it.reason}</span>}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

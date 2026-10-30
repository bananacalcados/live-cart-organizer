import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Pause, Play, XCircle, RotateCcw, ListChecks,
  Settings2, Smartphone, Clock, AlertTriangle, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AVG_GAP_SECONDS } from "@/lib/marketing/groupAdminQueue";
import { GroupResponsibleAlerts } from "./GroupResponsibleAlerts";

interface QueueAction {
  id: string;
  created_at: string;
  whatsapp_number_id: string;
  group_db_id: string | null;
  group_jid: string;
  group_name_snapshot: string | null;
  campaign_id: string | null;
  action_type: string;
  payload: Record<string, any>;
  status: string;
  not_before: string | null;
  finished_at: string | null;
  attempts: number;
  error_message: string | null;
  requested_by: string;
  batch: string | null;
  seq: number | null;
}

interface ThrottleRow {
  whatsapp_number_id: string;
  min_gap_seconds: number;
  max_gap_seconds: number;
  long_pause_every: number;
  long_pause_min_seconds: number;
  long_pause_max_seconds: number;
  max_per_hour: number;
  max_per_day: number;
  window_start: string;
  window_end: string;
  paused: boolean;
  paused_reason: string | null;
  consecutive_failures: number;
  last_action_at: string | null;
  next_allowed_at: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  rename: "Renomear",
  set_description: "Descrição",
  set_photo: "Foto",
  set_only_admins_send: "Só admins enviam",
  set_only_admins_add: "Só admins adicionam",
  pin_message: "Fixar mensagem",
  promote_admin: "Promover admin",
  demote_admin: "Rebaixar admin",
  add_participant: "Adicionar pessoa",
  remove_participant: "Remover pessoa",
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  queued: { label: "Na fila", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  running: { label: "Executando", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  done: { label: "Feita", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  failed: { label: "Falhou", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
  cancelled: { label: "Cancelada", cls: "bg-muted text-muted-foreground" },
  skipped: { label: "Pulada", cls: "bg-muted text-muted-foreground" },
};

function payloadSummary(a: QueueAction): string {
  const p = a.payload || {};
  switch (a.action_type) {
    case "rename": return `→ "${p.name}"`;
    case "set_description": return `→ "${String(p.description || "").slice(0, 60)}${String(p.description || "").length > 60 ? "…" : ""}"`;
    case "set_photo": return "→ nova foto";
    case "set_only_admins_send": return p.enabled ? "→ ativar" : "→ desativar";
    case "set_only_admins_add": return p.enabled ? "→ ativar" : "→ desativar";
    case "pin_message": return `→ "${String(p.text || "").slice(0, 60)}${String(p.text || "").length > 60 ? "…" : ""}"`;
    case "promote_admin": case "demote_admin": case "add_participant": case "remove_participant":
      return `→ ${p.phone || ""}`;
    default: return "";
  }
}

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

interface Props {
  campaignId?: string | null;
}

export function GroupActionsQueuePanel({ campaignId }: Props) {
  const [actions, setActions] = useState<QueueAction[]>([]);
  const [throttles, setThrottles] = useState<ThrottleRow[]>([]);
  const [instances, setInstances] = useState<{ id: string; label: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [instanceFilter, setInstanceFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");
  const [editingThrottle, setEditingThrottle] = useState<ThrottleRow | null>(null);
  const [isSavingThrottle, setIsSavingThrottle] = useState(false);
  const [hourCounts, setHourCounts] = useState<Record<string, number>>({});
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({});

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      let q = supabase
        .from("group_admin_actions" as any)
        .select("id, created_at, whatsapp_number_id, group_db_id, group_jid, group_name_snapshot, campaign_id, action_type, payload, status, not_before, finished_at, attempts, error_message, requested_by, batch, seq")
        .order("created_at", { ascending: false })
        .limit(200);
      if (campaignId) q = q.eq("campaign_id", campaignId);
      const { data, error } = await q;
      if (error) throw error;
      setActions((data || []) as unknown as QueueAction[]);

      const { data: th } = await supabase.from("group_admin_throttle" as any).select("whatsapp_number_id,min_gap_seconds,max_gap_seconds,long_pause_every,long_pause_min_seconds,long_pause_max_seconds,max_per_hour,max_per_day,window_start,window_end,paused,paused_reason,consecutive_failures,last_action_at,next_allowed_at").limit(200);
      setThrottles((th || []) as unknown as ThrottleRow[]);

      const { data: nums } = await supabase.from("whatsapp_numbers_safe").select("id, label").limit(200);
      setInstances((nums || []) as { id: string; label: string }[]);

      const { data: counts, error: countError } = await supabase.rpc("group_admin_queue_counts", { p_limit: 200, p_offset: 0 });
      if (countError) throw countError;
      const hc: Record<string, number> = {};
      const dc: Record<string, number> = {};
      (counts || []).forEach(r => { hc[r.whatsapp_number_id] = r.hour_count; dc[r.whatsapp_number_id] = r.day_count; });
      setHourCounts(hc);
      setDayCounts(dc);
    } catch (e) {
      toast.error("Erro ao carregar fila de ações");
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const batches = useMemo(() => [...new Set(actions.map(a => a.batch).filter(Boolean))] as string[], [actions]);

  const filtered = actions.filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (instanceFilter !== "all" && a.whatsapp_number_id !== instanceFilter) return false;
    if (batchFilter !== "all" && a.batch !== batchFilter) return false;
    return true;
  });

  const instanceLabel = (id: string) => instances.find(i => i.id === id)?.label || id.slice(0, 8);

  // Estimativa: posição na fila da instância × gap médio
  const estimateFor = (a: QueueAction): string => {
    if (a.status !== "queued") return "—";
    const ahead = actions.filter(x =>
      x.whatsapp_number_id === a.whatsapp_number_id && x.status === "queued" &&
      (x.created_at < a.created_at || (x.created_at === a.created_at && (x.seq ?? Infinity) < (a.seq ?? Infinity)))
    ).length;
    const th = throttles.find(t => t.whatsapp_number_id === a.whatsapp_number_id);
    const avg = th ? (th.min_gap_seconds + th.max_gap_seconds) / 2 : AVG_GAP_SECONDS;
    if (th?.paused) return "Fila pausada";
    const wait = Math.max(0, th?.next_allowed_at ? Date.parse(th.next_allowed_at) - Date.now() : 0, a.not_before ? Date.parse(a.not_before) - Date.now() : 0);
    const mins = Math.max(1, Math.ceil(((ahead + 1) * avg + wait / 1000) / 60));
    return `~${mins} min`;
  };

  const cancelAction = async (a: QueueAction) => {
    const { error } = await supabase.from("group_admin_actions" as any).update({ status: "cancelled", updated_at: new Date().toISOString() } as any).eq("id", a.id).eq("status", "queued");
    if (error) { toast.error("Erro ao cancelar"); return; }
    toast.success("Ação cancelada");
    fetchAll();
  };

  const requeueAction = async (a: QueueAction) => {
    const { error } = await supabase.from("group_admin_actions" as any)
      .update({ status: "queued", attempts: 0, not_before: null, error_message: null, finished_at: null, locked_until: null, updated_at: new Date().toISOString() } as any)
      .eq("id", a.id).eq("status", "failed");
    if (error) { toast.error("Erro ao reenfileirar"); return; }
    toast.success("Ação de volta na fila");
    fetchAll();
  };

  const cancelBatch = async (batch: string) => {
    const { error } = await supabase.from("group_admin_actions" as any)
      .update({ status: "cancelled", updated_at: new Date().toISOString() } as any)
      .eq("batch", batch).eq("status", "queued");
    if (error) { toast.error("Erro ao cancelar lote"); return; }
    toast.success(`Lote ${batch} cancelado`);
    fetchAll();
  };

  const togglePause = async (t: ThrottleRow) => {
    const { error } = await supabase.from("group_admin_throttle" as any)
      .update(t.paused ? { paused: false, paused_reason: null, consecutive_failures: 0 } : { paused: true, paused_reason: "Pausada manualmente" } as any)
      .eq("whatsapp_number_id", t.whatsapp_number_id);
    if (error) { toast.error("Erro ao alterar fila"); return; }
    toast.success(t.paused ? "Fila retomada" : "Fila pausada");
    fetchAll();
  };

  const saveThrottle = async () => {
    if (!editingThrottle) return;
    setIsSavingThrottle(true);
    const { whatsapp_number_id, min_gap_seconds, max_gap_seconds, long_pause_every, long_pause_min_seconds, long_pause_max_seconds, max_per_hour, max_per_day, window_start, window_end } = editingThrottle;
    const { error } = await supabase.from("group_admin_throttle" as any)
      .update({ min_gap_seconds, max_gap_seconds, long_pause_every, long_pause_min_seconds, long_pause_max_seconds, max_per_hour, max_per_day, window_start, window_end })
      .eq("whatsapp_number_id", whatsapp_number_id);
    setIsSavingThrottle(false);
    if (error) { toast.error("Erro ao salvar ritmo"); return; }
    toast.success("Ritmo salvo!");
    setEditingThrottle(null);
    fetchAll();
  };

  // Instâncias que têm ações OU throttle configurado
  const instanceIds = useMemo(() =>
    [...new Set([...actions.map(a => a.whatsapp_number_id), ...throttles.map(t => t.whatsapp_number_id)])],
    [actions, throttles]);

  return (
    <div className="space-y-4">
      <GroupResponsibleAlerts compact />
      {/* Painel de ritmo por instância */}
      {instanceIds.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {instanceIds.map(id => {
            const th = throttles.find(t => t.whatsapp_number_id === id);
            const queued = actions.filter(a => a.whatsapp_number_id === id && a.status === "queued").length;
            return (
              <Card key={id}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-xs font-medium truncate">{instanceLabel(id)}</span>
                      {th?.paused ? (
                        <Badge variant="outline" className="text-[9px] bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">Pausada</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">Ativa</Badge>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => th && togglePause(th)} disabled={!th}>
                        {th?.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                        {th?.paused ? "Retomar" : "Pausar fila"}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar ritmo" disabled={!th}
                        onClick={() => setEditingThrottle(th || {
                          whatsapp_number_id: id, min_gap_seconds: 45, max_gap_seconds: 120,
                          long_pause_every: 5, long_pause_min_seconds: 180, long_pause_max_seconds: 360,
                          max_per_hour: 20, max_per_day: 60, window_start: "08:00", window_end: "22:00",
                          paused: false, paused_reason: null, consecutive_failures: 0, last_action_at: null, next_allowed_at: null,
                        })}>
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {th?.paused && th.paused_reason && (
                    <p className="text-[11px] text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{th.paused_reason}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{queued} na fila</span>
                    <span>Última hora: {hourCounts[id] || 0}/{th?.max_per_hour ?? 20}</span>
                    <span>Hoje: {dayCounts[id] || 0}/{th?.max_per_day ?? 60}</span>
                    {th?.last_action_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Última: {fmtTime(th.last_action_at)}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="queued">Na fila</SelectItem>
            <SelectItem value="running">Executando</SelectItem>
            <SelectItem value="done">Feitas</SelectItem>
            <SelectItem value="failed">Falharam</SelectItem>
            <SelectItem value="cancelled">Canceladas</SelectItem>
            <SelectItem value="skipped">Puladas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={instanceFilter} onValueChange={setInstanceFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Instância" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as instâncias</SelectItem>
            {instanceIds.map(id => <SelectItem key={id} value={id}>{instanceLabel(id)}</SelectItem>)}
          </SelectContent>
        </Select>
        {batches.length > 0 && (
          <Select value={batchFilter} onValueChange={setBatchFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="Lote" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os lotes</SelectItem>
              {batches.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {batchFilter !== "all" && (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => cancelBatch(batchFilter)}>
            <Ban className="h-3 w-3" />Cancelar lote
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-8 gap-1 ml-auto" onClick={fetchAll} disabled={isLoading}>
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />Atualizar
        </Button>
      </div>

      {/* Lista */}
      {isLoading && actions.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <ListChecks className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">Nenhuma ação na fila.</p>
        </CardContent></Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-420px)]">
          <div className="space-y-1.5">
            {filtered.map(a => {
              const st = STATUS_STYLE[a.status] || STATUS_STYLE.queued;
              return (
                <Card key={a.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">{ACTION_LABELS[a.action_type] || a.action_type}</span>
                        <span className="text-xs text-muted-foreground truncate">{payloadSummary(a)}</span>
                        <Badge variant="outline" className={`text-[9px] ${st.cls}`}>{st.label}</Badge>
                        {a.requested_by === "claude" && <Badge variant="outline" className="text-[9px]">Claude</Badge>}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                        <span className="truncate">{a.group_name_snapshot || a.group_jid}</span>
                        <span>{instanceLabel(a.whatsapp_number_id)}</span>
                        <span>Criada {fmtTime(a.created_at)}</span>
                        {a.status === "queued" && <span>Previsão: {estimateFor(a)}</span>}
                        {a.finished_at && <span>Concluída {fmtTime(a.finished_at)}</span>}
                        {a.attempts > 1 && <span>Tentativa {a.attempts}</span>}
                        {a.batch && <span>Lote: {a.batch}</span>}
                      </div>
                      {a.error_message && (a.status === "failed" || a.status === "skipped") && (
                        <p className="text-[11px] text-destructive">{a.error_message}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {a.status === "queued" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Cancelar" onClick={() => cancelAction(a)}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                      {a.status === "failed" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Reenfileirar" onClick={() => requeueAction(a)}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Diálogo de edição do ritmo */}
      <Dialog open={!!editingThrottle} onOpenChange={(o) => { if (!o) setEditingThrottle(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Ritmo da fila — {editingThrottle ? instanceLabel(editingThrottle.whatsapp_number_id) : ""}</DialogTitle>
          </DialogHeader>
          {editingThrottle && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><Label className="text-[11px]">Gap mínimo (seg)</Label>
                <Input type="number" value={editingThrottle.min_gap_seconds} onChange={e => setEditingThrottle({ ...editingThrottle, min_gap_seconds: Number(e.target.value) })} /></div>
              <div><Label className="text-[11px]">Gap máximo (seg)</Label>
                <Input type="number" value={editingThrottle.max_gap_seconds} onChange={e => setEditingThrottle({ ...editingThrottle, max_gap_seconds: Number(e.target.value) })} /></div>
              <div><Label className="text-[11px]">Pausa longa a cada N ações</Label>
                <Input type="number" value={editingThrottle.long_pause_every} onChange={e => setEditingThrottle({ ...editingThrottle, long_pause_every: Number(e.target.value) })} /></div>
              <div><Label className="text-[11px]">Pausa longa mín (seg)</Label>
                <Input type="number" value={editingThrottle.long_pause_min_seconds} onChange={e => setEditingThrottle({ ...editingThrottle, long_pause_min_seconds: Number(e.target.value) })} /></div>
              <div><Label className="text-[11px]">Pausa longa máx (seg)</Label>
                <Input type="number" value={editingThrottle.long_pause_max_seconds} onChange={e => setEditingThrottle({ ...editingThrottle, long_pause_max_seconds: Number(e.target.value) })} /></div>
              <div><Label className="text-[11px]">Máx. por hora</Label>
                <Input type="number" value={editingThrottle.max_per_hour} onChange={e => setEditingThrottle({ ...editingThrottle, max_per_hour: Number(e.target.value) })} /></div>
              <div><Label className="text-[11px]">Máx. por dia</Label>
                <Input type="number" value={editingThrottle.max_per_day} onChange={e => setEditingThrottle({ ...editingThrottle, max_per_day: Number(e.target.value) })} /></div>
              <div><Label className="text-[11px]">Janela início</Label>
                <Input type="time" value={editingThrottle.window_start?.slice(0, 5)} onChange={e => setEditingThrottle({ ...editingThrottle, window_start: e.target.value })} /></div>
              <div><Label className="text-[11px]">Janela fim</Label>
                <Input type="time" value={editingThrottle.window_end?.slice(0, 5)} onChange={e => setEditingThrottle({ ...editingThrottle, window_end: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingThrottle(null)}>Cancelar</Button>
            <Button onClick={saveThrottle} disabled={isSavingThrottle}>
              {isSavingThrottle ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

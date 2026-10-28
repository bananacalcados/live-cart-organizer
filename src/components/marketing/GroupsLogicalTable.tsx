import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { GroupResponsibleAlerts } from "./GroupResponsibleAlerts";

interface Presence { instance_id: string; label: string; present: boolean; is_admin: boolean }
interface InstanceRow { id: string; instance_id: string; name: string | null; is_active: boolean; is_admin: boolean | null; participant_count: number | null; last_synced_at: string | null }
export interface LogicalGroup {
  base: string; name: string | null; active: boolean; is_vip: boolean; rows: InstanceRow[];
  responsible_id: string | null; responsible_label: string | null; mode: "auto" | "manual";
  health: "ok" | "sem_admin" | "sem_responsavel"; reason: string | null;
  pending_id: string | null; pending_label: string | null;
  unique_members: number; open_alerts: number; presence: Presence[];
}

const HEALTH: Record<string, string> = { ok: "ok", sem_admin: "sem admin", sem_responsavel: "sem responsável" };
const AUTO = "__auto__";

/** Tela de Grupos: uma linha por grupo lógico (1 chamada ao abrir; recarga manual). */
export function GroupsLogicalTable() {
  const [rows, setRows] = useState<LogicalGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("group_logical_overview", { p_include_archived: showArchived, p_limit: 200, p_offset: 0 });
    setLoading(false);
    if (error) { toast.error("Não foi possível carregar os grupos"); return; }
    setRows(((data as any)?.rows || []) as LogicalGroup[]);
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter(r => (r.name || "").toLowerCase().includes(t) || r.base.includes(t)) : rows;
  }, [rows, q]);

  const toggleVip = async (g: LogicalGroup) => {
    const next = !g.is_vip;
    setSaving(g.base);
    const { error } = await supabase.from("whatsapp_groups").update({ is_vip: next }).eq("group_jid_base", g.base).neq("is_vip", next);
    setSaving(null);
    if (error) { toast.error("Não foi possível salvar Grupo VIP (clientes)"); return; }
    setRows(prev => prev.map(r => (r.base === g.base ? { ...r, is_vip: next } : r)));
  };

  const swap = async (g: LogicalGroup, value: string) => {
    setSaving(g.base);
    const { data, error } = await (supabase.rpc as any)("set_group_responsible_manual", {
      p_base: g.base, p_instance: value === AUTO ? null : value,
    });
    setSaving(null);
    if (error) { toast.error(error.message.includes("permiss") ? "Só gerente/admin pode trocar" : error.message); return; }
    toast.success(data === "aguardando_envio" ? "Troca agendada: aguarda os envios pendentes do grupo" : "Responsável atualizada");
    load();
  };

  return (
    <div className="space-y-3">
      <GroupResponsibleAlerts compact onChange={load} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar grupo..." value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Mostrar arquivados
        </label>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
        <span className="text-sm text-muted-foreground">{filtered.length} grupos</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 w-6" />
              <th className="p-2">Grupo</th>
              <th className="p-2">VIP</th>
              <th className="p-2">Responsável</th>
              <th className="p-2">Instâncias (admin)</th>
              <th className="p-2 text-right">Membros únicos</th>
              <th className="p-2 text-right">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(g => {
              const present = g.presence.filter(p => p.present);
              const isOpen = open === g.base;
              return (
                <Fragment key={g.base}>
                  <tr className="border-t align-top">
                    <td className="p-2">
                      <button aria-label="Ver participações" onClick={() => setOpen(isOpen ? null : g.base)}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{g.name || g.base}</div>
                      {!g.active && <Badge variant="outline" className="mt-1 text-[10px]">arquivado</Badge>}
                    </td>
                    <td className="p-2">
                      <Switch aria-label="Grupo VIP (clientes)" checked={g.is_vip} disabled={saving === g.base} onCheckedChange={() => toggleVip(g)} />
                    </td>
                    <td className="p-2 space-y-1 min-w-[220px]">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span>{g.responsible_label || "—"}</span>
                        <Badge variant={g.mode === "manual" ? "default" : "secondary"} className="text-[10px]">{g.mode}</Badge>
                        <Badge variant="outline" className="text-[10px]">{HEALTH[g.health] || g.health}</Badge>
                      </div>
                      {g.pending_label && <div className="text-xs text-muted-foreground">Aguardando envios para trocar para {g.pending_label}</div>}
                      <Select value="" onValueChange={v => swap(g, v)} disabled={saving === g.base || present.length === 0}>
                        <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue placeholder="Trocar" /></SelectTrigger>
                        <SelectContent>
                          {present.map(p => (
                            <SelectItem key={p.instance_id} value={p.instance_id}>{p.label}{p.is_admin ? " (admin)" : ""}</SelectItem>
                          ))}
                          {g.mode === "manual" && <SelectItem value={AUTO}>Voltar ao automático</SelectItem>}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {present.length === 0 && <span className="text-muted-foreground">nenhuma</span>}
                        {present.map(p => (
                          <Badge key={p.instance_id} variant={p.is_admin ? "default" : "outline"} className="text-[10px]">
                            {p.label}{p.is_admin ? " · admin" : ""}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-2 text-right tabular-nums">{g.unique_members}</td>
                    <td className="p-2 text-right">{g.open_alerts > 0 ? <Badge variant="destructive">{g.open_alerts}</Badge> : "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td />
                      <td colSpan={6} className="p-2">
                        <div className="text-xs text-muted-foreground mb-1">Participações por instância</div>
                        <div className="grid gap-1">
                          {g.rows.map(r => {
                            const label = g.presence.find(p => p.instance_id && (r.instance_id === p.instance_id))?.label;
                            return (
                              <div key={r.id} className="flex flex-wrap gap-3 text-xs">
                                <span className="font-medium">{label || r.instance_id}</span>
                                <span>{r.name}</span>
                                <span>{r.participant_count ?? "?"} participantes</span>
                                <span>{r.is_active ? "ativo" : "arquivado"}</span>
                                <span>{r.is_admin ? "admin" : "não admin"}</span>
                                <span className="text-muted-foreground">sync {r.last_synced_at ? new Date(r.last_synced_at).toLocaleString("pt-BR") : "—"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

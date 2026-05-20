import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw,
  Search, Send, Store, ShoppingBag, Eye, AlertCircle, ArrowLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Channel = "all" | "pdv" | "live";
type StatusFilter = "all" | "sent" | "error" | "skipped" | "pending";

interface UnifiedLog {
  id: string;
  channel: "pdv" | "live";
  source_id: string;
  event_name: string;
  event_id: string;
  pixel_ref: string | null;
  status: string;
  http_status: number | null;
  error_message: string | null;
  meta_response: any;
  payload_summary: any;
  created_at: string;
  sent_at: string | null;
}

interface Props {
  storeId: string;
  onBack?: () => void;
}

export function POSMetaPixelDashboard({ storeId, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<UnifiedLog[]>([]);
  const [channel, setChannel] = useState<Channel>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<UnifiedLog | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [offlineRes, liveRes] = await Promise.all([
        supabase.from("meta_capi_offline_log")
          .select("id, sale_id, event_name, event_id, dataset_id, status, http_status, error_message, meta_response, payload_summary, created_at, sent_at")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(500),
        supabase.from("meta_capi_purchase_log")
          .select("id, order_id, event_name, event_id, pixel_id, status, http_status, error_message, meta_response, payload_summary, created_at, sent_at")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      ]);
      const offline: UnifiedLog[] = (offlineRes.data || []).map((r: any) => ({
        id: r.id, channel: "pdv", source_id: r.sale_id, event_name: r.event_name, event_id: r.event_id,
        pixel_ref: r.dataset_id || null, status: r.status, http_status: r.http_status,
        error_message: r.error_message, meta_response: r.meta_response, payload_summary: r.payload_summary,
        created_at: r.created_at, sent_at: r.sent_at,
      }));
      const live: UnifiedLog[] = (liveRes.data || []).map((r: any) => ({
        id: r.id, channel: "live", source_id: r.order_id, event_name: r.event_name, event_id: r.event_id,
        pixel_ref: r.pixel_id || null, status: r.status, http_status: r.http_status,
        error_message: r.error_message, meta_response: r.meta_response, payload_summary: r.payload_summary,
        created_at: r.created_at, sent_at: r.sent_at,
      }));
      const all = [...offline, ...live].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setLogs(all);
    } catch (e: any) {
      toast.error("Erro ao carregar logs: " + e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayLogs = logs.filter(l => new Date(l.created_at) >= today);
    const sent = todayLogs.filter(l => l.status === "sent").length;
    const errors = todayLogs.filter(l => l.status === "error").length;
    const skipped = todayLogs.filter(l => l.status === "skipped").length;
    const pending = todayLogs.filter(l => l.status === "pending").length;
    const total = sent + errors;
    const rate = total > 0 ? (sent / total) * 100 : 100;
    return { sent, errors, skipped, pending, rate };
  }, [logs]);

  const filtered = useMemo(() => logs.filter(l => {
    if (channel !== "all" && l.channel !== channel) return false;
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!l.source_id.toLowerCase().includes(s) && !l.event_id.toLowerCase().includes(s) && !(l.error_message || "").toLowerCase().includes(s)) return false;
    }
    return true;
  }), [logs, channel, statusFilter, search]);

  const pixelSummary = useMemo(() => {
    const map = new Map<string, any>();
    for (const l of logs) {
      const ref = l.pixel_ref || "(sem id)";
      const key = `${l.channel}::${ref}`;
      const cur = map.get(key) || { pixelRef: ref, channel: l.channel, sent: 0, errors: 0, total: 0, lastSeen: l.created_at, lastStatus: l.status };
      cur.total += 1;
      if (l.status === "sent") cur.sent += 1;
      if (l.status === "error") cur.errors += 1;
      if (l.created_at > cur.lastSeen) { cur.lastSeen = l.created_at; cur.lastStatus = l.status; }
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [logs]);

  const handleRetry = async (log: UnifiedLog) => {
    setRetrying(log.id);
    try {
      const fn = log.channel === "pdv" ? "meta-capi-offline" : "meta-capi-purchase-retry";
      const body = log.channel === "pdv" ? { sale_id: log.source_id } : { order_id: log.source_id };
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      toast.success(data?.ok !== false ? "Reenviado!" : "Reenvio com erro");
      await load();
    } catch (e: any) {
      toast.error("Erro ao reenviar: " + e.message);
    } finally { setRetrying(null); }
  };

  const handleReconcileLive = async () => {
    if (!confirm("Buscar e reenviar Purchase de Live antigas que não têm log? (últimos 30 dias, limite 100)")) return;
    setReconciling(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-capi-purchase-retry", { body: { reconcile: true, days: 30, limit: 100 } });
      if (error) throw error;
      toast.success(`Reconciliado: ${data?.sent || 0} enviados, ${data?.failed || 0} falhas`);
      await load();
    } catch (e: any) { toast.error("Erro: " + e.message); }
    finally { setReconciling(false); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string; icon: any }> = {
      sent: { cls: "bg-emerald-100 text-emerald-700 border-emerald-300", label: "Enviado", icon: CheckCircle2 },
      error: { cls: "bg-red-100 text-red-700 border-red-300", label: "Erro", icon: AlertCircle },
      skipped: { cls: "bg-amber-100 text-amber-700 border-amber-300", label: "Skipped", icon: AlertTriangle },
      pending: { cls: "bg-sky-100 text-sky-700 border-sky-300", label: "Pendente", icon: Clock },
    };
    const s = map[status] || { cls: "bg-muted text-foreground", label: status, icon: Activity };
    const Icon = s.icon;
    return (<Badge variant="outline" className={`${s.cls} gap-1`}><Icon className="h-3 w-3" />{s.label}</Badge>);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[hsl(var(--pos-bg))] text-foreground">
      <div className="px-4 py-3 border-b border-border bg-white flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-500" />
            Meta Pixel — Envios CAPI
          </h2>
          <p className="text-xs text-muted-foreground">Auditoria de eventos Purchase enviados ao Pixel da Meta (PDV + Live)</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="px-4 pt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Enviados (hoje)" value={kpis.sent} icon={CheckCircle2} color="text-emerald-600" />
        <KpiCard label="Erros (hoje)" value={kpis.errors} icon={AlertCircle} color="text-red-600" />
        <KpiCard label="Skipped (hoje)" value={kpis.skipped} icon={AlertTriangle} color="text-amber-600" />
        <KpiCard label="Pendentes" value={kpis.pending} icon={Clock} color="text-sky-600" />
        <KpiCard label="Taxa sucesso" value={`${kpis.rate.toFixed(1)}%`} icon={Activity} color="text-orange-600" />
      </div>

      {/* Pixels cadastrados */}
      <div className="px-4 pt-4">
        <div className="rounded-xl border border-border bg-white shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="h-4 w-4 text-orange-500" />
            <h3 className="text-sm font-bold text-foreground">Pixels / Datasets cadastrados</h3>
            <span className="text-[10px] text-muted-foreground ml-1">(últimos 30 dias)</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{pixelSummary.length} ativo(s)</span>
          </div>
          {pixelSummary.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum pixel/dataset detectado nos logs ainda.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {pixelSummary.map(p => {
                const rate = p.total > 0 ? (p.sent / p.total) * 100 : 0;
                const healthy = p.lastStatus === "sent";
                return (
                  <div key={`${p.channel}-${p.pixelRef}`} className="rounded-lg border border-border bg-[hsl(var(--pos-bg-2))] p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : p.lastStatus === "error" ? "bg-red-500" : "bg-amber-500"}`} />
                      <Badge variant="outline" className={p.channel === "pdv" ? "border-amber-400 bg-amber-50 text-amber-700 text-[9px]" : "border-fuchsia-400 bg-fuchsia-50 text-fuchsia-700 text-[9px]"}>
                        {p.channel === "pdv" ? "Offline · PDV" : "Online · Live"}
                      </Badge>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {format(new Date(p.lastSeen), "dd/MM HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                    <div className="font-mono text-xs text-foreground font-semibold truncate" title={p.pixelRef}>
                      {p.pixelRef}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                      <span className="text-emerald-600 font-medium">✓ {p.sent}</span>
                      <span className="text-red-600 font-medium">✕ {p.errors}</span>
                      <span className="text-muted-foreground">total {p.total}</span>
                      <span className="ml-auto text-orange-600 font-bold">{rate.toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 flex flex-wrap gap-2 items-center border-b border-border mt-3 bg-white">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar por ID, event_id ou erro..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
        </div>
        <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos canais</SelectItem>
            <SelectItem value="pdv">PDV</SelectItem>
            <SelectItem value="live">Live</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="sent">Enviado</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleReconcileLive} disabled={reconciling} className="gap-2 border-orange-400 text-orange-600 hover:bg-orange-50">
          {reconciling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Reconciliar Live antigas
        </Button>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Nenhum registro encontrado</div>
          ) : (
            filtered.map(log => (
              <div key={log.id} className="bg-white border border-border rounded-lg p-3 flex items-center gap-3 hover:bg-[hsl(var(--pos-bg-2))] shadow-sm">
                <div className={`p-2 rounded-lg ${log.channel === "pdv" ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"}`}>
                  {log.channel === "pdv" ? <Store className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{log.channel === "pdv" ? "Venda PDV" : "Live"}</span>
                    {statusBadge(log.status)}
                    {log.http_status && <span className="text-[10px] text-muted-foreground">HTTP {log.http_status}</span>}
                  </div>
                  <p className="text-xs text-foreground font-mono truncate">{log.source_id}</p>
                  {log.error_message && <p className="text-[11px] text-red-600 truncate mt-0.5">{log.error_message}</p>}
                  {log.payload_summary?.value && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      R$ {Number(log.payload_summary.value).toFixed(2)} ·
                      {log.payload_summary.num_items ? ` ${log.payload_summary.num_items} itens · ` : " "}
                      {format(new Date(log.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDetail(log)} className="h-8 w-8 p-0"><Eye className="h-3.5 w-3.5" /></Button>
                  {log.status !== "sent" && (
                    <Button size="sm" variant="ghost" onClick={() => handleRetry(log)} disabled={retrying === log.id} className="h-8 w-8 p-0 text-orange-600 hover:bg-orange-50" title="Reenviar">
                      {retrying === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.channel === "pdv" ? <Store className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
              Detalhes do envio
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <ScrollArea className="flex-1 pr-3">
              <div className="space-y-3 text-sm">
                <DetailRow label="Status">{statusBadge(detail.status)}</DetailRow>
                <DetailRow label="Canal">{detail.channel === "pdv" ? "PDV (Offline)" : "Live (Online)"}</DetailRow>
                <DetailRow label="Pixel/Dataset"><span className="font-mono text-xs">{detail.pixel_ref || "—"}</span></DetailRow>
                <DetailRow label={detail.channel === "pdv" ? "Sale ID" : "Order ID"}><span className="font-mono text-xs">{detail.source_id}</span></DetailRow>
                <DetailRow label="Event ID"><span className="font-mono text-xs">{detail.event_id}</span></DetailRow>
                <DetailRow label="Event">{detail.event_name}</DetailRow>
                <DetailRow label="HTTP">{detail.http_status || "—"}</DetailRow>
                <DetailRow label="Criado">{format(new Date(detail.created_at), "dd/MM/yyyy HH:mm:ss")}</DetailRow>
                {detail.sent_at && <DetailRow label="Enviado">{format(new Date(detail.sent_at), "dd/MM/yyyy HH:mm:ss")}</DetailRow>}
                {detail.error_message && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Mensagem de erro</p>
                    <pre className="bg-red-50 text-red-700 p-2 rounded text-xs whitespace-pre-wrap border border-red-200">{detail.error_message}</pre>
                  </div>
                )}
                {detail.payload_summary && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Resumo do payload</p>
                    <pre className="bg-muted p-2 rounded text-xs overflow-auto">{JSON.stringify(detail.payload_summary, null, 2)}</pre>
                  </div>
                )}
                {detail.meta_response && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Resposta da Meta</p>
                    <pre className="bg-muted p-2 rounded text-xs overflow-auto">{JSON.stringify(detail.meta_response, null, 2)}</pre>
                  </div>
                )}
                {detail.status !== "sent" && (
                  <Button onClick={() => { handleRetry(detail); setDetail(null); }} className="w-full gap-2">
                    <Send className="h-3.5 w-3.5" /> Reenviar para Meta
                  </Button>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: any; icon: any; color: string }) {
  return (
    <div className="bg-white border border-border rounded-lg p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

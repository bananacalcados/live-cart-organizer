import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  History, Send, CheckCircle, XCircle, Eye, Clock, RefreshCw,
  MessageSquare, BarChart3, Users, ChevronDown, ChevronUp,
  Pause, Play, CalendarClock, Trash2, Copy, Pencil, Check, X,
} from "lucide-react";
import { DispatchAttributionPanel } from "./DispatchAttributionPanel";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface DispatchRecord {
  id: string;
  template_name: string;
  campaign_name: string | null;
  audience_source: string;
  audience_filters: any;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  rendered_message: string | null;
  force_resend: boolean;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  // Live stats from whatsapp_messages
  stats?: {
    delivered: number;
    read: number;
    sent: number;
    failed: number;
    total: number;
    dispatched: number;
    interactions: number;
  };
}

interface RecipientRow {
  phone: string;
  recipient_name: string | null;
  status: string;
  message_wamid: string | null;
}

export interface DuplicateDispatchData {
  template_name: string;
  template_language: string | null;
  whatsapp_number_id: string | null;
  audience_source: string | null;
  audience_filters: any;
  variables_config: any;
  force_resend: boolean;
  header_media_url: string | null;
  template_components: any;
  has_dynamic_vars: boolean;
  recipients: { phone: string; name: string | null }[];
}

interface DispatchHistoryListProps {
  onDuplicate?: (data: DuplicateDispatchData) => void;
}

export function DispatchHistoryList({ onDuplicate }: DispatchHistoryListProps = {}) {
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDispatch, setSelectedDispatch] = useState<DispatchRecord | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [recipientStats, setRecipientStats] = useState<Record<string, string>>({});
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('dispatch_history')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      if (!data || data.length === 0) {
        setDispatches([]);
        return;
      }

      // For each dispatch, get live stats from whatsapp_messages
      const enriched = await Promise.all(data.map(async (d: any) => {
        // Get phones for this dispatch
        const { data: recs } = await supabase
          .from('dispatch_recipients')
          .select('phone')
          .eq('dispatch_id', d.id);

        if (!recs || recs.length === 0) {
          return { ...d, stats: { delivered: 0, read: 0, sent: 0, failed: 0, total: 0, dispatched: d.sent_count || 0, interactions: 0 } };
        }

        const phones = recs.map((r: any) => {
          let p = r.phone.replace(/\D/g, '');
          if (!p.startsWith('55')) p = '55' + p;
          return p;
        });

        // FIX: Use created_at (dispatch creation) instead of started_at (last lock timestamp)
        const startTime = new Date(d.created_at);
        startTime.setMinutes(startTime.getMinutes() - 2);
        const endTime = d.completed_at
          ? new Date(new Date(d.completed_at).getTime() + 24 * 60 * 60 * 1000)
          : new Date();

        // Batch phones in groups of 100 for the IN query
        let allStatuses: { phone: string; status: string }[] = [];
        let interactionCount = 0;
        for (let i = 0; i < phones.length; i += 100) {
          const batch = phones.slice(i, i + 100);
          const { data: msgs } = await supabase
            .from('whatsapp_messages')
            .select('phone, status')
            .eq('direction', 'outgoing')
            .in('phone', batch)
            .gte('created_at', startTime.toISOString())
            .lte('created_at', endTime.toISOString());
          if (msgs) allStatuses.push(...msgs);

          // Count interactions (incoming replies from these phones after dispatch)
          const { count: replies } = await supabase
            .from('whatsapp_messages')
            .select('*', { count: 'exact', head: true })
            .eq('direction', 'incoming')
            .in('phone', batch)
            .gte('created_at', startTime.toISOString())
            .lte('created_at', endTime.toISOString());
          interactionCount += replies || 0;
        }

        // Use best status per phone
        const phoneStatus = new Map<string, string>();
        const statusRank: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };
        for (const msg of allStatuses) {
          const current = phoneStatus.get(msg.phone);
          if (!current || (statusRank[msg.status] || 0) > (statusRank[current] || 0)) {
            phoneStatus.set(msg.phone, msg.status);
          }
        }

        const stats = {
          delivered: 0, read: 0, sent: 0, failed: 0,
          total: phones.length,
          dispatched: d.sent_count || 0,
          interactions: interactionCount,
        };
        for (const [, status] of phoneStatus) {
          if (status === 'delivered') stats.delivered++;
          else if (status === 'read') stats.read++;
          else if (status === 'sent') stats.sent++;
          else if (status === 'failed') stats.failed++;
        }

        return { ...d, stats };
      }));

      setDispatches(enriched);
    } catch (err) {
      console.error('Error loading dispatch history:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const openDetail = async (dispatch: DispatchRecord) => {
    setSelectedDispatch(dispatch);
    setIsLoadingDetail(true);
    try {
      const { data } = await supabase
        .from('dispatch_recipients')
        .select('phone, recipient_name, status, message_wamid')
        .eq('dispatch_id', dispatch.id)
        .order('created_at', { ascending: true });

      setRecipients(data || []);

      // Get live statuses
      if (data && data.length > 0) {
        const phones = data.map((r: any) => {
          let p = r.phone.replace(/\D/g, '');
          if (!p.startsWith('55')) p = '55' + p;
          return p;
        });

        // FIX: Use created_at instead of started_at for time window
        const startTime = new Date(dispatch.created_at);
        startTime.setMinutes(startTime.getMinutes() - 2);
        const endTime = dispatch.completed_at
          ? new Date(new Date(dispatch.completed_at).getTime() + 24 * 60 * 60 * 1000)
          : new Date();

        const statusMap: Record<string, string> = {};
        const statusRank: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };

        for (let i = 0; i < phones.length; i += 100) {
          const batch = phones.slice(i, i + 100);
          const { data: msgs } = await supabase
            .from('whatsapp_messages')
            .select('phone, status')
            .eq('direction', 'outgoing')
            .in('phone', batch)
            .gte('created_at', startTime.toISOString())
            .lte('created_at', endTime.toISOString());
          if (msgs) {
            for (const msg of msgs) {
              const current = statusMap[msg.phone];
              if (!current || (statusRank[msg.status] || 0) > (statusRank[current] || 0)) {
                statusMap[msg.phone] = msg.status;
              }
            }
          }
        }
        setRecipientStats(statusMap);
      }
    } catch (err) {
      console.error('Error loading recipients:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'read': return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs">Lida</Badge>;
      case 'delivered': return <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs">Entregue</Badge>;
      case 'sent': return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">Enviada</Badge>;
      case 'failed': return <Badge variant="destructive" className="text-xs">Falhou</Badge>;
      default: return <Badge variant="outline" className="text-xs">Pendente</Badge>;
    }
  };

  const getDispatchStatusBadge = (d: DispatchRecord) => {
    if (d.status === 'sending') return <Badge className="bg-amber-500/20 text-amber-700 animate-pulse text-xs"><Clock className="h-3 w-3 mr-1" />Enviando</Badge>;
    if (d.status === 'completed') return <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs"><CheckCircle className="h-3 w-3 mr-1" />Concluído</Badge>;
    if (d.status === 'cancelled') return <Badge variant="outline" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Cancelado</Badge>;
    if (d.status === 'scheduled') return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs"><CalendarClock className="h-3 w-3 mr-1" />Agendado</Badge>;
    if (d.status === 'scheduled_paused') return <Badge className="bg-muted text-muted-foreground text-xs"><Pause className="h-3 w-3 mr-1" />Pausado</Badge>;
    return <Badge variant="outline" className="text-xs">{d.status}</Badge>;
  };

  const handleTriggerNow = async (dispatchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await supabase
        .from('dispatch_history')
        .update({ status: 'sending', started_at: new Date().toISOString(), completed_at: null } as any)
        .eq('id', dispatchId);

      const res = await fetch(`https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/dispatch-mass-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ dispatchId }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.error) {
        await supabase
          .from('dispatch_history')
          .update({ status: 'scheduled_paused', processing_batch: false, started_at: null } as any)
          .eq('id', dispatchId);
        throw new Error(data?.error || 'Falha ao iniciar disparo');
      }

      toast.success("🚀 Disparo iniciado!");
      loadHistory();
    } catch (error) {
      console.error('Error triggering dispatch:', error);
      toast.error("Erro ao iniciar disparo");
      loadHistory();
    }
  };

  const handleCancelScheduled = async (dispatchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('dispatch_history').update({ status: 'cancelled' }).eq('id', dispatchId);
    toast.info("Disparo cancelado");
    loadHistory();
  };

  const handleDuplicate = async (dispatch: DispatchRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDuplicate) return;
    try {
      // Fetch recipients from this dispatch
      const { data: recs } = await supabase
        .from('dispatch_recipients')
        .select('phone, recipient_name')
        .eq('dispatch_id', dispatch.id);

      const d = dispatch as any;
      onDuplicate({
        template_name: d.template_name,
        template_language: d.template_language || null,
        whatsapp_number_id: d.whatsapp_number_id || null,
        audience_source: d.audience_source || null,
        audience_filters: d.audience_filters || {},
        variables_config: d.variables_config || {},
        force_resend: d.force_resend || false,
        header_media_url: d.header_media_url || null,
        template_components: d.template_components || null,
        has_dynamic_vars: d.has_dynamic_vars || false,
        recipients: (recs || []).map((r: any) => ({ phone: r.phone, name: r.recipient_name })),
      });
      toast.success("Disparo duplicado — edite as configurações e dispare quando quiser");
    } catch {
      toast.error("Erro ao duplicar disparo");
    }
  };

  const calcRate = (value: number, total: number) => {
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  const getAudienceLabel = (source: string, filters: any) => {
    const parts: string[] = [];
    if (source === 'crm') parts.push('CRM');
    else if (source === 'leads') parts.push('Leads');
    else if (source === 'both') parts.push('CRM + Leads');

    if (filters?.rfm && filters.rfm !== 'all') parts.push(`RFM: ${filters.rfm}`);
    if (filters?.state && filters.state !== 'all') parts.push(`UF: ${filters.state}`);
    if (filters?.city && filters.city !== 'all') parts.push(`Cidade: ${filters.city}`);
    if (filters?.ddd && filters.ddd !== 'all') parts.push(`DDD: ${filters.ddd}`);
    if (filters?.region && filters.region !== 'all') parts.push(`Região: ${filters.region}`);
    if (filters?.campaign && filters.campaign !== 'all') parts.push(`Campanha: ${filters.campaign}`);

    return parts.length > 0 ? parts.join(' • ') : source || 'N/A';
  };

  const handleSaveRename = async (dispatchId: string) => {
    try {
      await supabase.from('dispatch_history').update({ campaign_name: editName.trim() || null } as any).eq('id', dispatchId);
      setDispatches(prev => prev.map(d => d.id === dispatchId ? { ...d, campaign_name: editName.trim() || null } : d));
      setEditingId(null);
      toast.success("Campanha renomeada!");
    } catch {
      toast.error("Erro ao renomear");
    }
  };

  if (dispatches.length === 0 && !isLoading) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Histórico de Disparos ({dispatches.length})
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); loadHistory(); }}
              disabled={isLoading}
              className="h-7 px-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Carregando histórico...
            </div>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-2">
                {dispatches.map((d) => {
                  const s = d.stats || { delivered: 0, read: 0, sent: 0, failed: 0, total: 0, dispatched: 0, interactions: 0 };
                  const dispatched = s.dispatched || d.sent_count || 0;
                  const deliveryRate = calcRate(s.delivered + s.read, dispatched);
                  const readRate = calcRate(s.read, dispatched);

                  return (
                    <div
                      key={d.id}
                      className="border rounded-lg p-3 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => openDetail(d)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {editingId === d.id ? (
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <Input
                                  className="h-6 text-xs w-[200px]"
                                  value={editName}
                                  onChange={e => setEditName(e.target.value)}
                                  placeholder="Nome da campanha"
                                  autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter') handleSaveRename(d.id); if (e.key === 'Escape') setEditingId(null); }}
                                />
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleSaveRename(d.id)}>
                                  <Check className="h-3 w-3 text-emerald-500" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                {d.campaign_name && (
                                  <span className="text-sm font-medium">{d.campaign_name}</span>
                                )}
                                <span className={`font-mono text-sm ${d.campaign_name ? 'text-muted-foreground text-xs' : 'font-medium'}`}>{d.template_name}</span>
                                <Button
                                  variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-40 hover:opacity-100"
                                  onClick={e => { e.stopPropagation(); setEditingId(d.id); setEditName(d.campaign_name || ''); }}
                                  title="Renomear campanha"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            {getDispatchStatusBadge(d)}
                            {d.force_resend && (
                              <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Reenvio</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(new Date(d.created_at), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                            {(d as any).scheduled_at && (d.status === 'scheduled' || d.status === 'scheduled_paused') && (
                              <span className="flex items-center gap-1 text-blue-600">
                                <CalendarClock className="h-3 w-3" />
                                {format(new Date((d as any).scheduled_at), "dd/MM HH:mm", { locale: ptBR })}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {dispatched}/{d.total_recipients} disp.
                            </span>
                            <span className="truncate max-w-[200px]">
                              {getAudienceLabel(d.audience_source, d.audience_filters)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs shrink-0">
                          {onDuplicate && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 gap-1 text-xs"
                              onClick={(e) => handleDuplicate(d, e)}
                              title="Duplicar disparo"
                            >
                              <Copy className="h-3 w-3" />Duplicar
                            </Button>
                          )}
                          {(d.status === 'scheduled' || d.status === 'scheduled_paused') ? (
                            <>
                              <Button
                                variant="default"
                                size="sm"
                                className="h-7 px-2.5 gap-1 text-xs"
                                onClick={(e) => handleTriggerNow(d.id, e)}
                              >
                                <Play className="h-3 w-3" />Disparar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-destructive"
                                onClick={(e) => handleCancelScheduled(d.id, e)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <div className="text-center">
                                <div className="font-bold text-emerald-600">{deliveryRate}</div>
                                <div className="text-muted-foreground">Entrega</div>
                              </div>
                              <div className="text-center">
                                <div className="font-bold text-blue-600">{readRate}</div>
                                <div className="text-muted-foreground">Leitura</div>
                              </div>
                              <div className="flex gap-1">
                                <div className="w-2 h-8 rounded-full bg-muted overflow-hidden flex flex-col-reverse">
                                  <div className="bg-blue-500 transition-all" style={{ height: `${dispatched ? (s.read / dispatched) * 100 : 0}%` }} />
                                  <div className="bg-emerald-500 transition-all" style={{ height: `${dispatched ? (s.delivered / dispatched) * 100 : 0}%` }} />
                                  <div className="bg-amber-500 transition-all" style={{ height: `${dispatched ? (s.sent / dispatched) * 100 : 0}%` }} />
                                </div>
                              </div>
                              <Button variant="ghost" size="sm" className="h-7 px-2">
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedDispatch} onOpenChange={(o) => !o && setSelectedDispatch(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          {selectedDispatch && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Relatório: {selectedDispatch.template_name}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Summary Cards */}
                {(() => {
                  const s = selectedDispatch.stats;
                  const dispatched = s?.dispatched || selectedDispatch.sent_count || 0;
                  const webhookConfirmed = (s?.sent || 0) + (s?.delivered || 0) + (s?.read || 0);
                  const readCount = s?.read || 0;
                  const notRead = dispatched - readCount;
                  const interactions = s?.interactions || 0;
                  const failedCount = s?.failed || selectedDispatch.failed_count || 0;

                  return (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Card className="p-3 text-center">
                          <div className="text-2xl font-bold">{selectedDispatch.total_recipients}</div>
                          <div className="text-xs text-muted-foreground">Lista</div>
                        </Card>
                        <Card className="p-3 text-center">
                          <div className="text-2xl font-bold text-emerald-600">{dispatched}</div>
                          <div className="text-xs text-muted-foreground">Disparados</div>
                        </Card>
                        <Card className="p-3 text-center">
                          <div className="text-2xl font-bold text-blue-600">{readCount}</div>
                          <div className="text-xs text-muted-foreground">Lidas</div>
                        </Card>
                        <Card className="p-3 text-center">
                          <div className="text-2xl font-bold text-amber-600">{notRead > 0 ? notRead : 0}</div>
                          <div className="text-xs text-muted-foreground">Não lidas</div>
                        </Card>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        <Card className="p-3 text-center bg-emerald-50 dark:bg-emerald-950/30">
                          <div className="text-lg font-bold text-emerald-600">
                            {calcRate((s?.delivered || 0) + readCount, dispatched)}
                          </div>
                          <div className="text-xs text-muted-foreground">Taxa de Entrega</div>
                        </Card>
                        <Card className="p-3 text-center bg-blue-50 dark:bg-blue-950/30">
                          <div className="text-lg font-bold text-blue-600">
                            {calcRate(readCount, dispatched)}
                          </div>
                          <div className="text-xs text-muted-foreground">Taxa de Leitura</div>
                        </Card>
                        <Card className="p-3 text-center bg-purple-50 dark:bg-purple-950/30">
                          <div className="text-lg font-bold text-purple-600">{interactions}</div>
                          <div className="text-xs text-muted-foreground">Interações</div>
                        </Card>
                        <Card className="p-3 text-center bg-destructive/10">
                          <div className="text-lg font-bold text-destructive">{failedCount}</div>
                          <div className="text-xs text-muted-foreground">Falhas</div>
                        </Card>
                      </div>
                    </>
                  );
                })()}

                {/* Metadata */}
                <Card className="p-3 space-y-1 text-sm">
                  <div><strong>Início:</strong> {format(new Date(selectedDispatch.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</div>
                  {selectedDispatch.completed_at && (
                    <div><strong>Fim:</strong> {format(new Date(selectedDispatch.completed_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</div>
                  )}
                  <div><strong>Público:</strong> {getAudienceLabel(selectedDispatch.audience_source, selectedDispatch.audience_filters)}</div>
                  <div><strong>Reenvio forçado:</strong> {selectedDispatch.force_resend ? 'Sim' : 'Não'}</div>
                </Card>

                {/* Message Preview */}
                {selectedDispatch.rendered_message && (
                  <Card className="p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Mensagem enviada:</div>
                    <div className="bg-[hsl(var(--muted))] rounded-lg p-3 text-sm whitespace-pre-wrap">
                      {selectedDispatch.rendered_message}
                    </div>
                  </Card>
                )}

                {/* Recipients Table */}
                <div>
                  <div className="text-sm font-medium mb-2">Destinatários ({recipients.length})</div>
                  {isLoadingDetail ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />Carregando...
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Telefone</TableHead>
                            <TableHead className="text-xs">Nome</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {recipients.map((r, i) => {
                            let formattedPhone = r.phone.replace(/\D/g, '');
                            if (!formattedPhone.startsWith('55')) formattedPhone = '55' + formattedPhone;
                            const liveStatus = recipientStats[formattedPhone] || r.status;
                            return (
                              <TableRow key={i}>
                                <TableCell className="text-xs font-mono">{r.phone}</TableCell>
                                <TableCell className="text-xs">{r.recipient_name || '—'}</TableCell>
                                <TableCell>{getStatusBadge(liveStatus)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

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
  Download, FileSpreadsheet, FileText,
} from "lucide-react";
import { DispatchAttributionPanel } from "./DispatchAttributionPanel";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface DispatchRecord {
  id: string;
  template_name: string;
  template_category?: string | null;
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
  whatsapp_number_id?: string | null;
  whatsapp_instance_label?: string | null;
  whatsapp_phone_display?: string | null;
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

function DispatchMetadataCard({ dispatch, getAudienceLabel, onCostUpdate }: {
  dispatch: DispatchRecord;
  getAudienceLabel: (source: string, filters: any) => string;
  onCostUpdate: (newCost: number) => void;
}) {
  const [editingCost, setEditingCost] = useState(false);
  const [costValue, setCostValue] = useState("");

  const currentCost = (dispatch as any).cost_per_message;
  const categoryDefault = dispatch.template_category === 'UTILITY' ? 0.05 : 0.40;
  const displayCost = currentCost != null ? Number(currentCost) : categoryDefault;

  const handleSaveCost = async () => {
    const parsed = parseFloat(costValue.replace(",", "."));
    if (isNaN(parsed) || parsed < 0) { toast.error("Valor inválido"); return; }
    try {
      await supabase.from('dispatch_history').update({ cost_per_message: parsed } as any).eq('id', dispatch.id);
      onCostUpdate(parsed);
      setEditingCost(false);
      toast.success(`Custo atualizado para R$ ${parsed.toFixed(2)}/msg`);
    } catch { toast.error("Erro ao salvar custo"); }
  };

  return (
    <Card className="p-3 space-y-1 text-sm">
      <div><strong>Início:</strong> {format(new Date(dispatch.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</div>
      {dispatch.completed_at && (
        <div><strong>Fim:</strong> {format(new Date(dispatch.completed_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</div>
      )}
      <div><strong>Instância WhatsApp:</strong> {dispatch.whatsapp_instance_label || '—'}{dispatch.whatsapp_phone_display ? ` (${dispatch.whatsapp_phone_display})` : ''}</div>
      <div><strong>Template:</strong> {dispatch.template_name || '—'}</div>
      <div><strong>Categoria (no envio):</strong> {dispatch.template_category === 'UTILITY' ? 'Utilidade' : dispatch.template_category === 'MARKETING' ? 'Marketing' : '—'}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <strong>Custo/msg:</strong>
        {editingCost ? (
          <div className="flex items-center gap-1">
            <span className="text-xs">R$</span>
            <Input
              className="h-6 w-[80px] text-xs"
              value={costValue}
              onChange={e => setCostValue(e.target.value)}
              placeholder="0.05"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSaveCost(); if (e.key === 'Escape') setEditingCost(false); }}
            />
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSaveCost}>
              <Check className="h-3 w-3 text-emerald-500" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingCost(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <span className="flex items-center gap-1">
            R$ {displayCost.toFixed(2)}
            <Button
              variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-40 hover:opacity-100"
              onClick={() => { setEditingCost(true); setCostValue(displayCost.toFixed(2)); }}
              title="Alterar custo por mensagem"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            {currentCost != null && currentCost !== categoryDefault && (
              <Badge variant="outline" className="text-[9px] px-1 py-0">personalizado</Badge>
            )}
          </span>
        )}
      </div>
      <div><strong>Público:</strong> {getAudienceLabel(dispatch.audience_source, dispatch.audience_filters)}</div>
      <div><strong>Reenvio forçado:</strong> {dispatch.force_resend ? 'Sim' : 'Não'}</div>
    </Card>
  );
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('dispatch_history')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!data || data.length === 0) {
        setDispatches([]);
        return;
      }

      const numberIds = [...new Set((data as any[]).map((d) => d.whatsapp_number_id).filter(Boolean))];
      const numberMap = new Map<string, { label: string | null; phone_display: string | null }>();

      if (numberIds.length > 0) {
        const { data: numbers } = await supabase
          .from('whatsapp_numbers')
          .select('id, label, phone_display')
          .in('id', numberIds);

        numbers?.forEach((n: any) => {
          numberMap.set(n.id, { label: n.label || null, phone_display: n.phone_display || null });
        });
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

        return {
          ...d,
          whatsapp_instance_label: numberMap.get(d.whatsapp_number_id)?.label || null,
          whatsapp_phone_display: numberMap.get(d.whatsapp_number_id)?.phone_display || null,
          stats,
        };
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
      // Fetch ALL recipients (up to 50k) using pagination
      let allRecipients: RecipientRow[] = [];
      let page = 0;
      const PAGE_SIZE = 1000;
      while (true) {
        const { data: batch } = await supabase
          .from('dispatch_recipients')
          .select('phone, recipient_name, status, message_wamid')
          .eq('dispatch_id', dispatch.id)
          .order('created_at', { ascending: true })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (!batch || batch.length === 0) break;
        allRecipients = allRecipients.concat(batch);
        if (batch.length < PAGE_SIZE) break;
        page++;
        if (allRecipients.length >= 50000) break;
      }

      setRecipients(allRecipients);

      // Get live statuses
      if (allRecipients.length > 0) {
        const phones = allRecipients.map((r: any) => {
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
      // Fetch ALL recipients from this dispatch (paginated)
      let recs: { phone: string; recipient_name: string | null }[] = [];
      let dupPage = 0;
      while (true) {
        const { data: batch } = await supabase
          .from('dispatch_recipients')
          .select('phone, recipient_name')
          .eq('dispatch_id', dispatch.id)
          .range(dupPage * 1000, (dupPage + 1) * 1000 - 1);
        if (!batch || batch.length === 0) break;
        recs = recs.concat(batch);
        if (batch.length < 1000) break;
        dupPage++;
      }

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

  const exportRecipients = (format: 'csv' | 'xls') => {
    if (recipients.length === 0) return;
    const header = ['Telefone', 'Nome', 'Status'];
    const rows = recipients.map((r) => {
      let formattedPhone = r.phone.replace(/\D/g, '');
      if (!formattedPhone.startsWith('55')) formattedPhone = '55' + formattedPhone;
      const liveStatus = recipientStats[formattedPhone] || r.status || 'pending';
      return [r.phone, r.recipient_name || '', liveStatus];
    });

    if (format === 'csv') {
      const csvContent = [header, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `destinatarios_${selectedDispatch?.template_name || 'disparo'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`CSV exportado com ${recipients.length} destinatários`);
    } else {
      // XLS (tab-separated, opens in Excel)
      const xlsContent = [header, ...rows].map(row => row.join('\t')).join('\n');
      const blob = new Blob(['\uFEFF' + xlsContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `destinatarios_${selectedDispatch?.template_name || 'disparo'}.xls`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`XLS exportado com ${recipients.length} destinatários`);
    }
  };

  const filteredDispatches = dispatches.filter((dispatch) => {
    const createdAt = new Date(dispatch.created_at).getTime();
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    if (fromTime && createdAt < fromTime) return false;
    if (toTime && createdAt > toTime) return false;
    return true;
  });

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Histórico de Disparos ({filteredDispatches.length}/{dispatches.length})
          </span>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-[150px] text-xs" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-[150px] text-xs" />
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }} className="h-7 px-2 text-xs">
              Limpar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadHistory()}
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
            <ScrollArea className="h-[620px] pr-3">
              <div className="space-y-2">
                {filteredDispatches.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Nenhum disparo encontrado no período.</div>
                ) : filteredDispatches.map((d) => {
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
                  Relatório: {selectedDispatch.campaign_name || selectedDispatch.template_name}
                </DialogTitle>
                {selectedDispatch.campaign_name && (
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    Template: {selectedDispatch.template_name}
                  </div>
                )}
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
                <DispatchMetadataCard
                  dispatch={selectedDispatch}
                  getAudienceLabel={getAudienceLabel}
                  onCostUpdate={(newCost) => {
                    setSelectedDispatch(prev => prev ? { ...prev, cost_per_message: newCost } as any : null);
                    setDispatches(prev => prev.map(d => d.id === selectedDispatch.id ? { ...d, cost_per_message: newCost } as any : d));
                  }}
                />

                {/* Message Preview */}
                {selectedDispatch.rendered_message && (
                  <Card className="p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Mensagem enviada:</div>
                    <div className="bg-[hsl(var(--muted))] rounded-lg p-3 text-sm whitespace-pre-wrap">
                      {selectedDispatch.rendered_message}
                    </div>
                  </Card>
                )}

                {/* Attribution Panel */}
                <DispatchAttributionPanel
                  dispatchId={selectedDispatch.id}
                  sentCount={selectedDispatch.sent_count || selectedDispatch.stats?.dispatched || 0}
                />

                {/* Recipients Table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">Destinatários ({recipients.length})</div>
                    {recipients.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => exportRecipients('csv')}>
                          <Download className="h-3 w-3" />CSV
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => exportRecipients('xls')}>
                          <FileSpreadsheet className="h-3 w-3" />XLS
                        </Button>
                      </div>
                    )}
                  </div>
                  {isLoadingDetail ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />Carregando...
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
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

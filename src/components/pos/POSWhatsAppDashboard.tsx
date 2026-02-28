import { useState, useEffect, useMemo, useCallback } from 'react';
import { BarChart3, MessageCircle, Clock, TrendingUp, Send, ArrowRight, RefreshCw, Inbox, MessageSquare, CreditCard, PhoneForwarded, UserRoundCog } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { subDays, startOfDay, format, getDay, getHours, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, Cell } from 'recharts';
import { ConversationStatusFilter } from '@/components/chat/ChatTypes';
import { useConversationEnrichment } from '@/hooks/useConversationEnrichment';

interface Props {
  storeId: string;
  sellerId: string;
  sellerName: string;
  onGoToChat: (filter?: ConversationStatusFilter) => void;
  onChangeSeller: () => void;
}

type Period = '7d' | '30d';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function POSWhatsAppDashboard({ storeId, sellerId, sellerName, onGoToChat, onChangeSeller }: Props) {
  const [period, setPeriod] = useState<Period>('7d');
  const [messages, setMessages] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [finishedConvos, setFinishedConvos] = useState<any[]>([]);
  const [storeNumberIds, setStoreNumberIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const { enrichConversations, finishedPhones, archivedPhones, awaitingPaymentPhones } = useConversationEnrichment();

  const dateFilter = useMemo(() => {
    const days = period === '7d' ? 7 : 30;
    return startOfDay(subDays(new Date(), days)).toISOString();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    const [msgsRes, assignRes, finishedRes, storeNumsRes] = await Promise.all([
      supabase
        .from('whatsapp_messages')
        .select('id, phone, direction, created_at, status, whatsapp_number_id, is_group')
        .order('created_at', { ascending: false }),
      supabase
        .from('chat_seller_assignments')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('store_id', storeId)
        .gte('assigned_at', dateFilter),
      supabase
        .from('chat_finished_conversations')
        .select('*')
        .eq('seller_id', sellerId)
        .gte('finished_at', dateFilter),
      supabase
        .from('pos_store_whatsapp_numbers')
        .select('whatsapp_number_id')
        .eq('store_id', storeId),
    ]);
    setMessages(msgsRes.data || []);
    setAssignments(assignRes.data || []);
    setFinishedConvos(finishedRes.data || []);
    setStoreNumberIds(new Set((storeNumsRes.data || []).map((r: any) => r.whatsapp_number_id)));
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [dateFilter, sellerId, storeId]);

  // ── Helper: check if a message belongs to this store's configured instances ──
  const isStoreMessage = useCallback((msg: any) => {
    // If store has no configured numbers, show all (backward compat)
    if (storeNumberIds.size === 0) return true;
    // Z-API messages have null whatsapp_number_id — always include them
    if (!msg.whatsapp_number_id) return true;
    // Meta messages: only include if the number is linked to this store
    return storeNumberIds.has(msg.whatsapp_number_id);
  }, [storeNumberIds]);

  // ── Status counters from ALL messages across store instances ──
  const statusCounters = useMemo(() => {
    const phoneMap = new Map<string, { direction: string }[]>();
    const allPhones = new Set<string>();
    for (const msg of messages) {
      if (!isStoreMessage(msg)) continue;
      allPhones.add(msg.phone);
      if (!phoneMap.has(msg.phone)) phoneMap.set(msg.phone, []);
      phoneMap.get(msg.phone)!.push({ direction: msg.direction });
    }

    let notStarted = 0;
    let awaitingReply = 0;
    let awaitingPayment = 0;
    let followUp = 0;

    for (const phone of allPhones) {
      if (finishedPhones.has(phone) || archivedPhones.has(phone)) continue;
      
      if (awaitingPaymentPhones.has(phone)) {
        awaitingPayment++;
        continue;
      }

      const msgs = phoneMap.get(phone) || [];
      if (msgs.length === 0) continue;
      const hasOutgoing = msgs.some(m => m.direction === 'outgoing');
      const lastMsg = msgs[0]; // sorted desc
      
      if (!hasOutgoing && lastMsg.direction === 'incoming') notStarted++;
      else if (lastMsg.direction === 'incoming') awaitingReply++;
      else if (lastMsg.direction === 'outgoing') followUp++;
    }

    return { notStarted, awaitingReply, awaitingPayment, followUp };
  }, [messages, finishedPhones, archivedPhones, awaitingPaymentPhones, isStoreMessage]);

  // ── KPI metrics ──
  const kpis = useMemo(() => {
    const incoming = messages.filter(m => m.direction === 'incoming').length;
    const outgoing = messages.filter(m => m.direction === 'outgoing').length;
    const totalConvos = assignments.length;
    const replied = assignments.filter(a => a.first_reply_at);
    const responseRate = totalConvos > 0 ? (replied.length / totalConvos * 100) : 0;

    const responseTimes = replied
      .map(a => {
        const opened = new Date(a.opened_at).getTime();
        const reply = new Date(a.first_reply_at).getTime();
        return (reply - opened) / 60000;
      })
      .filter(t => t > 0 && t < 1440);
    const avgResponseMin = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

    const reasons = { compra: 0, duvida: 0, suporte: 0 };
    for (const f of finishedConvos) {
      if (f.finish_reason === 'compra') reasons.compra++;
      else if (f.finish_reason === 'duvida') reasons.duvida++;
      else if (f.finish_reason === 'suporte') reasons.suporte++;
    }

    return { incoming, outgoing, totalConvos, responseRate, avgResponseMin, reasons };
  }, [messages, assignments, finishedConvos]);

  // ── Heatmap data ──
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const msg of messages.filter(m => m.direction === 'incoming')) {
      const d = parseISO(msg.created_at);
      grid[getDay(d)][getHours(d)]++;
    }
    // Find max for color scaling
    let max = 1;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    return { grid, max };
  }, [messages]);

  // ── Evolution chart data ──
  const evolutionData = useMemo(() => {
    const dayMap = new Map<string, { date: string; incoming: number; outgoing: number; finished: number }>();
    for (const msg of messages) {
      const day = format(parseISO(msg.created_at), 'dd/MM');
      if (!dayMap.has(day)) dayMap.set(day, { date: day, incoming: 0, outgoing: 0, finished: 0 });
      const entry = dayMap.get(day)!;
      if (msg.direction === 'incoming') entry.incoming++;
      else entry.outgoing++;
    }
    for (const f of finishedConvos) {
      const day = format(parseISO(f.finished_at), 'dd/MM');
      if (!dayMap.has(day)) dayMap.set(day, { date: day, incoming: 0, outgoing: 0, finished: 0 });
      dayMap.get(day)!.finished++;
    }
    return Array.from(dayMap.values());
  }, [messages, finishedConvos]);

  // ── Hourly volume bar chart ──
  const hourlyData = useMemo(() => {
    const hours = Array(24).fill(0);
    for (const msg of messages) {
      hours[getHours(parseISO(msg.created_at))]++;
    }
    return hours.map((count, h) => ({ hour: `${String(h).padStart(2, '0')}h`, msgs: count }));
  }, [messages]);

  const formatTime = (minutes: number | null) => {
    if (minutes === null) return '—';
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  };

  const getHeatColor = (val: number, max: number) => {
    if (val === 0) return 'bg-muted/30';
    const ratio = val / max;
    if (ratio < 0.25) return 'bg-emerald-100 dark:bg-emerald-950';
    if (ratio < 0.5) return 'bg-emerald-300 dark:bg-emerald-800';
    if (ratio < 0.75) return 'bg-emerald-500 dark:bg-emerald-600 text-white';
    return 'bg-emerald-700 dark:bg-emerald-500 text-white';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#f0f2f5] dark:bg-[#222e35]">
      {/* Header */}
      <div className="p-4 border-b border-[#e9edef] dark:border-[#313d45] bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-[#00a884]/20 flex items-center justify-center text-[#00a884] font-bold text-lg">
            {sellerName.charAt(0)}
          </div>
          <div>
            <h2 className="text-base font-bold">{sellerName}</h2>
            <p className="text-xs text-muted-foreground">Dashboard de Atendimento</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={onChangeSeller} title="Trocar vendedora">
            <UserRoundCog className="h-4 w-4" />
            <span className="hidden sm:inline">Trocar</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={loadData}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" className="h-8 gap-1 bg-[#00a884] hover:bg-[#00a884]/90 text-white" onClick={() => onGoToChat()}>
            Ir para Chat <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground">Carregando métricas...</div>
          ) : (
            <>
              {/* Clickable Status Counters */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button
                  onClick={() => onGoToChat('not_started')}
                  className="rounded-xl border-0 shadow-sm bg-blue-500/10 hover:bg-blue-500/20 transition-colors p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <Inbox className="h-4 w-4 text-blue-500" />
                    </div>
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Novas Mensagens</span>
                  </div>
                  <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{statusCounters.notStarted}</p>
                </button>

                <button
                  onClick={() => onGoToChat('awaiting_reply')}
                  className="rounded-xl border-0 shadow-sm bg-amber-500/10 hover:bg-amber-500/20 transition-colors p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <MessageSquare className="h-4 w-4 text-amber-500" />
                    </div>
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Aguardando Resposta</span>
                  </div>
                  <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{statusCounters.awaitingReply}</p>
                </button>

                <button
                  onClick={() => onGoToChat('awaiting_payment')}
                  className="rounded-xl border-0 shadow-sm bg-violet-500/10 hover:bg-violet-500/20 transition-colors p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-full bg-violet-500/20 flex items-center justify-center">
                      <CreditCard className="h-4 w-4 text-violet-500" />
                    </div>
                    <span className="text-xs font-medium text-violet-600 dark:text-violet-400">Aguardando Pagamento</span>
                  </div>
                  <p className="text-3xl font-bold text-violet-600 dark:text-violet-400">{statusCounters.awaitingPayment}</p>
                </button>

                <button
                  onClick={() => onGoToChat('awaiting_customer')}
                  className="rounded-xl border-0 shadow-sm bg-orange-500/10 hover:bg-orange-500/20 transition-colors p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <PhoneForwarded className="h-4 w-4 text-orange-500" />
                    </div>
                    <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Follow Up</span>
                  </div>
                  <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">{statusCounters.followUp}</p>
                </button>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                      <MessageCircle className="h-3.5 w-3.5 text-blue-500" />
                      <span className="text-[10px] font-medium">Recebidas</span>
                    </div>
                    <p className="text-xl font-bold">{kpis.incoming}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                      <Send className="h-3.5 w-3.5 text-[#00a884]" />
                      <span className="text-[10px] font-medium">Enviadas</span>
                    </div>
                    <p className="text-xl font-bold">{kpis.outgoing}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                      <TrendingUp className="h-3.5 w-3.5 text-[#00a884]" />
                      <span className="text-[10px] font-medium">Taxa Resposta</span>
                    </div>
                    <p className="text-xl font-bold">{kpis.responseRate.toFixed(0)}%</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-[10px] font-medium">Tempo Médio</span>
                    </div>
                    <p className="text-xl font-bold">{formatTime(kpis.avgResponseMin)}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                      <BarChart3 className="h-3.5 w-3.5 text-primary" />
                      <span className="text-[10px] font-medium">Atendimentos</span>
                    </div>
                    <p className="text-xl font-bold">{kpis.totalConvos}</p>
                    <div className="flex gap-1 mt-1">
                      <Badge variant="outline" className="text-[8px] px-1 py-0">🛒 {kpis.reasons.compra}</Badge>
                      <Badge variant="outline" className="text-[8px] px-1 py-0">❓ {kpis.reasons.duvida}</Badge>
                      <Badge variant="outline" className="text-[8px] px-1 py-0">🎧 {kpis.reasons.suporte}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Evolution chart */}
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-[#00a884]" />
                      Evolução Diária
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-3">
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={evolutionData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--background))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                        />
                        <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        <Line type="monotone" dataKey="incoming" name="Recebidas" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="outgoing" name="Enviadas" stroke="#00a884" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="finished" name="Finalizadas" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Hourly volume */}
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-blue-500" />
                      Volume por Hora
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-3">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={hourlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" interval={1} />
                        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--background))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                        />
                        <Bar dataKey="msgs" name="Mensagens" radius={[4, 4, 0, 0]}>
                          {hourlyData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.msgs > 0 ? '#00a884' : 'hsl(var(--muted))'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Heatmap */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-500" />
                    Heatmap de Atividade (Mensagens Recebidas)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 overflow-x-auto">
                  <div className="min-w-[600px]">
                    {/* Hour labels */}
                    <div className="flex ml-10 mb-1">
                      {HOURS.map(h => (
                        <div key={h} className="flex-1 text-center text-[8px] text-muted-foreground">
                          {h % 2 === 0 ? `${String(h).padStart(2, '0')}` : ''}
                        </div>
                      ))}
                    </div>
                    {/* Grid rows */}
                    {[1, 2, 3, 4, 5, 6, 0].map(dayIdx => (
                      <div key={dayIdx} className="flex items-center mb-0.5">
                        <span className="w-10 text-[10px] text-muted-foreground font-medium">{DAYS_PT[dayIdx]}</span>
                        <div className="flex flex-1 gap-0.5">
                          {HOURS.map(h => (
                            <div
                              key={h}
                              className={cn(
                                "flex-1 h-5 rounded-sm flex items-center justify-center text-[7px] font-medium transition-colors",
                                getHeatColor(heatmapData.grid[dayIdx][h], heatmapData.max)
                              )}
                              title={`${DAYS_PT[dayIdx]} ${String(h).padStart(2, '0')}h: ${heatmapData.grid[dayIdx][h]} msgs`}
                            >
                              {heatmapData.grid[dayIdx][h] > 0 ? heatmapData.grid[dayIdx][h] : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {/* Legend */}
                    <div className="flex items-center gap-2 mt-2 ml-10">
                      <span className="text-[9px] text-muted-foreground">Menos</span>
                      <div className="w-4 h-3 rounded-sm bg-muted/30" />
                      <div className="w-4 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-950" />
                      <div className="w-4 h-3 rounded-sm bg-emerald-300 dark:bg-emerald-800" />
                      <div className="w-4 h-3 rounded-sm bg-emerald-500 dark:bg-emerald-600" />
                      <div className="w-4 h-3 rounded-sm bg-emerald-700 dark:bg-emerald-500" />
                      <span className="text-[9px] text-muted-foreground">Mais</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

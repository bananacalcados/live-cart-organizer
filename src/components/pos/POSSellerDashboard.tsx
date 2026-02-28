import { useState, useEffect, useMemo } from 'react';
import { BarChart3, Clock, TrendingUp, Medal, Users, MessageCircle, ShoppingBag, Headphones, HelpCircle, Star, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { subDays, startOfDay } from 'date-fns';

interface Props {
  storeId: string;
}

interface SellerMetrics {
  sellerId: string;
  sellerName: string;
  totalConversations: number;
  totalReplied: number;
  totalNotReplied: number;
  avgResponseMinutes: number | null;
  finishReasons: { suporte: number; duvida: number; compra: number };
  conversionRate: number;
  npsAvg: number | null;
  npsCount: number;
}

type Period = '7d' | '30d' | 'all';

export function POSSellerDashboard({ storeId }: Props) {
  const [period, setPeriod] = useState<Period>('7d');
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [finishedConvos, setFinishedConvos] = useState<any[]>([]);
  const [npsSurveys, setNpsSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const dateFilter = useMemo(() => {
    if (period === 'all') return null;
    const days = period === '7d' ? 7 : 30;
    return startOfDay(subDays(new Date(), days)).toISOString();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    const [sellersRes, assignRes, finishedRes, npsRes] = await Promise.all([
      supabase.from('pos_sellers').select('id, name').eq('store_id', storeId).eq('is_active', true).order('name'),
      (() => {
        let q = supabase.from('chat_seller_assignments').select('*').eq('store_id', storeId);
        if (dateFilter) q = q.gte('assigned_at', dateFilter);
        return q;
      })(),
      (() => {
        let q = supabase.from('chat_finished_conversations').select('*').not('seller_id', 'is', null);
        if (dateFilter) q = q.gte('finished_at', dateFilter);
        return q;
      })(),
      (() => {
        let q = supabase.from('chat_nps_surveys').select('*');
        if (storeId) q = q.eq('store_id', storeId);
        if (dateFilter) q = q.gte('sent_at', dateFilter);
        return q;
      })(),
    ]);

    setSellers(sellersRes.data || []);
    setAssignments(assignRes.data || []);
    setFinishedConvos(finishedRes.data || []);
    setNpsSurveys(npsRes.data || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [storeId, dateFilter]);

  const metrics: SellerMetrics[] = useMemo(() => {
    return sellers.map(seller => {
      const sellerAssignments = assignments.filter(a => a.seller_id === seller.id);
      const replied = sellerAssignments.filter(a => a.first_reply_at);
      const notReplied = sellerAssignments.filter(a => !a.first_reply_at);

      // Avg response time
      const responseTimes = replied
        .map(a => {
          const opened = new Date(a.opened_at).getTime();
          const firstReply = new Date(a.first_reply_at).getTime();
          return (firstReply - opened) / 60000; // minutes
        })
        .filter(t => t > 0 && t < 1440); // filter outliers (> 24h)
      
      const avgResponse = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : null;

      // Finish reasons
      const sellerFinished = finishedConvos.filter(f => f.seller_id === seller.id);
      const reasons = { suporte: 0, duvida: 0, compra: 0 };
      for (const f of sellerFinished) {
        if (f.finish_reason === 'suporte') reasons.suporte++;
        else if (f.finish_reason === 'duvida') reasons.duvida++;
        else if (f.finish_reason === 'compra') reasons.compra++;
      }

      const totalFinished = reasons.suporte + reasons.duvida + reasons.compra;
      const conversionRate = totalFinished > 0 ? (reasons.compra / totalFinished) * 100 : 0;

      // NPS
      const sellerNps = npsSurveys.filter(n => n.seller_id === seller.id && n.score != null);
      const npsAvg = sellerNps.length > 0
        ? sellerNps.reduce((s, n) => s + n.score, 0) / sellerNps.length
        : null;

      return {
        sellerId: seller.id,
        sellerName: seller.name,
        totalConversations: sellerAssignments.length,
        totalReplied: replied.length,
        totalNotReplied: notReplied.length,
        avgResponseMinutes: avgResponse,
        finishReasons: reasons,
        conversionRate,
        npsAvg,
        npsCount: sellerNps.length,
      };
    }).sort((a, b) => b.conversionRate - a.conversionRate);
  }, [sellers, assignments, finishedConvos, npsSurveys]);

  // Global totals
  const totals = useMemo(() => {
    const totalConvos = metrics.reduce((s, m) => s + m.totalConversations, 0);
    const totalCompras = metrics.reduce((s, m) => s + m.finishReasons.compra, 0);
    const totalFinished = metrics.reduce((s, m) => s + m.finishReasons.compra + m.finishReasons.duvida + m.finishReasons.suporte, 0);
    const allNps = npsSurveys.filter(n => n.score != null);
    const avgNps = allNps.length > 0 ? allNps.reduce((s, n) => s + n.score, 0) / allNps.length : null;
    return { totalConvos, totalCompras, totalFinished, conversionRate: totalFinished > 0 ? (totalCompras / totalFinished * 100) : 0, avgNps, npsCount: allNps.length };
  }, [metrics, npsSurveys]);

  const formatTime = (minutes: number | null) => {
    if (minutes === null) return '—';
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Dashboard de Vendedores</h2>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="all">Todo período</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={loadData}>
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MessageCircle className="h-4 w-4" />
                  <span className="text-xs font-medium">Conversas</span>
                </div>
                <p className="text-2xl font-bold">{totals.totalConvos}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <ShoppingBag className="h-4 w-4" />
                  <span className="text-xs font-medium">Compras</span>
                </div>
                <p className="text-2xl font-bold">{totals.totalCompras}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">Taxa Conversão</span>
                </div>
                <p className="text-2xl font-bold text-primary">{totals.conversionRate.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Star className="h-4 w-4" />
                  <span className="text-xs font-medium">NPS Médio</span>
                </div>
                <p className="text-2xl font-bold">
                  {totals.avgNps !== null ? totals.avgNps.toFixed(1) : '—'}
                </p>
                {totals.npsCount > 0 && <p className="text-[10px] text-muted-foreground">{totals.npsCount} respostas</p>}
              </CardContent>
            </Card>
          </div>

          {/* Seller Ranking */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Medal className="h-4 w-4 text-primary" />
                Ranking de Vendedores
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
              ) : metrics.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  Nenhum vendedor encontrado
                </div>
              ) : (
                <div className="divide-y">
                  {metrics.map((m, idx) => (
                    <div key={m.sellerId} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                      {/* Rank */}
                      <div
                        className={cn(
                          "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 bg-muted text-foreground",
                          idx === 0 && "bg-primary/10 text-primary",
                          idx === 1 && "bg-accent text-accent-foreground",
                          idx === 2 && "bg-secondary text-secondary-foreground"
                        )}
                      >
                        {idx + 1}
                      </div>

                      {/* Name & stats */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{m.sellerName}</p>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-0.5">
                            <MessageCircle className="h-3 w-3" /> {m.totalConversations} conversas
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-3 w-3" /> {formatTime(m.avgResponseMinutes)}
                          </span>
                          {m.totalNotReplied > 0 && (
                            <span className="text-destructive">⚠️ {m.totalNotReplied} sem resposta</span>
                          )}
                        </div>
                      </div>

                      {/* Reasons breakdown */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 gap-0.5 border-border text-foreground">
                          <ShoppingBag className="h-2.5 w-2.5" /> {m.finishReasons.compra}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 gap-0.5 border-border text-foreground">
                          <HelpCircle className="h-2.5 w-2.5" /> {m.finishReasons.duvida}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 gap-0.5 border-border text-foreground">
                          <Headphones className="h-2.5 w-2.5" /> {m.finishReasons.suporte}
                        </Badge>
                      </div>

                      {/* Conversion rate */}
                      <div className="text-right flex-shrink-0 w-16">
                        <p className={cn(
                          "text-sm font-bold",
                          m.conversionRate >= 50 ? "text-primary" : m.conversionRate >= 25 ? "text-foreground" : "text-destructive"
                        )}>
                          {m.conversionRate.toFixed(0)}%
                        </p>
                        <p className="text-[9px] text-muted-foreground">conversão</p>
                      </div>

                      {/* NPS */}
                      <div className="text-right flex-shrink-0 w-12">
                        {m.npsAvg !== null ? (
                          <>
                            <p className={cn(
                              "text-sm font-bold",
                              m.npsAvg >= 9 ? "text-primary" : m.npsAvg >= 7 ? "text-foreground" : "text-destructive"
                            )}>
                              {m.npsAvg.toFixed(1)}
                            </p>
                            <p className="text-[9px] text-muted-foreground">NPS ({m.npsCount})</p>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">—</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

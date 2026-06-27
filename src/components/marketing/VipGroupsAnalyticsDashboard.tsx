import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, MessageSquare, BarChart3, TrendingUp, Crown, RefreshCw,
  Loader2, ThumbsUp, Vote, DollarSign, Trophy, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface OverviewRow {
  total_groups: number;
  total_members: number;
  total_memberships: number;
  total_activities: number;
  groups_with_activity: number;
}

interface InteractionRow {
  group_id: string;
  name: string;
  photo_url: string | null;
  member_count: number;
  poll_votes: number;
  messages: number;
  reactions: number;
  total_activities: number;
  active_members: number;
}

interface SalesRow {
  group_id: string;
  name: string;
  photo_url: string | null;
  buyers: number;
  sales_count: number;
  revenue: number;
}

interface LeadRow {
  phone: string;
  display_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  source_origins: any;
  groups_count: number;
  poll_votes: number;
  messages: number;
  reactions: number;
  total_activities: number;
  last_activity_at: string | null;
}

const currency = (n: number) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const digits = (s: string) => String(s || "").replace(/\D/g, "");

const ORIGIN_LABELS: Record<string, string> = {
  typebot: "Typebot",
  whatsapp: "WhatsApp",
  pos: "PDV",
  pdv: "PDV",
  shopify: "Site",
  site: "Site",
  zoppy: "Zoppy",
  instagram: "Instagram",
  ads: "Ads",
  manual: "Manual",
  live: "Live",
};

function originLabel(o: string) {
  const k = String(o || "").toLowerCase();
  return ORIGIN_LABELS[k] || o;
}

export function VipGroupsAnalyticsDashboard() {
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("90");
  const [overview, setOverview] = useState<OverviewRow | null>(null);
  const [interaction, setInteraction] = useState<InteractionRow[]>([]);
  const [sales, setSales] = useState<SalesRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const d = Number(days);
      const [ov, inter, sl, ld] = await Promise.all([
        supabase.rpc("vip_groups_overview"),
        supabase.rpc("vip_groups_interaction_ranking", { p_days: d }),
        supabase.rpc("vip_groups_sales_ranking", { p_window_days: 14, p_days: d }),
        supabase.rpc("vip_leads_ranking", { p_limit: 50, p_days: d }),
      ]);
      if (ov.error) throw ov.error;
      setOverview((ov.data?.[0] as OverviewRow) || null);
      setInteraction((inter.data as InteractionRow[]) || []);
      setSales((sl.data as SalesRow[]) || []);
      setLeads((ld.data as LeadRow[]) || []);
    } catch (e: any) {
      toast.error("Erro ao carregar dashboard: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Deduplica grupos pelos dígitos do JID (mesmo grupo salvo em várias instâncias).
  const dedupedInteraction = useMemo(() => {
    const byDigits = new Map<string, InteractionRow>();
    for (const r of interaction) {
      const k = digits(r.group_id) || r.group_id;
      const ex = byDigits.get(k);
      if (!ex) { byDigits.set(k, r); continue; }
      // mantém a linha com mais atividade/membros
      const score = (x: InteractionRow) => x.total_activities * 1000 + x.member_count;
      if (score(r) > score(ex)) byDigits.set(k, r);
    }
    return Array.from(byDigits.values()).sort(
      (a, b) => b.total_activities - a.total_activities || b.member_count - a.member_count
    );
  }, [interaction]);

  const dedupedSales = useMemo(() => {
    const byDigits = new Map<string, SalesRow>();
    for (const r of sales) {
      const k = digits(r.group_id) || r.group_id;
      const ex = byDigits.get(k);
      if (!ex || r.revenue > ex.revenue) byDigits.set(k, r);
    }
    return Array.from(byDigits.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  const stats = [
    { label: "Grupos ativos", value: overview?.total_groups ?? 0, icon: Crown, color: "text-amber-500" },
    { label: "Pessoas nos grupos", value: overview?.total_members ?? 0, icon: Users, color: "text-blue-500" },
    { label: "Interações (período)", value: overview?.total_activities ?? 0, icon: BarChart3, color: "text-emerald-500" },
    { label: "Grupos com interação", value: overview?.groups_with_activity ?? 0, icon: Sparkles, color: "text-fuchsia-500" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Trophy className="h-4 w-4 text-amber-500" /> Lead Scoring dos Grupos VIP
          </h3>
          <p className="text-xs text-muted-foreground">
            Engajamento, vendas atribuídas (até 14 dias após interagir) e ranking de leads.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="365">Último ano</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading} className="gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-muted p-2">
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none">{s.value.toLocaleString("pt-BR")}</p>
                <p className="text-[11px] text-muted-foreground mt-1 truncate">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="interaction">
        <TabsList>
          <TabsTrigger value="interaction" className="gap-1"><BarChart3 className="h-3.5 w-3.5" />Grupos por interação</TabsTrigger>
          <TabsTrigger value="sales" className="gap-1"><DollarSign className="h-3.5 w-3.5" />Grupos por venda</TabsTrigger>
          <TabsTrigger value="leads" className="gap-1"><TrendingUp className="h-3.5 w-3.5" />Ranking de leads</TabsTrigger>
        </TabsList>

        {/* GRUPOS POR INTERAÇÃO */}
        <TabsContent value="interaction" className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : dedupedInteraction.filter(g => g.total_activities > 0).length === 0 ? (
            <EmptyState text="Ainda não há interações registradas (votos, mensagens ou reações) nos grupos neste período." />
          ) : (
            <ScrollArea className="max-h-[460px]">
              <div className="space-y-1.5 pr-2">
                {dedupedInteraction.filter(g => g.total_activities > 0).map((g, i) => (
                  <Card key={g.group_id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <span className="text-xs font-bold w-5 text-center text-muted-foreground">{i + 1}</span>
                      <GroupAvatar photo={g.photo_url} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.name}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <Metric icon={Vote} value={g.poll_votes} label="votos" />
                          <Metric icon={MessageSquare} value={g.messages} label="msgs" />
                          <Metric icon={ThumbsUp} value={g.reactions} label="reações" />
                          <Metric icon={Users} value={g.active_members} label="ativos" />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{g.total_activities}</p>
                        <p className="text-[10px] text-muted-foreground">interações</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* GRUPOS POR VENDA */}
        <TabsContent value="sales" className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : dedupedSales.length === 0 ? (
            <EmptyState text="Nenhuma venda atribuída a interações em grupos neste período. As vendas aparecem quando um membro que interagiu compra em até 14 dias." />
          ) : (
            <ScrollArea className="max-h-[460px]">
              <div className="space-y-1.5 pr-2">
                {dedupedSales.map((g, i) => (
                  <Card key={g.group_id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <span className="text-xs font-bold w-5 text-center text-muted-foreground">{i + 1}</span>
                      <GroupAvatar photo={g.photo_url} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.name}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <Metric icon={Users} value={g.buyers} label="compradores" />
                          <Metric icon={DollarSign} value={g.sales_count} label="vendas" />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{currency(g.revenue)}</p>
                        <p className="text-[10px] text-muted-foreground">faturamento</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* RANKING DE LEADS */}
        <TabsContent value="leads" className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : leads.length === 0 ? (
            <EmptyState text="Ainda não há leads com interação registrada neste período." />
          ) : (
            <ScrollArea className="max-h-[460px]">
              <div className="space-y-1.5 pr-2">
                {leads.map((l, i) => {
                  const origins: string[] = Array.isArray(l.source_origins) ? l.source_origins : [];
                  return (
                    <Card key={l.phone + i}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <span className="text-xs font-bold w-5 text-center text-muted-foreground">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {l.customer_name || l.display_name || l.phone}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{l.phone}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                            <Metric icon={Vote} value={l.poll_votes} label="votos" />
                            <Metric icon={MessageSquare} value={l.messages} label="msgs" />
                            <Metric icon={ThumbsUp} value={l.reactions} label="reações" />
                            <Metric icon={Crown} value={l.groups_count} label="grupos" />
                            {origins.length > 0 ? (
                              origins.slice(0, 3).map((o) => (
                                <Badge key={o} variant="secondary" className="text-[9px] px-1.5 py-0">{originLabel(o)}</Badge>
                              ))
                            ) : (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">origem desconhecida</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold">{l.total_activities}</p>
                          <p className="text-[10px] text-muted-foreground">pontos</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ icon: Icon, value, label }: { icon: any; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Icon className="h-3 w-3" />
      <span className="font-semibold text-foreground">{value}</span>
      {label}
    </span>
  );
}

function GroupAvatar({ photo }: { photo: string | null }) {
  return photo ? (
    <img src={photo} alt="" className="h-9 w-9 rounded-full object-cover shrink-0" />
  ) : (
    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
      <Users className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-10 px-6">
      <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
      <p className="text-xs text-muted-foreground max-w-md mx-auto">{text}</p>
    </div>
  );
}

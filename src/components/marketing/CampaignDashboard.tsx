import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, UserPlus, UserMinus, Percent, BarChart3, CheckCircle,
  RefreshCw, Loader2, ArrowRightLeft, Link2
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CampaignDashboardProps {
  targetGroups: string[];
  allGroups: any[];
  links: any[];
  messages: any[];
  campaignId: string;
  onRefreshGroups?: () => Promise<void>;
}

interface KpiCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  tooltip?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

function KpiCard({ icon, value, label, tooltip, variant = 'default' }: KpiCardProps) {
  const variantClasses = {
    default: '',
    success: 'border-green-500/30',
    warning: 'border-yellow-500/30',
    danger: 'border-red-500/30',
  };

  const content = (
    <Card className={variantClasses[variant]}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="text-primary">{icon}</div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent><p className="text-xs max-w-[200px]">{tooltip}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return content;
}

const AUTO_REFRESH_INTERVAL = 30_000; // 30 seconds

export function CampaignDashboard({ targetGroups, allGroups: propGroups, links, messages, campaignId, onRefreshGroups }: CampaignDashboardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [liveLinks, setLiveLinks] = useState<any[]>(links);
  const [liveGroups, setLiveGroups] = useState<any[]>(propGroups);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep liveLinks in sync with prop changes
  useEffect(() => { setLiveLinks(links); }, [links]);
  useEffect(() => { setLiveGroups(propGroups); }, [propGroups]);

  // Fetch fresh group data directly from DB
  const fetchGroupsFromDb = useCallback(async () => {
    if (targetGroups.length === 0) return;
    const { data } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name, participant_count, previous_participant_count, max_participants')
      .in('id', targetGroups);
    if (data && data.length > 0) {
      setLiveGroups(prev => {
        const updated = [...prev];
        for (const fresh of data) {
          const idx = updated.findIndex(g => g.id === fresh.id);
          if (idx >= 0) updated[idx] = { ...updated[idx], ...fresh };
          else updated.push(fresh);
        }
        return updated;
      });
    }
  }, [targetGroups]);

  const campaignGroups = liveGroups.filter(g => targetGroups.includes(g.id));

  const totalParticipants = campaignGroups.reduce((sum, g) => sum + (g.participant_count || 0), 0);
  const totalGroups = campaignGroups.length;
  const fullGroups = campaignGroups.filter(g => g.participant_count >= (g.max_participants || 1000)).length;
  const availableGroups = totalGroups - fullGroups;

  // Fetch snapshots
  const fetchSnapshots = useCallback(async () => {
    if (targetGroups.length === 0) return;
    const { data } = await supabase
      .from('whatsapp_group_snapshots')
      .select('*')
      .in('group_id', targetGroups)
      .order('recorded_at', { ascending: true });
    setSnapshots(data || []);
  }, [targetGroups]);

  // Fetch latest link stats directly from DB
  const fetchLinkStats = useCallback(async () => {
    if (!campaignId) return;
    const { data } = await supabase
      .from('group_redirect_links')
      .select('*')
      .eq('campaign_id', campaignId);
    if (data) setLiveLinks(data);
  }, [campaignId]);

  // Initial sync: fetch group participant counts from WhatsApp on mount
  const initialSyncDone = useRef(false);
  useEffect(() => {
    fetchSnapshots();
    fetchLinkStats();
    // Auto-sync group participants on first load
    if (!initialSyncDone.current && campaignGroups.length > 0) {
      initialSyncDone.current = true;
      const syncParticipants = async () => {
        try {
          const groupIds = campaignGroups.map(g => g.group_id);
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-list-groups`, {
            method: 'POST',
            headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ syncToDb: true, filterGroupIds: groupIds }),
          });
          if (onRefreshGroups) await onRefreshGroups();
        } catch { /* ignore */ }
      };
      syncParticipants();
    }
  }, [fetchSnapshots, fetchLinkStats, campaignGroups, onRefreshGroups]);

  // Auto-refresh polling every 30s — includes group data refresh
  useEffect(() => {
    autoRefreshRef.current = setInterval(async () => {
      fetchLinkStats();
      fetchSnapshots();
      if (onRefreshGroups) await onRefreshGroups();
    }, AUTO_REFRESH_INTERVAL);

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchLinkStats, fetchSnapshots, onRefreshGroups]);

  // Realtime subscription for link stats
  useEffect(() => {
    if (!campaignId) return;
    const channel = supabase
      .channel(`dashboard-links-${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_redirect_links', filter: `campaign_id=eq.${campaignId}` },
        () => { fetchLinkStats(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [campaignId, fetchLinkStats]);

  // Calculate deltas from snapshots
  const getDeltas = () => {
    if (snapshots.length === 0) {
      let entered = 0;
      let exited = 0;
      campaignGroups.forEach(g => {
        const prev = g.previous_participant_count || 0;
        const current = g.participant_count || 0;
        const delta = current - prev;
        if (delta > 0) entered += delta;
        else if (delta < 0) exited += Math.abs(delta);
      });
      return { entered, exited };
    }

    const byGroup = new Map<string, any[]>();
    snapshots.forEach(s => {
      const arr = byGroup.get(s.group_id) || [];
      arr.push(s);
      byGroup.set(s.group_id, arr);
    });

    let entered = 0;
    let exited = 0;
    byGroup.forEach(snaps => {
      if (snaps.length < 2) return;
      const first = snaps[0].participant_count;
      const last = snaps[snaps.length - 1].participant_count;
      const delta = last - first;
      if (delta > 0) entered += delta;
      else if (delta < 0) exited += Math.abs(delta);
    });

    return { entered, exited };
  };

  const { entered, exited } = getDeltas();
  const entryRate = totalParticipants > 0 ? ((entered / (entered + exited || 1)) * 100).toFixed(1) : '0';

  // Use liveLinks for click/redirect stats
  const totalClicks = liveLinks.reduce((sum: number, l: any) => sum + (l.click_count || 0), 0);
  const totalRedirects = liveLinks.reduce((sum: number, l: any) => sum + (l.redirect_count || 0), 0);
  const sentMessages = messages.filter((m: any) => m.status === 'sent').length;
  const pendingMessages = messages.filter((m: any) => m.status === 'pending').length;

  // Conversion rates
  const clickToRedirectRate = totalClicks > 0 ? ((totalRedirects / totalClicks) * 100).toFixed(1) : '0';
  const clickToEntryRate = totalClicks > 0 ? ((entered / totalClicks) * 100).toFixed(1) : '0';

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      const campaignGroupIds = campaignGroups.map(g => g.group_id);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-list-groups`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncToDb: true, filterGroupIds: campaignGroupIds }),
      });
      await res.json();
      if (onRefreshGroups) await onRefreshGroups();
      await Promise.all([fetchSnapshots(), fetchLinkStats()]);
    } catch { /* ignore */ }
    finally { setIsRefreshing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">VISÃO GERAL DA CAMPANHA</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Atualização automática a cada 30s</span>
          <Button variant="outline" size="sm" onClick={refreshData} disabled={isRefreshing} className="gap-1">
            {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPI Row 1 - Conversion funnel */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          icon={<BarChart3 className="h-5 w-5" />}
          value={totalClicks.toLocaleString('pt-BR')}
          label="Clicks no link"
          tooltip="Total de vezes que o link de redirecionamento foi acessado"
        />
        <KpiCard
          icon={<ArrowRightLeft className="h-5 w-5" />}
          value={totalRedirects.toLocaleString('pt-BR')}
          label="Redirecionados"
          tooltip="Usuários que foram redirecionados com sucesso para o WhatsApp"
        />
        <KpiCard
          icon={<UserPlus className="h-5 w-5" />}
          value={entered.toLocaleString('pt-BR')}
          label="Entraram no grupo"
          tooltip="Participantes que de fato entraram no grupo"
        />
        <KpiCard
          icon={<Link2 className="h-5 w-5" />}
          value={`${clickToRedirectRate}%`}
          label="Conv. click → redirect"
          tooltip="Taxa de conversão: cliques que resultaram em redirecionamento. Se < 100%, o link pode estar com problema"
          variant={Number(clickToRedirectRate) >= 90 ? 'success' : Number(clickToRedirectRate) >= 50 ? 'warning' : 'danger'}
        />
        <KpiCard
          icon={<Percent className="h-5 w-5" />}
          value={`${clickToEntryRate}%`}
          label="Conv. click → entrada"
          tooltip="Taxa de conversão: cliques que resultaram em entrada efetiva no grupo"
          variant={Number(clickToEntryRate) >= 50 ? 'success' : Number(clickToEntryRate) >= 20 ? 'warning' : 'danger'}
        />
      </div>

      {/* KPI Row 2 - Group metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          value={totalParticipants.toLocaleString('pt-BR')}
          label="Participantes"
        />
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          value={totalGroups}
          label="Grupos"
        />
        <KpiCard
          icon={<CheckCircle className="h-5 w-5" />}
          value={fullGroups}
          label="Grupos cheios"
        />
        <KpiCard
          icon={<UserMinus className="h-5 w-5" />}
          value={exited.toLocaleString('pt-BR')}
          label="Saíram"
        />
      </div>

      {/* KPI Row 3 - Messages */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard
          icon={<CheckCircle className="h-5 w-5" />}
          value={sentMessages}
          label="Mensagens enviadas"
        />
        <KpiCard
          icon={<RefreshCw className="h-5 w-5" />}
          value={pendingMessages}
          label="Mensagens pendentes"
        />
        <KpiCard
          icon={<Percent className="h-5 w-5" />}
          value={entryRate}
          label="% retenção (entrada vs saída)"
        />
      </div>

      {/* Per-link conversion table */}
      {liveLinks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">CONVERSÃO POR LINK</p>
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-2 font-medium">Slug</th>
                  <th className="text-right p-2 font-medium">Clicks</th>
                  <th className="text-right p-2 font-medium">Redirects</th>
                  <th className="text-right p-2 font-medium">Conv. %</th>
                  <th className="text-center p-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {liveLinks.map((link: any) => {
                  const clicks = link.click_count || 0;
                  const redirects = link.redirect_count || 0;
                  const conv = clicks > 0 ? ((redirects / clicks) * 100).toFixed(1) : '—';
                  const convNum = clicks > 0 ? (redirects / clicks) * 100 : -1;
                  return (
                    <tr key={link.id} className="border-t border-border/50">
                      <td className="p-2 font-mono">{link.slug}</td>
                      <td className="text-right p-2">{clicks.toLocaleString('pt-BR')}</td>
                      <td className="text-right p-2">{redirects.toLocaleString('pt-BR')}</td>
                      <td className="text-right p-2 font-semibold">
                        {convNum >= 0 ? (
                          <span className={convNum >= 90 ? 'text-green-500' : convNum >= 50 ? 'text-yellow-500' : 'text-red-500'}>
                            {conv}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-center p-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${link.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

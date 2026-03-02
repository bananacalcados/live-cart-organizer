import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, UserPlus, UserMinus, Percent, BarChart3, CheckCircle,
  RefreshCw, Loader2
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface CampaignDashboardProps {
  targetGroups: string[];
  allGroups: any[];
  links: any[];
  messages: any[];
  campaignId: string;
}

interface KpiCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}

function KpiCard({ icon, value, label }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="text-primary">{icon}</div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function CampaignDashboard({ targetGroups, allGroups, links, messages, campaignId }: CampaignDashboardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [snapshots, setSnapshots] = useState<any[]>([]);

  const campaignGroups = allGroups.filter(g => targetGroups.includes(g.id));

  const totalParticipants = campaignGroups.reduce((sum, g) => sum + (g.participant_count || 0), 0);
  const totalGroups = campaignGroups.length;
  const fullGroups = campaignGroups.filter(g => g.participant_count >= (g.max_participants || 1000)).length;
  const availableGroups = totalGroups - fullGroups;

  // Calculate entries/exits from snapshots
  const fetchSnapshots = useCallback(async () => {
    if (targetGroups.length === 0) return;
    const { data } = await supabase
      .from('whatsapp_group_snapshots')
      .select('*')
      .in('group_id', targetGroups)
      .order('recorded_at', { ascending: true });
    setSnapshots(data || []);
  }, [targetGroups]);

  useEffect(() => { fetchSnapshots(); }, [fetchSnapshots]);

  // Calculate deltas from snapshots
  const getDeltas = () => {
    if (snapshots.length === 0) {
      // Fallback: use previous_participant_count from allGroups
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

    // Group snapshots by group_id, get first and last
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

  const totalClicks = links.reduce((sum: number, l: any) => sum + (l.click_count || 0), 0);
  const totalRedirects = links.reduce((sum: number, l: any) => sum + (l.redirect_count || 0), 0);
  const sentMessages = messages.filter((m: any) => m.status === 'sent').length;
  const pendingMessages = messages.filter((m: any) => m.status === 'pending').length;

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-list-groups`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncToDb: true }),
      });
      await res.json();
      await fetchSnapshots();
    } catch { /* ignore */ }
    finally { setIsRefreshing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">VISÃO GERAL DA CAMPANHA</p>
        <Button variant="outline" size="sm" onClick={refreshData} disabled={isRefreshing} className="gap-1">
          {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {/* KPI Row 1 - Main metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<BarChart3 className="h-5 w-5" />}
          value={totalClicks.toLocaleString('pt-BR')}
          label="Clicks"
        />
        <KpiCard
          icon={<UserPlus className="h-5 w-5" />}
          value={entered.toLocaleString('pt-BR')}
          label="Entraram"
        />
        <KpiCard
          icon={<Percent className="h-5 w-5" />}
          value={entryRate}
          label="Percentual de entrada"
        />
        <KpiCard
          icon={<UserMinus className="h-5 w-5" />}
          value={exited.toLocaleString('pt-BR')}
          label="Saíram"
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
          icon={<Users className="h-5 w-5" />}
          value={availableGroups}
          label="Grupos disponíveis"
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
          icon={<BarChart3 className="h-5 w-5" />}
          value={totalRedirects.toLocaleString('pt-BR')}
          label="Redirecionamentos"
        />
      </div>
    </div>
  );
}

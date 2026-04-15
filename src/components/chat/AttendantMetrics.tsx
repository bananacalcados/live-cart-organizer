import { useState, useEffect, useCallback } from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Metrics {
  user_id: string;
  display_name: string;
  total_conversations: number;
  active_conversations: number;
  finished_conversations: number;
  total_messages_sent: number;
  total_messages_received: number;
  avg_first_response_minutes: number | null;
  conversations_today: number;
}

interface AttendantMetricsProps {
  isAdmin?: boolean;
}

export function AttendantMetrics({ isAdmin }: AttendantMetricsProps) {
  const [expanded, setExpanded] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("me");
  const [agents, setAgents] = useState<{ user_id: string; display_name: string }[]>([]);

  const loadMetrics = useCallback(async () => {
    if (!expanded) return;
    setLoading(true);
    try {
      const userId = selectedUserId === "me" ? undefined : selectedUserId;
      
      let currentUserId: string | undefined;
      if (!userId) {
        const { data: { user } } = await supabase.auth.getUser();
        currentUserId = user?.id;
      }

      const { data, error } = await supabase.rpc("get_attendant_metrics", {
        p_user_id: userId || currentUserId || null,
      });

      if (!error && data && data.length > 0) {
        setMetrics(data[0] as unknown as Metrics);
      } else {
        setMetrics(null);
      }
    } catch {
      setMetrics(null);
    }
    setLoading(false);
  }, [expanded, selectedUserId]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (!expanded) return;
    const interval = setInterval(loadMetrics, 60_000);
    return () => clearInterval(interval);
  }, [expanded, loadMetrics]);

  // Load agents list for admin dropdown
  useEffect(() => {
    if (!isAdmin || !expanded) return;
    supabase.from("profiles").select("user_id, display_name").then(({ data }) => {
      if (data) setAgents(data.filter(a => a.display_name));
    });
  }, [isAdmin, expanded]);

  return (
    <div className="mx-2 mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942] transition-colors"
      >
        <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
        <span>Métricas</span>
        {expanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {isAdmin && agents.length > 0 && (
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="h-7 text-[10px] bg-[#202c33] border-[#3b4a54] text-[#e9edef]">
                <SelectValue placeholder="Meus dados" />
              </SelectTrigger>
              <SelectContent className="bg-[#233138] border-[#3b4a54]">
                <SelectItem value="me" className="text-[#e9edef] text-xs">Meus dados</SelectItem>
                {agents.map(a => (
                  <SelectItem key={a.user_id} value={a.user_id} className="text-[#e9edef] text-xs">
                    {a.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {loading ? (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 bg-[#1a2228]" />
              ))}
            </div>
          ) : !metrics ? (
            <p className="text-[10px] text-[#8696a0] text-center py-3">Sem dados para o período selecionado</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              <MetricCard label="Hoje" value={metrics.conversations_today} />
              <MetricCard label="Ativas" value={metrics.active_conversations} />
              <MetricCard label="Finalizadas" value={metrics.finished_conversations} />
              <MetricCard
                label="Tempo resp."
                value={metrics.avg_first_response_minutes != null ? `${metrics.avg_first_response_minutes} min` : "—"}
              />
              <MetricCard label="Enviadas" value={metrics.total_messages_sent} />
              <MetricCard label="Recebidas" value={metrics.total_messages_received} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#1a2228] rounded-lg px-2 py-2 text-center">
      <p className="text-emerald-400 font-bold text-base leading-tight">{value}</p>
      <p className="text-[9px] text-[#8696a0] mt-0.5">{label}</p>
    </div>
  );
}

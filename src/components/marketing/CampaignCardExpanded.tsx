import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  MessageSquare, Instagram, Mail, Store, Globe, Sparkles,
  Calendar, ListChecks, ChevronDown, ChevronUp, CheckCircle2, Circle,
  Target, Send
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Trash2 } from "lucide-react";

const CHANNEL_META: Record<string, { icon: typeof Send; label: string; color: string; bg: string }> = {
  whatsapp: { icon: MessageSquare, label: "WhatsApp", color: "text-emerald-600", bg: "bg-emerald-500/10 border-emerald-500/30" },
  instagram: { icon: Instagram, label: "Instagram", color: "text-pink-600", bg: "bg-pink-500/10 border-pink-500/30" },
  email: { icon: Mail, label: "Email", color: "text-blue-600", bg: "bg-blue-500/10 border-blue-500/30" },
  loja_fisica: { icon: Store, label: "Loja Física", color: "text-amber-600", bg: "bg-amber-500/10 border-amber-500/30" },
  site: { icon: Globe, label: "Site", color: "text-violet-600", bg: "bg-violet-500/10 border-violet-500/30" },
  outros: { icon: Sparkles, label: "Outros", color: "text-cyan-600", bg: "bg-cyan-500/10 border-cyan-500/30" },
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  sending: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho", review: "Em Revisão", approved: "Aprovada", sending: "Enviando", completed: "Concluída",
};

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  channels: string[] | null;
  start_date?: string;
  end_date?: string;
  budget?: number;
  created_at: string;
}

interface ChannelRecord {
  id: string;
  channel_type: string;
  strategy: string | null;
  tone_of_voice: string | null;
  content_plan: any[];
}

interface TaskRecord {
  id: string;
  channel_id: string | null;
  title: string;
  status: string;
  due_date: string | null;
}

interface Props {
  campaign: Campaign;
  onOpenDetail: () => void;
  onDelete: () => void;
}

export function CampaignCardExpanded({ campaign, onOpenDetail, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const isActive = ['approved', 'sending', 'review'].includes(campaign.status);

  const loadDetails = useCallback(async () => {
    if (loaded) return;
    const [chRes, tkRes] = await Promise.all([
      supabase.from('campaign_channels').select('id, channel_type, strategy, tone_of_voice, content_plan').eq('campaign_id', campaign.id).order('created_at'),
      supabase.from('campaign_tasks').select('id, channel_id, title, status, due_date').eq('campaign_id', campaign.id).order('sort_order'),
    ]);
    setChannels((chRes.data || []) as ChannelRecord[]);
    setTasks((tkRes.data || []) as TaskRecord[]);
    setLoaded(true);
  }, [campaign.id, loaded]);

  useEffect(() => {
    if (expanded && !loaded) loadDetails();
  }, [expanded, loaded, loadDetails]);

  const toggleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    const { error } = await supabase.from('campaign_tasks').update({ status: newStatus }).eq('id', taskId);
    if (!error) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
  };

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-4 pb-3 px-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpenDetail}>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm truncate">{campaign.name}</h3>
              <Badge className={`text-[10px] ${STATUS_COLORS[campaign.status] || ''}`}>
                {STATUS_LABELS[campaign.status] || campaign.status}
              </Badge>
            </div>
            {campaign.description && <p className="text-xs text-muted-foreground line-clamp-1">{campaign.description}</p>}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {campaign.channels?.map(ch => {
                const meta = CHANNEL_META[ch] || CHANNEL_META.outros;
                const Icon = meta.icon;
                return <Badge key={ch} variant="outline" className={`text-[10px] gap-0.5 ${meta.bg}`}><Icon className="h-2.5 w-2.5" />{meta.label}</Badge>;
              })}
              {campaign.start_date && <span className="text-[10px] text-muted-foreground">📅 {campaign.start_date}</span>}
              {campaign.budget ? <span className="text-[10px] text-muted-foreground">💰 {formatCurrency(campaign.budget)}</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Expanded Steps */}
        {expanded && loaded && (
          <div className="mt-4 space-y-4 border-t pt-4">
            {/* Progress bar */}
            {totalTasks > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold">Progresso</span>
                  <span className="text-xs text-muted-foreground">{doneCount}/{totalTasks} ({progress}%)</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {/* Channels with steps */}
            <div className="grid gap-3 md:grid-cols-2">
              {channels.map(ch => {
                const meta = CHANNEL_META[ch.channel_type] || CHANNEL_META.outros;
                const Icon = meta.icon;
                const chTasks = tasks.filter(t => t.channel_id === ch.id);
                const chDone = chTasks.filter(t => t.status === 'done').length;
                const contentPlan = Array.isArray(ch.content_plan) ? ch.content_plan : [];

                return (
                  <div key={ch.id} className={`rounded-lg border p-3 space-y-2 ${meta.bg}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${meta.color}`} />
                        <span className="text-sm font-semibold">{meta.label}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{chDone}/{chTasks.length}</span>
                    </div>

                    {ch.strategy && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{ch.strategy}</p>
                    )}

                    {/* Cronograma items */}
                    {contentPlan.length > 0 && (
                      <div className="space-y-1">
                        <h6 className="text-[10px] font-semibold flex items-center gap-1 text-muted-foreground">
                          <Calendar className="h-2.5 w-2.5" />Cronograma
                        </h6>
                        {contentPlan.slice(0, 3).map((cp: any, i: number) => (
                          <div key={i} className="flex items-start gap-1.5 text-[11px]">
                            <Badge variant="outline" className="text-[9px] shrink-0 px-1 py-0">D{cp.day_offset}</Badge>
                            <span className="text-muted-foreground truncate">{cp.title}</span>
                          </div>
                        ))}
                        {contentPlan.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{contentPlan.length - 3} mais...</span>
                        )}
                      </div>
                    )}

                    {/* Tasks checklist */}
                    {chTasks.length > 0 && (
                      <div className="space-y-1">
                        <h6 className="text-[10px] font-semibold flex items-center gap-1 text-muted-foreground">
                          <ListChecks className="h-2.5 w-2.5" />Tarefas
                        </h6>
                        {chTasks.map(t => (
                          <div key={t.id}
                            className={`flex items-center gap-1.5 text-[11px] cursor-pointer rounded px-1 py-0.5 hover:bg-background/50 transition-colors ${t.status === 'done' ? 'opacity-50' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleTask(t.id); }}
                          >
                            <Checkbox checked={t.status === 'done'} className="h-3 w-3" />
                            <span className={t.status === 'done' ? 'line-through' : ''}>{t.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={onOpenDetail}>
              <Target className="h-3 w-3" />Ver detalhes completos
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

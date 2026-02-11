import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Clock, Send, Trash2, Eye, Calendar,
  ListChecks, MessageSquare, Instagram, Mail, Store, Globe, Sparkles,
  Target, BarChart3, DollarSign, Users, TrendingUp, ChevronRight,
  Pencil, Save, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

const CHANNEL_META: Record<string, { icon: typeof Send; label: string; color: string }> = {
  whatsapp: { icon: MessageSquare, label: "WhatsApp", color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
  instagram: { icon: Instagram, label: "Instagram", color: "text-pink-600 bg-pink-500/10 border-pink-500/30" },
  email: { icon: Mail, label: "Email", color: "text-blue-600 bg-blue-500/10 border-blue-500/30" },
  loja_fisica: { icon: Store, label: "Loja Física", color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
  site: { icon: Globe, label: "Site", color: "text-violet-600 bg-violet-500/10 border-violet-500/30" },
  outros: { icon: Sparkles, label: "Outros", color: "text-cyan-600 bg-cyan-500/10 border-cyan-500/30" },
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
  objective: string | null;
  target_audience: string | null;
  ai_strategy: any;
  channels: string[] | null;
  start_date?: string;
  end_date?: string;
  budget?: number;
  actual_cost?: number;
  attributed_revenue?: number;
  attributed_orders?: number;
  leads_captured?: number;
  people_reached?: number;
  total_recipients: number | null;
  sent_count: number | null;
  delivered_count: number | null;
  read_count: number | null;
  created_at: string;
}

interface ChannelRecord {
  id: string;
  campaign_id: string;
  channel_type: string;
  strategy: string | null;
  tone_of_voice: string | null;
  content_plan: any[];
  schedule: any[];
  notes: string | null;
}

interface TaskRecord {
  id: string;
  campaign_id: string;
  channel_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  sort_order: number;
}

interface Props {
  campaign: Campaign | null;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
}

export function CampaignDetail({ campaign, onClose, onStatusChange }: Props) {
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editStrategy, setEditStrategy] = useState("");
  const [editTone, setEditTone] = useState("");

  const fetchData = useCallback(async () => {
    if (!campaign) return;
    const [chRes, tkRes] = await Promise.all([
      supabase.from('campaign_channels').select('*').eq('campaign_id', campaign.id).order('created_at'),
      supabase.from('campaign_tasks').select('*').eq('campaign_id', campaign.id).order('sort_order'),
    ]);
    setChannels((chRes.data || []) as ChannelRecord[]);
    setTasks((tkRes.data || []) as TaskRecord[]);
  }, [campaign]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    const { error } = await supabase.from('campaign_tasks').update({ status: newStatus }).eq('id', taskId);
    if (!error) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
  };

  const startEditChannel = (ch: ChannelRecord) => {
    setEditingChannel(ch.id);
    setEditStrategy(ch.strategy || "");
    setEditTone(ch.tone_of_voice || "");
  };

  const saveChannelEdit = async (channelId: string) => {
    const { error } = await supabase.from('campaign_channels').update({
      strategy: editStrategy,
      tone_of_voice: editTone,
    }).eq('id', channelId);
    if (error) { toast.error("Erro ao salvar"); return; }
    setChannels(prev => prev.map(c => c.id === channelId ? { ...c, strategy: editStrategy, tone_of_voice: editTone } : c));
    setEditingChannel(null);
    toast.success("Estratégia atualizada!");
  };

  if (!campaign) return null;

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <Dialog open={!!campaign} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {campaign.name}
            <Badge className={`text-[10px] ${STATUS_COLORS[campaign.status] || ''}`}>
              {STATUS_LABELS[campaign.status] || campaign.status}
            </Badge>
          </DialogTitle>
          {campaign.description && <p className="text-sm text-muted-foreground">{campaign.description}</p>}
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="bg-transparent p-0 gap-1 shrink-0 flex-wrap h-auto">
            <TabsTrigger value="overview" className="gap-1 text-xs"><Target className="h-3 w-3" />Visão Geral</TabsTrigger>
            {channels.map(ch => {
              const meta = CHANNEL_META[ch.channel_type] || CHANNEL_META.outros;
              const Icon = meta.icon;
              return (
                <TabsTrigger key={ch.id} value={ch.channel_type} className={`gap-1 text-xs border ${meta.color}`}>
                  <Icon className="h-3 w-3" />{meta.label}
                </TabsTrigger>
              );
            })}
            <TabsTrigger value="checklist" className="gap-1 text-xs"><ListChecks className="h-3 w-3" />Checklist</TabsTrigger>
            <TabsTrigger value="metrics" className="gap-1 text-xs"><BarChart3 className="h-3 w-3" />Métricas</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0 mt-3">
            {/* OVERVIEW */}
            <TabsContent value="overview" className="space-y-3 mt-0">
              {/* Progress */}
              <Card>
                <CardContent className="pt-3 pb-3 px-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold">Progresso Geral</span>
                    <span className="text-xs text-muted-foreground">{doneCount}/{totalTasks} tarefas ({progress}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </CardContent>
              </Card>

              {/* Dates & Budget */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <Calendar className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs text-muted-foreground">Início</p>
                  <p className="text-sm font-semibold">{campaign.start_date || '—'}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <Calendar className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs text-muted-foreground">Término</p>
                  <p className="text-sm font-semibold">{campaign.end_date || '—'}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <DollarSign className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs text-muted-foreground">Orçamento</p>
                  <p className="text-sm font-semibold">{campaign.budget ? formatCurrency(campaign.budget) : '—'}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <Target className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs text-muted-foreground">Canais</p>
                  <p className="text-sm font-semibold">{channels.length}</p>
                </CardContent></Card>
              </div>

              {/* Channels summary */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground">Canais Ativos</h4>
                {channels.map(ch => {
                  const meta = CHANNEL_META[ch.channel_type] || CHANNEL_META.outros;
                  const Icon = meta.icon;
                  const chTasks = tasks.filter(t => t.channel_id === ch.id);
                  const chDone = chTasks.filter(t => t.status === 'done').length;
                  return (
                    <Card key={ch.id} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => setActiveTab(ch.channel_type)}>
                      <CardContent className="pt-3 pb-2 px-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${meta.color}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{meta.label}</p>
                            <p className="text-xs text-muted-foreground">{chTasks.length} tarefas • {chDone} concluídas</p>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            {/* CHANNEL TABS */}
            {channels.map(ch => {
              const meta = CHANNEL_META[ch.channel_type] || CHANNEL_META.outros;
              const chTasks = tasks.filter(t => t.channel_id === ch.id);
              const contentPlan = Array.isArray(ch.content_plan) ? ch.content_plan : [];
              const isEditing = editingChannel === ch.id;
              return (
                <TabsContent key={ch.id} value={ch.channel_type} className="space-y-3 mt-0">
                  {/* Strategy - editable */}
                  <Card>
                    <CardContent className="pt-3 pb-3 px-4">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-semibold text-muted-foreground">Estratégia</h5>
                        {!isEditing ? (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => startEditChannel(ch)}>
                            <Pencil className="h-3 w-3" />Editar
                          </Button>
                        ) : (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setEditingChannel(null)}>
                              <X className="h-3 w-3" />Cancelar
                            </Button>
                            <Button size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => saveChannelEdit(ch.id)}>
                              <Save className="h-3 w-3" />Salvar
                            </Button>
                          </div>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <Textarea value={editStrategy} onChange={e => setEditStrategy(e.target.value)} rows={4} className="text-sm" />
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">🎤 Tom:</span>
                            <Input value={editTone} onChange={e => setEditTone(e.target.value)} className="text-xs h-7" />
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm">{ch.strategy}</p>
                          {ch.tone_of_voice && <Badge variant="secondary" className="text-[10px] mt-1">🎤 Tom: {ch.tone_of_voice}</Badge>}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  {/* Cronograma */}
                  {contentPlan.length > 0 && (
                    <div className="space-y-1.5">
                      <h5 className="text-xs font-semibold flex items-center gap-1"><Calendar className="h-3 w-3" />Cronograma</h5>
                      {contentPlan.map((cp: any, i: number) => (
                        <div key={i} className="flex gap-2 text-xs items-start border rounded-md p-2">
                          <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">Dia {cp.day_offset}</Badge>
                          <div className="min-w-0">
                            <p className="font-medium">{cp.title}</p>
                            <p className="text-muted-foreground">{cp.description}</p>
                            {cp.content_suggestion && <p className="italic text-muted-foreground mt-0.5">💬 {cp.content_suggestion}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tasks */}
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-semibold flex items-center gap-1"><ListChecks className="h-3 w-3" />Checklist ({chTasks.length})</h5>
                    {chTasks.map(t => (
                      <div key={t.id} className={`flex items-center gap-2 text-xs border rounded-md p-2 cursor-pointer ${t.status === 'done' ? 'opacity-60' : ''}`}
                        onClick={() => toggleTask(t.id)}
                      >
                        <Checkbox checked={t.status === 'done'} />
                        <span className={t.status === 'done' ? 'line-through' : 'font-medium'}>{t.title}</span>
                        {t.due_date && <Badge variant="outline" className="text-[9px] ml-auto">{t.due_date}</Badge>}
                      </div>
                    ))}
                  </div>
                </TabsContent>
              );
            })}

            {/* CHECKLIST ALL */}
            <TabsContent value="checklist" className="space-y-3 mt-0">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-semibold">Todas as Tarefas ({totalTasks})</h4>
                <span className="text-xs text-muted-foreground">{doneCount} concluídas ({progress}%)</span>
              </div>
              {channels.map(ch => {
                const meta = CHANNEL_META[ch.channel_type] || CHANNEL_META.outros;
                const Icon = meta.icon;
                const chTasks = tasks.filter(t => t.channel_id === ch.id);
                if (chTasks.length === 0) return null;
                return (
                  <div key={ch.id} className="space-y-1.5">
                    <h5 className="text-xs font-semibold flex items-center gap-1">
                      <Icon className="h-3 w-3" />{meta.label}
                    </h5>
                    {chTasks.map(t => (
                      <div key={t.id} className={`flex items-center gap-2 text-xs border rounded-md p-2 cursor-pointer ${t.status === 'done' ? 'opacity-60' : ''}`}
                        onClick={() => toggleTask(t.id)}
                      >
                        <Checkbox checked={t.status === 'done'} />
                        <span className={t.status === 'done' ? 'line-through' : 'font-medium'}>{t.title}</span>
                        {t.due_date && <Badge variant="outline" className="text-[9px] ml-auto">{t.due_date}</Badge>}
                      </div>
                    ))}
                  </div>
                );
              })}
              {/* Tasks without channel */}
              {tasks.filter(t => !t.channel_id).length > 0 && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-semibold">Geral</h5>
                  {tasks.filter(t => !t.channel_id).map(t => (
                    <div key={t.id} className={`flex items-center gap-2 text-xs border rounded-md p-2 cursor-pointer ${t.status === 'done' ? 'opacity-60' : ''}`}
                      onClick={() => toggleTask(t.id)}
                    >
                      <Checkbox checked={t.status === 'done'} />
                      <span className={t.status === 'done' ? 'line-through' : 'font-medium'}>{t.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* METRICS */}
            <TabsContent value="metrics" className="space-y-3 mt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <DollarSign className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs text-muted-foreground">Custo Real</p>
                  <p className="text-lg font-bold">{campaign.actual_cost ? formatCurrency(campaign.actual_cost) : '—'}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <TrendingUp className="h-4 w-4 mx-auto text-emerald-500 mb-1" />
                  <p className="text-xs text-muted-foreground">Receita Atribuída</p>
                  <p className="text-lg font-bold">{campaign.attributed_revenue ? formatCurrency(campaign.attributed_revenue) : '—'}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <Users className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs text-muted-foreground">Leads Captados</p>
                  <p className="text-lg font-bold">{campaign.leads_captured || 0}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 px-3 text-center">
                  <BarChart3 className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs text-muted-foreground">ROAS</p>
                  <p className="text-lg font-bold">
                    {campaign.actual_cost && campaign.attributed_revenue
                      ? `${(campaign.attributed_revenue / campaign.actual_cost).toFixed(1)}x`
                      : '—'}
                  </p>
                </CardContent></Card>
              </div>

              {/* WhatsApp stats */}
              {(campaign.sent_count ?? 0) > 0 && (
                <Card>
                  <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-xs">WhatsApp</CardTitle></CardHeader>
                  <CardContent className="pb-3 px-4">
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div><p className="text-lg font-bold">{campaign.total_recipients || 0}</p><p className="text-[10px] text-muted-foreground">Destinatários</p></div>
                      <div><p className="text-lg font-bold">{campaign.sent_count || 0}</p><p className="text-[10px] text-muted-foreground">Enviadas</p></div>
                      <div><p className="text-lg font-bold">{campaign.delivered_count || 0}</p><p className="text-[10px] text-muted-foreground">Entregues</p></div>
                      <div><p className="text-lg font-bold">{campaign.read_count || 0}</p><p className="text-[10px] text-muted-foreground">Lidas</p></div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <p className="text-xs text-muted-foreground text-center">
                As métricas de atribuição serão preenchidas automaticamente à medida que vendas forem registradas durante o período da campanha.
              </p>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="border-t pt-3 shrink-0">
          {campaign.status === 'draft' && (
            <Button variant="outline" size="sm" onClick={() => { onStatusChange(campaign.id, 'review'); onClose(); }} className="gap-1">
              <Eye className="h-3.5 w-3.5" />Enviar p/ Revisão
            </Button>
          )}
          {campaign.status === 'review' && (
            <Button size="sm" onClick={() => { onStatusChange(campaign.id, 'approved'); onClose(); }} className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />Aprovar
            </Button>
          )}
          {campaign.status === 'approved' && (
            <Button size="sm" className="gap-1 bg-primary hover:bg-primary/90">
              <Send className="h-3.5 w-3.5" />Executar Campanha
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

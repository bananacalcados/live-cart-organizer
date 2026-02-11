import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Brain, ChevronDown, Plus, RefreshCw, Send, Target, 
  Instagram, Mail, Store, Globe, Sparkles, CheckCircle2,
  MessageSquare, ListChecks, Calendar, ArrowLeft, Megaphone
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";

// ─── Types ──────────────────────────────────────
export interface ChannelStrategy {
  channel_type: string;
  strategy: string;
  tone_of_voice: string;
  content_plan: Array<{
    day_offset: number;
    title: string;
    description: string;
    content_type: string;
    content_suggestion?: string;
  }>;
  tasks: Array<{
    title: string;
    description?: string;
    due_day_offset?: number;
  }>;
}

export interface AI360Strategy {
  campaign_name: string;
  summary: string;
  start_date_suggestion?: string;
  end_date_suggestion?: string;
  estimated_budget?: number;
  target_analysis: string;
  lead_capture: {
    strategy: string;
    channels: string[];
    tips: string[];
    landing_page_suggestion?: string;
  };
  channel_strategies: ChannelStrategy[];
  success_metrics: string[];
  additional_tips: string[];
}

const CHANNEL_META: Record<string, { icon: typeof Send; label: string; color: string }> = {
  whatsapp: { icon: MessageSquare, label: "WhatsApp", color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
  instagram: { icon: Instagram, label: "Instagram", color: "text-pink-600 bg-pink-500/10 border-pink-500/30" },
  email: { icon: Mail, label: "Email", color: "text-blue-600 bg-blue-500/10 border-blue-500/30" },
  loja_fisica: { icon: Store, label: "Loja Física", color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
  site: { icon: Globe, label: "Site", color: "text-violet-600 bg-violet-500/10 border-violet-500/30" },
  outros: { icon: Sparkles, label: "Outros", color: "text-cyan-600 bg-cyan-500/10 border-cyan-500/30" },
};

export default function NewCampaign() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'briefing' | 'strategy' | 'confirm'>('briefing');
  const [isGenerating, setIsGenerating] = useState(false);
  const [strategy, setStrategy] = useState<AI360Strategy | null>(null);
  const [customerStats, setCustomerStats] = useState<any>(null);

  // Form
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [instructions, setInstructions] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState("");

  // Load customer stats for AI context
  useEffect(() => {
    const loadStats = async () => {
      const { data } = await supabase.from('zoppy_customers').select('*').limit(1000);
      if (data && data.length > 0) {
        setCustomerStats({
          total: data.length,
          local: data.filter((c: any) => c.region_type === 'local').length,
          online: data.filter((c: any) => c.region_type === 'online').length,
          revenue: data.reduce((s: number, c: any) => s + (c.total_spent || 0), 0),
          segments: [...new Set(data.map((c: any) => c.rfm_segment).filter(Boolean))],
        });
      }
    };
    loadStats();
  }, []);

  const handleGenerate = async () => {
    if (!objective.trim()) { toast.error("Informe o objetivo"); return; }
    setIsGenerating(true);
    try {
      const res = await supabase.functions.invoke('ai-marketing-strategy', {
        body: { objective, audience, instructions, customer_stats: customerStats },
      });
      if (res.error) throw new Error(res.error.message);
      const data = res.data as any;
      if (!data?.success || !data?.strategy) throw new Error(data?.error || "Erro ao gerar");

      const s = data.strategy as AI360Strategy;
      setStrategy(s);
      setCampaignName(s.campaign_name);
      setStartDate(s.start_date_suggestion || "");
      setEndDate(s.end_date_suggestion || "");
      setBudget(s.estimated_budget?.toString() || "");
      setStep('strategy');
      toast.success("Estratégia 360° gerada!");
    } catch (err: any) {
      if (err?.message?.includes('429')) toast.error("Rate limit. Tente em alguns segundos.");
      else if (err?.message?.includes('402')) toast.error("Créditos de IA insuficientes.");
      else { console.error(err); toast.error("Erro ao gerar estratégia"); }
    } finally { setIsGenerating(false); }
  };

  const handleCreate = async () => {
    if (!campaignName.trim()) { toast.error("Nome obrigatório"); return; }
    try {
      const { data: campaign, error } = await supabase
        .from('marketing_campaigns')
        .insert({
          name: campaignName,
          description: strategy?.summary || objective,
          objective,
          target_audience: audience,
          ai_prompt: instructions,
          ai_strategy: strategy as any,
          channels: strategy?.channel_strategies.map(c => c.channel_type) || [],
          status: 'draft',
          start_date: startDate || null,
          end_date: endDate || null,
          budget: budget ? parseFloat(budget) : 0,
        } as any)
        .select()
        .single();
      if (error) throw error;

      if (strategy?.channel_strategies && campaign) {
        const channelRecords = strategy.channel_strategies.map(ch => ({
          campaign_id: campaign.id,
          channel_type: ch.channel_type,
          strategy: ch.strategy,
          tone_of_voice: ch.tone_of_voice,
          content_plan: ch.content_plan as any,
          schedule: ch.content_plan.map(cp => ({
            day_offset: cp.day_offset, action: cp.title,
            description: cp.description, content_type: cp.content_type, status: 'pending',
          })) as any,
        }));
        const { data: channels, error: chErr } = await supabase
          .from('campaign_channels').insert(channelRecords).select();
        if (chErr) console.error("channel insert error:", chErr);

        if (channels) {
          const channelMap = new Map(channels.map((c: any) => [c.channel_type, c.id]));
          const allTasks: any[] = [];
          strategy.channel_strategies.forEach(ch => {
            const channelId = channelMap.get(ch.channel_type);
            ch.tasks.forEach((t, i) => {
              allTasks.push({
                campaign_id: campaign.id, channel_id: channelId || null,
                title: t.title, description: t.description || null,
                due_date: t.due_day_offset != null && startDate ? addDays(startDate, t.due_day_offset) : null,
                sort_order: i, status: 'pending',
              });
            });
          });
          if (allTasks.length > 0) {
            const { error: tErr } = await supabase.from('campaign_tasks').insert(allTasks);
            if (tErr) console.error("task insert error:", tErr);
          }
        }
      }

      toast.success("Campanha 360° criada!");
      navigate('/marketing');
    } catch (err) {
      console.error(err);
      toast.error("Erro ao criar campanha");
    }
  };

  const addDays = (dateStr: string, days: number): string => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/marketing')} className="gap-1">
              <ArrowLeft className="h-4 w-4" />Voltar
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-bold">Nova Campanha 360°</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Stepper */}
      <div className="container py-4">
        <div className="flex items-center gap-2 mb-6">
          {(['briefing', 'strategy', 'confirm'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                step === s ? 'bg-primary text-primary-foreground' :
                (['briefing', 'strategy', 'confirm'].indexOf(step) > i) ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              }`}>{i + 1}</div>
              <span className={`text-sm ${step === s ? 'font-semibold' : 'text-muted-foreground'}`}>
                {s === 'briefing' ? 'Briefing' : s === 'strategy' ? 'Estratégia 360°' : 'Confirmar'}
              </span>
              {i < 2 && <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90 mx-2" />}
            </div>
          ))}
        </div>

        <div className="max-w-4xl mx-auto space-y-6">
          {/* STEP 1: BRIEFING */}
          {step === 'briefing' && (
            <Card className="border-dashed border-primary/30 bg-primary/5">
              <CardContent className="pt-6 pb-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Briefing da Campanha</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Descreva o que quer alcançar. A IA vai montar uma estratégia 360° completa cobrindo todos os canais:
                  WhatsApp, Instagram, Email, Loja Física, Site e ações criativas.
                </p>
                <div className="space-y-2">
                  <Label>Objetivo da campanha *</Label>
                  <Textarea
                    placeholder="Ex: Evento de lançamento da coleção verão com live shopping nos dias 19-21/fev. Queremos captar leads, gerar buzz nas redes e converter em vendas nas lojas físicas e online."
                    value={objective} onChange={e => setObjective(e.target.value)} rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Público-alvo (opcional)</Label>
                  <Input placeholder="Ex: Clientes fiéis + novos leads captados via Instagram" value={audience} onChange={e => setAudience(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Instruções adicionais (opcional)</Label>
                  <Textarea placeholder="Ex: Teremos combo 3 por R$300. Parceria com influenciadora @fulana. Carro de som no bairro Pérola." value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} />
                </div>
                <Button onClick={handleGenerate} disabled={isGenerating} className="w-full gap-2" size="lg">
                  <Brain className={`h-4 w-4 ${isGenerating ? 'animate-pulse' : ''}`} />
                  {isGenerating ? 'Gerando estratégia 360°...' : '🚀 Gerar Estratégia 360°'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* STEP 2: STRATEGY REVIEW */}
          {step === 'strategy' && strategy && (
            <div className="space-y-6">
              {/* Campaign details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome da Campanha</Label>
                  <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} className="font-semibold text-base" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Início</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Término</Label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Orçamento (R$)</Label>
                    <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0" />
                  </div>
                </div>
              </div>

              {/* Summary */}
              <Card>
                <CardContent className="pt-4 pb-4 px-5">
                  <h4 className="text-sm font-semibold text-muted-foreground mb-2">📋 Resumo Executivo</h4>
                  <p className="text-sm leading-relaxed">{strategy.summary}</p>
                </CardContent>
              </Card>

              {/* Target */}
              <Card>
                <CardContent className="pt-4 pb-4 px-5">
                  <h4 className="text-sm font-semibold text-muted-foreground mb-2">🎯 Público-Alvo</h4>
                  <p className="text-sm leading-relaxed">{strategy.target_analysis}</p>
                </CardContent>
              </Card>

              {/* Lead Capture */}
              <Card className="border-blue-500/20 bg-blue-500/5">
                <CardContent className="pt-4 pb-4 px-5 space-y-3">
                  <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-400">📣 Captação de Leads</h4>
                  <p className="text-sm leading-relaxed">{strategy.lead_capture.strategy}</p>
                  <div className="flex flex-wrap gap-2">
                    {strategy.lead_capture.channels.map(ch => (
                      <Badge key={ch} variant="outline">{ch}</Badge>
                    ))}
                  </div>
                  {strategy.lead_capture.landing_page_suggestion && (
                    <p className="text-sm italic text-muted-foreground">🌐 {strategy.lead_capture.landing_page_suggestion}</p>
                  )}
                  <ul className="space-y-1.5">
                    {strategy.lead_capture.tips.map((tip, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex gap-2"><span className="text-blue-500 shrink-0">💡</span>{tip}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Channel Strategies */}
              <div className="space-y-3">
                <h4 className="text-base font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Estratégia por Canal ({strategy.channel_strategies.length} canais)
                </h4>
                <Tabs defaultValue={strategy.channel_strategies[0]?.channel_type}>
                  <TabsList className="flex-wrap h-auto gap-1.5 bg-transparent p-0">
                    {strategy.channel_strategies.map(ch => {
                      const meta = CHANNEL_META[ch.channel_type] || CHANNEL_META.outros;
                      const Icon = meta.icon;
                      return (
                        <TabsTrigger key={ch.channel_type} value={ch.channel_type}
                          className={`gap-1.5 text-sm border ${meta.color} data-[state=active]:shadow-sm`}
                        >
                          <Icon className="h-3.5 w-3.5" />{meta.label}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>

                  {strategy.channel_strategies.map(ch => (
                    <TabsContent key={ch.channel_type} value={ch.channel_type} className="space-y-4 mt-4">
                      <Card>
                        <CardContent className="pt-4 pb-4 px-5 space-y-3">
                          <p className="text-sm leading-relaxed">{ch.strategy}</p>
                          <Badge variant="secondary">🎤 Tom: {ch.tone_of_voice}</Badge>
                        </CardContent>
                      </Card>

                      {/* Content Plan */}
                      <div className="space-y-2">
                        <h5 className="text-sm font-semibold flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />Cronograma</h5>
                        {ch.content_plan.map((cp, i) => (
                          <div key={i} className="flex gap-3 text-sm items-start border rounded-lg p-3">
                            <Badge variant="outline" className="shrink-0 mt-0.5">Dia {cp.day_offset}</Badge>
                            <div className="min-w-0">
                              <p className="font-medium">{cp.title}</p>
                              <p className="text-muted-foreground">{cp.description}</p>
                              {cp.content_suggestion && <p className="italic text-muted-foreground mt-1">💬 {cp.content_suggestion}</p>}
                              <Badge variant="secondary" className="text-xs mt-1.5">{cp.content_type}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Tasks */}
                      <div className="space-y-2">
                        <h5 className="text-sm font-semibold flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />Checklist ({ch.tasks.length})</h5>
                        {ch.tasks.map((t, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm border rounded-lg p-3">
                            <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium">{t.title}</p>
                              {t.description && <p className="text-muted-foreground">{t.description}</p>}
                              {t.due_day_offset != null && <Badge variant="outline" className="text-xs mt-1">Dia {t.due_day_offset}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </div>

              {/* Metrics & Tips */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-4 pb-4 px-5">
                    <h4 className="text-sm font-semibold text-muted-foreground mb-2">📊 Métricas de Sucesso</h4>
                    <ul className="space-y-1.5">
                      {strategy.success_metrics.map((m, i) => (
                        <li key={i} className="text-sm text-muted-foreground">• {m}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4 px-5">
                    <h4 className="text-sm font-semibold text-muted-foreground mb-2">✨ Dicas</h4>
                    <ul className="space-y-1.5">
                      {strategy.additional_tips.map((t, i) => (
                        <li key={i} className="text-sm text-muted-foreground">• {t}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* STEP 3: CONFIRM */}
          {step === 'confirm' && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-8 pb-6 space-y-4 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
                <h3 className="text-lg font-semibold">Confirmar Criação</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  A campanha <strong>{campaignName}</strong> será criada com {strategy?.channel_strategies.length || 0} canais,{' '}
                  {strategy?.channel_strategies.reduce((s, c) => s + c.tasks.length, 0) || 0} tarefas no checklist
                  e cronograma completo.
                </p>
                <p className="text-xs text-muted-foreground">
                  Depois de criar, você poderá ajustar cada canal, editar tarefas, selecionar templates WhatsApp e configurar landing pages.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 border-t pt-4 pb-8">
            {step === 'briefing' && (
              <Button variant="outline" onClick={() => navigate('/marketing')}>Cancelar</Button>
            )}
            {step === 'strategy' && (
              <>
                <Button variant="outline" onClick={() => setStep('briefing')}>← Voltar</Button>
                <Button variant="outline" onClick={() => { setStrategy(null); setStep('briefing'); }} className="gap-1">
                  <RefreshCw className="h-3.5 w-3.5" />Regerar
                </Button>
                <Button onClick={() => setStep('confirm')} className="gap-1" size="lg">
                  Aprovar Estratégia →
                </Button>
              </>
            )}
            {step === 'confirm' && (
              <>
                <Button variant="outline" onClick={() => setStep('strategy')}>← Voltar</Button>
                <Button onClick={handleCreate} className="gap-1" size="lg">
                  <Plus className="h-4 w-4" />Criar Campanha 360°
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

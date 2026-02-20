import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Brain, ChevronDown, Plus, RefreshCw, ArrowLeft, Sparkles, CheckCircle2,
  MessageSquare, Instagram, Mail, Store, Globe, Users, Megaphone, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MasterDirectiveCard, type MasterDirective } from "@/components/marketing/MasterDirectiveCard";
import { ChannelConfigurator, type ChannelParams } from "@/components/marketing/ChannelConfigurator";
import { ChannelPlanResult, type ChannelPlan } from "@/components/marketing/ChannelPlanResult";

// ─── Channel metadata ──────────────────────────
const ALL_CHANNELS = [
  { type: "grupo_vip", icon: Users, label: "Grupo VIP" },
  { type: "whatsapp_marketing", icon: MessageSquare, label: "WhatsApp Marketing" },
  { type: "instagram", icon: Instagram, label: "Instagram" },
  { type: "loja_fisica", icon: Store, label: "Loja Física" },
  { type: "email", icon: Mail, label: "Email Marketing" },
  { type: "site", icon: Globe, label: "Site" },
] as const;

const CHANNEL_COLORS: Record<string, string> = {
  grupo_vip: "text-purple-600 bg-purple-500/10 border-purple-500/30",
  whatsapp_marketing: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  instagram: "text-pink-600 bg-pink-500/10 border-pink-500/30",
  loja_fisica: "text-amber-600 bg-amber-500/10 border-amber-500/30",
  email: "text-blue-600 bg-blue-500/10 border-blue-500/30",
  site: "text-violet-600 bg-violet-500/10 border-violet-500/30",
};

type Step = "mode" | "directive" | "channels" | "review";
const STEPS: { key: Step; label: string }[] = [
  { key: "mode", label: "Modo" },
  { key: "directive", label: "Diretriz Matriz" },
  { key: "channels", label: "Canais" },
  { key: "review", label: "Revisar" },
];

export default function NewCampaign() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("mode");
  const [isGeneratingDirective, setIsGeneratingDirective] = useState(false);
  const [generatingChannel, setGeneratingChannel] = useState<string | null>(null);

  // Step 1: Mode
  const [mode, setMode] = useState<"360" | "single">("360");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(ALL_CHANNELS.map(c => c.type));
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [instructions, setInstructions] = useState("");

  // Step 2: Directive
  const [directive, setDirective] = useState<MasterDirective | null>(null);
  const [customerStats, setCustomerStats] = useState<any>(null);

  // Step 3: Channel configs & plans
  const [channelParams, setChannelParams] = useState<Record<string, ChannelParams>>({});
  const [channelPlans, setChannelPlans] = useState<Record<string, ChannelPlan>>({});

  // Load customer stats
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

  const toggleChannel = (ch: string) => {
    setSelectedChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
    );
  };

  // ─── Generate Master Directive ───────────────
  const handleGenerateDirective = async () => {
    if (!objective.trim()) { toast.error("Informe o objetivo"); return; }
    setIsGeneratingDirective(true);
    try {
      const res = await supabase.functions.invoke('ai-marketing-master', {
        body: { objective, audience, instructions, customer_stats: customerStats },
      });
      if (res.error) throw new Error(res.error.message);
      const data = res.data as any;
      if (!data?.success || !data?.directive) throw new Error(data?.error || "Erro ao gerar");

      setDirective(data.directive as MasterDirective);
      setStep("directive");
      toast.success("Diretriz Matriz gerada!");
    } catch (err: any) {
      if (err?.message?.includes('429')) toast.error("Rate limit. Tente em alguns segundos.");
      else if (err?.message?.includes('402')) toast.error("Créditos de IA insuficientes.");
      else { console.error(err); toast.error("Erro ao gerar diretriz"); }
    } finally { setIsGeneratingDirective(false); }
  };

  // ─── Generate Channel Plan ───────────────────
  const handleGenerateChannelPlan = async (channelType: string) => {
    if (!directive) return;
    setGeneratingChannel(channelType);
    try {
      const res = await supabase.functions.invoke('ai-channel-specialist', {
        body: {
          channel_type: channelType,
          directive,
          params: channelParams[channelType] || {},
        },
      });
      if (res.error) throw new Error(res.error.message);
      const data = res.data as any;
      if (!data?.success || !data?.plan) throw new Error(data?.error || "Erro ao gerar plano");

      setChannelPlans(prev => ({ ...prev, [channelType]: data.plan as ChannelPlan }));
      toast.success(`Plano de ${ALL_CHANNELS.find(c => c.type === channelType)?.label} gerado!`);
    } catch (err: any) {
      if (err?.message?.includes('429')) toast.error("Rate limit. Tente em alguns segundos.");
      else if (err?.message?.includes('402')) toast.error("Créditos de IA insuficientes.");
      else { console.error(err); toast.error("Erro ao gerar plano do canal"); }
    } finally { setGeneratingChannel(null); }
  };

  // ─── Save Campaign ──────────────────────────
  const handleCreate = async () => {
    if (!directive) return;
    const name = directive.campaign_name;
    if (!name.trim()) { toast.error("Nome obrigatório"); return; }

    try {
      const { data: campaign, error } = await supabase
        .from('marketing_campaigns')
        .insert({
          name,
          description: directive.summary,
          objective,
          target_audience: audience,
          ai_prompt: instructions,
          ai_strategy: { directive, channel_plans: channelPlans } as any,
          channels: selectedChannels,
          status: 'draft',
          start_date: directive.start_date_suggestion || null,
          end_date: directive.end_date_suggestion || null,
          budget: directive.estimated_budget || 0,
        } as any)
        .select()
        .single();
      if (error) throw error;

      // Insert channel records
      if (campaign) {
        const channelRecords = selectedChannels
          .filter(ch => channelPlans[ch])
          .map(ch => {
            const plan = channelPlans[ch];
            return {
              campaign_id: campaign.id,
              channel_type: ch,
              strategy: plan.strategy,
              tone_of_voice: plan.tone_of_voice,
              content_plan: plan.content_plan as any,
              schedule: plan.content_plan.map(cp => ({
                day_offset: cp.day_offset, action: cp.title,
                description: cp.description, content_type: cp.content_type, status: 'pending',
              })) as any,
            };
          });

        if (channelRecords.length > 0) {
          const { data: channels, error: chErr } = await supabase
            .from('campaign_channels').insert(channelRecords).select();
          if (chErr) console.error("channel insert error:", chErr);

          if (channels) {
            const channelMap = new Map(channels.map((c: any) => [c.channel_type, c.id]));
            const allTasks: any[] = [];
            Object.entries(channelPlans).forEach(([chType, plan]) => {
              const channelId = channelMap.get(chType);
              plan.tasks.forEach((t, i) => {
                allTasks.push({
                  campaign_id: campaign.id, channel_id: channelId || null,
                  title: t.title, description: t.description || null,
                  due_date: t.due_day_offset != null && directive.start_date_suggestion
                    ? addDays(directive.start_date_suggestion, t.due_day_offset) : null,
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
      }

      toast.success("Campanha criada!");
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

  const stepIndex = STEPS.findIndex(s => s.key === step);
  const activeChannels = mode === "360" ? ALL_CHANNELS.map(c => c.type) : selectedChannels;
  const allPlansGenerated = activeChannels.every(ch => channelPlans[ch]);

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
              <h1 className="text-lg font-bold">Nova Campanha IA</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Stepper */}
      <div className="container py-4">
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                step === s.key ? 'bg-primary text-primary-foreground' :
                stepIndex > i ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              }`}>{i + 1}</div>
              <span className={`text-sm ${step === s.key ? 'font-semibold' : 'text-muted-foreground'}`}>{s.label}</span>
              {i < STEPS.length - 1 && <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90 mx-2" />}
            </div>
          ))}
        </div>

        <div className="max-w-4xl mx-auto space-y-6">
          {/* ═══ STEP 1: MODE ═══ */}
          {step === "mode" && (
            <div className="space-y-6">
              {/* Mode Selection */}
              <div className="grid grid-cols-2 gap-4">
                <Card className={`cursor-pointer transition-all ${mode === "360" ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50"}`}
                  onClick={() => { setMode("360"); setSelectedChannels(ALL_CHANNELS.map(c => c.type)); }}>
                  <CardContent className="pt-6 pb-4 text-center space-y-2">
                    <Megaphone className="h-8 w-8 mx-auto text-primary" />
                    <h3 className="font-bold">Campanha 360°</h3>
                    <p className="text-xs text-muted-foreground">Todos os canais integrados</p>
                  </CardContent>
                </Card>
                <Card className={`cursor-pointer transition-all ${mode === "single" ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50"}`}
                  onClick={() => setMode("single")}>
                  <CardContent className="pt-6 pb-4 text-center space-y-2">
                    <Sparkles className="h-8 w-8 mx-auto text-primary" />
                    <h3 className="font-bold">Canal Específico</h3>
                    <p className="text-xs text-muted-foreground">Selecione os canais desejados</p>
                  </CardContent>
                </Card>
              </div>

              {/* Channel selection for single mode */}
              {mode === "single" && (
                <Card>
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <Label className="font-semibold">Selecione os Canais</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {ALL_CHANNELS.map(ch => {
                        const Icon = ch.icon;
                        const selected = selectedChannels.includes(ch.type);
                        return (
                          <label key={ch.type}
                            className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                              selected ? `${CHANNEL_COLORS[ch.type]} border-2` : "hover:bg-muted/50"
                            }`}>
                            <Checkbox checked={selected} onCheckedChange={() => toggleChannel(ch.type)} />
                            <Icon className="h-4 w-4" />
                            <span className="text-sm font-medium">{ch.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Briefing */}
              <Card className="border-dashed border-primary/30 bg-primary/5">
                <CardContent className="pt-6 pb-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold">Objetivo da Campanha</h3>
                  </div>
                  <div className="space-y-2">
                    <Label>Objetivo *</Label>
                    <Textarea
                      placeholder="Ex: Evento de lançamento da coleção verão com live shopping. Queremos captar leads e converter em vendas."
                      value={objective} onChange={e => setObjective(e.target.value)} rows={4}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Público-alvo (opcional)</Label>
                    <Input placeholder="Ex: Clientes fiéis + novos leads" value={audience} onChange={e => setAudience(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Instruções adicionais (opcional)</Label>
                    <Textarea placeholder="Ex: Combo 3 por R$300. Parceria com @fulana." value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} />
                  </div>
                  <Button onClick={handleGenerateDirective} disabled={isGeneratingDirective || selectedChannels.length === 0} className="w-full gap-2" size="lg">
                    <Brain className={`h-4 w-4 ${isGeneratingDirective ? 'animate-pulse' : ''}`} />
                    {isGeneratingDirective ? 'Gerando Diretriz Matriz...' : '🚀 Gerar Diretriz Matriz'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ═══ STEP 2: DIRECTIVE ═══ */}
          {step === "directive" && directive && (
            <div className="space-y-6">
              <MasterDirectiveCard directive={directive} onUpdate={setDirective} />
            </div>
          )}

          {/* ═══ STEP 3: CHANNELS ═══ */}
          {step === "channels" && directive && (
            <div className="space-y-4">
              <Tabs defaultValue={activeChannels[0]}>
                <TabsList className="flex-wrap h-auto gap-1.5 bg-transparent p-0">
                  {activeChannels.map(chType => {
                    const ch = ALL_CHANNELS.find(c => c.type === chType)!;
                    const Icon = ch.icon;
                    const hasplan = !!channelPlans[chType];
                    return (
                      <TabsTrigger key={chType} value={chType}
                        className={`gap-1.5 text-sm border ${CHANNEL_COLORS[chType]} data-[state=active]:shadow-sm`}>
                        <Icon className="h-3.5 w-3.5" />
                        {ch.label}
                        {hasplan && <CheckCircle2 className="h-3 w-3 text-primary" />}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {activeChannels.map(chType => {
                  const ch = ALL_CHANNELS.find(c => c.type === chType)!;
                  const plan = channelPlans[chType];
                  return (
                    <TabsContent key={chType} value={chType} className="space-y-4 mt-4">
                      {/* Configurator */}
                      <Card>
                        <CardContent className="pt-4 pb-4 space-y-4">
                          <div className="flex items-center gap-2">
                            <ch.icon className="h-4 w-4 text-primary" />
                            <h4 className="font-semibold text-sm">Configurar {ch.label}</h4>
                          </div>
                          <ChannelConfigurator
                            channelType={chType}
                            params={channelParams[chType] || {}}
                            onParamsChange={p => setChannelParams(prev => ({ ...prev, [chType]: p }))}
                          />
                          <Button
                            onClick={() => handleGenerateChannelPlan(chType)}
                            disabled={generatingChannel === chType}
                            className="w-full gap-2"
                          >
                            {generatingChannel === chType ? (
                              <><Loader2 className="h-4 w-4 animate-spin" />Gerando plano...</>
                            ) : plan ? (
                              <><RefreshCw className="h-4 w-4" />Regerar Plano</>
                            ) : (
                              <><Brain className="h-4 w-4" />Gerar Plano com IA Especialista</>
                            )}
                          </Button>
                        </CardContent>
                      </Card>

                      {/* Plan Result */}
                      {plan && (
                        <ChannelPlanResult
                          plan={plan}
                          onUpdateContentSuggestion={(idx, value) => {
                            setChannelPlans(prev => {
                              const updated = { ...prev[chType] };
                              const newPlan = [...updated.content_plan];
                              newPlan[idx] = { ...newPlan[idx], content_suggestion: value };
                              return { ...prev, [chType]: { ...updated, content_plan: newPlan } };
                            });
                          }}
                        />
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </div>
          )}

          {/* ═══ STEP 4: REVIEW ═══ */}
          {step === "review" && directive && (
            <div className="space-y-6">
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-8 pb-6 space-y-4 text-center">
                  <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
                  <h3 className="text-lg font-semibold">Confirmar Criação</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    A campanha <strong>{directive.campaign_name}</strong> será criada com{' '}
                    {Object.keys(channelPlans).length} canais configurados e{' '}
                    {Object.values(channelPlans).reduce((s, p) => s + p.tasks.length, 0)} tarefas.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {Object.keys(channelPlans).map(ch => {
                      const meta = ALL_CHANNELS.find(c => c.type === ch);
                      return meta ? (
                        <Badge key={ch} variant="outline" className={CHANNEL_COLORS[ch]}>
                          {meta.label} ✓
                        </Badge>
                      ) : null;
                    })}
                  </div>
                  {activeChannels.some(ch => !channelPlans[ch]) && (
                    <p className="text-xs text-amber-600">
                      ⚠️ {activeChannels.filter(ch => !channelPlans[ch]).length} canal(is) sem plano gerado
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Quick overview of each plan */}
              {Object.entries(channelPlans).map(([chType, plan]) => {
                const meta = ALL_CHANNELS.find(c => c.type === chType);
                if (!meta) return null;
                return (
                  <Card key={chType}>
                    <CardContent className="pt-4 pb-4 px-5">
                      <div className="flex items-center gap-2 mb-2">
                        <meta.icon className="h-4 w-4" />
                        <h4 className="font-semibold text-sm">{meta.label}</h4>
                        <Badge variant="secondary" className="text-xs">{plan.content_plan.length} ações</Badge>
                        <Badge variant="outline" className="text-xs">{plan.tasks.length} tarefas</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{plan.strategy}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ═══ Footer Actions ═══ */}
          <div className="flex items-center justify-end gap-3 border-t pt-4 pb-8">
            {step === "mode" && (
              <Button variant="outline" onClick={() => navigate('/marketing')}>Cancelar</Button>
            )}
            {step === "directive" && (
              <>
                <Button variant="outline" onClick={() => setStep("mode")}>← Voltar</Button>
                <Button variant="outline" onClick={() => { setDirective(null); setStep("mode"); }} className="gap-1">
                  <RefreshCw className="h-3.5 w-3.5" />Regerar
                </Button>
                <Button onClick={() => setStep("channels")} className="gap-1" size="lg">
                  Configurar Canais →
                </Button>
              </>
            )}
            {step === "channels" && (
              <>
                <Button variant="outline" onClick={() => setStep("directive")}>← Voltar</Button>
                <Button onClick={() => setStep("review")} className="gap-1" size="lg"
                  disabled={Object.keys(channelPlans).length === 0}>
                  Revisar e Criar →
                </Button>
              </>
            )}
            {step === "review" && (
              <>
                <Button variant="outline" onClick={() => setStep("channels")}>← Voltar</Button>
                <Button onClick={handleCreate} className="gap-1" size="lg">
                  <Plus className="h-4 w-4" />Criar Campanha
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

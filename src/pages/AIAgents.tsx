import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, Users, Loader2, Send, Copy, Check, Save, Clock, ShieldCheck, ShieldOff, RefreshCw, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface FilterSummary {
  total_candidates?: number;
  clientes_elegiveis?: number;
  bloqueados_cooldown?: number;
  bloqueados_atendimento_ativo?: number;
  bloqueados_incoming?: number;
  bloqueados_chat_aberto?: number;
  bloqueados_compra_recente?: number;
  total_filtrado?: number;
}

const FilterSummaryBlock = ({ summary }: { summary: FilterSummary }) => {
  const total = summary.total_candidates || 0;
  const eligible = summary.clientes_elegiveis || 0;
  const eligiblePct = total > 0 ? Math.round((eligible / total) * 100) : 0;

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3 mb-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Filtragem de Cooldown</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs">Candidatos totais</p>
          <p className="font-bold text-lg">{total}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs">Elegíveis</p>
          <p className="font-bold text-lg text-primary">{eligible} <span className="text-xs font-normal text-muted-foreground">({eligiblePct}%)</span></p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs">Total bloqueados</p>
          <p className="font-bold text-lg text-destructive">{summary.total_filtrado || 0}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <ShieldOff className="h-3 w-3" /> Cooldown disparo
          </span>
          <Badge variant="outline" className="text-xs">{summary.bloqueados_cooldown || 0}</Badge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <ShieldOff className="h-3 w-3" /> Atendimento ativo
          </span>
          <Badge variant="outline" className="text-xs">{summary.bloqueados_atendimento_ativo || 0}</Badge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <ShieldOff className="h-3 w-3" /> Compra recente
          </span>
          <Badge variant="outline" className="text-xs">{summary.bloqueados_compra_recente || 0}</Badge>
        </div>
      </div>
    </div>
  );
};

const AIAgents = () => {
  const [activeAgent, setActiveAgent] = useState("customers");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState("");
  const [meta, setMeta] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [filterSummary, setFilterSummary] = useState<FilterSummary | null>(null);

  // Novidades
  const [novidades, setNovidades] = useState("");
  const [novidadesSaved, setNovidadesSaved] = useState(false);
  const [isSavingNovidades, setIsSavingNovidades] = useState(false);

  // Auto-calculated (read-only display)
  const [autoVerba, setAutoVerba] = useState<number | null>(null);
  const [autoMeta, setAutoMeta] = useState<number | null>(null);

  // Execution history
  const [lastExecution, setLastExecution] = useState<any>(null);

  // RFM Health
  const [rfmHealth, setRfmHealth] = useState<{ lastUpdate: string | null; segments: Record<string, number> } | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);

  useEffect(() => {
    loadNovidades();
    loadLastExecution();
    calculateAutoContext();
    loadRfmHealth();
  }, []);

  const loadNovidades = async () => {
    const { data } = await supabase
      .from('agent_weekly_context')
      .select('value')
      .eq('key', 'novidades_estoque')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.value) {
      setNovidades(data.value);
      setNovidadesSaved(true);
    }
  };

  const loadLastExecution = async () => {
    const { data } = await supabase
      .from('agent_executions')
      .select('*')
      .eq('agent_name', 'customers_rfm')
      .order('executed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setLastExecution(data);
      if (data.output_result) setResponse(data.output_result);
      if (data.input_data) {
        const input = data.input_data as any;
        setMeta({
          customers_analyzed: input.customers_count,
          segments: input.segments,
          verba: input.verba,
          meta: input.meta,
          tokens_used: input.tokens,
        });
        if (input.filter_summary) {
          setFilterSummary(input.filter_summary);
        }
      }
    }
  };

  const loadRfmHealth = async () => {
    // Get last update timestamp
    const { data: latest } = await supabase
      .from('zoppy_customers')
      .select('rfm_updated_at')
      .not('rfm_updated_at', 'is', null)
      .order('rfm_updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get segment counts  
    const { data: allCustomers } = await supabase
      .from('zoppy_customers')
      .select('rfm_segment')
      .not('rfm_segment', 'is', null);

    const segments: Record<string, number> = {};
    (allCustomers || []).forEach((c: any) => {
      const seg = c.rfm_segment || 'others';
      segments[seg] = (segments[seg] || 0) + 1;
    });

    setRfmHealth({
      lastUpdate: latest?.rfm_updated_at || null,
      segments,
    });
  };

  const handleRecalculateRfm = async () => {
    setIsRecalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('zoppy-sync-customers', {
        body: { mode: 'calculate_rfm' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`RFM recalculado: ${data.count} clientes`);
      loadRfmHealth();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao recalcular RFM');
    } finally {
      setIsRecalculating(false);
    }
  };

  const calculateAutoContext = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: sales } = await supabase
      .from('pos_sales')
      .select('total')
      .gte('created_at', sevenDaysAgo)
      .neq('status', 'cancelled');

    const revenue = (sales || []).reduce((sum, s) => sum + (s.total || 0), 0);
    let verba = Math.round(revenue * 0.482 - 71279 / 4.4);
    verba = Math.max(500, Math.min(7000, verba));
    setAutoVerba(verba);
    setAutoMeta(Math.round(131400 / 4.4));
  };

  const handleSaveNovidades = async () => {
    setIsSavingNovidades(true);
    try {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      const weekStartStr = weekStart.toISOString().split('T')[0];

      const { error } = await supabase
        .from('agent_weekly_context')
        .upsert({
          key: 'novidades_estoque',
          value: novidades,
          week_start: weekStartStr,
        }, { onConflict: 'key,week_start' });

      if (error) throw error;
      setNovidadesSaved(true);
      toast.success("Novidades da semana salvas!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setIsSavingNovidades(false);
    }
  };

  const handleRunAgent = async () => {
    setIsLoading(true);
    setResponse("");
    setMeta(null);
    setFilterSummary(null);

    try {
      const { data, error } = await supabase.functions.invoke("ai-agent-customers", {
        body: { novidades: novidades || undefined },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResponse(data.response);
      setMeta(data.meta);
      if (data.meta?.filter_summary) {
        setFilterSummary(data.meta.filter_summary);
      }
      toast.success(`Análise concluída — ${data.meta?.customers_analyzed || 0} clientes elegíveis analisados`);
      loadLastExecution();
    } catch (err: any) {
      console.error("Agent error:", err);
      toast.error(err.message || "Erro ao executar agente");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(response);
    setCopied(true);
    toast.success("Copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  const formatCurrency = (val: number | null) =>
    val !== null ? `R$ ${val.toLocaleString('pt-BR')}` : '—';

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Agentes de IA</h1>
            <p className="text-sm text-muted-foreground">Análises inteligentes com dados reais do seu negócio</p>
          </div>
        </div>

        <Tabs value={activeAgent} onValueChange={setActiveAgent}>
          <TabsList>
            <TabsTrigger value="customers" className="gap-2">
              <Users className="h-4 w-4" />
              Clientes & RFM
            </TabsTrigger>
            <TabsTrigger value="sales" disabled className="gap-2 opacity-50">Vendas</TabsTrigger>
            <TabsTrigger value="marketing" disabled className="gap-2 opacity-50">Marketing</TabsTrigger>
            <TabsTrigger value="inventory" disabled className="gap-2 opacity-50">Estoque</TabsTrigger>
          </TabsList>

          <TabsContent value="customers" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Input Panel */}
              <Card className="lg:col-span-1 space-y-0">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Agente de Clientes
                  </CardTitle>
                  <CardDescription>
                    Executa automaticamente toda segunda às 7h. Use o botão para rodar manualmente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Contexto automático
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">Verba</span>
                        <p className="font-medium">{formatCurrency(autoVerba)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Meta</span>
                        <p className="font-medium">{formatCurrency(autoMeta)}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Verba = (receita 7d × 0,482) - custos fixos. Meta = R$ 131.400 / 4,4 semanas.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="novidades" className="flex items-center justify-between">
                      <span>Novidades em estoque</span>
                      {novidadesSaved && (
                        <Badge variant="outline" className="text-[10px] text-primary">
                          <Check className="h-3 w-3 mr-1" /> Salvo
                        </Badge>
                      )}
                    </Label>
                    <Textarea
                      id="novidades"
                      placeholder="Ex: Chegaram tênis ortopédicos Usaflex novos, sandálias Piccadilly conforto..."
                      value={novidades}
                      onChange={(e) => {
                        setNovidades(e.target.value);
                        setNovidadesSaved(false);
                      }}
                      rows={4}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleSaveNovidades}
                      disabled={isSavingNovidades || !novidades.trim()}
                    >
                      {isSavingNovidades ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Save className="h-3 w-3 mr-1" />
                      )}
                      Salvar novidades da semana
                    </Button>
                  </div>

                  <Button
                    onClick={handleRunAgent}
                    disabled={isLoading}
                    className="w-full"
                    size="lg"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Analisando base...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Executar Agente
                      </>
                    )}
                  </Button>

                  {lastExecution && (
                    <div className="space-y-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground font-medium">Última execução</p>
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Quando</span>
                          <span>{new Date(lastExecution.executed_at).toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <Badge variant={lastExecution.status === 'success' ? 'default' : 'destructive'} className="text-[10px]">
                            {lastExecution.status === 'success' ? '✅ Sucesso' : `❌ ${lastExecution.status}`}
                          </Badge>
                        </div>
                      </div>

                      {meta && (
                        <>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className="text-xs">
                              {meta.customers_analyzed} clientes
                            </Badge>
                            {meta.tokens_used && (
                              <Badge variant="outline" className="text-xs">
                                {(meta.tokens_used.input_tokens || meta.tokens_used.prompt_tokens || 0) + (meta.tokens_used.output_tokens || meta.tokens_used.completion_tokens || 0)} tokens
                              </Badge>
                            )}
                          </div>
                          {meta.segments && (
                            <div className="text-xs space-y-1 mt-2">
                              {Object.entries(meta.segments as Record<string, number>)
                                .sort(([, a], [, b]) => (b as number) - (a as number))
                                .slice(0, 6)
                                .map(([seg, count]) => (
                                  <div key={seg} className="flex justify-between">
                                    <span className="text-muted-foreground">{seg}</span>
                                    <span className="font-medium">{count as number}</span>
                                  </div>
                                ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Output Panel */}
              <Card className="lg:col-span-2">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">Resultado da Análise</CardTitle>
                  {response && (
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin mb-4" />
                      <p className="text-sm">Filtrando base por cooldown e gerando análise...</p>
                      <p className="text-xs mt-1">Isso pode levar até 60 segundos</p>
                    </div>
                  ) : response ? (
                    <ScrollArea className="h-[600px] pr-4">
                      {filterSummary && <FilterSummaryBlock summary={filterSummary} />}
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{response}</ReactMarkdown>
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                      <Bot className="h-12 w-12 mb-4 opacity-30" />
                      <p className="text-sm">Nenhuma análise disponível</p>
                      <p className="text-xs mt-1">Preencha as novidades e clique em "Executar Agente" ou aguarde a execução automática de segunda-feira</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* RFM Health Section */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Saúde do RFM</CardTitle>
            </div>
            <div className="flex items-center gap-3">
              {rfmHealth?.lastUpdate && (
                <span className="text-xs text-muted-foreground">
                  Último cálculo: {new Date(rfmHealth.lastUpdate).toLocaleString('pt-BR')}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleRecalculateRfm} disabled={isRecalculating}>
                {isRecalculating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Recalcular agora
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {rfmHealth && Object.keys(rfmHealth.segments).length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Segmento</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(rfmHealth.segments)
                    .sort(([, a], [, b]) => b - a)
                    .map(([seg, count]) => {
                      const total = Object.values(rfmHealth.segments).reduce((s, v) => s + v, 0);
                      return (
                        <TableRow key={seg}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{seg}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{count.toLocaleString('pt-BR')}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{total > 0 ? ((count / total) * 100).toFixed(1) : 0}%</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum dado RFM calculado ainda. Clique em "Recalcular agora".</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AIAgents;

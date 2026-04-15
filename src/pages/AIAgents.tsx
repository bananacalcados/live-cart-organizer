import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Users, Loader2, Send, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

const AIAgents = () => {
  const [activeAgent, setActiveAgent] = useState("customers");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState("");
  const [meta, setMeta] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  // Agent 01 form
  const [novidades, setNovidades] = useState("");
  const [verba, setVerba] = useState("");
  const [metaValue, setMetaValue] = useState("");

  const handleRunAgent = async () => {
    setIsLoading(true);
    setResponse("");
    setMeta(null);

    try {
      const { data, error } = await supabase.functions.invoke("ai-agent-customers", {
        body: { novidades, verba, meta: metaValue },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResponse(data.response);
      setMeta(data.meta);
      toast.success(`Análise concluída — ${data.meta?.customers_analyzed || 0} clientes analisados`);
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

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
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
            {/* Future agents */}
            <TabsTrigger value="sales" disabled className="gap-2 opacity-50">
              Vendas
            </TabsTrigger>
            <TabsTrigger value="marketing" disabled className="gap-2 opacity-50">
              Marketing
            </TabsTrigger>
            <TabsTrigger value="inventory" disabled className="gap-2 opacity-50">
              Estoque
            </TabsTrigger>
          </TabsList>

          <TabsContent value="customers" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Input Panel */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Agente de Clientes
                  </CardTitle>
                  <CardDescription>
                    Analisa a base RFM e gera plano de reativação com scripts prontos para disparo.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="novidades">Novidades em estoque</Label>
                    <Textarea
                      id="novidades"
                      placeholder="Ex: Chegaram tênis ortopédicos Usaflex novos, sandálias Piccadilly conforto..."
                      value={novidades}
                      onChange={(e) => setNovidades(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="verba">Verba da semana (R$)</Label>
                    <Input
                      id="verba"
                      placeholder="Ex: 500"
                      value={verba}
                      onChange={(e) => setVerba(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="meta">Meta de faturamento (R$)</Label>
                    <Input
                      id="meta"
                      placeholder="Ex: 15000"
                      value={metaValue}
                      onChange={(e) => setMetaValue(e.target.value)}
                    />
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

                  {meta && (
                    <div className="space-y-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground font-medium">Metadados</p>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-xs">
                          {meta.customers_analyzed} clientes
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {meta.model}
                        </Badge>
                        {meta.tokens_used && (
                          <Badge variant="outline" className="text-xs">
                            {meta.tokens_used.input_tokens + meta.tokens_used.output_tokens} tokens
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
                      <p className="text-sm">Consultando base de dados e gerando análise...</p>
                      <p className="text-xs mt-1">Isso pode levar até 30 segundos</p>
                    </div>
                  ) : response ? (
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{response}</ReactMarkdown>
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                      <Bot className="h-12 w-12 mb-4 opacity-30" />
                      <p className="text-sm">Configure o contexto da semana e clique em "Executar Agente"</p>
                      <p className="text-xs mt-1">O agente irá consultar seus dados reais de clientes e RFM</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AIAgents;

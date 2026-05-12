import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Sparkles, RefreshCw, MessageCircle, ChevronDown, Send, Trash2,
  AlertTriangle, TrendingUp, Package, Flame, ShoppingCart, Puzzle
} from "lucide-react";

/* ─── Types ─── */
interface ProdutoAfetado {
  sku: string;
  nome: string;
  loja: string;
  size: string;
  estoque: number;
  cobertura_dias?: number;
}

interface Insight {
  tipo: "ruptura" | "encalhe" | "grade_incompleta" | "oportunidade" | "queima" | "compra";
  prioridade: "alta" | "media" | "baixa";
  titulo: string;
  descricao: string;
  produtos_afetados: ProdutoAfetado[];
  acao_recomendada: string;
}

interface AnaliseResponse {
  insights_proativos?: Insight[];
  resumo_executivo?: string;
  score_saude_estoque?: number;
  gerado_em?: string;
  cached?: boolean;
  provider?: string;
  fallback_reason?: string;
}

interface ChatMsg {
  role: "user" | "agente";
  content: string;
}

/* ─── Helpers ─── */
function corPrioridade(p: string) {
  if (p === "alta") return "border-l-4 border-l-red-500";
  if (p === "media") return "border-l-4 border-l-amber-400";
  return "border-l-4 border-l-blue-400";
}

function iconeTipo(t: string) {
  switch (t) {
    case "ruptura": return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "encalhe": return <Package className="h-4 w-4 text-amber-500" />;
    case "grade_incompleta": return <Puzzle className="h-4 w-4 text-blue-400" />;
    case "oportunidade": return <TrendingUp className="h-4 w-4 text-green-500" />;
    case "queima": return <Flame className="h-4 w-4 text-orange-500" />;
    case "compra": return <ShoppingCart className="h-4 w-4 text-purple-500" />;
    default: return <Sparkles className="h-4 w-4" />;
  }
}

function emojiTipo(t: string) {
  switch (t) {
    case "ruptura": return "🔴";
    case "encalhe": return "📦";
    case "grade_incompleta": return "🧩";
    case "oportunidade": return "🟢";
    case "queima": return "🔥";
    case "compra": return "🛒";
    default: return "✨";
  }
}

function ScoreCircle({ score }: { score: number }) {
  let color = "text-red-500";
  if (score >= 40 && score < 70) color = "text-amber-500";
  if (score >= 70) color = "text-green-500";
  return (
    <div className={`flex items-center gap-2 font-bold text-xl ${color}`}>
      <div className={`w-10 h-10 rounded-full border-4 flex items-center justify-center ${color.replace("text", "border")}`}>
        <span className="text-sm">{score}</span>
      </div>
      <span className="text-sm">{score < 40 ? "Crítico" : score < 70 ? "Atenção" : "Saudável"}</span>
    </div>
  );
}

function horarioLabel(geradoEm?: string, cached?: boolean) {
  if (!geradoEm) return "—";
  const d = new Date(geradoEm);
  const now = new Date();
  const diffH = Math.floor((now.getTime() - d.getTime()) / 3600000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (cached && diffH > 0) return `Cache de ${diffH}h atrás`;
  return `Gerado às ${hh}:${mm}`;
}

/* ─── Component ─── */
export default function InventoryAIAnalysis() {
  const [analise, setAnalise] = useState<AnaliseResponse | null>(null);
  const [contextoResumo, setContextoResumo] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* Load analysis */
  const loadAnalise = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-stock-analyst", {
        body: { mode: "analise", force },
      });
      if (error) throw error;
      const d = data as any;
      setAnalise({
        insights_proativos: d.analise?.insights_proativos || [],
        resumo_executivo: d.analise?.resumo_executivo || "",
        score_saude_estoque: d.analise?.score_saude_estoque ?? 50,
        gerado_em: d.gerado_em || new Date().toISOString(),
        cached: d.cached === true,
        provider: d.provider,
        fallback_reason: d.fallback_reason,
      });
      setContextoResumo(d.contexto_resumo || null);
    } catch (e) {
      toast.error("Erro ao carregar análise de estoque");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalise();
  }, [loadAnalise]);

  /* Scroll chat to bottom */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatOpen]);

  /* Send chat message */
  const sendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatSending(true);
    setChatHistory((prev) => [...prev, { role: "user", content: userMsg }]);

    try {
      const { data, error } = await supabase.functions.invoke("ai-stock-analyst", {
        body: {
          mode: "chat",
          mensagem: userMsg,
          historico_conversa: chatHistory.map((m) => ({ role: m.role === "agente" ? "assistant" : "user", content: m.content })),
        },
      });
      if (error) throw error;
      const reply = (data as any)?.resposta || "Sem resposta.";
      setChatHistory((prev) => [...prev, { role: "agente", content: reply }]);
    } catch (e) {
      toast.error("Erro ao enviar mensagem");
      setChatHistory((prev) => [...prev, { role: "agente", content: "❌ Não consegui processar sua pergunta. Tente novamente." }]);
    } finally {
      setChatSending(false);
    }
  }, [chatInput, chatHistory]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const openChatWithPrompt = (prompt: string) => {
    setChatOpen(true);
    setChatInput(prompt);
  };

  const clearChat = () => setChatHistory([]);

  /* Markdown-like simple renderer */
  const renderMarkdown = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("### ")) return <h4 key={i} className="font-bold mt-2">{line.replace("### ", "")}</h4>;
      if (line.startsWith("## ")) return <h3 key={i} className="font-bold mt-3 text-lg">{line.replace("## ", "")}</h3>;
      if (line.startsWith("# ")) return <h2 key={i} className="font-bold mt-4 text-xl">{line.replace("# ", "")}</h2>;
      if (line.startsWith("- ")) return <li key={i} className="ml-4 list-disc">{line.replace("- ", "")}</li>;
      if (line.startsWith("* ")) return <li key={i} className="ml-4 list-disc">{line.replace("* ", "")}</li>;
      if (line.match(/^\d+\.\s/)) return <li key={i} className="ml-4 list-decimal">{line.replace(/^\d+\.\s/, "")}</li>;
      if (line.trim() === "") return <div key={i} className="h-2" />;
      return <p key={i} className="text-sm leading-relaxed">{line}</p>;
    });
  };

  /* Loading skeleton */
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  const insights = analise?.insights_proativos || [];
  const resumo = analise?.resumo_executivo || "";
  const score = analise?.score_saude_estoque ?? 50;
  const isCached = analise?.cached === true;

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">Análise de Estoque — IA</h1>
          <Badge variant="outline" className="text-xs font-normal">
            {horarioLabel(analise?.gerado_em, isCached)}
          </Badge>
          {isCached ? (
            <Badge variant="secondary" className="text-xs gap-1">
              💾 Cache
            </Badge>
          ) : (
            <Badge className="text-xs gap-1 bg-green-500/10 text-green-600 border-green-200">
              ⚡ Ao vivo
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ScoreCircle score={score} />
          <Button
            variant={isCached ? "default" : "outline"}
            size="sm"
            onClick={() => loadAnalise(true)}
            className="gap-1"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {isCached ? "Gerar nova análise" : "Atualizar"}
          </Button>
        </div>
      </div>

      {/* Context summary badges */}
      {contextoResumo && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(contextoResumo).map(([k, v]) => (
            <Badge key={k} variant="outline" className="text-xs">
              {k}: {v}
            </Badge>
          ))}
        </div>
      )}

      {/* Resumo Executivo */}
      {resumo && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <p className="text-sm leading-relaxed text-foreground/90">{resumo}</p>
          </CardContent>
        </Card>
      )}

      {/* Insights Grid */}
      {insights.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {insights.map((insight, idx) => (
            <Card key={idx} className={`${corPrioridade(insight.prioridade)} hover:shadow-md transition-shadow`}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  {iconeTipo(insight.tipo)}
                  <CardTitle className="text-sm font-semibold">{emojiTipo(insight.tipo)} {insight.titulo}</CardTitle>
                </div>
                <Badge
                  variant={insight.prioridade === "alta" ? "destructive" : insight.prioridade === "media" ? "default" : "secondary"}
                  className="text-[10px] h-5"
                >
                  {insight.prioridade.toUpperCase()}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <p className="text-xs text-muted-foreground leading-relaxed">{insight.descricao}</p>

                {/* Produtos afetados (max 5) */}
                {insight.produtos_afetados && insight.produtos_afetados.length > 0 && (
                  <div className="rounded-lg bg-muted/60 p-2 space-y-1">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Produtos afetados</p>
                    <div className="space-y-0.5 max-h-[120px] overflow-auto">
                      {insight.produtos_afetados.slice(0, 5).map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate max-w-[180px]" title={p.nome}>{p.nome}</span>
                          <span className="text-muted-foreground shrink-0">{p.loja} · Est:{p.estoque}</span>
                        </div>
                      ))}
                      {insight.produtos_afetados.length > 5 && (
                        <p className="text-[10px] text-muted-foreground">+{insight.produtos_afetados.length - 5} produtos</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Ação recomendada */}
                <div className="rounded-lg bg-primary/5 border border-primary/10 p-2">
                  <p className="text-[10px] font-semibold text-primary uppercase">Ação recomendada</p>
                  <p className="text-xs mt-0.5">{insight.acao_recomendada}</p>
                </div>

                {/* Perguntar ao agente */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs gap-1 h-7"
                  onClick={() => openChatWithPrompt(`Quero entender melhor: ${insight.titulo}`)}
                >
                  <MessageCircle className="h-3 w-3" />
                  💬 Perguntar ao agente
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Nenhum insight proativo encontrado no momento.</p>
        </div>
      )}

      {/* Chat Panel */}
      <Collapsible open={chatOpen} onOpenChange={setChatOpen} className="border rounded-lg bg-card">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between h-12 px-4">
            <span className="flex items-center gap-2 font-semibold">
              <MessageCircle className="h-4 w-4" />
              Chat com o Agente de Estoque
              {chatHistory.length > 0 && (
                <Badge variant="outline" className="text-[10px]">{chatHistory.length}</Badge>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${chatOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-4 space-y-3">
            {/* Messages */}
            <ScrollArea className="h-[320px] rounded-lg bg-muted/40 p-3">
              {chatHistory.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-8">
                  <p>💬 Pergunte qualquer coisa sobre o estoque, vendas ou produtos.</p>
                  <p className="text-xs mt-1">Ex: "Por que o tênis X está em ruptura?"</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {chatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-background border shadow-sm"
                        }`}
                      >
                        {msg.role === "agente" ? renderMarkdown(msg.content) : msg.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Input */}
            <div className="flex items-end gap-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Pergunte ao agente... (Enter para enviar, Shift+Enter para nova linha)"
                className="min-h-[44px] max-h-[120px] text-sm resize-y"
                disabled={chatSending}
              />
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={chatSending || !chatInput.trim()}
                className="shrink-0 h-10 w-10"
              >
                {chatSending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>

            {chatHistory.length > 0 && (
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-7" onClick={clearChat}>
                <Trash2 className="h-3 w-3" /> Limpar conversa
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

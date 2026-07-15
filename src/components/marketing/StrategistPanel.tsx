// Estrategista (Fase 2) — Painel de chat com o agente de marketing.
// Renderizado dentro de um Sheet a partir do MarketingCalendar.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Sparkles, Plus, Trash2, MessageSquare, CheckCircle2, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Conversation { id: string; titulo: string; last_message_at: string; }
interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls: any;
  pending_confirmation: any;
  created_at: string;
}

export function StrategistPanel({ onDataChanged }: { onDataChanged?: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolIndicator, setToolIndicator] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { if (activeId) loadMessages(activeId); else setMessages([]); }, [activeId]);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, toolIndicator]);

  async function loadConversations() {
    const { data } = await supabase.from("agent_conversations")
      .select("id, titulo, last_message_at")
      .order("last_message_at", { ascending: false }).limit(30);
    setConversations((data as any) || []);
  }

  async function loadMessages(convId: string) {
    const { data } = await supabase.from("agent_messages")
      .select("*").eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    setMessages((data as any) || []);
  }

  async function newConversation() {
    setActiveId(null);
    setMessages([]);
    setInput("");
  }

  async function deleteConversation(id: string) {
    if (!confirm("Apagar esta conversa? Decisões e ações do calendário permanecem.")) return;
    await supabase.from("agent_conversations").delete().eq("id", id);
    if (activeId === id) setActiveId(null);
    loadConversations();
  }

  async function send() {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput("");
    setSending(true);
    setToolIndicator("consultando dados…");

    // UI otimista
    const optimistic: Message = {
      id: `temp-${Date.now()}`, role: "user", content: userMessage,
      tool_calls: null, pending_confirmation: null, created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("marketing-agent-chat", {
        body: { conversationId: activeId, userMessage },
        headers: { Authorization: `Bearer ${sess.session?.access_token}` },
      });
      if (res.error) throw new Error(res.error.message);
      const data = res.data;
      if (data?.error) throw new Error(data.error);

      const newActiveId = data.conversationId;
      if (newActiveId !== activeId) setActiveId(newActiveId);
      await loadMessages(newActiveId);
      loadConversations();

      if (data.committed?.length > 0) {
        toast.success(`Gravado: ${data.committed.map((c: any) => c.kind.replace("propor_", "")).join(", ")}`);
        onDataChanged?.();
      }
      if (data.pendingProposal) {
        toast.info("Proposta aguardando sua confirmação (responda \"ok\" para gravar).");
      }
    } catch (e: any) {
      toast.error(e.message || "Erro no Estrategista");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
      setToolIndicator(null);
    }
  }

  return (
    <div className="flex h-[calc(100vh-120px)] gap-3">
      {/* Sidebar de conversas */}
      <div className="w-56 shrink-0 flex flex-col gap-2">
        <Button onClick={newConversation} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova conversa
        </Button>
        <ScrollArea className="flex-1 border rounded-md">
          <div className="p-1.5 space-y-1">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">Sem conversas ainda.</p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-start gap-1 p-2 rounded cursor-pointer hover:bg-muted ${activeId === c.id ? "bg-muted" : ""}`}
                onClick={() => setActiveId(c.id)}
              >
                <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{c.titulo}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(c.last_message_at), "dd/MM HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Chat */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4 py-2 flex items-center gap-2 bg-gradient-to-r from-violet-500/10 to-transparent">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold">Estrategista</span>
          <Badge variant="outline" className="text-[10px] ml-auto">leitura + memória · confirmação em 2 passos</Badge>
        </div>

        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 && !sending && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Sparkles className="h-8 w-8 mx-auto mb-3 text-violet-400" />
              <p className="font-medium">Sou seu Estrategista de Marketing.</p>
              <p className="text-xs mt-2 max-w-md mx-auto">
                Posso ler métricas reais (vendas, RFM, estoque por numeração, resultados de campanha,
                pressão de disparo, ciclo shadow) e planejar com você o calendário do mês.
                Proponho ações — você confirma antes de eu gravar.
              </p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {[
                  "Como estamos vs meta neste mês?",
                  "Onde está o gargalo de estoque agora?",
                  "Ideia de calendário para a próxima semana",
                ].map((s) => (
                  <Button key={s} variant="outline" size="sm" className="text-xs" onClick={() => setInput(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
            {toolIndicator && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {toolIndicator}
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Pergunte, peça análise ou proponha uma ação…"
            disabled={sending}
            className="flex-1"
          />
          <Button onClick={send} disabled={sending || !input.trim()} size="icon">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const pending = msg.pending_confirmation;
  const committed = pending?.committed;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        )}

        {msg.tool_calls?.tools?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {msg.tool_calls.tools.map((t: any, i: number) => (
              <Badge key={i} variant="secondary" className="text-[10px]">🔎 {t.name}</Badge>
            ))}
          </div>
        )}

        {pending && (
          <div className={`mt-2 border rounded-md p-2 text-xs ${committed ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              {committed ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Clock className="h-3 w-3 text-amber-500" />}
              {committed ? "Gravado" : "Proposta — responda \"ok\" para gravar"}
              <span className="text-muted-foreground font-normal">· {pending.kind?.replace("propor_", "")}</span>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[10px] opacity-80">
              {JSON.stringify(pending.payload, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

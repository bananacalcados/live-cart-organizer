import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Sparkles, Send, Trash2, RefreshCw, Bot, User } from "lucide-react";

interface ChatMsg {
  role: "user" | "agente";
  content: string;
  timestamp: Date;
}

const STORAGE_KEY = "inventory-ai-chat-history";

const SUGGESTIONS = [
  "Quais produtos estão em ruptura?",
  "Onde tenho excesso de estoque?",
  "Quais grades estão incompletas?",
  "Me dá um resumo da saúde do estoque",
  "Quais SKUs devo comprar agora?",
  "Quais produtos estão encalhados?",
];

export default function InventoryAIAnalysis() {
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setChatHistory(
          parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        );
      }
    } catch {}
  }, []);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory));
    } catch {}
  }, [chatHistory]);

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatSending]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [chatSending]);

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? chatInput).trim();
      if (!text || chatSending) return;

      setChatInput("");
      setChatSending(true);
      const userMsg: ChatMsg = { role: "user", content: text, timestamp: new Date() };
      setChatHistory((prev) => [...prev, userMsg]);

      try {
        const { data, error } = await supabase.functions.invoke("ai-stock-analyst", {
          body: {
            mode: "chat",
            mensagem: text,
            historico_conversa: chatHistory.map((m) => ({
              role: m.role === "agente" ? "assistant" : "user",
              content: m.content,
            })),
          },
        });
        if (error) throw error;
        const reply = (data as any)?.resposta || "Sem resposta.";
        setChatHistory((prev) => [
          ...prev,
          { role: "agente", content: reply, timestamp: new Date() },
        ]);
      } catch (e) {
        console.error(e);
        toast.error("Erro ao enviar mensagem");
        setChatHistory((prev) => [
          ...prev,
          {
            role: "agente",
            content: "❌ Não consegui processar sua pergunta. Tente novamente.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setChatSending(false);
      }
    },
    [chatInput, chatHistory, chatSending]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (!confirm("Limpar toda a conversa?")) return;
    setChatHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const renderMarkdown = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("### "))
        return <h4 key={i} className="font-bold mt-2 text-sm">{line.replace("### ", "")}</h4>;
      if (line.startsWith("## "))
        return <h3 key={i} className="font-bold mt-3 text-base">{line.replace("## ", "")}</h3>;
      if (line.startsWith("# "))
        return <h2 key={i} className="font-bold mt-4 text-lg">{line.replace("# ", "")}</h2>;
      if (line.startsWith("- ") || line.startsWith("* "))
        return <li key={i} className="ml-4 list-disc">{line.replace(/^[-*]\s/, "")}</li>;
      if (line.match(/^\d+\.\s/))
        return <li key={i} className="ml-4 list-decimal">{line.replace(/^\d+\.\s/, "")}</li>;
      if (line.trim() === "") return <div key={i} className="h-2" />;
      // bold **text**
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={i} className="text-sm leading-relaxed">
          {parts.map((p, j) =>
            p.startsWith("**") && p.endsWith("**") ? (
              <strong key={j}>{p.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{p}</span>
            )
          )}
        </p>
      );
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] min-h-[500px] border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Agente de Estoque</h2>
            <p className="text-xs text-muted-foreground">
              Pergunte sobre rupturas, encalhes, compras, vendas e mais
            </p>
          </div>
        </div>
        {chatHistory.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} className="gap-1 text-xs">
            <Trash2 className="h-3.5 w-3.5" /> Limpar
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {chatHistory.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8 gap-6">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="font-semibold text-lg">Olá! Como posso ajudar?</h3>
              <p className="text-sm text-muted-foreground">
                Sou seu agente de análise de estoque. Posso responder sobre ruptura,
                encalhe, grades, vendas, sugestões de compra e qualquer dúvida sobre o
                seu inventário.
              </p>
            </div>
            <div className="w-full max-w-2xl">
              <p className="text-xs text-muted-foreground mb-2 text-left">
                Sugestões para começar:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    className="text-left text-sm rounded-lg border bg-background hover:bg-accent hover:border-primary/40 transition-colors px-3 py-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "agente" && (
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted rounded-bl-sm"
                  }`}
                >
                  {msg.role === "agente" ? (
                    <div className="space-y-1">{renderMarkdown(msg.content)}</div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                  <p
                    className={`text-[10px] mt-1 ${
                      msg.role === "user"
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground"
                    }`}
                  >
                    {msg.timestamp.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {msg.role === "user" && (
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}
            {chatSending && (
              <div className="flex gap-3 justify-start">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3 bg-background">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Pergunte qualquer coisa sobre o estoque..."
            className="min-h-[44px] max-h-[160px] text-sm resize-none"
            disabled={chatSending}
            rows={1}
          />
          <Button
            size="icon"
            onClick={() => sendMessage()}
            disabled={chatSending || !chatInput.trim()}
            className="shrink-0 h-11 w-11"
          >
            {chatSending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  );
}

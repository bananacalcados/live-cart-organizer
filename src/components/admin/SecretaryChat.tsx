import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Send, Bot, User, Settings, Loader2, Sparkles } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function SecretaryChat() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Settings
  const [reminderPhone, setReminderPhone] = useState("");
  const [whatsappNumberId, setWhatsappNumberId] = useState("");
  const [weeklyDay, setWeeklyDay] = useState("1");
  const [weeklyHour, setWeeklyHour] = useState("8");
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (userId) {
      loadHistory();
      loadSettings();
      loadWhatsappNumbers();
    }
  }, [userId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserId(user.id);
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from("secretary_messages")
      .select("*")
      .eq("user_id", userId!)
      .order("created_at", { ascending: true })
      .limit(100);
    if (data) setMessages(data as Message[]);
    setLoadingHistory(false);
  };

  const loadSettings = async () => {
    const { data } = await supabase
      .from("secretary_settings")
      .select("*")
      .eq("user_id", userId!)
      .maybeSingle();
    if (data) {
      setReminderPhone(data.reminder_phone || "");
      setWhatsappNumberId(data.whatsapp_number_id || "");
      setWeeklyDay(String(data.weekly_reminder_day ?? 1));
      setWeeklyHour(String(data.weekly_reminder_hour ?? 8));
    }
  };

  const loadWhatsappNumbers = async () => {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, phone_number")
      .eq("is_active", true);
    if (data) setWhatsappNumbers(data);
  };

  const saveSettings = async () => {
    if (!userId) return;
    const { error } = await supabase
      .from("secretary_settings")
      .upsert({
        user_id: userId,
        reminder_phone: reminderPhone,
        whatsapp_number_id: whatsappNumberId || null,
        weekly_reminder_day: parseInt(weeklyDay),
        weekly_reminder_hour: parseInt(weeklyHour),
      }, { onConflict: "user_id" });

    if (error) {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } else {
      toast({ title: "Configurações salvas!" });
      setShowSettings(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || !userId) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Save user message
    await supabase.from("secretary_messages").insert({
      user_id: userId,
      role: "user",
      content: userMsg.content,
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Build conversation for Claude (last 20 messages)
      const conversationHistory = [...messages.slice(-20), userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await supabase.functions.invoke("ai-secretary", {
        body: { messages: conversationHistory, userId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (res.error || res.data?.error) {
        throw new Error(res.data?.error || (res.data?.retryable ? "A IA está temporariamente indisponível. Tente novamente em instantes." : "Erro na resposta da IA"));
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.data.reply,
        created_at: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Save assistant message
      await supabase.from("secretary_messages").insert({
        user_id: userId,
        role: "assistant",
        content: assistantMsg.content,
        tool_calls: res.data.toolCalls > 0 ? { count: res.data.toolCalls } : null,
      });
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível obter resposta",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const dayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

  if (showSettings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" /> Configurações da Secretária
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Seu WhatsApp (para receber lembretes)</Label>
            <Input
              value={reminderPhone}
              onChange={e => setReminderPhone(e.target.value)}
              placeholder="5531999999999"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Instância WhatsApp para envio</Label>
            <Select value={whatsappNumberId} onValueChange={setWhatsappNumberId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {whatsappNumbers.map(n => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label} ({n.phone_number})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Dia do resumo semanal</Label>
              <Select value={weeklyDay} onValueChange={setWeeklyDay}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dayNames.map((d, i) => (
                    <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Horário</Label>
              <Select value={weeklyHour} onValueChange={setWeeklyHour}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveSettings} className="flex-1">Salvar</Button>
            <Button variant="outline" onClick={() => setShowSettings(false)}>Voltar</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-220px)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Secretária Virtual</h2>
            <p className="text-xs text-muted-foreground">IA para gestão, lembretes e consultas</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSettings(true)} className="gap-1.5">
          <Settings className="h-3.5 w-3.5" /> Configurar
        </Button>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 p-4">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Sparkles className="h-12 w-12 mb-4 text-violet-400" />
              <p className="text-lg font-medium">Olá! Sou sua Secretária Virtual 🤖</p>
              <p className="text-sm mt-2 max-w-md">
                Posso registrar contas a pagar, agendar lembretes via WhatsApp, 
                consultar vendas, status de envios e muito mais. O que precisa?
              </p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {[
                  "📋 Quais contas vencem essa semana?",
                  "💰 Registrar boleto de fornecedor",
                  "📦 Quantos envios pendentes temos?",
                  "📊 Como foram as vendas hoje?",
                ].map(suggestion => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setInput(suggestion);
                    }}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-400">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md"
                    }`}
                  >
                    {msg.content}
                  </div>
                  {msg.role === "user" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-400">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          )}
        </ScrollArea>

        <div className="border-t p-3 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={loading || !input.trim()} size="icon">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </Card>
    </div>
  );
}

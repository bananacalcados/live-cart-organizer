import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Send, MessageCircle } from "lucide-react";

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  channel: string;
  created_at: string;
  message_type: string;
}

interface PresenterTeamChatProps {
  eventId: string;
  /** When true, renders with large fonts for the presenter view */
  presenterMode?: boolean;
}

export function PresenterTeamChat({ eventId, presenterMode = false }: PresenterTeamChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [senderName, setSenderName] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channel = `presenter-${eventId}`;

  // Detect sender name
  useEffect(() => {
    const detect = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profile?.display_name) {
          setSenderName(profile.display_name);
          return;
        }
        const emailName = (user.email || "").split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        setSenderName(user.user_metadata?.full_name || user.user_metadata?.name || emailName);
      } catch {
        setSenderName("Equipe");
      }
    };
    detect();
  }, []);

  // Load messages + realtime
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("team_chat_messages")
        .select("id, sender_name, message, channel, created_at, message_type")
        .eq("channel", channel)
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) setMessages(data as ChatMessage[]);
    };
    load();

    const sub = supabase
      .channel(`presenter-chat-${eventId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "team_chat_messages",
        filter: `channel=eq.${channel}`,
      }, (payload) => {
        setMessages(prev => [...prev.slice(-99), payload.new as ChatMessage]);
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [eventId, channel]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Sound for presenter mode
  const playSound = useCallback(() => {
    if (!presenterMode) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 660;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }, [presenterMode]);

  // Play sound on new message in presenter mode
  useEffect(() => {
    if (messages.length > 0) playSound();
  }, [messages.length, playSound]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    await supabase.from("team_chat_messages").insert({
      sender_name: senderName,
      message: text,
      channel,
      message_type: "text",
    });
    setSending(false);
  };

  const getNameColor = (name: string) => {
    const colors = [
      "text-amber-400", "text-pink-400", "text-cyan-400",
      "text-green-400", "text-purple-400", "text-orange-400", "text-blue-400"
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-700 bg-zinc-900/80">
        <MessageCircle className={presenterMode ? "h-6 w-6 text-amber-400" : "h-4 w-4 text-primary"} />
        <span className={presenterMode ? "text-lg font-bold text-amber-300" : "text-sm font-semibold"}>
          Chat da Equipe
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className={`text-center py-8 ${presenterMode ? "text-lg text-zinc-500" : "text-xs text-muted-foreground"}`}>
            Nenhuma mensagem da equipe ainda 📢
          </p>
        )}
        {messages.map(msg => {
          const isMe = msg.sender_name === senderName;
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} animate-fade-in`}>
              <span className={`${presenterMode ? "text-sm" : "text-[10px]"} ${getNameColor(msg.sender_name)} font-bold`}>
                {msg.sender_name}
              </span>
              <div className={`max-w-[90%] px-4 py-2 rounded-2xl ${
                isMe
                  ? "bg-amber-500/20 border border-amber-500/40 rounded-br-sm"
                  : "bg-zinc-800 border border-zinc-700 rounded-bl-sm"
              }`}>
                <p className={`${
                  presenterMode
                    ? "text-xl md:text-2xl font-bold leading-snug text-white"
                    : "text-sm text-foreground"
                }`}>
                  {msg.message}
                </p>
              </div>
              <span className={`${presenterMode ? "text-xs" : "text-[9px]"} text-zinc-500 mt-0.5`}>
                {formatTime(msg.created_at)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-zinc-700 bg-zinc-900/80">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Mensagem para a equipe..."
            maxLength={500}
            className={`flex-1 bg-zinc-800 rounded-full px-4 py-2 text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-amber-500/50 ${
              presenterMode ? "text-lg" : "text-sm"
            }`}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center transition-colors"
          >
            <Send className={presenterMode ? "w-5 h-5 text-black" : "w-4 h-4 text-black"} />
          </button>
        </div>
      </div>
    </div>
  );
}

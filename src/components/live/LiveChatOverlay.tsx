import { useState, useEffect, useRef } from "react";
import { Send, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ChatMessage {
  id: string;
  viewer_name: string;
  message: string;
  message_type: string;
  created_at: string;
}

interface LiveChatOverlayProps {
  sessionId: string;
  viewerName: string;
  viewerPhone: string;
  viewerCount: number;
}

export function LiveChatOverlay({ sessionId, viewerName, viewerPhone, viewerCount }: LiveChatOverlayProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load initial messages + subscribe to realtime
  useEffect(() => {
    const loadMessages = async () => {
      const { data } = await supabase
        .from("live_chat_messages")
        .select("id, viewer_name, message, message_type, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) setMessages(data);
    };
    loadMessages();

    const channel = supabase
      .channel(`live-chat-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_chat_messages", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages(prev => [...prev.slice(-99), msg]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");

    await supabase.from("live_chat_messages").insert({
      session_id: sessionId,
      viewer_name: viewerName,
      viewer_phone: viewerPhone,
      message: text,
      message_type: "text",
    });

    // Update messages_count on viewer
    await supabase
      .from("live_viewers")
      .update({ messages_count: messages.length + 1, last_seen_at: new Date().toISOString() })
      .eq("session_id", sessionId)
      .eq("phone", viewerPhone);

    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getNameColor = (name: string) => {
    const colors = ["text-amber-400", "text-pink-400", "text-cyan-400", "text-green-400", "text-purple-400", "text-orange-400", "text-blue-400"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
        <span className="text-xs font-bold text-zinc-300">Chat ao vivo</span>
        <div className="flex items-center gap-1 text-xs text-zinc-400">
          <Users className="w-3 h-3" />
          <span>{viewerCount}</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 min-h-0">
        {messages.map(msg => (
          <div key={msg.id} className="animate-fade-in">
            {msg.message_type === "system" ? (
              <p className="text-[11px] text-zinc-500 text-center italic">{msg.message}</p>
            ) : (
              <p className="text-[12px] leading-tight">
                <span className={`font-bold ${getNameColor(msg.viewer_name)}`}>
                  {msg.viewer_name}
                </span>
                <span className="text-zinc-300 ml-1.5">{msg.message}</span>
              </p>
            )}
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-zinc-600 text-xs text-center py-4">Seja o primeiro a comentar! 💬</p>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Comente aqui..."
            maxLength={200}
            className="flex-1 bg-zinc-800 rounded-full px-4 py-2 text-xs text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-amber-500/50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="w-8 h-8 rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-black" />
          </button>
        </div>
      </div>
    </div>
  );
}

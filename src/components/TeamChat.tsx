import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, X, Send, Minimize2, Maximize2 } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  channel: string;
  created_at: string;
}

export function TeamChat() {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [senderName, setSenderName] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const detectName = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          // Check user_profiles first
          try {
            const { data: profileById } = await supabase
              .from('user_profiles')
              .select('display_name')
              .eq('user_id', user.id)
              .maybeSingle();
            
            if (profileById?.display_name) {
              setSenderName(profileById.display_name);
              localStorage.setItem('team_chat_name', profileById.display_name);
              setIsReady(true);
              return;
            }

            // Check by email placeholder
            const emailKey = `email:${(user.email || '').toLowerCase()}`;
            const { data: profileByEmail } = await supabase
              .from('user_profiles')
              .select('id, display_name')
              .eq('user_id', emailKey)
              .maybeSingle();
            
            if (profileByEmail?.display_name) {
              await supabase.from('user_profiles')
                .update({ user_id: user.id } as any)
                .eq('id', profileByEmail.id);
              setSenderName(profileByEmail.display_name);
              localStorage.setItem('team_chat_name', profileByEmail.display_name);
              setIsReady(true);
              return;
            }
          } catch (profileErr) {
            console.warn('user_profiles lookup failed, using fallback:', profileErr);
          }

          // Fallback to email name
          const emailName = (user.email || '').split('@')[0]
            .replace(/[._-]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          const displayName = user.user_metadata?.full_name || user.user_metadata?.name || emailName;
          setSenderName(displayName);
          localStorage.setItem('team_chat_name', displayName);
          setIsReady(true);
        } else {
          const stored = localStorage.getItem('team_chat_name');
          if (stored) { setSenderName(stored); setIsReady(true); }
        }
      } catch (err) {
        console.warn('TeamChat detectName error:', err);
        const stored = localStorage.getItem('team_chat_name');
        if (stored) { setSenderName(stored); }
        setIsReady(true);
      }
    };
    detectName();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadMessages();

    const channel = supabase
      .channel('team-chat-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' }, (payload) => {
        const msg = payload.new as ChatMessage;
        setMessages((prev) => [...prev, msg]);
        setTimeout(() => scrollToBottom(), 100);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      const channel = supabase
        .channel('team-chat-unread')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' }, () => {
          setUnreadCount((c) => c + 1);
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    } else {
      setUnreadCount(0);
    }
  }, [isOpen]);

  const loadMessages = async () => {
    const { data } = await supabase
      .from('team_chat_messages')
      .select('*')
      .eq('channel', 'general')
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) {
      setMessages(data as ChatMessage[]);
      setTimeout(() => scrollToBottom(), 100);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !senderName.trim()) return;
    const msg = newMessage.trim();
    setNewMessage('');
    await supabase.from('team_chat_messages').insert({
      sender_name: senderName,
      message: msg,
      channel: 'general',
    });
  };

  // Hide on POS page (has its own chat) and landing pages
  if (location.pathname === '/pos' || location.pathname === '/live' || location.pathname.startsWith('/banana-') || location.pathname.startsWith('/lp/')) return null;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105"
      >
        <MessageCircle className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`fixed bottom-6 right-6 z-50 bg-card border border-border rounded-xl shadow-2xl flex flex-col transition-all ${isMinimized ? 'w-72 h-12' : 'w-80 h-[28rem]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-primary/5 rounded-t-xl cursor-pointer" onClick={() => isMinimized && setIsMinimized(false)}>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Chat da Equipe</span>
          {senderName && <span className="text-[10px] text-muted-foreground">({senderName})</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} className="p-1 hover:bg-secondary rounded">
            {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-secondary rounded">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {!isReady ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <p className="text-sm text-muted-foreground">Carregando...</p>
            </div>
          ) : (
            <>
              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">Nenhuma mensagem ainda. Diga oi! 👋</p>
                )}
                {messages.map((msg) => {
                  const isMe = msg.sender_name === senderName;
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-muted-foreground mb-0.5">{msg.sender_name}</span>
                      <div className={`max-w-[80%] px-3 py-1.5 rounded-xl text-sm ${isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-secondary text-foreground rounded-bl-sm'}`}>
                        {msg.message}
                      </div>
                      <span className="text-[9px] text-muted-foreground mt-0.5">
                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Input */}
              <div className="border-t border-border p-2 flex gap-2">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Mensagem..."
                  className="h-8 text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                />
                <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={!newMessage.trim()}>
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

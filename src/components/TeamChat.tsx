import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, X, Send, Minimize2, Maximize2, Image, Mic, BarChart3, CheckCheck, Check } from 'lucide-react';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  channel: string;
  created_at: string;
  message_type: string;
  metadata?: any;
}

interface PollOption {
  text: string;
  votes: string[]; // sender_names who voted
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
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const detectName = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
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
            console.warn('user_profiles lookup failed:', profileErr);
          }
          const emailName = (user.email || '').split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
        if (stored) setSenderName(stored);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_chat_messages' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages(prev => [...prev, payload.new as ChatMessage]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new as ChatMessage : m));
        }
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
          setUnreadCount(c => c + 1);
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
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !senderName.trim()) return;
    const msg = newMessage.trim();
    setNewMessage('');
    await supabase.from('team_chat_messages').insert({
      sender_name: senderName,
      message: msg,
      channel: 'general',
      message_type: 'text',
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'audio') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Arquivo muito grande (max 10MB)'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `team-chat/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const { error } = await supabase.storage.from('chat-media').upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);
      await supabase.from('team_chat_messages').insert({
        sender_name: senderName,
        message: type === 'image' ? '📷 Foto' : '🎵 Áudio',
        channel: 'general',
        message_type: type,
        metadata: { url: urlData.publicUrl, fileName: file.name } as any,
      });
    } catch (err) {
      console.error(err);
      toast.error('Erro ao enviar arquivo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSendPoll = async () => {
    if (!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2) {
      toast.error('Preencha a pergunta e pelo menos 2 opções');
      return;
    }
    const options: PollOption[] = pollOptions.filter(o => o.trim()).map(o => ({ text: o.trim(), votes: [] }));
    await supabase.from('team_chat_messages').insert({
      sender_name: senderName,
      message: pollQuestion.trim(),
      channel: 'general',
      message_type: 'poll',
      metadata: { options } as any,
    });
    setPollQuestion('');
    setPollOptions(['', '']);
    setShowPollCreator(false);
  };

  const handleVotePoll = async (msgId: string, optionIndex: number) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.metadata?.options) return;
    const options = [...msg.metadata.options] as PollOption[];
    // Remove previous vote
    options.forEach(o => { o.votes = o.votes.filter(v => v !== senderName); });
    // Add new vote
    options[optionIndex].votes.push(senderName);
    await supabase.from('team_chat_messages')
      .update({ metadata: { options } } as any)
      .eq('id', msgId);
  };

  const handleAcknowledge = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;
    const acks: string[] = msg.metadata?.acknowledgements || [];
    if (acks.includes(senderName)) return;
    await supabase.from('team_chat_messages')
      .update({ metadata: { ...msg.metadata, acknowledgements: [...acks, senderName] } } as any)
      .eq('id', msgId);
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

  const renderMessage = (msg: ChatMessage) => {
    const isMe = msg.sender_name === senderName;
    const acks: string[] = msg.metadata?.acknowledgements || [];
    const hasAcked = acks.includes(senderName);

    return (
      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        <span className="text-[10px] text-muted-foreground mb-0.5">{msg.sender_name}</span>
        <div className={`max-w-[85%] px-3 py-1.5 rounded-xl text-sm ${isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-secondary text-foreground rounded-bl-sm'}`}>
          {/* Text */}
          {msg.message_type === 'text' && msg.message}

          {/* Image */}
          {msg.message_type === 'image' && msg.metadata?.url && (
            <img src={msg.metadata.url} alt="Foto" className="max-w-full rounded-lg max-h-48 cursor-pointer" onClick={() => window.open(msg.metadata.url, '_blank')} />
          )}

          {/* Audio */}
          {msg.message_type === 'audio' && msg.metadata?.url && (
            <audio controls src={msg.metadata.url} className="max-w-full" />
          )}

          {/* Poll */}
          {msg.message_type === 'poll' && msg.metadata?.options && (
            <div className="space-y-1.5">
              <p className="font-semibold text-xs">📊 {msg.message}</p>
              {(msg.metadata.options as PollOption[]).map((opt, i) => {
                const totalVotes = (msg.metadata.options as PollOption[]).reduce((s, o) => s + o.votes.length, 0);
                const pct = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
                const voted = opt.votes.includes(senderName);
                return (
                  <button
                    key={i}
                    onClick={() => handleVotePoll(msg.id, i)}
                    className={`w-full text-left px-2 py-1 rounded text-xs relative overflow-hidden border ${voted ? 'border-primary/50 bg-primary/10' : 'border-border/50 hover:bg-secondary/50'}`}
                  >
                    <div className="absolute inset-0 bg-primary/10 rounded" style={{ width: `${pct}%` }} />
                    <span className="relative z-10 flex justify-between">
                      <span>{opt.text}</span>
                      <span className="text-muted-foreground">{opt.votes.length} ({pct}%)</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Acknowledge button for non-poll messages from others */}
        {!isMe && msg.message_type !== 'poll' && (
          <button
            onClick={() => handleAcknowledge(msg.id)}
            className={`mt-0.5 flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full transition-all ${hasAcked ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-secondary'}`}
          >
            {hasAcked ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {acks.length > 0 ? `${acks.length} ciente${acks.length > 1 ? 's' : ''}` : 'Ciente'}
          </button>
        )}

        {/* Show acks on own messages */}
        {isMe && acks.length > 0 && (
          <span className="text-[9px] text-primary mt-0.5 flex items-center gap-1">
            <CheckCheck className="h-3 w-3" /> {acks.length} ciente{acks.length > 1 ? 's' : ''}
          </span>
        )}

        <span className="text-[9px] text-muted-foreground mt-0.5">
          {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    );
  };

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
                {messages.map(renderMessage)}
              </div>

              {/* Poll Creator */}
              {showPollCreator && (
                <div className="border-t border-border p-2 space-y-1.5 bg-secondary/30">
                  <Input
                    value={pollQuestion}
                    onChange={e => setPollQuestion(e.target.value)}
                    placeholder="Pergunta da enquete..."
                    className="h-7 text-xs"
                  />
                  {pollOptions.map((opt, i) => (
                    <Input
                      key={i}
                      value={opt}
                      onChange={e => {
                        const next = [...pollOptions];
                        next[i] = e.target.value;
                        setPollOptions(next);
                      }}
                      placeholder={`Opção ${i + 1}`}
                      className="h-7 text-xs"
                    />
                  ))}
                  <div className="flex gap-1">
                    {pollOptions.length < 4 && (
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setPollOptions([...pollOptions, ''])}>+ Opção</Button>
                    )}
                    <Button size="sm" className="h-6 text-[10px] ml-auto" onClick={handleSendPoll}>Enviar Enquete</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setShowPollCreator(false)}>Cancelar</Button>
                  </div>
                </div>
              )}

              {/* Input + Media Buttons */}
              <div className="border-t border-border p-2 space-y-1">
                <div className="flex items-center gap-1">
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileUpload(e, 'image')} />
                  <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={e => handleFileUpload(e, 'audio')} />
                  <button onClick={() => imageInputRef.current?.click()} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground" disabled={uploading}>
                    <Image className="h-4 w-4" />
                  </button>
                  <button onClick={() => audioInputRef.current?.click()} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground" disabled={uploading}>
                    <Mic className="h-4 w-4" />
                  </button>
                  <button onClick={() => setShowPollCreator(!showPollCreator)} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground">
                    <BarChart3 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    placeholder="Mensagem..."
                    className="h-8 text-sm"
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  />
                  <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={!newMessage.trim() || uploading}>
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

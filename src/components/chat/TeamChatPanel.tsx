import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Users, Send, Image as ImageIcon, Mic, BarChart3, CheckCheck, Check, Circle, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useTeamIdentity } from '@/hooks/chat/useTeamIdentity';
import { useTeamChatPresence } from '@/hooks/chat/useTeamChatPresence';
import { useTeamChatUnread } from '@/hooks/chat/useTeamChatUnread';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  channel: string;
  created_at: string;
  message_type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}

interface PollOption { text: string; votes: string[] }

interface Props {
  onBack?: () => void;
}

export function TeamChatPanel({ onBack }: Props) {
  const { senderName, userId, isReady } = useTeamIdentity();
  const { members, count: onlineCount } = useTeamChatPresence(senderName, userId);
  const { markAsRead } = useTeamChatUnread(senderName, true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Mark as read on mount + whenever new messages arrive while open
  useEffect(() => { markAsRead(); }, [markAsRead, messages.length]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('team_chat_messages')
        .select('*')
        .eq('channel', 'general')
        .order('created_at', { ascending: true })
        .limit(200);
      if (data) {
        setMessages(data as ChatMessage[]);
        setTimeout(() => scrollToBottom(), 100);
      }
    };
    load();

    const channel = supabase
      .channel('team-chat-panel-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_chat_messages' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages(prev => [...prev, payload.new as ChatMessage]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => m.id === (payload.new as ChatMessage).id ? payload.new as ChatMessage : m));
        }
        setTimeout(() => scrollToBottom(), 100);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

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
        metadata: { url: urlData.publicUrl, fileName: file.name },
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
      metadata: { options },
    });
    setPollQuestion('');
    setPollOptions(['', '']);
    setShowPollCreator(false);
  };

  const handleVotePoll = async (msgId: string, optionIndex: number) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.metadata?.options) return;
    const options = [...msg.metadata.options] as PollOption[];
    options.forEach(o => { o.votes = o.votes.filter(v => v !== senderName); });
    options[optionIndex].votes.push(senderName);
    await supabase.from('team_chat_messages')
      .update({ metadata: { ...msg.metadata, options } })
      .eq('id', msgId);
  };

  const handleAcknowledge = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;
    const acks: string[] = msg.metadata?.acknowledgements || [];
    if (acks.includes(senderName)) return;
    await supabase.from('team_chat_messages')
      .update({ metadata: { ...msg.metadata, acknowledgements: [...acks, senderName] } })
      .eq('id', msgId);
  };

  const initials = (n: string) => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const renderMessage = (msg: ChatMessage) => {
    const isMe = msg.sender_name === senderName;
    const acks: string[] = msg.metadata?.acknowledgements || [];
    const hasAcked = acks.includes(senderName);

    return (
      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        <span className="text-[10px] text-muted-foreground mb-0.5 px-1">{msg.sender_name}</span>
        <div className={cn(
          'max-w-[70%] px-3 py-2 rounded-2xl text-sm',
          isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-secondary text-foreground rounded-bl-sm',
        )}>
          {msg.message_type === 'text' && msg.message}
          {msg.message_type === 'image' && msg.metadata?.url && (
            <img src={msg.metadata.url} alt="Foto" className="max-w-full rounded-lg max-h-64 cursor-pointer" onClick={() => window.open(msg.metadata.url, '_blank')} />
          )}
          {msg.message_type === 'audio' && msg.metadata?.url && (
            <audio controls src={msg.metadata.url} className="max-w-full" />
          )}
          {msg.message_type === 'poll' && msg.metadata?.options && (
            <div className="space-y-1.5 min-w-[200px]">
              <p className="font-semibold text-xs">📊 {msg.message}</p>
              {(msg.metadata.options as PollOption[]).map((opt, i) => {
                const total = (msg.metadata.options as PollOption[]).reduce((s, o) => s + o.votes.length, 0);
                const pct = total > 0 ? Math.round((opt.votes.length / total) * 100) : 0;
                const voted = opt.votes.includes(senderName);
                return (
                  <button
                    key={i}
                    onClick={() => handleVotePoll(msg.id, i)}
                    className={cn(
                      'w-full text-left px-2 py-1 rounded text-xs relative overflow-hidden border',
                      voted ? 'border-primary/50 bg-primary/10' : 'border-border/50 hover:bg-secondary/50',
                    )}
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

        {!isMe && msg.message_type !== 'poll' && (
          <button
            onClick={() => handleAcknowledge(msg.id)}
            className={cn(
              'mt-0.5 flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full transition-all',
              hasAcked ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-secondary',
            )}
          >
            {hasAcked ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {acks.length > 0 ? `${acks.length} ciente${acks.length > 1 ? 's' : ''}` : 'Ciente'}
          </button>
        )}

        {isMe && acks.length > 0 && (
          <span className="text-[9px] text-primary mt-0.5 flex items-center gap-1">
            <CheckCheck className="h-3 w-3" /> {acks.length} ciente{acks.length > 1 ? 's' : ''}
          </span>
        )}

        <span className="text-[9px] text-muted-foreground mt-0.5 px-1">
          {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-[#f0f2f5] dark:bg-[#111b21]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-primary/10 flex-shrink-0">
        {onBack && (
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md">
          <Users className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-extrabold text-base uppercase tracking-wide text-primary">Chat de Equipe</h2>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {onlineCount > 0 ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Circle className="h-2 w-2 fill-current" />
                {onlineCount} online
              </span>
            ) : (
              <span>Nenhum membro online</span>
            )}
            {members.length > 0 && (
              <span className="truncate">· {members.slice(0, 5).map(m => m.name).join(', ')}{members.length > 5 ? '…' : ''}</span>
            )}
          </div>
        </div>
      </div>

      {/* Online members strip */}
      {members.length > 0 && (
        <div className="px-3 py-2 border-b border-border/50 bg-background/50 flex gap-2 overflow-x-auto flex-shrink-0">
          {members.map(m => (
            <div key={m.userId || m.name} className="flex flex-col items-center gap-0.5 flex-shrink-0">
              <div className="relative">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="text-[10px] bg-primary/20 text-primary font-bold">
                    {initials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-emerald-500 text-emerald-500 stroke-white dark:stroke-[#111b21] stroke-2" />
              </div>
              <span className="text-[9px] text-muted-foreground max-w-[60px] truncate">{m.name.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {!isReady && (
          <p className="text-sm text-muted-foreground text-center py-8">Carregando…</p>
        )}
        {isReady && messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda. Diga oi! 👋</p>
        )}
        {messages.map(renderMessage)}
      </div>

      {/* Poll Creator */}
      {showPollCreator && (
        <div className="border-t border-border p-3 space-y-2 bg-secondary/30 flex-shrink-0">
          <Input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Pergunta da enquete..." className="h-8 text-sm" />
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
              className="h-8 text-sm"
            />
          ))}
          <div className="flex gap-2">
            {pollOptions.length < 4 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPollOptions([...pollOptions, ''])}>+ Opção</Button>
            )}
            <Button size="sm" className="h-7 text-xs ml-auto" onClick={handleSendPoll}>Enviar Enquete</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPollCreator(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-3 space-y-2 flex-shrink-0 bg-background">
        <div className="flex items-center gap-1">
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileUpload(e, 'image')} />
          <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={e => handleFileUpload(e, 'audio')} />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => imageInputRef.current?.click()} disabled={uploading}>
            <ImageIcon className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => audioInputRef.current?.click()} disabled={uploading}>
            <Mic className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowPollCreator(s => !s)}>
            <BarChart3 className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder={senderName ? `Mensagem da equipe...` : 'Carregando seu nome...'}
            className="h-9"
            disabled={!senderName || uploading}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={!newMessage.trim() || !senderName || uploading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

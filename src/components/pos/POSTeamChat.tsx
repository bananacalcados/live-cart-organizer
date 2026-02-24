import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Send, Package, HeadphonesIcon, ClipboardList, Plus,
  ArrowRightLeft, AlertTriangle, CheckCircle2, ImageIcon, Mic, MicOff, Paperclip
} from 'lucide-react';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  channel: string;
  created_at: string;
  message_type: string;
  metadata: any;
}

interface ReadReceipt {
  message_id: string;
  reader_name: string;
}

interface Props {
  storeId: string;
}

export function POSTeamChat({ storeId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [senderName, setSenderName] = useState('');
  const [isReady, setIsReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Read receipts
  const [readReceipts, setReadReceipts] = useState<Map<string, string[]>>(new Map());

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Action dialogs
  const [showTransfer, setShowTransfer] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showTask, setShowTask] = useState(false);

  // Transfer form
  const [transferProduct, setTransferProduct] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('1');
  const [transferToStore, setTransferToStore] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  // Support form
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDescription, setSupportDescription] = useState('');
  const [supportPriority, setSupportPriority] = useState('medium');

  // Task form
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskDescription, setTaskDescription] = useState('');

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
              setIsReady(true);
              loadStores();
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
              setIsReady(true);
              loadStores();
              return;
            }
          } catch (profileErr) {
            console.warn('user_profiles lookup failed:', profileErr);
          }

          const emailName = (user.email || '').split('@')[0]
            .replace(/[._-]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          const displayName = user.user_metadata?.full_name || user.user_metadata?.name || emailName;
          setSenderName(displayName);
          setIsReady(true);
        } else {
          const stored = localStorage.getItem('team_chat_name');
          if (stored) { setSenderName(stored); setIsReady(true); }
        }
      } catch (err) {
        console.warn('POSTeamChat detectName error:', err);
        setIsReady(true);
      }
      loadStores();
    };
    detectName();
  }, []);

  useEffect(() => {
    loadMessages();
    const channel = supabase
      .channel('pos-team-chat-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' }, (payload) => {
        setMessages(prev => [...prev, payload.new as ChatMessage]);
        setTimeout(scrollToBottom, 100);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Read receipts realtime
  useEffect(() => {
    loadReadReceipts();
    const channel = supabase
      .channel('pos-team-chat-reads')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_reads' }, (payload) => {
        const r = payload.new as any;
        setReadReceipts(prev => {
          const next = new Map(prev);
          const existing = next.get(r.message_id) || [];
          if (!existing.includes(r.reader_name)) {
            next.set(r.message_id, [...existing, r.reader_name]);
          }
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Mark messages as read when they come in
  useEffect(() => {
    if (!senderName || messages.length === 0) return;
    const unreadIds = messages
      .filter(m => m.sender_name !== senderName)
      .filter(m => !(readReceipts.get(m.id) || []).includes(senderName))
      .map(m => m.id);
    if (unreadIds.length === 0) return;

    const markRead = async () => {
      const inserts = unreadIds.map(id => ({ message_id: id, reader_name: senderName }));
      await supabase.from('team_chat_reads').upsert(inserts, { onConflict: 'message_id,reader_name' });
    };
    markRead();
  }, [messages, senderName]);

  const loadReadReceipts = async () => {
    const { data } = await supabase
      .from('team_chat_reads')
      .select('message_id, reader_name')
      .order('read_at', { ascending: true })
      .limit(500);
    if (data) {
      const map = new Map<string, string[]>();
      data.forEach((r: any) => {
        const existing = map.get(r.message_id) || [];
        existing.push(r.reader_name);
        map.set(r.message_id, existing);
      });
      setReadReceipts(map);
    }
  };

  const loadMessages = async () => {
    const { data } = await supabase
      .from('team_chat_messages')
      .select('*')
      .eq('channel', 'general')
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) {
      setMessages(data as ChatMessage[]);
      setTimeout(scrollToBottom, 100);
    }
  };

  const loadStores = async () => {
    const { data } = await supabase.from('pos_stores').select('id, name').eq('is_active', true);
    if (data) setStores(data.filter(s => s.id !== storeId));
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

  // Image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !senderName) return;
    
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `team-chat/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(fileName, file, { contentType: file.type });
      
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      await supabase.from('team_chat_messages').insert({
        sender_name: senderName,
        message: '📷 Imagem',
        channel: 'general',
        message_type: 'image',
        metadata: { media_url: publicUrl },
      });
      toast.success('Imagem enviada!');
    } catch (err) {
      console.error('Upload error:', err);
      toast.error('Erro ao enviar imagem');
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Audio recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadAudio(blob);
      };
      
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      console.error('Mic error:', err);
      toast.error('Erro ao acessar microfone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    setIsRecording(false);
    setMediaRecorder(null);
  };

  const uploadAudio = async (blob: Blob) => {
    try {
      const fileName = `team-chat/${Date.now()}-audio.webm`;
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(fileName, blob, { contentType: 'audio/webm' });
      
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(fileName);
      
      await supabase.from('team_chat_messages').insert({
        sender_name: senderName,
        message: '🎤 Áudio',
        channel: 'general',
        message_type: 'audio',
        metadata: { media_url: urlData.publicUrl },
      });
      toast.success('Áudio enviado!');
    } catch (err) {
      console.error('Audio upload error:', err);
      toast.error('Erro ao enviar áudio');
    }
  };

  const handleTransferRequest = async () => {
    if (!transferProduct.trim() || !transferToStore) return;
    const storeName = stores.find(s => s.id === transferToStore)?.name || '';
    const msg = `📦 Solicitação de Transferência\nProduto: ${transferProduct}\nQtd: ${transferQuantity}\nPara: ${storeName}${transferNotes ? `\nObs: ${transferNotes}` : ''}`;

    await supabase.from('pos_inter_store_requests').insert({
      from_store_id: storeId,
      to_store_id: transferToStore,
      items: [{ product: transferProduct, quantity: parseInt(transferQuantity) }],
      notes: transferNotes || null,
      status: 'pending',
      priority: 'normal',
    });

    await supabase.from('team_chat_messages').insert({
      sender_name: senderName,
      message: msg,
      channel: 'general',
      message_type: 'transfer_request',
      metadata: { product: transferProduct, quantity: parseInt(transferQuantity), to_store: transferToStore, to_store_name: storeName },
    });

    toast.success('Solicitação de transferência criada!');
    setShowTransfer(false);
    setTransferProduct(''); setTransferQuantity('1'); setTransferToStore(''); setTransferNotes('');
  };

  const handleSupportTicket = async () => {
    if (!supportSubject.trim()) return;

    await supabase.from('support_tickets').insert({
      subject: supportSubject,
      description: supportDescription || null,
      priority: supportPriority,
      status: 'new',
      source: 'pos_chat',
    });

    const priorityLabel = supportPriority === 'urgent' ? '🔴 Urgente' : supportPriority === 'medium' ? '🟡 Média' : '🟢 Baixa';
    const msg = `🎧 Ticket de Suporte Criado\nAssunto: ${supportSubject}\nPrioridade: ${priorityLabel}${supportDescription ? `\nDescrição: ${supportDescription}` : ''}`;

    await supabase.from('team_chat_messages').insert({
      sender_name: senderName,
      message: msg,
      channel: 'general',
      message_type: 'support_ticket',
      metadata: { subject: supportSubject, priority: supportPriority },
    });

    toast.success('Ticket de suporte criado!');
    setShowSupport(false);
    setSupportSubject(''); setSupportDescription(''); setSupportPriority('medium');
  };

  const handleTaskAssign = async () => {
    if (!taskTitle.trim()) return;

    const msg = `📋 Nova Tarefa Designada\nTarefa: ${taskTitle}${taskAssignee ? `\nPara: ${taskAssignee}` : ''}${taskDescription ? `\nDetalhes: ${taskDescription}` : ''}`;

    await supabase.from('team_chat_messages').insert({
      sender_name: senderName,
      message: msg,
      channel: 'general',
      message_type: 'task',
      metadata: { title: taskTitle, assignee: taskAssignee, description: taskDescription },
    });

    toast.success('Tarefa designada no chat!');
    setShowTask(false);
    setTaskTitle(''); setTaskAssignee(''); setTaskDescription('');
  };

  const SENDER_COLORS = [
    'bg-pink-500', 'bg-violet-500', 'bg-blue-500', 'bg-cyan-500',
    'bg-emerald-500', 'bg-lime-500', 'bg-yellow-500', 'bg-rose-500',
    'bg-indigo-500', 'bg-teal-500', 'bg-fuchsia-500', 'bg-sky-500',
  ];

  const getSenderColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
  };

  const renderMessage = (msg: ChatMessage) => {
    const isMe = msg.sender_name === senderName;
    const isAction = !['text', 'image', 'audio'].includes(msg.message_type);
    const senderColor = getSenderColor(msg.sender_name);
    const actionColors: Record<string, string> = {
      transfer_request: 'border-blue-500/30 bg-blue-500/10',
      support_ticket: 'border-red-500/30 bg-red-500/10',
      task: 'border-purple-500/30 bg-purple-500/10',
    };
    const actionIcons: Record<string, JSX.Element> = {
      transfer_request: <ArrowRightLeft className="h-3.5 w-3.5 text-blue-400" />,
      support_ticket: <HeadphonesIcon className="h-3.5 w-3.5 text-red-400" />,
      task: <ClipboardList className="h-3.5 w-3.5 text-purple-400" />,
    };

    const readers = (readReceipts.get(msg.id) || []).filter(r => r !== msg.sender_name);

    return (
      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        <span className={`text-[10px] mb-0.5 font-semibold ${isMe ? 'text-pos-white/40' : senderColor.replace('bg-', 'text-')}`}>{msg.sender_name}</span>
        <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-line ${
          isAction
            ? `border ${actionColors[msg.message_type] || ''} text-pos-white`
            : isMe
              ? 'bg-pos-orange text-pos-black rounded-br-sm'
              : `${senderColor}/20 text-pos-white rounded-bl-sm border border-${senderColor.replace('bg-', '')}/30`
        }`}>
          {isAction && (
            <div className="flex items-center gap-1.5 mb-1">
              {actionIcons[msg.message_type]}
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                {msg.message_type === 'transfer_request' ? 'Transferência' : msg.message_type === 'support_ticket' ? 'Suporte' : 'Tarefa'}
              </span>
            </div>
          )}
          
          {/* Image message */}
          {msg.message_type === 'image' && msg.metadata?.media_url ? (
            <img 
              src={msg.metadata.media_url} 
              alt="Imagem" 
              className="max-w-[250px] max-h-[200px] rounded-lg object-cover cursor-pointer"
              onClick={() => window.open(msg.metadata.media_url, '_blank')}
            />
          ) : msg.message_type === 'audio' && msg.metadata?.media_url ? (
            <audio controls src={msg.metadata.media_url} className="max-w-[250px]" />
          ) : (
            msg.message
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[9px] text-pos-white/30">
            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {readers.length > 0 && (
            <span className="text-[9px] text-pos-white/25 italic">
              Lido por {readers.join(', ')}
            </span>
          )}
        </div>
      </div>
    );
  };

  if (!isReady) {
    return <div className="flex-1 flex items-center justify-center text-pos-white/50 text-sm">Carregando chat...</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-pos-orange/20 bg-pos-white/5">
        <div>
          <h2 className="text-sm font-bold text-pos-white">Chat da Equipe</h2>
          <p className="text-[10px] text-pos-white/40">Logado como {senderName}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 bg-transparent"
            onClick={() => setShowTransfer(true)}
          >
            <Package className="h-3 w-3" /> Transferência
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 bg-transparent"
            onClick={() => setShowSupport(true)}
          >
            <HeadphonesIcon className="h-3 w-3" /> Suporte
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300 bg-transparent"
            onClick={() => setShowTask(true)}
          >
            <ClipboardList className="h-3 w-3" /> Tarefa
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-pos-black/50">
        {messages.length === 0 && (
          <p className="text-xs text-pos-white/30 text-center py-12">Nenhuma mensagem ainda. Diga oi! 👋</p>
        )}
        {messages.map(renderMessage)}
      </div>

      {/* Input */}
      <div className="border-t border-pos-orange/20 p-3 flex gap-2 bg-pos-white/5 items-center">
        {/* Image upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0 text-pos-white/50 hover:text-pos-orange hover:bg-pos-orange/10"
          onClick={() => fileInputRef.current?.click()}
          title="Enviar imagem"
        >
          <ImageIcon className="h-4 w-4" />
        </Button>

        {/* Audio record */}
        <Button
          size="icon"
          variant="ghost"
          className={`h-9 w-9 shrink-0 ${isRecording ? 'text-red-500 bg-red-500/10 animate-pulse' : 'text-pos-white/50 hover:text-pos-orange hover:bg-pos-orange/10'}`}
          onClick={isRecording ? stopRecording : startRecording}
          title={isRecording ? 'Parar gravação' : 'Gravar áudio'}
        >
          {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Mensagem..."
          className="h-9 text-sm bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30"
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
        />
        <Button size="icon" className="h-9 w-9 shrink-0 bg-pos-orange text-pos-black hover:bg-pos-orange-muted" onClick={handleSend} disabled={!newMessage.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Transfer Dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="bg-pos-black border-pos-orange/30 text-pos-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-pos-white">
              <Package className="h-5 w-5 text-blue-400" /> Solicitar Transferência
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70">Produto</Label>
              <Input value={transferProduct} onChange={e => setTransferProduct(e.target.value)} placeholder="Nome ou SKU do produto" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
            </div>
            <div>
              <Label className="text-pos-white/70">Quantidade</Label>
              <Input type="number" value={transferQuantity} onChange={e => setTransferQuantity(e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white" />
            </div>
            <div>
              <Label className="text-pos-white/70">Loja Destino</Label>
              <Select value={transferToStore} onValueChange={setTransferToStore}>
                <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
                <SelectContent>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-pos-white/70">Observações (opcional)</Label>
              <Textarea value={transferNotes} onChange={e => setTransferNotes(e.target.value)} placeholder="Ex: Cliente aguardando" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
            </div>
            <Button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold" onClick={handleTransferRequest}>
              <ArrowRightLeft className="h-4 w-4 mr-2" /> Enviar Solicitação
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Support Dialog */}
      <Dialog open={showSupport} onOpenChange={setShowSupport}>
        <DialogContent className="bg-pos-black border-pos-orange/30 text-pos-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-pos-white">
              <HeadphonesIcon className="h-5 w-5 text-red-400" /> Criar Ticket de Suporte
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70">Assunto</Label>
              <Input value={supportSubject} onChange={e => setSupportSubject(e.target.value)} placeholder="Descreva o problema brevemente" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
            </div>
            <div>
              <Label className="text-pos-white/70">Prioridade</Label>
              <Select value={supportPriority} onValueChange={setSupportPriority}>
                <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">🔴 Urgente (10 min)</SelectItem>
                  <SelectItem value="medium">🟡 Média (1 hora)</SelectItem>
                  <SelectItem value="low">🟢 Baixa (2 horas)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-pos-white/70">Descrição</Label>
              <Textarea value={supportDescription} onChange={e => setSupportDescription(e.target.value)} placeholder="Detalhes do problema..." className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
            </div>
            <Button className="w-full bg-red-500 hover:bg-red-600 text-white font-bold" onClick={handleSupportTicket}>
              <AlertTriangle className="h-4 w-4 mr-2" /> Criar Ticket
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Task Dialog */}
      <Dialog open={showTask} onOpenChange={setShowTask}>
        <DialogContent className="bg-pos-black border-pos-orange/30 text-pos-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-pos-white">
              <ClipboardList className="h-5 w-5 text-purple-400" /> Designar Tarefa
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70">Tarefa</Label>
              <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="O que precisa ser feito?" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
            </div>
            <div>
              <Label className="text-pos-white/70">Para quem? (opcional)</Label>
              <Input value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)} placeholder="Nome da pessoa" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
            </div>
            <div>
              <Label className="text-pos-white/70">Detalhes (opcional)</Label>
              <Textarea value={taskDescription} onChange={e => setTaskDescription(e.target.value)} placeholder="Mais informações..." className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
            </div>
            <Button className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold" onClick={handleTaskAssign}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Designar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

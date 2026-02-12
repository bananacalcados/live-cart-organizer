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
  ArrowRightLeft, AlertTriangle, CheckCircle2
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

interface Props {
  storeId: string;
}

export function POSTeamChat({ storeId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [senderName, setSenderName] = useState('');
  const [isReady, setIsReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const emailName = user.email.split('@')[0]
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        const displayName = user.user_metadata?.full_name || user.user_metadata?.name || emailName;
        setSenderName(displayName);
        setIsReady(true);
      } else {
        const stored = localStorage.getItem('team_chat_name');
        if (stored) { setSenderName(stored); setIsReady(true); }
      }
    };
    detectName();
    loadStores();
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

  const handleTransferRequest = async () => {
    if (!transferProduct.trim() || !transferToStore) return;
    const storeName = stores.find(s => s.id === transferToStore)?.name || '';
    const msg = `📦 Solicitação de Transferência\nProduto: ${transferProduct}\nQtd: ${transferQuantity}\nPara: ${storeName}${transferNotes ? `\nObs: ${transferNotes}` : ''}`;

    // Create inter-store request
    await supabase.from('pos_inter_store_requests').insert({
      from_store_id: storeId,
      to_store_id: transferToStore,
      items: [{ product: transferProduct, quantity: parseInt(transferQuantity) }],
      notes: transferNotes || null,
      status: 'pending',
      priority: 'normal',
    });

    // Post to chat
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

  const renderMessage = (msg: ChatMessage) => {
    const isMe = msg.sender_name === senderName;
    const isAction = msg.message_type !== 'text';
    const actionColors = {
      transfer_request: 'border-blue-500/30 bg-blue-500/10',
      support_ticket: 'border-red-500/30 bg-red-500/10',
      task: 'border-purple-500/30 bg-purple-500/10',
    };
    const actionIcons = {
      transfer_request: <ArrowRightLeft className="h-3.5 w-3.5 text-blue-400" />,
      support_ticket: <HeadphonesIcon className="h-3.5 w-3.5 text-red-400" />,
      task: <ClipboardList className="h-3.5 w-3.5 text-purple-400" />,
    };

    return (
      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        <span className="text-[10px] text-pos-white/40 mb-0.5">{msg.sender_name}</span>
        <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-line ${
          isAction
            ? `border ${actionColors[msg.message_type as keyof typeof actionColors] || ''} text-pos-white`
            : isMe
              ? 'bg-pos-orange text-pos-black rounded-br-sm'
              : 'bg-pos-white/10 text-pos-white rounded-bl-sm'
        }`}>
          {isAction && (
            <div className="flex items-center gap-1.5 mb-1">
              {actionIcons[msg.message_type as keyof typeof actionIcons]}
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                {msg.message_type === 'transfer_request' ? 'Transferência' : msg.message_type === 'support_ticket' ? 'Suporte' : 'Tarefa'}
              </span>
            </div>
          )}
          {msg.message}
        </div>
        <span className="text-[9px] text-pos-white/30 mt-0.5">
          {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
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
      <div className="border-t border-pos-orange/20 p-3 flex gap-2 bg-pos-white/5">
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

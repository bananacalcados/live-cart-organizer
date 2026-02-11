import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HeadphonesIcon, Plus, Clock, CheckCircle2, AlertTriangle, Trophy, Flame, Star, Zap, Target, Medal, MessageCircle, ArrowRightLeft, Phone } from 'lucide-react';
import { SupportWhatsAppChat } from './SupportWhatsAppChat';

interface SupportTicket {
  id: string;
  shopify_order_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  source: string;
  deadline_at: string | null;
  started_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  points_awarded: number;
  created_at: string;
  updated_at: string;
}

interface GamificationEntry {
  id: string;
  member_name: string;
  total_points: number;
  tickets_resolved: number;
  tickets_fast: number;
  tickets_medium: number;
  tickets_slow: number;
  penalties: number;
  weekly_points: number;
  weekly_goal: number;
  badges: any[];
}

function getTimeElapsed(startDate: string) {
  const diff = Date.now() - new Date(startDate).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function calculatePoints(startedAt: string, resolvedAt: string): { points: number; tier: string } {
  const diff = (new Date(resolvedAt).getTime() - new Date(startedAt).getTime()) / 60000;
  if (diff <= 5) return { points: 5, tier: 'fast' };
  if (diff <= 20) return { points: 2, tier: 'medium' };
  return { points: 0, tier: 'slow' };
}

export function SupportDashboard() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ranking, setRanking] = useState<GamificationEntry[]>([]);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newAssignedTo, setNewAssignedTo] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newOrderName, setNewOrderName] = useState('');
  const [chatTicket, setChatTicket] = useState<SupportTicket | null>(null);

  const loadData = useCallback(async () => {
    const [ticketsRes, rankingRes] = await Promise.all([
      supabase.from('support_tickets').select('*').order('created_at', { ascending: false }),
      supabase.from('team_gamification').select('*').order('total_points', { ascending: false }),
    ]);
    if (ticketsRes.data) setTickets(ticketsRes.data as SupportTicket[]);
    if (rankingRes.data) setRanking(rankingRes.data as GamificationEntry[]);
  }, []);

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel('support-tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Get unique team members for transfer
  const teamMembers = Array.from(new Set(
    tickets.map(t => t.assigned_to).filter(Boolean) as string[]
  ));

  const createTicket = async () => {
    if (!newSubject.trim()) { toast.error('Informe o assunto'); return; }
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + (newPriority === 'high' ? 1 : newPriority === 'medium' ? 4 : 24));

    await supabase.from('support_tickets').insert({
      subject: newSubject.trim(),
      description: newDescription.trim() || null,
      priority: newPriority,
      assigned_to: newAssignedTo.trim() || null,
      customer_name: newCustomerName.trim() || null,
      customer_phone: newCustomerPhone.trim() || null,
      shopify_order_name: newOrderName.trim() || null,
      deadline_at: deadline.toISOString(),
    });

    setNewSubject(''); setNewDescription(''); setNewAssignedTo(''); setNewCustomerName(''); setNewCustomerPhone(''); setNewOrderName('');
    setShowNewTicket(false);
    toast.success('Ticket criado!');
    loadData();
  };

  const startTicket = async (ticket: SupportTicket) => {
    await supabase.from('support_tickets').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', ticket.id);
    toast.success('Ticket iniciado!');
    loadData();
  };

  const transferTicket = async (ticket: SupportTicket, newOwner: string) => {
    await supabase.from('support_tickets').update({ assigned_to: newOwner }).eq('id', ticket.id);
    toast.success(`Ticket transferido para ${newOwner}`);
    loadData();
  };

  const resolveTicket = async (ticket: SupportTicket, notes: string) => {
    const now = new Date().toISOString();
    const { points, tier } = ticket.started_at ? calculatePoints(ticket.started_at, now) : { points: 0, tier: 'slow' };

    await supabase.from('support_tickets').update({
      status: 'resolved',
      resolved_at: now,
      resolution_notes: notes || null,
      points_awarded: points,
    }).eq('id', ticket.id);

    if (ticket.assigned_to) {
      const { data: existing } = await supabase.from('team_gamification').select('*').eq('member_name', ticket.assigned_to).maybeSingle();
      if (existing) {
        const e = existing as GamificationEntry;
        const updates: any = {
          total_points: e.total_points + points,
          weekly_points: e.weekly_points + points,
          tickets_resolved: e.tickets_resolved + 1,
        };
        if (tier === 'fast') updates.tickets_fast = e.tickets_fast + 1;
        if (tier === 'medium') updates.tickets_medium = e.tickets_medium + 1;
        if (tier === 'slow') updates.tickets_slow = e.tickets_slow + 1;
        await supabase.from('team_gamification').update(updates).eq('id', e.id);
      } else {
        await supabase.from('team_gamification').insert({
          member_name: ticket.assigned_to,
          total_points: points,
          weekly_points: points,
          tickets_resolved: 1,
          tickets_fast: tier === 'fast' ? 1 : 0,
          tickets_medium: tier === 'medium' ? 1 : 0,
          tickets_slow: tier === 'slow' ? 1 : 0,
        });
      }
    }

    toast.success(`Ticket resolvido! ${points > 0 ? `+${points} pontos 🎉` : 'Sem pontos dessa vez'}`);
    loadData();
  };

  const newTickets = tickets.filter(t => t.status === 'new');
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress');
  const resolvedTickets = tickets.filter(t => t.status === 'resolved');

  // If a chat is open, show split view
  if (chatTicket) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: 'calc(100vh - 300px)' }}>
        <div className="space-y-3 overflow-auto">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <HeadphonesIcon className="h-4 w-4" /> Tickets
          </h3>
          <ScrollArea className="h-[calc(100vh-380px)]">
            <div className="space-y-2 pr-2">
              {[...newTickets, ...inProgressTickets].map(ticket => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onStart={startTicket}
                  onResolve={resolveTicket}
                  onTransfer={transferTicket}
                  onOpenChat={setChatTicket}
                  teamMembers={teamMembers}
                  isActive={ticket.id === chatTicket.id}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
        <div className="h-full">
          <SupportWhatsAppChat
            phone={chatTicket.customer_phone || ''}
            customerName={chatTicket.customer_name || 'Cliente'}
            ticketSubject={chatTicket.subject}
            onClose={() => setChatTicket(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Support Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-orange-500" />
            <div>
              <p className="text-2xl font-bold">{newTickets.length}</p>
              <p className="text-xs text-muted-foreground">Novos</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <Clock className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{inProgressTickets.length}</p>
              <p className="text-xs text-muted-foreground">Em Andamento</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{resolvedTickets.length}</p>
              <p className="text-xs text-muted-foreground">Finalizados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 flex items-center gap-3">
            <Trophy className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{ranking[0]?.total_points || 0}</p>
              <p className="text-xs text-muted-foreground">Líder: {ranking[0]?.member_name || '—'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TicketColumn title="🆕 Novos" tickets={newTickets} onStart={startTicket} onResolve={resolveTicket} onTransfer={transferTicket} onOpenChat={setChatTicket} teamMembers={teamMembers} />
        <TicketColumn title="🔄 Em Andamento" tickets={inProgressTickets} onStart={startTicket} onResolve={resolveTicket} onTransfer={transferTicket} onOpenChat={setChatTicket} teamMembers={teamMembers} />
        <div className="space-y-3">
          <TicketColumn title="✅ Finalizados" tickets={resolvedTickets.slice(0, 10)} onStart={startTicket} onResolve={resolveTicket} onTransfer={transferTicket} onOpenChat={setChatTicket} teamMembers={teamMembers} />
          
          {ranking.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-orange-500" /> Ranking da Equipe
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ranking.map((entry, i) => (
                  <div key={entry.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30">
                    <span className="text-lg font-bold w-6 text-center">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{entry.member_name}</p>
                      <p className="text-[10px] text-muted-foreground">{entry.tickets_resolved} resolvidos · {entry.tickets_fast} rápidos</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary">{entry.total_points} pts</p>
                      <p className="text-[10px] text-muted-foreground">Semana: {entry.weekly_points}/{entry.weekly_goal}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* New Ticket Button */}
      <Dialog open={showNewTicket} onOpenChange={setShowNewTicket}>
        <DialogTrigger asChild>
          <Button className="fixed bottom-6 right-24 z-40 gap-2 shadow-lg">
            <Plus className="h-4 w-4" /> Novo Ticket
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Ticket de Suporte</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Assunto *</Label>
              <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Descreva o problema" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cliente</Label>
                <Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder="Nome" />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} placeholder="5511999999999" />
              </div>
            </div>
            <div>
              <Label>Pedido</Label>
              <Input value={newOrderName} onChange={(e) => setNewOrderName(e.target.value)} placeholder="#1234" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Detalhes..." rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prioridade</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa (24h)</SelectItem>
                    <SelectItem value="medium">Média (4h)</SelectItem>
                    <SelectItem value="high">Alta (1h)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Responsável</Label>
                <Input value={newAssignedTo} onChange={(e) => setNewAssignedTo(e.target.value)} placeholder="Nome" />
              </div>
            </div>
            <Button onClick={createTicket} className="w-full">Criar Ticket</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TicketColumn({
  title,
  tickets,
  onStart,
  onResolve,
  onTransfer,
  onOpenChat,
  teamMembers,
}: {
  title: string;
  tickets: SupportTicket[];
  onStart: (t: SupportTicket) => void;
  onResolve: (t: SupportTicket, notes: string) => void;
  onTransfer: (t: SupportTicket, newOwner: string) => void;
  onOpenChat: (t: SupportTicket) => void;
  teamMembers: string[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm">{title} ({tickets.length})</h3>
      <ScrollArea className="h-[400px]">
        <div className="space-y-2 pr-2">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onStart={onStart} onResolve={onResolve} onTransfer={onTransfer} onOpenChat={onOpenChat} teamMembers={teamMembers} />
          ))}
          {tickets.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">Nenhum ticket</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TicketCard({
  ticket,
  onStart,
  onResolve,
  onTransfer,
  onOpenChat,
  teamMembers,
  isActive,
}: {
  ticket: SupportTicket;
  onStart: (t: SupportTicket) => void;
  onResolve: (t: SupportTicket, notes: string) => void;
  onTransfer: (t: SupportTicket, newOwner: string) => void;
  onOpenChat: (t: SupportTicket) => void;
  teamMembers: string[];
  isActive?: boolean;
}) {
  const [showResolve, setShowResolve] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [notes, setNotes] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const isOverdue = ticket.deadline_at && new Date(ticket.deadline_at) < new Date() && ticket.status !== 'resolved';

  return (
    <Card className={`${isOverdue ? 'border-destructive/50 bg-destructive/5' : ''} ${isActive ? 'ring-2 ring-primary' : ''}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{ticket.subject}</p>
            {ticket.customer_name && <p className="text-xs text-muted-foreground">{ticket.customer_name}</p>}
            {ticket.shopify_order_name && <p className="text-xs text-muted-foreground">Pedido {ticket.shopify_order_name}</p>}
          </div>
          <Badge variant={ticket.priority === 'high' ? 'destructive' : ticket.priority === 'medium' ? 'default' : 'secondary'} className="text-[10px] shrink-0">
            {ticket.priority === 'high' ? '🔴' : ticket.priority === 'medium' ? '🟡' : '🟢'} {ticket.priority}
          </Badge>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          {ticket.assigned_to && <span>👤 {ticket.assigned_to}</span>}
          {ticket.customer_phone && <span className="flex items-center gap-0.5"><Phone className="h-2.5 w-2.5" /> {ticket.customer_phone}</span>}
          {ticket.started_at && ticket.status === 'in_progress' && (
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {getTimeElapsed(ticket.started_at)}</span>
          )}
          {ticket.points_awarded > 0 && <span className="text-primary font-bold">+{ticket.points_awarded} pts</span>}
          {isOverdue && <span className="text-destructive font-bold">⚠️ ATRASADO</span>}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1 flex-wrap">
          {ticket.status === 'new' && (
            <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => onStart(ticket)}>
              Iniciar
            </Button>
          )}
          {ticket.status === 'in_progress' && !showResolve && (
            <Button size="sm" className="h-7 text-xs flex-1" onClick={() => setShowResolve(true)}>
              Resolver
            </Button>
          )}
          
          {/* WhatsApp button */}
          {ticket.customer_phone && ticket.status !== 'resolved' && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onOpenChat(ticket)}>
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </Button>
          )}

          {/* Transfer button */}
          {ticket.status !== 'resolved' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowTransfer(!showTransfer)}>
              <ArrowRightLeft className="h-3 w-3" /> Transferir
            </Button>
          )}
        </div>

        {/* Transfer form */}
        {showTransfer && (
          <div className="space-y-2 pt-1 border-t">
            <p className="text-[10px] text-muted-foreground font-medium">Transferir para:</p>
            <div className="flex flex-wrap gap-1">
              {teamMembers.filter(m => m !== ticket.assigned_to).map(member => (
                <Button key={member} size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { onTransfer(ticket, member); setShowTransfer(false); }}>
                  {member}
                </Button>
              ))}
            </div>
            <div className="flex gap-1">
              <Input
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                placeholder="Ou digite o nome..."
                className="h-7 text-xs"
              />
              <Button size="sm" className="h-7 text-xs" disabled={!transferTo.trim()} onClick={() => { onTransfer(ticket, transferTo.trim()); setTransferTo(''); setShowTransfer(false); }}>
                OK
              </Button>
            </div>
          </div>
        )}

        {/* Resolve form */}
        {showResolve && (
          <div className="space-y-2">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Como foi resolvido?" className="h-7 text-xs" />
            <div className="flex gap-1">
              <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => { onResolve(ticket, notes); setShowResolve(false); }}>Confirmar</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowResolve(false)}>Cancelar</Button>
            </div>
          </div>
        )}
        {ticket.status === 'resolved' && ticket.resolution_notes && (
          <p className="text-[10px] text-muted-foreground italic">✅ {ticket.resolution_notes}</p>
        )}
      </CardContent>
    </Card>
  );
}

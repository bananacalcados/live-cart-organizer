import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { HeadphonesIcon } from 'lucide-react';

interface CreateSupportTicketDialogProps {
  /** Pre-fill customer phone */
  phone?: string;
  /** Pre-fill customer name */
  customerName?: string;
  /** Pre-fill order name */
  orderName?: string;
  /** Custom trigger element. Defaults to a button. */
  trigger?: React.ReactNode;
  /** Callback after ticket is created */
  onCreated?: () => void;
}

export function CreateSupportTicketDialog({
  phone,
  customerName,
  orderName,
  trigger,
  onCreated,
}: CreateSupportTicketDialogProps) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!subject.trim()) {
      toast.error('Informe o assunto do suporte');
      return;
    }

    setIsCreating(true);
    const deadline = new Date();
    deadline.setMinutes(deadline.getMinutes() + (priority === 'high' ? 10 : priority === 'medium' ? 60 : 120));

    const { error } = await supabase.from('support_tickets').insert({
      subject: subject.trim(),
      description: description.trim() || null,
      priority,
      customer_name: customerName?.trim() || null,
      customer_phone: phone?.replace(/\D/g, '') || null,
      shopify_order_name: orderName?.trim() || null,
      deadline_at: deadline.toISOString(),
      source: 'whatsapp_chat',
    });

    setIsCreating(false);

    if (error) {
      toast.error('Erro ao criar ticket de suporte');
      console.error(error);
      return;
    }

    toast.success('Ticket de suporte criado! Visível na aba Expedição → Suporte.');
    setSubject('');
    setDescription('');
    setPriority('medium');
    setOpen(false);
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="gap-1 text-xs">
            <HeadphonesIcon className="h-3.5 w-3.5" />
            Criar Suporte
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeadphonesIcon className="h-5 w-5" />
            Criar Ticket de Suporte
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {customerName && (
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-2">
              Cliente: <strong>{customerName}</strong>
              {phone && <span className="ml-2">· {phone}</span>}
              {orderName && <span className="ml-2">· Pedido {orderName}</span>}
            </div>
          )}
          <div>
            <Label>Assunto *</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Descreva o problema do cliente"
              autoFocus
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes adicionais..."
              rows={3}
            />
          </div>
          <div>
            <Label>Prioridade</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">🟢 Baixa (2h)</SelectItem>
                <SelectItem value="medium">🟡 Média (1h)</SelectItem>
                <SelectItem value="high">🔴 Urgente (10min)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleCreate} disabled={isCreating} className="w-full gap-2">
            <HeadphonesIcon className="h-4 w-4" />
            {isCreating ? 'Criando...' : 'Criar Ticket'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

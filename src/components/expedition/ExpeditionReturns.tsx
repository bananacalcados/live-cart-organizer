import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { RotateCcw, Plus, Package, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

interface Props {
  onRefresh: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  in_transit: 'Em Trânsito',
  received: 'Recebida',
  inspected: 'Inspecionada',
  completed: 'Concluída',
  rejected: 'Rejeitada',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  in_transit: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  received: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  inspected: 'bg-primary/10 text-primary',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export function ExpeditionReturns({ onRefresh }: Props) {
  const [returns, setReturns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);

  // New return form
  const [newReturn, setNewReturn] = useState({
    shopify_order_name: '',
    customer_name: '',
    customer_email: '',
    return_type: 'return',
    reason: '',
  });

  const fetchReturns = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('expedition_returns')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReturns(data || []);
    } catch (error) {
      console.error('Error fetching returns:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchReturns(); }, []);

  const handleCreateReturn = async () => {
    try {
      await supabase.from('expedition_returns').insert(newReturn);
      toast.success('Devolução/troca registrada!');
      setShowNewDialog(false);
      setNewReturn({ shopify_order_name: '', customer_name: '', customer_email: '', return_type: 'return', reason: '' });
      fetchReturns();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      const updates: any = { status };
      if (status === 'received') updates.received_at = new Date().toISOString();
      if (status === 'inspected') updates.inspected_at = new Date().toISOString();

      await supabase.from('expedition_returns').update(updates).eq('id', id);
      toast.success('Status atualizado!');
      fetchReturns();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const stats = {
    total: returns.length,
    pending: returns.filter(r => r.status === 'pending').length,
    inTransit: returns.filter(r => r.status === 'in_transit').length,
    completed: returns.filter(r => r.status === 'completed').length,
    exchanges: returns.filter(r => r.return_type === 'exchange').length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Devoluções e Trocas</h2>
          <p className="text-sm text-muted-foreground">
            {stats.total} total • {stats.pending} pendentes • {stats.inTransit} em trânsito • {stats.exchanges} trocas
          </p>
        </div>
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Nova Devolução
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar Devolução/Troca</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Nº do Pedido (ex: #1234)"
                value={newReturn.shopify_order_name}
                onChange={(e) => setNewReturn(prev => ({ ...prev, shopify_order_name: e.target.value }))}
              />
              <Input
                placeholder="Nome do Cliente"
                value={newReturn.customer_name}
                onChange={(e) => setNewReturn(prev => ({ ...prev, customer_name: e.target.value }))}
              />
              <Input
                placeholder="Email"
                value={newReturn.customer_email}
                onChange={(e) => setNewReturn(prev => ({ ...prev, customer_email: e.target.value }))}
              />
              <Select value={newReturn.return_type} onValueChange={(v) => setNewReturn(prev => ({ ...prev, return_type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="return">Devolução</SelectItem>
                  <SelectItem value="exchange">Troca</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Motivo da devolução/troca"
                value={newReturn.reason}
                onChange={(e) => setNewReturn(prev => ({ ...prev, reason: e.target.value }))}
              />
              <Button onClick={handleCreateReturn} className="w-full">Registrar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {returns.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhuma devolução registrada.</CardContent></Card>
      ) : (
        returns.map(ret => (
          <Card key={ret.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RotateCcw className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{ret.shopify_order_name || 'Sem pedido'}</span>
                      <Badge className={STATUS_COLORS[ret.status] || 'bg-muted'}>
                        {STATUS_LABELS[ret.status] || ret.status}
                      </Badge>
                      <Badge variant="outline">
                        {ret.return_type === 'exchange' ? 'Troca' : 'Devolução'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{ret.customer_name} • {ret.customer_email}</p>
                    {ret.reason && <p className="text-xs text-muted-foreground mt-1">{ret.reason}</p>}
                  </div>
                </div>
                <Select value={ret.status} onValueChange={(v) => handleUpdateStatus(ret.id, v)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

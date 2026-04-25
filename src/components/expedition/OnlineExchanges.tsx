import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeftRight, Plus, Loader2, Search, BarChart3 } from 'lucide-react';

const REASON_LABELS: Record<string, string> = {
  tamanho: 'Tamanho',
  defeito: 'Defeito',
  arrependimento: 'Arrependimento',
  outros: 'Outros',
};

const REASON_COLORS: Record<string, string> = {
  tamanho: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  defeito: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  arrependimento: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  outros: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

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

export function OnlineExchanges() {
  const [exchanges, setExchanges] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [showNewDialog, setShowNewDialog] = useState(false);

  const fetchExchanges = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('online_exchanges')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setExchanges(data || []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchExchanges();
    const channel = supabase
      .channel('online_exchanges_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'online_exchanges' }, fetchExchanges)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = exchanges.filter(e => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (reasonFilter !== 'all' && e.reason_category !== reasonFilter) return false;
    if (search) {
      const term = search.toLowerCase();
      return (
        e.shopify_order_name?.toLowerCase().includes(term) ||
        e.customer_name?.toLowerCase().includes(term) ||
        e.product_name?.toLowerCase().includes(term)
      );
    }
    return true;
  });

  // Stats por motivo
  const reasonStats = exchanges.reduce((acc: Record<string, number>, e) => {
    acc[e.reason_category] = (acc[e.reason_category] || 0) + 1;
    return acc;
  }, {});
  const totalExchanges = exchanges.length;

  const handleUpdateStatus = async (id: string, status: string) => {
    const updates: any = { status };
    if (status === 'received') updates.received_at = new Date().toISOString();
    if (status === 'inspected') updates.inspected_at = new Date().toISOString();
    if (status === 'completed') updates.completed_at = new Date().toISOString();
    const { error } = await supabase.from('online_exchanges').update(updates).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Status atualizado');
    fetchExchanges();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" /> Trocas Online (Shopify)
          </h2>
          <p className="text-sm text-muted-foreground">
            {totalExchanges} troca{totalExchanges !== 1 ? 's' : ''} registrada{totalExchanges !== 1 ? 's' : ''}
          </p>
        </div>
        <NewExchangeDialog open={showNewDialog} onOpenChange={setShowNewDialog} onCreated={fetchExchanges} />
      </div>

      {/* Análise rápida por motivo */}
      {totalExchanges > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Motivos mais frequentes</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(['defeito', 'tamanho', 'arrependimento', 'outros'] as const).map(r => {
                const count = reasonStats[r] || 0;
                const pct = totalExchanges > 0 ? Math.round((count / totalExchanges) * 100) : 0;
                return (
                  <div key={r} className="rounded-lg border p-2">
                    <div className="flex items-center justify-between">
                      <Badge className={`text-[10px] ${REASON_COLORS[r]}`}>{REASON_LABELS[r]}</Badge>
                      <span className="text-xs text-muted-foreground">{pct}%</span>
                    </div>
                    <p className="text-xl font-bold mt-1">{count}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar pedido, cliente, produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos motivos</SelectItem>
            {Object.entries(REASON_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nenhuma troca encontrada.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(ex => (
            <Card key={ex.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{ex.shopify_order_name}</span>
                      <Badge className={`text-[10px] ${REASON_COLORS[ex.reason_category]}`}>
                        {REASON_LABELS[ex.reason_category]}
                      </Badge>
                      <Badge className={`text-[10px] ${STATUS_COLORS[ex.status]}`}>
                        {STATUS_LABELS[ex.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {ex.customer_name} {ex.product_name && `• ${ex.product_name}`}
                      {ex.product_variant && ` (${ex.product_variant})`}
                      {ex.quantity > 1 && ` ×${ex.quantity}`}
                    </p>
                    {ex.reason_detail && (
                      <p className="text-xs text-foreground/80 mt-1 italic">"{ex.reason_detail}"</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Criada em {new Date(ex.created_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <Select value={ex.status} onValueChange={(v) => handleUpdateStatus(ex.id, v)}>
                    <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NewExchangeDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    shopify_order_name: '',
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    product_name: '',
    product_sku: '',
    product_variant: '',
    quantity: 1,
    reason_category: 'tamanho' as 'tamanho' | 'defeito' | 'arrependimento' | 'outros',
    reason_detail: '',
  });

  const handleSubmit = async () => {
    if (!form.shopify_order_name || !form.customer_name) {
      return toast.error('Nº do pedido e nome do cliente são obrigatórios');
    }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('online_exchanges').insert({
      ...form,
      created_by: user?.id,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Troca registrada!');
    onOpenChange(false);
    setForm({
      shopify_order_name: '', customer_name: '', customer_email: '', customer_phone: '',
      product_name: '', product_sku: '', product_variant: '', quantity: 1,
      reason_category: 'tamanho', reason_detail: '',
    });
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Nova Troca</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar Troca Online</DialogTitle>
          <DialogDescription>Para pedidos da Shopify. Categorize o motivo para análise futura.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Nº do pedido (#1234)" value={form.shopify_order_name}
              onChange={(e) => setForm(f => ({ ...f, shopify_order_name: e.target.value }))} />
            <Input placeholder="Nome do cliente *" value={form.customer_name}
              onChange={(e) => setForm(f => ({ ...f, customer_name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Email" value={form.customer_email}
              onChange={(e) => setForm(f => ({ ...f, customer_email: e.target.value }))} />
            <Input placeholder="WhatsApp" value={form.customer_phone}
              onChange={(e) => setForm(f => ({ ...f, customer_phone: e.target.value }))} />
          </div>
          <Input placeholder="Produto" value={form.product_name}
            onChange={(e) => setForm(f => ({ ...f, product_name: e.target.value }))} />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="SKU" value={form.product_sku}
              onChange={(e) => setForm(f => ({ ...f, product_sku: e.target.value }))} />
            <Input placeholder="Variação (cor/tam)" value={form.product_variant}
              onChange={(e) => setForm(f => ({ ...f, product_variant: e.target.value }))} />
            <Input type="number" min={1} placeholder="Qtd" value={form.quantity}
              onChange={(e) => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} />
          </div>
          <Select value={form.reason_category} onValueChange={(v: any) => setForm(f => ({ ...f, reason_category: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tamanho">📏 Tamanho</SelectItem>
              <SelectItem value="defeito">⚠️ Defeito</SelectItem>
              <SelectItem value="arrependimento">↩️ Arrependimento</SelectItem>
              <SelectItem value="outros">📦 Outros</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Detalhes do motivo (opcional)"
            value={form.reason_detail}
            onChange={(e) => setForm(f => ({ ...f, reason_detail: e.target.value }))}
            rows={3} />
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Registrar Troca
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

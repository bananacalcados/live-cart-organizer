import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldAlert, Search, Loader2, MapPin, Phone, Mail, FileText } from 'lucide-react';
import { MarkChargebackDialog } from './MarkChargebackDialog';

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  investigating: 'Investigando',
  contacted: 'Cliente contatado',
  resolved: 'Resolvido',
  confirmed_fraud: 'Fraude confirmada',
  dismissed: 'Descartado',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  investigating: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  contacted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  confirmed_fraud: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-300',
  dismissed: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

export function ChargebacksDashboard() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('chargebacks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
    const channel = supabase
      .channel('chargebacks_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chargebacks' }, fetchItems)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = items.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (search) {
      const t = search.toLowerCase();
      return (
        c.customer_name?.toLowerCase().includes(t) ||
        c.source_order_name?.toLowerCase().includes(t) ||
        c.customer_cpf?.includes(search) ||
        c.customer_phone?.includes(search) ||
        c.customer_email?.toLowerCase().includes(t) ||
        c.address_cep?.includes(search)
      );
    }
    return true;
  });

  const stats = {
    total: items.length,
    open: items.filter(c => c.status === 'open').length,
    investigating: items.filter(c => c.status === 'investigating').length,
    fraud: items.filter(c => c.status === 'confirmed_fraud').length,
    totalValue: items.reduce((s, c) => s + Number(c.amount || 0), 0),
  };

  const handleStatusChange = async (id: string, status: string) => {
    const { error } = await supabase.from('chargebacks').update({ status }).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Status atualizado');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Chargebacks
          </h2>
          <p className="text-sm text-muted-foreground">
            {stats.total} registrado{stats.total !== 1 ? 's' : ''} • {stats.open} aberto{stats.open !== 1 ? 's' : ''} • {stats.fraud} fraude{stats.fraud !== 1 ? 's' : ''}
          </p>
        </div>
        <MarkChargebackDialog onCreated={fetchItems} />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatBox label="Total" value={stats.total} />
        <StatBox label="Em aberto" value={stats.open} highlight />
        <StatBox label="Investigando" value={stats.investigating} />
        <StatBox label="Valor total" value={`R$ ${stats.totalValue.toFixed(2)}`} />
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar nome, pedido, CPF, CEP..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nenhum chargeback encontrado.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <Card key={c.id} className="border-l-4 border-l-destructive">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{c.customer_name}</span>
                      {c.source_order_name && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <FileText className="h-3 w-3" /> {c.source_order_name}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">{c.source}</Badge>
                      <Badge className={`text-[10px] ${STATUS_COLORS[c.status]}`}>
                        {STATUS_LABELS[c.status]}
                      </Badge>
                      {c.amount > 0 && (
                        <span className="text-sm font-bold text-destructive">R$ {Number(c.amount).toFixed(2)}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {c.customer_cpf && <span>CPF: {c.customer_cpf}</span>}
                      {c.customer_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.customer_phone}</span>}
                      {c.customer_email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.customer_email}</span>}
                    </div>
                    {(c.address_street || c.address_cep) && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                        <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>
                          {c.address_street}{c.address_number ? `, ${c.address_number}` : ''}
                          {c.address_complement ? ` - ${c.address_complement}` : ''}
                          {c.address_neighborhood ? `, ${c.address_neighborhood}` : ''}
                          {c.address_city ? ` - ${c.address_city}/${c.address_state}` : ''}
                          {c.address_cep ? ` (CEP ${c.address_cep})` : ''}
                        </span>
                      </p>
                    )}
                    {c.reason && <p className="text-xs italic mt-1">"{c.reason}"</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {c.chargeback_date && `Data: ${new Date(c.chargeback_date).toLocaleDateString('pt-BR')} • `}
                      Registrado em {new Date(c.created_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <Select value={c.status} onValueChange={(v) => handleStatusChange(c.id, v)}>
                    <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
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

function StatBox({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'border-destructive/50' : ''}>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${highlight ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

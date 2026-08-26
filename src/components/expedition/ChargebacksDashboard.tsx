import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ShieldAlert, Search, Loader2, MapPin, Phone, Mail, FileText, Ban, ShieldCheck,
  Trash2, History, ChevronDown, ChevronRight,
} from 'lucide-react';
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

const ACTION_LABELS: Record<string, string> = {
  created: 'Registrado',
  status_changed: 'Status alterado',
  blocked: 'Cliente bloqueado',
  unblocked: 'Bloqueio removido',
  deleted: 'Marcação removida',
};

interface CustomerGroup {
  key: string;
  name: string;
  phone: string | null;
  cpf: string | null;
  email: string | null;
  items: any[];
  blocked: boolean;
  total: number;
}

export function ChargebacksDashboard() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [blockFilter, setBlockFilter] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [historyOf, setHistoryOf] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchItems = async () => {
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

  const groups = useMemo<CustomerGroup[]>(() => {
    const filtered = items.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (blockFilter === 'blocked' && !c.blocked) return false;
      if (blockFilter === 'not_blocked' && c.blocked) return false;
      if (search) {
        const t = search.toLowerCase();
        const digits = search.replace(/\D/g, '');
        return (
          c.customer_name?.toLowerCase().includes(t) ||
          c.source_order_name?.toLowerCase().includes(t) ||
          (digits && (c.cpf_digits?.includes(digits) || c.phone_key?.includes(digits))) ||
          c.customer_cpf?.includes(search) ||
          c.customer_phone?.includes(search) ||
          c.customer_email?.toLowerCase().includes(t) ||
          c.address_cep?.includes(search)
        );
      }
      return true;
    });

    const map = new Map<string, CustomerGroup>();
    for (const c of filtered) {
      const key =
        c.customer_unified_id ||
        (c.cpf_digits ? `cpf:${c.cpf_digits}` : null) ||
        (c.phone_key ? `phone:${c.phone_key}` : null) ||
        `cb:${c.id}`;
      const g = map.get(key);
      if (g) {
        g.items.push(c);
        g.blocked = g.blocked || !!c.blocked;
        g.total += Number(c.amount || 0);
        g.phone = g.phone || c.customer_phone;
        g.cpf = g.cpf || c.customer_cpf;
        g.email = g.email || c.customer_email;
      } else {
        map.set(key, {
          key,
          name: c.customer_name || 'Sem nome',
          phone: c.customer_phone,
          cpf: c.customer_cpf,
          email: c.customer_email,
          items: [c],
          blocked: !!c.blocked,
          total: Number(c.amount || 0),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
      return b.items.length - a.items.length;
    });
  }, [items, search, statusFilter, blockFilter]);

  const stats = {
    customers: new Set(
      items.map((c) => c.customer_unified_id || c.cpf_digits || c.phone_key || c.id),
    ).size,
    total: items.length,
    blocked: items.filter((c) => c.blocked).length,
    totalValue: items.reduce((s, c) => s + Number(c.amount || 0), 0),
  };

  const handleStatusChange = async (id: string, status: string) => {
    setBusyId(id);
    const { error } = await supabase.from('chargebacks').update({ status }).eq('id', id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success('Status atualizado');
    fetchItems();
  };

  const toggleBlocked = async (c: any) => {
    setBusyId(c.id);
    const { error } = await supabase.from('chargebacks').update({ blocked: !c.blocked }).eq('id', c.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(!c.blocked ? 'Cliente bloqueado para novas compras' : 'Bloqueio removido');
    fetchItems();
  };

  const blockGroup = async (g: CustomerGroup, blocked: boolean) => {
    const ids = g.items.filter((c) => !!c.blocked !== blocked).map((c) => c.id);
    if (!ids.length) return;
    const { error } = await supabase.from('chargebacks').update({ blocked }).in('id', ids);
    if (error) return toast.error(error.message);
    toast.success(blocked ? 'Cliente bloqueado' : 'Bloqueio removido');
    fetchItems();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('chargebacks').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    if (error) return toast.error(error.message);
    toast.success('Marcação removida (registrada no histórico)');
    fetchItems();
  };

  const openHistory = async (c: any) => {
    setHistoryOf(c);
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from('chargeback_events')
      .select('*')
      .eq('chargeback_id', c.id)
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setHistory(data || []);
    setHistoryLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Chargebacks
          </h2>
          <p className="text-sm text-muted-foreground">
            {stats.customers} cliente{stats.customers !== 1 ? 's' : ''} • {stats.total} registro{stats.total !== 1 ? 's' : ''} • {stats.blocked} bloqueado{stats.blocked !== 1 ? 's' : ''}
          </p>
        </div>
        <MarkChargebackDialog onCreated={fetchItems} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatBox label="Clientes" value={stats.customers} />
        <StatBox label="Registros" value={stats.total} />
        <StatBox label="Bloqueados" value={stats.blocked} highlight />
        <StatBox label="Valor total" value={`R$ ${stats.totalValue.toFixed(2)}`} />
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar nome, pedido, CPF, telefone, CEP..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={blockFilter} onValueChange={setBlockFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Bloqueio: todos</SelectItem>
            <SelectItem value="blocked">Somente bloqueados</SelectItem>
            <SelectItem value="not_blocked">Somente não bloqueados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : groups.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nenhum chargeback encontrado.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expanded[g.key] ?? g.items.length === 1;
            return (
              <Card key={g.key} className={`border-l-4 ${g.blocked ? 'border-l-destructive' : 'border-l-amber-500'}`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <button
                      className="flex items-start gap-2 text-left min-w-0 flex-1"
                      onClick={() => setExpanded((p) => ({ ...p, [g.key]: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 mt-1 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{g.name}</span>
                          {g.blocked ? (
                            <Badge className="text-[10px] bg-destructive text-destructive-foreground gap-1">
                              <Ban className="h-3 w-3" /> BLOQUEADO
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Somente alerta</Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {g.items.length} chargeback{g.items.length !== 1 ? 's' : ''}
                          </Badge>
                          {g.total > 0 && (
                            <span className="text-sm font-bold text-destructive">R$ {g.total.toFixed(2)}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                          {g.cpf && <span>CPF: {g.cpf}</span>}
                          {g.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{g.phone}</span>}
                          {g.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{g.email}</span>}
                        </div>
                      </div>
                    </button>
                    <Button
                      size="sm"
                      variant={g.blocked ? 'outline' : 'destructive'}
                      className="h-8 text-xs gap-1"
                      onClick={() => blockGroup(g, !g.blocked)}
                    >
                      {g.blocked ? <><ShieldCheck className="h-3.5 w-3.5" /> Desbloquear</> : <><Ban className="h-3.5 w-3.5" /> Bloquear compras</>}
                    </Button>
                  </div>

                  {isOpen && (
                    <div className="space-y-2 pl-6">
                      {g.items.map((c) => (
                        <div key={c.id} className="rounded-md border border-border p-2">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {c.source_order_name && (
                                  <Badge variant="outline" className="text-[10px] gap-1">
                                    <FileText className="h-3 w-3" /> {c.source_order_name}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-[10px]">{c.source}</Badge>
                                <Badge className={`text-[10px] ${STATUS_COLORS[c.status]}`}>
                                  {STATUS_LABELS[c.status] || c.status}
                                </Badge>
                                {c.blocked && (
                                  <Badge className="text-[10px] bg-destructive text-destructive-foreground">bloqueia venda</Badge>
                                )}
                                {c.amount > 0 && (
                                  <span className="text-xs font-bold text-destructive">R$ {Number(c.amount).toFixed(2)}</span>
                                )}
                                {(c.pos_sale_id || c.order_id) && (
                                  <Badge variant="secondary" className="text-[10px]">venda vinculada</Badge>
                                )}
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
                            <div className="flex items-center gap-1 flex-wrap">
                              <Select value={c.status} onValueChange={(v) => handleStatusChange(c.id, v)}>
                                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                                    <SelectItem key={k} value={k}>{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button size="icon" variant="ghost" className="h-8 w-8"
                                title={c.blocked ? 'Desbloquear este registro' : 'Bloquear por este registro'}
                                disabled={busyId === c.id}
                                onClick={() => toggleBlocked(c)}>
                                {c.blocked ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4 text-destructive" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Histórico"
                                onClick={() => openHistory(c)}>
                                <History className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Remover marcação"
                                onClick={() => setDeleteTarget(c)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover marcação de chargeback?</AlertDialogTitle>
            <AlertDialogDescription>
              O registro de {deleteTarget?.customer_name} será removido e o cliente deixa de ser
              alertado/bloqueado por ele. A remoção fica registrada no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!historyOf} onOpenChange={(o) => !o && setHistoryOf(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Histórico — {historyOf?.customer_name}</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhum evento registrado ainda.</p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {history.map((h) => (
                <div key={h.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{ACTION_LABELS[h.action] || h.action}</span>
                    <span className="text-muted-foreground">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                  </div>
                  {(h.from_value || h.to_value) && (
                    <p className="text-muted-foreground mt-0.5">
                      {h.from_value ? `${STATUS_LABELS[h.from_value] || h.from_value} → ` : ''}
                      {STATUS_LABELS[h.to_value] || h.to_value || '—'}
                    </p>
                  )}
                  {h.note && <p className="italic mt-0.5">"{h.note}"</p>}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
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

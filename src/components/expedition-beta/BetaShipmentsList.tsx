import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Loader2, Truck, Search, CalendarIcon, ChevronLeft, ChevronRight,
  MapPin, Copy, PackageCheck, Send,
} from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth } from 'date-fns';
import { pt } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DeliveryCostDialog } from '@/components/pos/DeliveryCostDialog';

const PAGE_SIZE = 25;

interface ShipmentRow {
  id: string;
  shopify_order_name: string | null;
  shopify_order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  shipping_address: any;
  tracking_code: string | null;
  shipping_method: string | null;
  expedition_status: string;
  total_price: number | null;
  shopify_created_at: string | null;
  updated_at: string | null;
}

const fmtMoney = (v?: number | null) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  dispatched: { label: 'Enviado', cls: 'bg-primary/15 text-primary border-primary/30' },
  delivered: { label: 'Entregue', cls: 'bg-green-500/15 text-green-600 border-green-500/30' },
};

function formatAddress(addr: any): string {
  if (!addr || typeof addr !== 'object') return '—';
  const parts = [
    addr.address1 || addr.address || addr.street,
    addr.number || addr.address_number,
    addr.neighborhood,
    addr.city,
    addr.province_code || addr.state,
    addr.zip || addr.cep,
  ].filter(Boolean);
  return parts.join(', ') || '—';
}

export function BetaShipmentsList() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [deliveryCostFor, setDeliveryCostFor] = useState<ShipmentRow | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);

  const getDateRange = useCallback((): { from?: Date; to?: Date } => {
    const now = new Date();
    switch (period) {
      case 'day': return { from: startOfDay(now) };
      case 'week': return { from: startOfWeek(now, { weekStartsOn: 1 }) };
      case 'month': return { from: startOfMonth(now) };
      case 'custom': return { from: customFrom, to: customTo };
      default: return {};
    }
  }, [period, customFrom, customTo]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('expedition_beta_orders')
        .select(
          'id, shopify_order_name, shopify_order_number, customer_name, customer_phone, shipping_address, tracking_code, shipping_method, expedition_status, total_price, shopify_created_at, updated_at',
          { count: 'exact' },
        );

      if (statusFilter === 'all') {
        q = q.in('expedition_status', ['dispatched', 'delivered']);
      } else {
        q = q.eq('expedition_status', statusFilter);
      }

      const { from, to } = getDateRange();
      if (from) q = q.gte('shopify_created_at', from.toISOString());
      if (to) {
        const end = new Date(to);
        end.setDate(end.getDate() + 1);
        q = q.lt('shopify_created_at', end.toISOString());
      }

      const term = search.trim();
      if (term.length >= 2) {
        q = q.or(
          `customer_name.ilike.%${term}%,tracking_code.ilike.%${term}%,shopify_order_name.ilike.%${term}%,shopify_order_number.ilike.%${term}%`,
        );
      }

      q = q
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      setRows((data as ShipmentRow[]) || []);
      setTotal(count || 0);
    } catch (e: any) {
      toast.error('Erro ao carregar envios: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, getDateRange, search, page]);

  useEffect(() => { fetchPage(); }, [fetchPage]);
  useEffect(() => { setPage(0); }, [search, period, statusFilter, customFrom, customTo]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const copyTracking = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Rastreio copiado!');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); }}
          className="relative flex-1"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, rastreio ou pedido..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => setSearch(searchInput)}
            className="pl-10"
          />
        </form>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Enviados + Entregues</SelectItem>
            <SelectItem value="dispatched">Somente enviados</SelectItem>
            <SelectItem value="delivered">Somente entregues</SelectItem>
          </SelectContent>
        </Select>

        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-full md:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo período</SelectItem>
            <SelectItem value="day">Hoje</SelectItem>
            <SelectItem value="week">Esta semana</SelectItem>
            <SelectItem value="month">Este mês</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>

        {period === 'custom' && (
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4" />
                  {customFrom ? format(customFrom, 'dd/MM/yy') : 'De'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} locale={pt} className={cn('p-3 pointer-events-auto')} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4" />
                  {customTo ? format(customTo, 'dd/MM/yy') : 'Até'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customTo} onSelect={setCustomTo} locale={pt} className={cn('p-3 pointer-events-auto')} />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Truck className="h-10 w-10 mx-auto mb-3 opacity-40" />
          Nenhum envio encontrado para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => {
            const st = STATUS_LABEL[s.expedition_status] || { label: s.expedition_status, cls: 'bg-muted text-muted-foreground' };
            return (
              <div key={s.id} className="rounded-xl border border-border/60 bg-card p-3 md:p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{s.customer_name || 'Cliente'}</span>
                      <Badge variant="outline" className={cn('text-[10px]', st.cls)}>
                        {s.expedition_status === 'delivered'
                          ? <PackageCheck className="h-3 w-3 mr-1" />
                          : <Send className="h-3 w-3 mr-1" />}
                        {st.label}
                      </Badge>
                      {s.shopify_order_name && (
                        <span className="text-xs text-muted-foreground">{s.shopify_order_name}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3 shrink-0" /> {formatAddress(s.shipping_address)}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
                      {s.shipping_method && <span className="text-muted-foreground">📦 {s.shipping_method}</span>}
                      {s.tracking_code ? (
                        <button
                          onClick={() => copyTracking(s.tracking_code!)}
                          className="flex items-center gap-1 text-primary hover:underline"
                        >
                          {s.tracking_code} <Copy className="h-3 w-3" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground/60">Sem rastreio</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <p className="font-medium text-sm">{fmtMoney(s.total_price)}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(s.shopify_created_at)}</p>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setDeliveryCostFor(s)}>
                      <Truck className="h-3 w-3" /> Custo entrega
                    </Button>
                  </div>
                </div>
              </div>

            );
          })}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
        <span>
          {total > 0
            ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} de ${total.toLocaleString('pt-BR')} envios`
            : '0 envios'}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Badge variant="secondary">{page + 1} / {totalPages}</Badge>
          <Button size="sm" variant="outline" className="h-8" disabled={page + 1 >= totalPages || loading} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

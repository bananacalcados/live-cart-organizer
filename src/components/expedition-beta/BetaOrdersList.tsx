import { useState, lazy, Suspense } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { CheckCircle2, AlertTriangle, Users, Package, ChevronDown, ChevronUp, Trash2, Unlink, Clock, ArrowRight, Gift, Radio, RotateCcw, Truck, Timer } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

function ShippingBadge({ method }: { method: string }) {
  const upper = method.toUpperCase();
  const isHighPriority = upper.includes('SEDEX') || upper.includes('MOTOTAXISTA');
  const isPac = upper.includes('PAC');
  
  const colorClass = isHighPriority
    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800'
    : isPac
    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800'
    : 'bg-gray-100 text-gray-700 dark:bg-gray-800/30 dark:text-gray-400 border-gray-200 dark:border-gray-700';

  return (
    <Badge variant="outline" className={`text-[10px] gap-1 mt-0.5 ${colorClass}`}>
      <Truck className="h-3 w-3" />
      {method}
    </Badge>
  );
}

const Barcode = lazy(() => import('react-barcode'));

const BarcodeWrapper = ({ value, ...props }: any) => (
  <Suspense fallback={<div className="h-[60px] flex items-center justify-center text-xs text-muted-foreground">Carregando código...</div>}>
    <Barcode value={value} {...props} />
  </Suspense>
);

interface Props {
  orders: any[];
  searchTerm: string;
  showGrouping: boolean;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Em Aberto',
  approved: 'Aprovado',
  grouped: 'Agrupado',
  awaiting_stock: 'Aguardando Estoque',
  preparing: 'Preparando Envio',
  picking: 'Separando',
  picked: 'Separado',
  invoiced: 'Faturado',
  packing: 'Bipando',
  packed: 'Embalado',
  ready_to_ship: 'Pronto p/ Envio',
  dispatched: 'Enviado',
  delivered: 'Entregue',
  not_delivered: 'Não Entregue',
  cancelled: 'Cancelado',
};

type StatusFilter = 'todos' | 'nao_despachados' | 'atrasados' | 'pending' | 'approved' | 'grouped' | 'awaiting_stock' | 'preparing' | 'picking' | 'picked' | 'invoiced' | 'packing' | 'packed' | 'ready_to_ship' | 'dispatched' | 'delivered' | 'not_delivered' | 'cancelled';

const DELAY_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48h

const STATUS_TABS: { key: StatusFilter; label: string; color: string }[] = [
  { key: 'todos', label: 'Todos', color: 'text-foreground' },
  { key: 'nao_despachados', label: 'Não despachados', color: 'text-orange-500' },
  { key: 'atrasados', label: '⚠️ Atrasados', color: 'text-red-500' },
  { key: 'pending', label: 'Em Aberto', color: 'text-gray-500' },
  { key: 'approved', label: 'Aprovado', color: 'text-green-500' },
  { key: 'grouped', label: 'Agrupado', color: 'text-blue-500' },
  { key: 'awaiting_stock', label: 'Aguardando', color: 'text-amber-500' },
  { key: 'preparing', label: 'Prep. Envio', color: 'text-sky-500' },
  { key: 'picking', label: 'Separando', color: 'text-cyan-500' },
  { key: 'picked', label: 'Separado', color: 'text-indigo-500' },
  { key: 'invoiced', label: 'Faturado', color: 'text-teal-500' },
  { key: 'packing', label: 'Bipando', color: 'text-purple-500' },
  { key: 'packed', label: 'Embalado', color: 'text-violet-500' },
  { key: 'ready_to_ship', label: 'Pronto Envio', color: 'text-lime-500' },
  { key: 'dispatched', label: 'Enviado', color: 'text-emerald-500' },
  { key: 'delivered', label: 'Entregue', color: 'text-green-600' },
  { key: 'not_delivered', label: 'Não Entregue', color: 'text-red-600' },
  { key: 'cancelled', label: 'Cancelado', color: 'text-red-500' },
];

export function BetaOrdersList({ orders, searchTerm, showGrouping, onRefresh }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('nao_despachados');

  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (!term) return true;
    return (
      o.shopify_order_name?.toLowerCase().includes(term) ||
      o.customer_name?.toLowerCase().includes(term) ||
      o.customer_email?.toLowerCase().includes(term)
    );
  });

  const approved = filtered.filter(o => o.financial_status === 'paid' || o.financial_status === 'partially_paid');
  const pending = filtered.filter(o => o.financial_status !== 'paid' && o.financial_status !== 'partially_paid');

  // Grouping
  const customerGroups = new Map<string, any[]>();
  if (showGrouping) {
    approved.forEach(order => {
      const key = order.customer_email || order.customer_name || order.id;
      if (!customerGroups.has(key)) customerGroups.set(key, []);
      customerGroups.get(key)!.push(order);
    });
  }
  const multiOrderCustomers = Array.from(customerGroups.entries()).filter(([, o]) => o.length > 1);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAutoGroup = async () => {
    try {
      for (const [email, groupOrders] of multiOrderCustomers) {
        const { data: group } = await supabase
          .from('expedition_groups')
          .insert({
            customer_email: email,
            customer_name: groupOrders[0].customer_name,
            order_count: groupOrders.length,
            total_items: groupOrders.reduce((sum: number, o: any) => sum + (o.expedition_beta_order_items?.length || 0), 0),
          })
          .select().single();

        if (group) {
          const ids = groupOrders.map((o: any) => o.id);
          await supabase.from('expedition_beta_orders').update({ group_id: group.id, expedition_status: 'grouped' }).in('id', ids);
        }
      }
      toast.success(`${multiOrderCustomers.length} grupos criados!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro ao agrupar: ${error.message}`);
    }
  };

  const handleManualGroup = async () => {
    if (selectedIds.size < 2) { toast.error('Selecione pelo menos 2 pedidos.'); return; }
    const selected = approved.filter(o => selectedIds.has(o.id));
    try {
      const { data: group } = await supabase
        .from('expedition_groups')
        .insert({
          customer_email: selected[0].customer_email,
          customer_name: selected[0].customer_name,
          order_count: selected.length,
          total_items: selected.reduce((sum: number, o: any) => sum + (o.expedition_beta_order_items?.length || 0), 0),
        })
        .select().single();

      if (group) {
        await supabase.from('expedition_beta_orders').update({ group_id: group.id, expedition_status: 'grouped' }).in('id', Array.from(selectedIds));
      }
      toast.success(`Grupo criado com ${selected.length} pedidos!`);
      setSelectedIds(new Set());
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleAdvanceStatus = async (orderId: string, currentStatus: string) => {
    const flow: Record<string, string> = {
      approved: 'picking', grouped: 'picking', awaiting_stock: 'picking',
      picking: 'picked', picked: 'packing', packing: 'packed', packed: 'dispatched',
    };
    const next = flow[currentStatus];
    if (!next) { toast.info('Último estágio.'); return; }
    try {
      await supabase.from('expedition_beta_orders').update({ expedition_status: next }).eq('id', orderId);
      toast.success(`Status → ${STATUS_LABELS[next] || next}`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleDelete = async (orderId: string) => {
    try {
      await supabase.from('expedition_beta_orders').delete().eq('id', orderId);
      toast.success('Pedido removido!');
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleToggleAwaiting = async (orderId: string, isAwaiting: boolean) => {
    const newStatus = isAwaiting ? 'approved' : 'awaiting_stock';
    await supabase.from('expedition_beta_orders').update({ expedition_status: newStatus }).eq('id', orderId);
    toast.success(isAwaiting ? 'Pedido retomado!' : 'Marcado como Aguardando Estoque');
    onRefresh();
  };

  const handleResetExpedition = async (orderId: string, orderName: string) => {
    try {
      await supabase.from('expedition_beta_orders').update({
        expedition_status: 'approved', group_id: null, picking_list_id: null,
        internal_barcode: null, ean13_barcode: null, dispatch_verified: false, dispatch_verified_at: null,
      }).eq('id', orderId);
      await supabase.from('expedition_beta_order_items').update({
        pick_verified: false, picked_quantity: 0, pack_verified: false, packed_quantity: 0,
      }).eq('expedition_order_id', orderId);
      toast.success(`Expedição do pedido ${orderName} reiniciada!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  if (showGrouping) {
    return (
      <div className="space-y-6">
        <Card className="border-dashed border-2 border-primary/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" /> Agrupar Manualmente</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{selectedIds.size} selecionados</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => selectedIds.size === approved.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(approved.map(o => o.id)))}>
                  {selectedIds.size === approved.length ? 'Desmarcar' : 'Selecionar todos'}
                </Button>
                {selectedIds.size >= 2 && (
                  <Button onClick={handleManualGroup} size="sm" className="gap-2"><Users className="h-4 w-4" />Agrupar</Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {approved.map(o => (
                <label key={o.id} className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${selectedIds.has(o.id) ? 'bg-primary/10' : 'hover:bg-secondary/50'}`}>
                  <Checkbox checked={selectedIds.has(o.id)} onCheckedChange={() => toggleSelect(o.id)} />
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <div>
                      <span className="font-medium text-sm">{o.shopify_order_name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{o.customer_name}</span>
                    </div>
                    <span className="text-sm font-medium shrink-0">R$ {Number(o.total_price || 0).toFixed(2)}</span>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Agrupamento Automático</h2>
            <p className="text-sm text-muted-foreground">{multiOrderCustomers.length} clientes com múltiplos pedidos</p>
          </div>
          {multiOrderCustomers.length > 0 && (
            <Button onClick={handleAutoGroup} className="gap-2"><Users className="h-4 w-4" />Agrupar Automaticamente</Button>
          )}
        </div>

        {multiOrderCustomers.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum cliente com múltiplos pedidos.</CardContent></Card>
        ) : (
          multiOrderCustomers.map(([email, groupOrders]) => (
            <Card key={email} className="border-l-4 border-l-primary">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{groupOrders[0].customer_name || email}</CardTitle>
                  <Badge variant="secondary">{groupOrders.length} pedidos</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {groupOrders.map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between p-2 rounded bg-secondary/50 mb-1">
                    <span className="font-medium text-sm">{o.shopify_order_name}</span>
                    <span className="text-sm font-medium">R$ {Number(o.total_price || 0).toFixed(2)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    );
  }

  // Delayed orders detection
  const now = Date.now();
  const delayedOrders = filtered.filter(o => {
    if (['dispatched', 'delivered', 'cancelled'].includes(o.expedition_status)) return false;
    const created = new Date(o.shopify_created_at).getTime();
    return (now - created) > DELAY_THRESHOLD_MS;
  });

  const oldestDelayDays = delayedOrders.length > 0
    ? Math.max(...delayedOrders.map(o => Math.floor((now - new Date(o.shopify_created_at).getTime()) / (1000 * 60 * 60 * 24))))
    : 0;

  // Apply status filter
  const statusFiltered = filtered.filter(o => {
    if (statusFilter === 'todos') return true;
    if (statusFilter === 'nao_despachados') return !['dispatched', 'delivered', 'cancelled'].includes(o.expedition_status);
    if (statusFilter === 'atrasados') {
      if (['dispatched', 'delivered', 'cancelled'].includes(o.expedition_status)) return false;
      return (now - new Date(o.shopify_created_at).getTime()) > DELAY_THRESHOLD_MS;
    }
    return o.expedition_status === statusFilter;
  });

  // Count per status
  const statusCounts: Record<string, number> = { todos: filtered.length, nao_despachados: 0, atrasados: delayedOrders.length };
  filtered.forEach(o => {
    const s = o.expedition_status || 'approved';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    if (!['dispatched', 'delivered', 'cancelled'].includes(s)) statusCounts['nao_despachados']++;
  });

  return (
    <div className="space-y-4">
      {/* Delayed orders alert */}
      {delayedOrders.length > 0 && statusFilter !== 'atrasados' && (
        <Alert variant="destructive" className="cursor-pointer" onClick={() => setStatusFilter('atrasados')}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="flex items-center gap-2">
            {delayedOrders.length} pedido{delayedOrders.length > 1 ? 's' : ''} atrasado{delayedOrders.length > 1 ? 's' : ''}
          </AlertTitle>
          <AlertDescription>
            Há pedidos não despachados há mais de 48h. O mais antigo está há {oldestDelayDays} dia{oldestDelayDays > 1 ? 's' : ''}. Clique para ver.
          </AlertDescription>
        </Alert>
      )}

      {/* Status filter tabs like Tiny */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {STATUS_TABS.map(tab => {
          const count = statusCounts[tab.key] || 0;
          const isActive = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`flex flex-col items-center px-3 py-1.5 rounded-md text-xs transition-all ${
                isActive
                  ? 'bg-primary/10 border border-primary/30 font-semibold'
                  : 'hover:bg-secondary/50'
              }`}
            >
              <span className={`flex items-center gap-1 ${isActive ? tab.color : 'text-muted-foreground'}`}>
                <span className={`w-2 h-2 rounded-full ${isActive ? 'opacity-100' : 'opacity-40'}`} style={{ backgroundColor: 'currentColor' }} />
                {tab.label}
              </span>
              <span className={`text-sm font-bold ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Orders list */}
      <div className="space-y-2">
        {statusFiltered.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido neste filtro.</CardContent></Card>
        ) : statusFiltered.map(order => (
          <BetaOrderRow
            key={order.id}
            order={order}
            isExpanded={expandedId === order.id}
            onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
            onAdvance={handleAdvanceStatus}
            onDelete={handleDelete}
            onToggleAwaiting={handleToggleAwaiting}
            onReset={handleResetExpedition}
          />
        ))}
      </div>
    </div>
  );
}

function BetaOrderRow({ order, isExpanded, onToggle, onAdvance, onDelete, onToggleAwaiting, onReset }: {
  order: any;
  isExpanded: boolean;
  onToggle: () => void;
  onAdvance: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onToggleAwaiting: (id: string, isAwaiting: boolean) => void;
  onReset: (id: string, name: string) => void;
}) {
  const isAwaiting = order.expedition_status === 'awaiting_stock';
  const items = order.expedition_beta_order_items || [];
  const statusLabel = STATUS_LABELS[order.expedition_status] || order.expedition_status;

  const statusColor = {
    pending: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    grouped: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    awaiting_stock: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    preparing: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
    picking: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
    picked: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
    invoiced: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
    packing: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    packed: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
    ready_to_ship: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400',
    dispatched: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    delivered: 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-300',
    not_delivered: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  }[order.expedition_status] || '';

  return (
    <Card className={isAwaiting ? 'opacity-60' : ''}>
      <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-secondary/30 transition-colors" onClick={onToggle}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">{order.shopify_order_name}</span>
              {order.tiny_order_number && (
                <span className="text-xs text-muted-foreground font-mono">T:{order.tiny_order_number}</span>
              )}
              <Badge className={`text-[10px] ${statusColor}`}>{statusLabel}</Badge>
              {(order.tracking_code || order.freight_tracking_code) && (
                <a
                  href={`https://www.linkcorreios.com.br/?id=${order.tracking_code || order.freight_tracking_code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex"
                >
                  <Badge variant="outline" className="text-[10px] gap-1 font-mono cursor-pointer hover:bg-primary/10 transition-colors">
                    🚚 {order.tracking_code || order.freight_tracking_code}
                  </Badge>
                </a>
              )}
              {order.has_gift && <Gift className="h-3.5 w-3.5 text-pink-500" />}
              {order.is_from_live && <Radio className="h-3.5 w-3.5 text-red-500" />}
              {order.ean13_barcode && <Badge variant="outline" className="text-[10px] gap-1">EAN-13 ✓</Badge>}
            </div>
             <p className="text-xs text-muted-foreground mt-0.5">
               {order.customer_name}
               {order.shopify_created_at && (
                 <span className="ml-1">• {new Date(order.shopify_created_at).toLocaleDateString('pt-BR')}</span>
               )}
               {' '}• {items.length} itens • R$ {Number(order.total_price || 0).toFixed(2)}
             </p>
             {order.shipping_method && order.shipping_method !== 'N/A' && (
               <ShippingBadge method={order.shipping_method} />
             )}
          </div>
        </div>
        {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </div>

      {isExpanded && (
        <CardContent className="pt-0 border-t">
          {/* Items */}
          <div className="space-y-1 mb-3">
            {items.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between text-sm p-1.5 rounded bg-secondary/30">
                <div className="min-w-0">
                  <span className="font-medium">{item.product_name}</span>
                  {item.variant_name && <span className="text-muted-foreground ml-1">({item.variant_name})</span>}
                  {item.sku && <span className="text-muted-foreground ml-1 text-xs font-mono">[{item.sku}]</span>}
                </div>
                <span className="font-medium shrink-0 ml-2">×{item.quantity}</span>
              </div>
            ))}
          </div>

          {/* EAN-13 Barcode display */}
          {order.ean13_barcode && (
            <div className="mb-3 p-3 rounded-lg bg-white border flex flex-col items-center">
              <BarcodeWrapper value={order.ean13_barcode} format="EAN13" width={2} height={60} fontSize={14} />
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAdvance(order.id, order.expedition_status)} className="gap-1">
              <ArrowRight className="h-3 w-3" /> Avançar
            </Button>
            <Button size="sm" variant="outline" onClick={() => onToggleAwaiting(order.id, isAwaiting)} className="gap-1">
              <Clock className="h-3 w-3" /> {isAwaiting ? 'Retomar' : 'Aguardar Estoque'}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1 text-amber-600"><RotateCcw className="h-3 w-3" />Refazer</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Refazer expedição?</AlertDialogTitle>
                  <AlertDialogDescription>Isso resetará todo o progresso do pedido {order.shopify_order_name}.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onReset(order.id, order.shopify_order_name)}>Confirmar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="gap-1"><Trash2 className="h-3 w-3" />Excluir</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir pedido?</AlertDialogTitle>
                  <AlertDialogDescription>Remover {order.shopify_order_name} da expedição beta.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(order.id)}>Confirmar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

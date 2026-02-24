import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { CheckCircle2, AlertTriangle, Users, Package, ChevronDown, ChevronUp, Truck, ClipboardList, ScanBarcode, Receipt, Tag, ShieldCheck, ArrowRight, Gift, Radio, Trash2, CheckCheck, Unlink, Clock, Play } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  showGrouping: boolean;
  onRefresh: () => void;
}

const STATUS_FLOW = [
  { key: 'pending_sync', label: 'Pendente', next: 'approved' },
  { key: 'approved', label: 'Aprovado', next: 'picking' },
  { key: 'grouped', label: 'Agrupado', next: 'picking' },
  { key: 'awaiting_stock', label: 'Aguardando Estoque', next: 'picking' },
  { key: 'picking', label: 'Separando', next: 'picked' },
  { key: 'picked', label: 'Separado', next: 'packing' },
  { key: 'packing', label: 'Bipando', next: 'packed' },
  { key: 'packed', label: 'Embalado', next: 'freight_quoted' },
  { key: 'freight_quoted', label: 'Frete Cotado', next: 'invoice_issued' },
  { key: 'invoice_issued', label: 'NF-e Emitida', next: 'label_generated' },
  { key: 'label_generated', label: 'Etiqueta Gerada', next: 'dispatch_verified' },
  { key: 'dispatch_verified', label: 'Verificado', next: 'dispatched' },
  { key: 'dispatched', label: 'Despachado', next: null },
];

export function ExpeditionOrdersList({ orders, searchTerm, showGrouping, onRefresh }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Grouping logic
  const customerGroups = new Map<string, any[]>();
  if (showGrouping) {
    approved.forEach(order => {
      const key = order.customer_email || order.customer_name || order.id;
      if (!customerGroups.has(key)) customerGroups.set(key, []);
      customerGroups.get(key)!.push(order);
    });
  }

  const multiOrderCustomers = Array.from(customerGroups.entries()).filter(([, orders]) => orders.length > 1);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === approved.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approved.map(o => o.id)));
    }
  };

  const handleUngroup = async (orderId: string, orderName: string) => {
    try {
      await supabase
        .from('expedition_orders')
        .update({ group_id: null, expedition_status: 'approved' })
        .eq('id', orderId);
      toast.success(`Pedido ${orderName} removido do grupo!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro ao desagrupar: ${error.message}`);
    }
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
            total_items: groupOrders.reduce((sum: number, o: any) => 
              sum + (o.expedition_order_items?.length || 0), 0),
          })
          .select()
          .single();

        if (group) {
          const ids = groupOrders.map((o: any) => o.id);
          await supabase
            .from('expedition_orders')
            .update({ group_id: group.id, expedition_status: 'grouped' })
            .in('id', ids);
        }
      }
      toast.success(`${multiOrderCustomers.length} grupos criados!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro ao agrupar: ${error.message}`);
    }
  };

  const handleManualGroup = async () => {
    if (selectedIds.size < 2) {
      toast.error('Selecione pelo menos 2 pedidos para agrupar.');
      return;
    }

    const selected = approved.filter(o => selectedIds.has(o.id));
    const firstOrder = selected[0];

    try {
      const { data: group } = await supabase
        .from('expedition_groups')
        .insert({
          customer_email: firstOrder.customer_email,
          customer_name: firstOrder.customer_name,
          order_count: selected.length,
          total_items: selected.reduce((sum: number, o: any) =>
            sum + (o.expedition_order_items?.length || 0), 0),
        })
        .select()
        .single();

      if (group) {
        await supabase
          .from('expedition_orders')
          .update({ group_id: group.id, expedition_status: 'grouped' })
          .in('id', Array.from(selectedIds));
      }

      toast.success(`Grupo manual criado com ${selected.length} pedidos!`);
      setSelectedIds(new Set());
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro ao agrupar: ${error.message}`);
    }
  };

  const handleAdvanceStatus = async (orderId: string, currentStatus: string) => {
    const step = STATUS_FLOW.find(s => s.key === currentStatus);
    if (!step?.next) {
      toast.info('Este pedido já está no último estágio.');
      return;
    }
    try {
      await supabase
        .from('expedition_orders')
        .update({ expedition_status: step.next })
        .eq('id', orderId);
      toast.success(`Status avançado para: ${STATUS_FLOW.find(s => s.key === step.next)?.label || step.next}`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  if (showGrouping) {
    return (
      <div className="space-y-6">
        {/* Manual grouping section */}
        <Card className="border-dashed border-2 border-primary/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" /> Agrupar Pedidos Manualmente
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Selecione os pedidos que deseja agrupar ({selectedIds.size} selecionados)
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {selectedIds.size === approved.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </Button>
                {selectedIds.size >= 2 && (
                  <Button onClick={handleManualGroup} size="sm" className="gap-2">
                    <Users className="h-4 w-4" />
                    Agrupar {selectedIds.size} pedidos
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {approved.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">Nenhum pedido aprovado.</p>
              ) : (
                approved.map(o => (
                  <label
                    key={o.id}
                    className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                      selectedIds.has(o.id) ? 'bg-primary/10' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <Checkbox
                      checked={selectedIds.has(o.id)}
                      onCheckedChange={() => toggleSelect(o.id)}
                    />
                    <div className="flex-1 flex items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{o.shopify_order_name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{o.customer_name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {o.expedition_order_items?.length || 0} itens
                        </span>
                        {o.shopify_created_at && (
                          <span className="text-xs text-muted-foreground ml-2">
                            📅 {new Date(o.shopify_created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-medium shrink-0 ml-2">
                        R$ {Number(o.total_price || 0).toFixed(2)}
                      </span>
                    </div>
                  </label>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Auto grouping section */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Agrupamento Automático por Cliente</h2>
            <p className="text-sm text-muted-foreground">
              {multiOrderCustomers.length} clientes com múltiplos pedidos
            </p>
          </div>
          {multiOrderCustomers.length > 0 && (
            <Button onClick={handleAutoGroup} className="gap-2">
              <Users className="h-4 w-4" />
              Agrupar Automaticamente
            </Button>
          )}
        </div>

        {multiOrderCustomers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhum cliente com múltiplos pedidos encontrado.
            </CardContent>
          </Card>
        ) : (
          multiOrderCustomers.map(([email, groupOrders]) => (
            <Card key={email} className="border-l-4 border-l-primary">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{groupOrders[0].customer_name || email}</CardTitle>
                  <Badge variant="secondary">{groupOrders.length} pedidos</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{email}</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {groupOrders.map((o: any) => (
                    <div key={o.id} className="flex items-center justify-between p-2 rounded bg-secondary/50">
                      <div>
                        <span className="font-medium text-sm">{o.shopify_order_name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {o.expedition_order_items?.length || 0} itens
                        </span>
                        {o.shopify_created_at && (
                          <span className="text-xs text-muted-foreground ml-2">
                            📅 {new Date(o.shopify_created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          R$ {Number(o.total_price || 0).toFixed(2)}
                        </span>
                        {o.group_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                            title="Remover do grupo"
                            onClick={() => handleUngroup(o.id, o.shopify_order_name)}
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="approved">
        <TabsList>
          <TabsTrigger value="approved" className="gap-2">
            <CheckCircle2 className="h-4 w-4" /> Aprovados ({approved.length})
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <AlertTriangle className="h-4 w-4" /> Pendentes ({pending.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approved" className="space-y-2 mt-4">
          {approved.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido aprovado.</CardContent></Card>
          ) : (
            approved.map(order => (
              <OrderRow
                key={order.id}
                order={order}
                isExpanded={expandedId === order.id}
                onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
                onAdvance={handleAdvanceStatus}
                onRefresh={onRefresh}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-2 mt-4">
          {pending.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido pendente.</CardContent></Card>
          ) : (
            pending.map(order => (
              <OrderRow
                key={order.id}
                order={order}
                isExpanded={expandedId === order.id}
                onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
                onAdvance={handleAdvanceStatus}
                onRefresh={onRefresh}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrderRow({ order, isExpanded, onToggle, onAdvance, onRefresh }: {
  order: any;
  isExpanded: boolean;
  onToggle: () => void;
  onAdvance: (id: string, status: string) => void;
  onRefresh: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const isAwaiting = order.expedition_status === 'awaiting_stock';

  const handleToggleAwaiting = async () => {
    setIsToggling(true);
    try {
      const newStatus = isAwaiting ? 'approved' : 'awaiting_stock';
      const { error } = await supabase
        .from('expedition_orders')
        .update({ expedition_status: newStatus })
        .eq('id', order.id);
      if (error) throw error;
      toast.success(isAwaiting
        ? `Pedido ${order.shopify_order_name} retomado!`
        : `Pedido ${order.shopify_order_name} marcado como Aguardando Estoque`
      );
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    } finally {
      setIsToggling(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      // Delete items first, then the order
      await supabase.from('expedition_order_items').delete().eq('expedition_order_id', order.id);
      await supabase.from('expedition_freight_quotes').delete().eq('expedition_order_id', order.id);
      const { error } = await supabase.from('expedition_orders').delete().eq('id', order.id);
      if (error) throw error;
      toast.success(`Pedido ${order.shopify_order_name} excluído!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro ao excluir: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMarkDispatched = async () => {
    setIsMarking(true);
    try {
      const { error } = await supabase
        .from('expedition_orders')
        .update({ expedition_status: 'dispatched', dispatch_verified: true, dispatch_verified_at: new Date().toISOString() })
        .eq('id', order.id);
      if (error) throw error;
      toast.success(`Pedido ${order.shopify_order_name} marcado como despachado!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    } finally {
      setIsMarking(false);
    }
  };
  const statusColors: Record<string, string> = {
    pending_sync: 'bg-muted text-muted-foreground',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    grouped: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    awaiting_stock: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    picking: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    picked: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    packing: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    packed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    freight_quoted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    invoice_issued: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
    label_generated: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
    dispatch_verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    dispatched: 'bg-primary/10 text-primary',
  };

  const addr = order.shipping_address as any;
  const currentStep = STATUS_FLOW.find(s => s.key === order.expedition_status);
  const nextStep = currentStep?.next ? STATUS_FLOW.find(s => s.key === currentStep.next) : null;
  const items = order.expedition_order_items || [];

  return (
    <Card className={`transition-shadow ${isExpanded ? 'shadow-lg border-primary/30' : 'hover:shadow-md'}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between cursor-pointer" onClick={onToggle}>
          <div className="flex items-center gap-3">
            <Package className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-foreground">{order.shopify_order_name || order.shopify_order_number}</span>
                <Badge className={statusColors[order.expedition_status] || 'bg-muted'}>
                  {currentStep?.label || order.expedition_status}
                </Badge>
                {order.is_from_live && (
                  <Badge className="bg-red-500 text-white gap-1">
                    <Radio className="h-3 w-3" /> LIVE
                  </Badge>
                )}
                {order.has_gift && (
                  <Badge className="bg-pink-500 text-white gap-1">
                    <Gift className="h-3 w-3" /> Brinde
                  </Badge>
                )}
                {order.group_id && (
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" /> Agrupado
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {order.customer_name} • {order.customer_email}
                {order.source_event_name && (
                  <span className="ml-2 text-xs font-medium text-primary">
                    📌 {order.source_event_name}
                    {order.source_event_date && ` (${new Date(order.source_event_date).toLocaleDateString('pt-BR')})`}
                  </span>
                )}
              </p>
              {order.shopify_created_at && (
                <p className="text-xs text-muted-foreground">
                  📅 {new Date(order.shopify_created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              {addr && (
                <p className="text-xs text-muted-foreground">
                  {addr.city}/{addr.province} - CEP: {addr.zip}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="font-bold text-foreground">R$ {Number(order.total_price || 0).toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">
                {items.length} itens • {((order.total_weight_grams || 0) / 1000).toFixed(1)}kg
              </p>
            </div>
            {isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
          </div>
        </div>

        {/* Expanded actions panel */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border space-y-4">
            {/* Items list */}
            {items.length > 0 && (
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Itens do pedido:</p>
                <div className="space-y-1">
                  {items.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between text-sm p-2 rounded bg-secondary/50">
                      <div>
                        <span className="font-medium">{item.product_name}</span>
                        {item.variant_name && <span className="text-muted-foreground ml-1">({item.variant_name})</span>}
                        <span className="text-muted-foreground ml-2">SKU: {item.sku || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">x{item.quantity}</Badge>
                        <span className="text-muted-foreground">{item.weight_grams || 0}g</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Freight info */}
            {order.freight_carrier && (
              <div className="p-2 rounded bg-secondary/50 text-sm">
                <span className="font-medium">🚚 Frete:</span> {order.freight_carrier} - {order.freight_service} — R$ {Number(order.freight_price || 0).toFixed(2)}
                {order.freight_delivery_days && ` (${order.freight_delivery_days} dias)`}
                {order.freight_tracking_code && <span className="ml-2">Rastreio: {order.freight_tracking_code}</span>}
              </div>
            )}

            {/* Invoice info */}
            {order.invoice_number && (
              <div className="p-2 rounded bg-secondary/50 text-sm">
                <span className="font-medium">📄 NF-e:</span> {order.invoice_number} (Série {order.invoice_series})
              </div>
            )}

            {/* Internal barcode */}
            {order.internal_barcode && (
              <div className="p-2 rounded bg-secondary/50 text-sm">
                <span className="font-medium">🏷️ Código Interno:</span> <span className="font-mono">{order.internal_barcode}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              {nextStep && (
                <Button
                  onClick={() => onAdvance(order.id, order.expedition_status)}
                  className="gap-2 w-full"
                >
                  <ArrowRight className="h-4 w-4" />
                  Avançar para: {nextStep.label}
                </Button>
              )}

              {order.expedition_status !== 'dispatched' && (
                <Button
                  onClick={handleToggleAwaiting}
                  disabled={isToggling}
                  variant="outline"
                  className={`gap-2 w-full ${isAwaiting
                    ? 'border-green-500/50 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20'
                    : 'border-amber-500/50 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20'
                  }`}
                >
                  {isAwaiting ? <Play className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  {isToggling ? 'Processando...' : isAwaiting ? 'Retomar Pedido' : 'Aguardando Estoque'}
                </Button>
              )}

              {order.expedition_status !== 'dispatched' && (
                <Button
                  onClick={handleMarkDispatched}
                  disabled={isMarking}
                  variant="outline"
                  className="gap-2 w-full border-green-500/50 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                >
                  <CheckCheck className="h-4 w-4" />
                  {isMarking ? 'Marcando...' : 'Marcar como Despachado'}
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="gap-2 w-full border-destructive/50 text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4" />
                    Excluir Pedido
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir pedido {order.shopify_order_name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Essa ação é irreversível. O pedido e todos os seus itens serão removidos da expedição permanentemente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {isDeleting ? 'Excluindo...' : 'Excluir'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {order.expedition_status === 'dispatched' && (
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 text-center">
                <CheckCircle2 className="h-5 w-5 text-green-500 inline mr-2" />
                <span className="font-medium text-green-700 dark:text-green-400">Pedido despachado!</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

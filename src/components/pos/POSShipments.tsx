import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, Package, CheckCircle2, Clock, Truck, Search,
  ChevronDown, ChevronUp, MapPin, Phone, User, DollarSign,
  PackageCheck, Send, Eye, RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  storeId: string;
}

interface ShipmentOrder {
  id: string;
  store_id: string;
  seller_id: string | null;
  customer_id: string | null;
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  sale_type: string;
  payment_gateway: string | null;
  expedition_status: string;
  tracking_code: string | null;
  shipped_at: string | null;
  shipping_address: any;
  shipping_notes: string | null;
  notes: string | null;
  tiny_order_id: string | null;
  tiny_order_number: string | null;
  created_at: string;
  // joined
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_cep?: string | null;
  customer_city?: string | null;
  customer_state?: string | null;
  customer_address?: string | null;
  seller_name?: string | null;
  items?: SaleItem[];
}

interface SaleItem {
  id: string;
  sku: string | null;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

type ExpeditionFilter = 'all' | 'pending' | 'separating' | 'packed' | 'shipped';

const EXPEDITION_TABS: { key: ExpeditionFilter; label: string; color: string }[] = [
  { key: 'all', label: 'Todos', color: 'text-white' },
  { key: 'pending', label: 'Pendente', color: 'text-yellow-400' },
  { key: 'separating', label: 'Separando', color: 'text-cyan-400' },
  { key: 'packed', label: 'Embalado', color: 'text-purple-400' },
  { key: 'shipped', label: 'Enviado', color: 'text-green-400' },
];

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800 border border-yellow-300', icon: Clock },
  separating: { label: 'Separando', color: 'bg-cyan-100 text-cyan-800 border border-cyan-300', icon: Package },
  packed: { label: 'Embalado', color: 'bg-purple-100 text-purple-800 border border-purple-300', icon: PackageCheck },
  shipped: { label: 'Enviado', color: 'bg-green-100 text-green-800 border border-green-300', icon: Truck },
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function POSShipments({ storeId }: Props) {
  const [orders, setOrders] = useState<ShipmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<ExpeditionFilter>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  const [shippingNotesInput, setShippingNotesInput] = useState('');
  const [showTrackingDialog, setShowTrackingDialog] = useState<string | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const { data: sales } = await supabase
        .from('pos_sales')
        .select('*')
        .eq('store_id', storeId)
        .in('sale_type', ['online', 'pickup'])
        .in('status', ['online_pending', 'pending_pickup', 'completed'])
        .order('created_at', { ascending: false })
        .limit(200);

      if (!sales || sales.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      // Fetch customer and seller data
      const customerIds = [...new Set(sales.filter(s => s.customer_id).map(s => s.customer_id!))];
      const sellerIds = [...new Set(sales.filter(s => s.seller_id).map(s => s.seller_id!))];
      const saleIds = sales.map(s => s.id);

      // Also fetch checkout attempts for sales without customer_id
      const salesWithoutCustomer = sales.filter(s => !s.customer_id).map(s => s.id);

      const [customersRes, sellersRes, itemsRes, checkoutRes] = await Promise.all([
        customerIds.length > 0
          ? supabase.from('pos_customers').select('id, name, whatsapp, cep, city, state, address').in('id', customerIds)
          : { data: [] },
        sellerIds.length > 0
          ? supabase.from('pos_sellers').select('id, name').in('id', sellerIds)
          : { data: [] },
        supabase.from('pos_sale_items').select('*').in('sale_id', saleIds),
        salesWithoutCustomer.length > 0
          ? supabase.from('pos_checkout_attempts')
              .select('sale_id, customer_name, customer_phone, customer_email')
              .in('sale_id', salesWithoutCustomer)
              .not('customer_name', 'is', null)
              .order('created_at', { ascending: false })
          : { data: [] },
      ]);

      const customerMap = new Map((customersRes.data || []).map(c => [c.id, c]));
      const sellerMap = new Map((sellersRes.data || []).map(s => [s.id, s]));
      const itemsMap = new Map<string, SaleItem[]>();
      (itemsRes.data || []).forEach((item: any) => {
        if (!itemsMap.has(item.sale_id)) itemsMap.set(item.sale_id, []);
        itemsMap.get(item.sale_id)!.push(item);
      });

      // Build checkout fallback map (sale_id -> customer data)
      const checkoutMap = new Map<string, any>();
      (checkoutRes.data || []).forEach((c: any) => {
        if (c.customer_name) checkoutMap.set(c.sale_id, c);
      });

      const enriched: ShipmentOrder[] = sales.map(s => {
        const customer = s.customer_id ? customerMap.get(s.customer_id) : null;
        const checkoutFallback = !customer ? checkoutMap.get(s.id) : null;
        const seller = s.seller_id ? sellerMap.get(s.seller_id) : null;
        
        // Also check payment_details for seller name fallback
        const paymentDetails = s.payment_details as any;

        return {
          ...s,
          customer_name: customer?.name || checkoutFallback?.customer_name || null,
          customer_phone: customer?.whatsapp || checkoutFallback?.customer_phone || null,
          customer_cep: customer?.cep || null,
          customer_city: customer?.city || null,
          customer_state: customer?.state || null,
          customer_address: customer?.address || null,
          seller_name: seller?.name || paymentDetails?.seller_name || null,
          items: itemsMap.get(s.id) || [],
        } as ShipmentOrder;
      });

      setOrders(enriched);
    } catch (e: any) {
      console.error('Fetch shipments error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const channel = supabase
      .channel(`pos-shipments-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_sales', filter: `store_id=eq.${storeId}` }, () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  const filteredOrders = orders.filter(o => {
    // Filter by expedition status
    if (filter !== 'all' && o.expedition_status !== filter) return false;
    // Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        o.customer_name?.toLowerCase().includes(term) ||
        o.customer_phone?.toLowerCase().includes(term) ||
        o.tiny_order_number?.toLowerCase().includes(term) ||
        o.items?.some(i => i.product_name?.toLowerCase().includes(term) || i.sku?.toLowerCase().includes(term))
      );
    }
    return true;
  });

  const counts = {
    all: orders.length,
    pending: orders.filter(o => o.expedition_status === 'pending').length,
    separating: orders.filter(o => o.expedition_status === 'separating').length,
    packed: orders.filter(o => o.expedition_status === 'packed').length,
    shipped: orders.filter(o => o.expedition_status === 'shipped').length,
  };

  const updateStatus = async (id: string, newStatus: string, extra?: Record<string, any>) => {
    setSaving(true);
    try {
      const payload: Record<string, any> = { expedition_status: newStatus, ...extra };
      if (newStatus === 'shipped') payload.shipped_at = new Date().toISOString();
      
      await supabase.from('pos_sales').update(payload).eq('id', id);
      toast.success(`Status atualizado para ${STATUS_MAP[newStatus]?.label || newStatus}`);
      setExpandedId(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleShipWithTracking = async (id: string) => {
    await updateStatus(id, 'shipped', {
      tracking_code: trackingInput || null,
      shipping_notes: shippingNotesInput || null,
    });
    setShowTrackingDialog(null);
    setTrackingInput('');
    setShippingNotesInput('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-pos-yellow" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-3 md:p-4 border-b border-gray-200 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-amber-600" />
            <h2 className="text-base md:text-lg font-bold text-black">Envios Online</h2>
            {counts.pending > 0 && (
              <Badge className="bg-red-500 text-white border-0 animate-pulse">{counts.pending}</Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={fetchOrders} className="text-gray-500 hover:text-black border-gray-300">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por nome, telefone, SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 text-sm bg-gray-50 border-gray-300 text-black h-9 placeholder:text-gray-400"
          />
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {EXPEDITION_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all',
                filter === tab.key
                  ? 'bg-black text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {tab.label}
              <span className="ml-1 opacity-70">({counts[tab.key]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <ScrollArea className="flex-1 p-3 md:p-4">
        <div className="space-y-2">
          {filteredOrders.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Package className="h-10 w-10 mx-auto mb-2" />
              <p className="text-sm">Nenhum envio encontrado</p>
            </div>
          )}

          {filteredOrders.map(order => {
            const isExpanded = expandedId === order.id;
            const status = STATUS_MAP[order.expedition_status] || STATUS_MAP.pending;
            const StatusIcon = status.icon;
            const itemCount = order.items?.reduce((s, i) => s + i.quantity, 0) || 0;

            return (
              <Card
                key={order.id}
                className={cn(
                  'border-gray-200 bg-white shadow-sm transition-all',
                  order.expedition_status === 'pending' && 'border-yellow-300 bg-yellow-50'
                )}
              >
                <CardContent className="p-3">
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : order.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-black text-sm">
                            {order.customer_name || 'Sem cliente'}
                          </span>
                          <Badge className={`text-[10px] ${status.color}`}>
                            <StatusIcon className="h-3 w-3 mr-0.5" />{status.label}
                          </Badge>
                          {order.sale_type === 'pickup' && (
                            <Badge className="bg-teal-100 text-teal-800 border border-teal-300 text-[10px]">Retirada</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                          {order.customer_phone && <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" />{order.customer_phone}</span>}
                          {order.seller_name && <span>• {order.seller_name}</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-600 mt-0.5">
                          <span className="font-semibold text-red-600">{fmt(order.total)}</span>
                          <span>• {itemCount} {itemCount === 1 ? 'item' : 'itens'}</span>
                          {order.payment_gateway && <span>• {order.payment_gateway}</span>}
                        </div>
                        {order.tracking_code && (
                          <p className="text-[10px] text-green-700 font-medium mt-0.5">🚚 {order.tracking_code}</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {new Date(order.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          {order.tiny_order_number && ` • Tiny #${order.tiny_order_number}`}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-3 border-t border-gray-200 pt-3 space-y-3">
                      {/* Items list */}
                      {order.items && order.items.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-gray-500">Itens:</p>
                          {order.items.map((item, idx) => (
                            <div key={item.id || idx} className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 last:border-0">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs text-black truncate">{item.product_name}</p>
                                <div className="flex gap-2 text-[10px] text-gray-500">
                                  {item.variant_name && <span>{item.variant_name}</span>}
                                  {item.size && <span>Tam: {item.size}</span>}
                                  {item.sku && <span className="font-mono">SKU: {item.sku}</span>}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs text-black font-medium">{item.quantity}x</p>
                                <p className="text-[10px] text-gray-500">{fmt(item.unit_price)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Customer address */}
                      {(order.customer_address || order.customer_city) && (
                        <div className="flex items-start gap-1.5 text-[10px] text-gray-500">
                          <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>
                            {[order.customer_address, order.customer_city, order.customer_state, order.customer_cep].filter(Boolean).join(' - ')}
                          </span>
                        </div>
                      )}

                      {order.notes && (
                        <p className="text-[10px] text-gray-500 italic">📝 {order.notes}</p>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2">
                        {order.expedition_status === 'pending' && (
                          <Button
                            onClick={() => updateStatus(order.id, 'separating')}
                            disabled={saving}
                            className="gap-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs flex-1"
                          >
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                            Separar
                          </Button>
                        )}

                        {order.expedition_status === 'separating' && (
                          <Button
                            onClick={() => updateStatus(order.id, 'packed')}
                            disabled={saving}
                            className="gap-1 bg-purple-600 hover:bg-purple-700 text-white text-xs flex-1"
                          >
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <PackageCheck className="h-3 w-3" />}
                            Embalar
                          </Button>
                        )}

                        {order.expedition_status === 'packed' && (
                          <Button
                            onClick={() => {
                              setShowTrackingDialog(order.id);
                              setTrackingInput(order.tracking_code || '');
                              setShippingNotesInput(order.shipping_notes || '');
                            }}
                            disabled={saving}
                            className="gap-1 bg-green-600 hover:bg-green-700 text-white text-xs flex-1"
                          >
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                            Despachar
                          </Button>
                        )}

                        {order.expedition_status === 'shipped' && (
                          <Badge className="bg-green-100 text-green-800 border border-green-300 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Enviado {order.shipped_at ? new Date(order.shipped_at).toLocaleDateString('pt-BR') : ''}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>

      {/* Tracking Dialog */}
      <Dialog open={!!showTrackingDialog} onOpenChange={(open) => { if (!open) setShowTrackingDialog(null); }}>
        <DialogContent className="bg-white border-gray-300 text-black max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-black">
              <Truck className="h-4 w-4 text-amber-600" /> Despachar Envio
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">Código de Rastreio (opcional)</label>
              <Input
                placeholder="Ex: BR123456789BR"
                value={trackingInput}
                onChange={(e) => setTrackingInput(e.target.value)}
                className="bg-gray-50 border-gray-300 text-black text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">Observações do envio</label>
              <Textarea
                placeholder="Transportadora, prazo estimado..."
                value={shippingNotesInput}
                onChange={(e) => setShippingNotesInput(e.target.value)}
                rows={2}
                className="bg-gray-50 border-gray-300 text-black text-sm"
              />
            </div>
            <Button
              onClick={() => showTrackingDialog && handleShipWithTracking(showTrackingDialog)}
              disabled={saving}
              className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Confirmar Despacho
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

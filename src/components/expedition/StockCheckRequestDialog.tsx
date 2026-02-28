import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Store, Send, CheckCircle2, XCircle, Clock, Truck, Package } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  sku: string;
  productName: string;
  variantName?: string;
  quantityNeeded: number;
  orderNames: string[];
  expeditionOrderIds: string[];
}

interface StoreOption {
  id: string;
  name: string;
}

interface StockRequest {
  id: string;
  sku: string;
  product_name: string;
  variant_name: string | null;
  to_store_id: string;
  to_store_name: string | null;
  status: string;
  has_stock: boolean | null;
  courier_requested: boolean;
  courier_name: string | null;
  response_notes: string | null;
  created_at: string;
  responded_at: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Aguardando', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  confirmed: { label: 'Tem Estoque', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  unavailable: { label: 'Sem Estoque', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  courier_coming: { label: 'Motoboy a Caminho', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400', icon: Truck },
  completed: { label: 'Concluído', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: CheckCircle2 },
};

export function StockCheckRequestDialog({ open, onClose, sku, productName, variantName, quantityNeeded, orderNames, expeditionOrderIds }: Props) {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [existingRequests, setExistingRequests] = useState<StockRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);
      const [{ data: storesData }, { data: requests }] = await Promise.all([
        supabase.from('pos_stores').select('id, name').eq('is_active', true).eq('is_simulation', false).order('name'),
        supabase.from('expedition_stock_requests').select('*').eq('sku', sku).in('status', ['pending', 'confirmed', 'courier_coming']).order('created_at', { ascending: false }),
      ]);
      // Filter out the "Site" store (expedition warehouse)
      setStores((storesData || []).filter((s: any) => !s.name?.toLowerCase().includes('site')));
      setExistingRequests((requests as any) || []);
      setLoading(false);
    };
    load();

    // Realtime updates
    const channel = supabase
      .channel(`stock-req-${sku}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expedition_stock_requests' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, sku]);

  const handleSend = async () => {
    if (!selectedStore) { toast.error('Selecione uma loja'); return; }
    setSending(true);
    try {
      const store = stores.find(s => s.id === selectedStore);
      const { error } = await supabase.from('expedition_stock_requests').insert({
        sku,
        product_name: productName,
        variant_name: variantName || null,
        quantity_needed: quantityNeeded,
        to_store_id: selectedStore,
        to_store_name: store?.name || '',
        expedition_order_ids: expeditionOrderIds,
        order_names: orderNames,
        notes: notes || null,
        requested_by: 'Expedição',
      });
      if (error) throw error;
      toast.success(`Solicitação enviada para ${store?.name}!`);
      setNotes('');
      setSelectedStore('');
    } catch (e: any) {
      toast.error('Erro ao enviar: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  const handleMarkCompleted = async (id: string) => {
    await supabase.from('expedition_stock_requests').update({ status: 'completed' }).eq('id', id);
    toast.success('Solicitação concluída!');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Solicitar Conferência de Estoque
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product info */}
          <Card>
            <CardContent className="p-3">
              <p className="font-medium text-foreground">{productName}</p>
              {variantName && <p className="text-sm text-muted-foreground">{variantName}</p>}
              <p className="text-xs font-mono text-muted-foreground">SKU: {sku}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Qtd necessária: <span className="font-bold text-foreground">{quantityNeeded}</span> • Pedidos: {orderNames.join(', ')}
              </p>
            </CardContent>
          </Card>

          {/* Existing requests */}
          {existingRequests.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">Solicitações em andamento</h4>
              {existingRequests.map(req => {
                const status = STATUS_MAP[req.status] || STATUS_MAP.pending;
                const Icon = status.icon;
                return (
                  <Card key={req.id} className="border-border/50">
                    <CardContent className="p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Store className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium text-foreground">{req.to_store_name}</span>
                          <Badge className={`text-[10px] ${status.color}`}>
                            <Icon className="h-3 w-3 mr-0.5" />{status.label}
                          </Badge>
                        </div>
                        {req.response_notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">💬 {req.response_notes}</p>
                        )}
                        {req.courier_name && (
                          <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">
                            🏍️ Motoboy: {req.courier_name}
                          </p>
                        )}
                      </div>
                      {(req.status === 'confirmed' || req.status === 'courier_coming') && (
                        <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => handleMarkCompleted(req.id)}>
                          Concluir
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* New request form */}
          <div className="space-y-3 border-t pt-3">
            <h4 className="text-sm font-semibold text-foreground">Nova solicitação</h4>
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a loja..." />
              </SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Observações (opcional)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-sm"
            />
            <Button onClick={handleSend} disabled={sending || !selectedStore} className="w-full gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar Solicitação
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

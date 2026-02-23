import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Package, CheckCircle2, XCircle, Clock, Truck, Bell, Store } from 'lucide-react';

interface Props {
  storeId: string;
}

interface StockRequest {
  id: string;
  sku: string;
  product_name: string;
  variant_name: string | null;
  quantity_needed: number;
  to_store_id: string;
  to_store_name: string | null;
  order_names: string[];
  status: string;
  has_stock: boolean | null;
  courier_requested: boolean;
  courier_name: string | null;
  courier_phone: string | null;
  notes: string | null;
  response_notes: string | null;
  requested_by: string | null;
  responded_by: string | null;
  created_at: string;
  responded_at: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Aguardando', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  confirmed: { label: 'Tem Estoque', color: 'bg-green-500/20 text-green-400', icon: CheckCircle2 },
  unavailable: { label: 'Sem Estoque', color: 'bg-red-500/20 text-red-400', icon: XCircle },
  courier_coming: { label: 'Motoboy a Caminho', color: 'bg-purple-500/20 text-purple-400', icon: Truck },
  completed: { label: 'Concluído', color: 'bg-blue-500/20 text-blue-400', icon: CheckCircle2 },
};

export function POSStockRequests({ storeId }: Props) {
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseNotes, setResponseNotes] = useState('');
  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchRequests = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('expedition_stock_requests')
      .select('*')
      .eq('to_store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(50);
    setRequests((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchRequests();
    const channel = supabase
      .channel(`pos-stock-req-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expedition_stock_requests' }, () => fetchRequests())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  const handleConfirmStock = async (id: string) => {
    setSaving(true);
    try {
      await supabase.from('expedition_stock_requests').update({
        status: 'confirmed',
        has_stock: true,
        response_notes: responseNotes || 'Produto encontrado no estoque.',
        responded_at: new Date().toISOString(),
      }).eq('id', id);
      toast.success('Estoque confirmado!');
      setRespondingId(null);
      setResponseNotes('');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleNoStock = async (id: string) => {
    setSaving(true);
    try {
      await supabase.from('expedition_stock_requests').update({
        status: 'unavailable',
        has_stock: false,
        response_notes: responseNotes || 'Produto não encontrado no estoque físico.',
        responded_at: new Date().toISOString(),
      }).eq('id', id);
      toast.success('Resposta enviada.');
      setRespondingId(null);
      setResponseNotes('');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendCourier = async (id: string) => {
    if (!courierName.trim()) { toast.error('Informe o nome do motoboy'); return; }
    setSaving(true);
    try {
      await supabase.from('expedition_stock_requests').update({
        status: 'courier_coming',
        courier_requested: true,
        courier_name: courierName,
        courier_phone: courierPhone || null,
        response_notes: responseNotes || `Motoboy ${courierName} enviado para buscar o produto.`,
        responded_at: new Date().toISOString(),
      }).eq('id', id);
      toast.success('Motoboy registrado! A expedição será notificada.');
      setRespondingId(null);
      setResponseNotes('');
      setCourierName('');
      setCourierPhone('');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const otherRequests = requests.filter(r => r.status !== 'pending');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-pos-yellow" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 md:p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-pos-yellow" />
          <h2 className="text-base md:text-lg font-bold text-white">Conferência de Estoque (Expedição)</h2>
          {pendingRequests.length > 0 && (
            <Badge className="bg-red-500 text-white border-0 animate-pulse">{pendingRequests.length} pendente{pendingRequests.length > 1 ? 's' : ''}</Badge>
          )}
        </div>
        <p className="text-xs text-white/50 mt-0.5">Solicitações da expedição para verificar estoque físico</p>
      </div>

      <ScrollArea className="flex-1 p-3 md:p-4">
        <div className="space-y-3">
          {/* Pending requests (highlighted) */}
          {pendingRequests.map(req => (
            <Card key={req.id} className="border-yellow-500/50 bg-yellow-500/5 animate-in fade-in">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Bell className="h-4 w-4 text-yellow-500 animate-bounce shrink-0" />
                      <span className="font-bold text-white text-sm">{req.product_name}</span>
                      <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px]">
                        <Clock className="h-3 w-3 mr-0.5" />NOVO
                      </Badge>
                    </div>
                    {req.variant_name && <p className="text-xs text-white/60 mt-0.5">{req.variant_name}</p>}
                    <p className="text-[10px] font-mono text-white/40">SKU: {req.sku}</p>
                    <p className="text-xs text-white/50 mt-0.5">
                      Qtd: <span className="font-bold text-white">{req.quantity_needed}</span>
                      {req.order_names?.length > 0 && ` • Pedidos: ${(req.order_names as string[]).join(', ')}`}
                    </p>
                    {req.notes && <p className="text-xs text-white/40 mt-0.5 italic">📝 {req.notes}</p>}
                    <p className="text-[10px] text-white/30 mt-1">
                      {new Date(req.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </p>
                  </div>
                </div>

                {respondingId === req.id ? (
                  <div className="space-y-2 border-t border-white/10 pt-2">
                    <Textarea
                      placeholder="Observações da verificação..."
                      value={responseNotes}
                      onChange={(e) => setResponseNotes(e.target.value)}
                      rows={2}
                      className="text-sm bg-white/5 border-white/20 text-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button onClick={() => handleConfirmStock(req.id)} disabled={saving} className="gap-1 bg-green-600 hover:bg-green-700 text-white text-xs">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Tem Estoque
                      </Button>
                      <Button onClick={() => handleNoStock(req.id)} disabled={saving} variant="destructive" className="gap-1 text-xs">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        Sem Estoque
                      </Button>
                    </div>

                    {/* Courier section */}
                    <div className="border-t border-white/10 pt-2 space-y-1.5">
                      <p className="text-xs font-medium text-white/70 flex items-center gap-1">
                        <Truck className="h-3 w-3" /> Enviar via motoboy
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          placeholder="Nome do motoboy"
                          value={courierName}
                          onChange={(e) => setCourierName(e.target.value)}
                          className="text-xs h-8 bg-white/5 border-white/20 text-white"
                        />
                        <Input
                          placeholder="Telefone (opcional)"
                          value={courierPhone}
                          onChange={(e) => setCourierPhone(e.target.value)}
                          className="text-xs h-8 bg-white/5 border-white/20 text-white"
                        />
                      </div>
                      <Button
                        onClick={() => handleSendCourier(req.id)}
                        disabled={saving || !courierName.trim()}
                        className="w-full gap-1 bg-purple-600 hover:bg-purple-700 text-white text-xs"
                      >
                        <Truck className="h-3 w-3" /> Confirmar Motoboy
                      </Button>
                    </div>

                    <Button variant="ghost" size="sm" className="text-xs text-white/40" onClick={() => { setRespondingId(null); setResponseNotes(''); setCourierName(''); setCourierPhone(''); }}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setRespondingId(req.id)} className="w-full gap-2 bg-pos-yellow text-pos-black hover:bg-pos-yellow/90 text-sm">
                    <Package className="h-4 w-4" /> Verificar Estoque
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}

          {pendingRequests.length === 0 && (
            <div className="text-center py-8 text-white/30">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-2" />
              <p className="text-sm">Nenhuma solicitação pendente</p>
            </div>
          )}

          {/* Previous requests */}
          {otherRequests.length > 0 && (
            <>
              <div className="border-t border-white/10 pt-3 mt-3">
                <h3 className="text-xs font-semibold text-white/50 mb-2">Histórico</h3>
              </div>
              {otherRequests.map(req => {
                const status = STATUS_MAP[req.status] || STATUS_MAP.pending;
                const Icon = status.icon;
                return (
                  <Card key={req.id} className="border-white/10 bg-white/5">
                    <CardContent className="p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white truncate">{req.product_name}</p>
                          {req.variant_name && <p className="text-[10px] text-white/50">{req.variant_name}</p>}
                          <p className="text-[10px] text-white/30 font-mono">SKU: {req.sku}</p>
                          {req.response_notes && <p className="text-[10px] text-white/40 mt-0.5">💬 {req.response_notes}</p>}
                          {req.courier_name && <p className="text-[10px] text-purple-400">🏍️ {req.courier_name}</p>}
                        </div>
                        <Badge className={`text-[10px] shrink-0 ${status.color}`}>
                          <Icon className="h-3 w-3 mr-0.5" />{status.label}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

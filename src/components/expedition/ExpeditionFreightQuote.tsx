import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Truck, Receipt, Tag, CheckCircle2, Download, ExternalLink } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  activeTab: string;
  onRefresh: () => void;
}

export function ExpeditionFreightQuote({ orders, searchTerm, activeTab, onRefresh }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return true;
  });

  const handleQuoteFreight = async (orderId: string) => {
    setLoadingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('expedition-quote-freight', {
        body: { order_id: orderId },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`${data.quotes?.length || 0} cotações recebidas!`);
        onRefresh();
      } else {
        throw new Error(data?.error || 'Falha na cotação');
      }
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleSelectFreight = async (orderId: string, quote: any) => {
    try {
      await supabase
        .from('expedition_orders')
        .update({
          freight_carrier: quote.carrier,
          freight_service: quote.service,
          freight_price: quote.price,
          freight_delivery_days: quote.delivery_days,
          expedition_status: 'freight_quoted',
        })
        .eq('id', orderId);

      await supabase
        .from('expedition_freight_quotes')
        .update({ is_selected: false })
        .eq('expedition_order_id', orderId);

      await supabase
        .from('expedition_freight_quotes')
        .update({ is_selected: true })
        .eq('id', quote.id);

      toast.success(`Frete selecionado: ${quote.carrier} - ${quote.service}`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleEmitInvoice = async (orderId: string) => {
    setLoadingId(orderId);
    try {
      // First create order in Tiny if not yet
      const order = filtered.find(o => o.id === orderId);
      if (!order?.tiny_order_id) {
        const { data: createData, error: createError } = await supabase.functions.invoke('expedition-tiny-invoice', {
          body: { order_id: orderId, action: 'create_order' },
        });
        if (createError) throw createError;
        if (!createData?.success) throw new Error(createData?.error || 'Erro ao criar pedido no Tiny');
      }

      // Then emit invoice
      const { data, error } = await supabase.functions.invoke('expedition-tiny-invoice', {
        body: { order_id: orderId, action: 'emit_invoice' },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success('NF-e emitida com sucesso!');
        onRefresh();
      } else {
        throw new Error(data?.error || 'Erro na emissão');
      }
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleGenerateLabel = async (orderId: string) => {
    setLoadingId(orderId);
    try {
      // Generate internal barcode
      const internalBarcode = `EXP-${Date.now()}-${orderId.slice(0, 8)}`.toUpperCase();
      
      await supabase
        .from('expedition_orders')
        .update({
          internal_barcode: internalBarcode,
          expedition_status: 'label_generated',
        })
        .eq('id', orderId);

      toast.success('Etiqueta e código interno gerados!');
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-foreground">
        {activeTab === 'freight' ? 'Cotação de Frete' : activeTab === 'invoice' ? 'Emissão de NF-e' : 'Etiquetas de Envio'}
      </h2>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido encontrado.</CardContent></Card>
      ) : (
        filtered.map(order => {
          const addr = order.shipping_address as any;
          return (
            <Card key={order.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {order.shopify_order_name}
                    <Badge variant="outline">{order.expedition_status}</Badge>
                  </CardTitle>
                  <span className="font-bold text-foreground">R$ {Number(order.total_price || 0).toFixed(2)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {order.customer_name} • {addr?.city}/{addr?.province} • CEP: {addr?.zip}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Freight section */}
                {activeTab === 'freight' && (
                  <div className="space-y-2">
                    {order.freight_carrier ? (
                      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span className="font-medium text-foreground">
                            {order.freight_carrier} - {order.freight_service}
                          </span>
                          <span className="font-bold">R$ {Number(order.freight_price || 0).toFixed(2)}</span>
                          {order.freight_delivery_days && (
                            <Badge variant="secondary">{order.freight_delivery_days} dias</Badge>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Button
                        onClick={() => handleQuoteFreight(order.id)}
                        disabled={loadingId === order.id}
                        variant="outline"
                        className="gap-2"
                      >
                        {loadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                        Cotar Frete
                      </Button>
                    )}
                  </div>
                )}

                {/* Invoice section */}
                {activeTab === 'invoice' && (
                  <div className="space-y-2">
                    {order.invoice_number ? (
                      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="font-medium text-foreground">
                              NF-e {order.invoice_number} (Série {order.invoice_series})
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {order.invoice_pdf_url && (
                              <Button size="sm" variant="outline" asChild>
                                <a href={order.invoice_pdf_url} target="_blank" rel="noopener noreferrer">
                                  <Download className="h-3 w-3 mr-1" /> DANFE
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button
                        onClick={() => handleEmitInvoice(order.id)}
                        disabled={loadingId === order.id}
                        variant="outline"
                        className="gap-2"
                      >
                        {loadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                        Emitir NF-e
                      </Button>
                    )}
                  </div>
                )}

                {/* Labels section */}
                {activeTab === 'labels' && (
                  <div className="space-y-2">
                    {order.internal_barcode ? (
                      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                              <span className="font-medium text-foreground">Código Interno</span>
                            </div>
                            <p className="text-lg font-mono font-bold mt-1 text-foreground">{order.internal_barcode}</p>
                          </div>
                          {order.freight_tracking_code && (
                            <div>
                              <p className="text-xs text-muted-foreground">Rastreio</p>
                              <p className="font-mono font-bold text-foreground">{order.freight_tracking_code}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Button
                        onClick={() => handleGenerateLabel(order.id)}
                        disabled={loadingId === order.id}
                        variant="outline"
                        className="gap-2"
                      >
                        {loadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                        Gerar Etiqueta + Código Interno
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Truck, Receipt, Tag, CheckCircle2, Download, RefreshCw, Printer, Pencil, RotateCcw } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  activeTab: string;
  onRefresh: () => void;
}

export function ExpeditionFreightQuote({ orders, searchTerm, activeTab, onRefresh }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [quotesMap, setQuotesMap] = useState<Record<string, any[]>>({});
  const [editingCpf, setEditingCpf] = useState<string | null>(null);
  const [cpfValue, setCpfValue] = useState('');

  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return true;
  });

  // Fetch existing quotes for all orders
  useEffect(() => {
    if (activeTab !== 'freight') return;
    const fetchQuotes = async () => {
      const orderIds = filtered.map(o => o.id);
      if (orderIds.length === 0) return;
      const { data } = await supabase
        .from('expedition_freight_quotes')
        .select('*')
        .in('expedition_order_id', orderIds)
        .order('price', { ascending: true });

      if (data) {
        const map: Record<string, any[]> = {};
        data.forEach(q => {
          if (!map[q.expedition_order_id]) map[q.expedition_order_id] = [];
          map[q.expedition_order_id].push(q);
        });
        setQuotesMap(map);
      }
    };
    fetchQuotes();
  }, [activeTab, filtered.length]);

  const handleQuoteFreight = async (orderId: string) => {
    setLoadingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('expedition-quote-freight', {
        body: { order_id: orderId },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`${data.quotes?.length || 0} cotações recebidas!`);
        // Refresh quotes from DB
        const { data: newQuotes } = await supabase
          .from('expedition_freight_quotes')
          .select('*')
          .eq('expedition_order_id', orderId)
          .order('price', { ascending: true });
        if (newQuotes) {
          setQuotesMap(prev => ({ ...prev, [orderId]: newQuotes }));
        }
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

      // Update local state
      setQuotesMap(prev => ({
        ...prev,
        [orderId]: (prev[orderId] || []).map(q => ({ ...q, is_selected: q.id === quote.id })),
      }));

      toast.success(`Frete selecionado: ${quote.carrier} - ${quote.service}`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleSelectManualFreight = async (orderId: string, carrier: string) => {
    try {
      await supabase
        .from('expedition_orders')
        .update({
          freight_carrier: carrier,
          freight_service: 'Entrega local',
          freight_price: 0,
          freight_delivery_days: 0,
          expedition_status: 'freight_quoted',
        })
        .eq('id', orderId);
      toast.success(`Frete definido como ${carrier}`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleSaveCpf = async (orderId: string) => {
    const cleaned = cpfValue.replace(/\D/g, '');
    if (cleaned.length < 11) {
      toast.error('CPF inválido. Deve ter pelo menos 11 dígitos.');
      return;
    }
    try {
      await supabase
        .from('expedition_orders')
        .update({ customer_cpf: cleaned })
        .eq('id', orderId);
      toast.success('CPF atualizado!');
      setEditingCpf(null);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleEmitInvoice = async (orderId: string) => {
    setLoadingId(orderId);
    try {
      const order = filtered.find(o => o.id === orderId);
      
      // Validate: freight must be quoted first
      if (!order?.freight_carrier || !order?.freight_price) {
        toast.error('O frete precisa ser cotado e selecionado antes de emitir a NF-e.');
        return;
      }

      // Sync: find existing Tiny order (auto-synced from Shopify) and update CPF/customer data
      if (!order?.tiny_order_id) {
        const { data: syncData, error: syncError } = await supabase.functions.invoke('expedition-tiny-invoice', {
          body: { order_id: orderId, action: 'sync_order' },
        });
        if (syncError) throw syncError;
        if (!syncData?.success) throw new Error(syncData?.error || 'Erro ao localizar pedido no Tiny');
        toast.info(syncData?.message || 'Pedido sincronizado com Tiny');
      }

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

  const handleReemitInvoice = async (orderId: string) => {
    setLoadingId(orderId);
    try {
      // First sync customer data on Tiny
      const { data: syncData, error: syncError } = await supabase.functions.invoke('expedition-tiny-invoice', {
        body: { order_id: orderId, action: 'sync_order' },
      });
      if (syncError) throw syncError;
      if (!syncData?.success) throw new Error(syncData?.error || 'Erro ao sincronizar com Tiny');
      toast.info('Dados do cliente atualizados no Tiny');

      // Reset invoice data in our DB
      await supabase
        .from('expedition_orders')
        .update({
          tiny_invoice_id: null,
          invoice_number: null,
          invoice_series: null,
          invoice_key: null,
          invoice_pdf_url: null,
          invoice_xml_url: null,
          internal_barcode: null,
          freight_label_url: null,
          freight_tracking_code: null,
          expedition_status: 'freight_quoted',
        })
        .eq('id', orderId);

      // Re-emit
      const { data, error } = await supabase.functions.invoke('expedition-tiny-invoice', {
        body: { order_id: orderId, action: 'emit_invoice' },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success('NF-e re-emitida com sucesso!');
        onRefresh();
      } else {
        throw new Error(data?.error || 'Erro na re-emissão');
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
      const order = filtered.find(o => o.id === orderId);

      // Validate: NF-e must be emitted first
      if (!order?.invoice_number && !order?.tiny_invoice_id) {
        toast.error('A NF-e precisa ser emitida antes de gerar a etiqueta. Fluxo: Cotar Frete → Emitir NF-e → Gerar Etiqueta.');
        return;
      }

      // Generate internal barcode
      const internalBarcode = `EXP-${Date.now()}-${orderId.slice(0, 8)}`.toUpperCase();
      
      await supabase
        .from('expedition_orders')
        .update({ internal_barcode: internalBarcode })
        .eq('id', orderId);

      // Fetch official shipping label from Tiny (sends NF-e to expedition)
      const { data, error } = await supabase.functions.invoke('expedition-fetch-label', {
        body: { order_id: orderId },
      });

      if (error) {
        console.error('Label fetch error:', error);
        await supabase
          .from('expedition_orders')
          .update({ expedition_status: 'label_generated' })
          .eq('id', orderId);
        toast.success('Código interno gerado! Etiqueta oficial ainda sendo processada pelo Tiny.');
      } else if (data?.success && data?.label_url) {
        toast.success('Etiqueta oficial e código interno gerados!');
      } else {
        await supabase
          .from('expedition_orders')
          .update({ expedition_status: 'label_generated' })
          .eq('id', orderId);
        toast.info(data?.error || 'Código interno gerado! Etiqueta oficial ainda não disponível.');
      }

      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleFetchOfficialLabel = async (orderId: string) => {
    setLoadingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('expedition-fetch-label', {
        body: { order_id: orderId },
      });
      if (error) {
        toast.error('Erro ao conectar com o servidor. Tente novamente.');
        return;
      }
      if (data?.success && data?.label_url) {
        toast.success(data?.message || 'Etiqueta oficial obtida com sucesso!');
        window.open(data.label_url, '_blank');
        onRefresh();
      } else if (data?.label_url) {
        // Label exists but success=false (e.g. tracking pending) — still open it
        window.open(data.label_url, '_blank');
        toast.info(data?.message || 'Etiqueta obtida, mas rastreio ainda pendente.');
        onRefresh();
      } else {
        toast.info(data?.message || data?.error || 'Etiqueta oficial ainda não disponível.');
      }
    } catch (error: any) {
      toast.error('Erro ao buscar etiqueta. Tente novamente.');
    } finally {
      setLoadingId(null);
    }
  };

  const printInternalLabel = (order: any) => {
    const w = window.open('', '_blank');
    if (!w) return;
    const items = order.expedition_order_items || [];
    const itemLines = items.map((it: any, i: number) =>
      `<tr>
        <td style="text-align:center;font-weight:bold;color:#666;">${i + 1}</td>
        <td style="font-weight:600;">${it.product_name}${it.variant_name ? ` <span style="color:#e67e22;font-size:9px;">— ${it.variant_name}</span>` : ''}</td>
        <td style="text-align:center;font-size:14px;font-weight:bold;background:#fff8e1;border-radius:3px;">${it.quantity}</td>
        <td style="font-family:monospace;font-size:9px;color:#888;">${it.sku || '—'}</td>
      </tr>`
    ).join('');
    w.document.write(`<html><head><title>Etiqueta - ${order.shopify_order_name}</title>
<style>
  @page { size: 100mm 80mm; margin: 2mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; margin: 0; padding: 4px; }
  .box { border: 2px solid #1a1a1a; border-radius: 6px; padding: 6px; height: calc(80mm - 12px); display: flex; flex-direction: column; }
  .header { background: #1a1a1a; color: #f5c518; padding: 6px 8px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .header .order { font-size: 16px; font-weight: bold; letter-spacing: 1px; }
  .header .customer { font-size: 10px; color: #ccc; max-width: 50%; text-align: right; }
  .barcode { font-family: monospace; font-size: 14px; font-weight: bold; text-align: center; letter-spacing: 3px; padding: 4px; border: 1px dashed #999; border-radius: 3px; margin-bottom: 4px; background: #fafafa; }
  table { width: 100%; border-collapse: collapse; flex: 1; }
  th { background: #f0f0f0; font-size: 8px; text-transform: uppercase; padding: 2px 4px; text-align: left; color: #666; }
  td { padding: 2px 4px; border-bottom: 1px solid #eee; font-size: 9px; }
  .footer { margin-top: auto; padding-top: 3px; border-top: 1px solid #ddd; font-size: 8px; color: #999; text-align: center; display: flex; justify-content: space-between; }
  .footer .carrier { color: #e67e22; font-weight: 600; }
  @media print { .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="box">
  <div class="header">
    <span class="order">${order.shopify_order_name}</span>
    <span class="customer">${order.customer_name || ''}</span>
  </div>
  <div class="barcode">${order.internal_barcode || '—'}</div>
  ${items.length > 0 ? `<table><thead><tr><th style="width:20px;text-align:center">#</th><th>Produto</th><th style="width:30px;text-align:center">Qtd</th><th style="width:60px">SKU</th></tr></thead><tbody>${itemLines}</tbody></table>` : ''}
  <div class="footer">
    <span>${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
    <span class="carrier">${order.freight_carrier || ''} ${order.freight_tracking_code || ''}</span>
  </div>
</div>
</body></html>`);
    w.document.close();
    w.print();
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
          const quotes = quotesMap[order.id] || [];
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
                  {order.total_weight_grams ? ` • ${order.total_weight_grams}g` : ''}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Freight section */}
                {activeTab === 'freight' && (
                  <div className="space-y-2">
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        onClick={() => handleQuoteFreight(order.id)}
                        disabled={loadingId === order.id}
                        variant="outline"
                        size="sm"
                        className="gap-2"
                      >
                        {loadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {quotes.length > 0 ? 'Recotar' : 'Cotar Frete'}
                      </Button>
                      {!order.freight_carrier && (
                        <Button
                          onClick={() => handleSelectManualFreight(order.id, 'Mototaxista')}
                          disabled={loadingId === order.id}
                          variant="outline"
                          size="sm"
                          className="gap-2 border-orange-500/50 text-orange-700 dark:text-orange-400"
                        >
                          🏍️ Mototaxista
                        </Button>
                      )}
                    </div>

                    {/* Show freight options */}
                    {quotes.length > 0 && (
                      <div className="space-y-1">
                        {quotes.map(q => (
                          <div
                            key={q.id}
                            className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                              q.is_selected
                                ? 'border-green-500 bg-green-50 dark:bg-green-900/10'
                                : 'border-border hover:border-primary/50 hover:bg-secondary/50'
                            }`}
                            onClick={() => handleSelectFreight(order.id, q)}
                          >
                            <div className="flex items-center gap-3">
                              {q.is_selected && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                              <div>
                                <span className="font-medium text-foreground">{q.carrier}</span>
                                <span className="text-sm text-muted-foreground ml-2">{q.service}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-right">
                              {q.delivery_days && (
                                <Badge variant="secondary">{q.delivery_days} dias</Badge>
                              )}
                              <span className="font-bold text-foreground min-w-[80px] text-right">
                                R$ {Number(q.price || 0).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Selected freight summary */}
                    {order.freight_carrier && (
                      <div className="p-2 rounded bg-green-50 dark:bg-green-900/10 text-sm">
                        <span className="text-green-700 dark:text-green-400 font-medium">
                          ✓ Selecionado: {order.freight_carrier} - {order.freight_service} — R$ {Number(order.freight_price || 0).toFixed(2)}
                          {order.freight_delivery_days && ` (${order.freight_delivery_days} dias)`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Invoice section */}
                {activeTab === 'invoice' && (
                  <div className="space-y-2">
                    {/* CPF display/edit */}
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">CPF:</span>
                      {editingCpf === order.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={cpfValue}
                            onChange={(e) => setCpfValue(e.target.value)}
                            placeholder="000.000.000-00"
                            className="h-7 w-40 text-sm"
                          />
                          <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => handleSaveCpf(order.id)}>Salvar</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingCpf(null)}>Cancelar</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className={order.customer_cpf ? 'font-mono text-foreground' : 'text-destructive font-medium'}>
                            {order.customer_cpf || 'Não informado'}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => { setEditingCpf(order.id); setCpfValue(order.customer_cpf || ''); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>

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
                            <Button
                              size="sm"
                              variant="destructive"
                              className="gap-1"
                              onClick={() => handleReemitInvoice(order.id)}
                              disabled={loadingId === order.id}
                            >
                              {loadingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                              Re-emitir NF-e
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : !order.freight_carrier ? (
                      <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-700 dark:text-yellow-400">
                        ⚠️ Cote e selecione o frete primeiro (aba Cotação de Frete) antes de emitir a NF-e.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {!order.tiny_order_id && (
                          <Button
                            onClick={async () => {
                              setLoadingId(order.id);
                              try {
                                const { data, error } = await supabase.functions.invoke('expedition-tiny-invoice', {
                                  body: { order_id: order.id, action: 'sync_order' },
                                });
                                if (error) throw error;
                                if (data?.success) {
                                  toast.success(data.message || 'Pedido sincronizado com Tiny!');
                                  onRefresh();
                                } else {
                                  throw new Error(data?.error || 'Erro ao sincronizar');
                                }
                              } catch (e: any) {
                                toast.error(`Erro: ${e.message}`);
                              } finally {
                                setLoadingId(null);
                              }
                            }}
                            disabled={loadingId === order.id}
                            variant="outline"
                            className="gap-2 border-blue-500/50 text-blue-700 dark:text-blue-400"
                          >
                            {loadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Sincronizar com Tiny
                          </Button>
                        )}
                        <Button
                          onClick={() => handleEmitInvoice(order.id)}
                          disabled={loadingId === order.id}
                          variant="outline"
                          className="gap-2"
                        >
                          {loadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                          Emitir NF-e
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Labels section */}
                {activeTab === 'labels' && (
                  <div className="space-y-3">
                    {order.internal_barcode ? (
                      <>
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

                        {/* Print buttons */}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => handleFetchOfficialLabel(order.id)}
                            disabled={loadingId === order.id}
                          >
                            {loadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Imprimir Etiqueta Oficial de Envio
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="gap-2"
                            onClick={() => printInternalLabel(order)}
                          >
                            <Printer className="h-4 w-4" /> Imprimir Etiqueta Interna
                          </Button>
                        </div>
                      </>
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

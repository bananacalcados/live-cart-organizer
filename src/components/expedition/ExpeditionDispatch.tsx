import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, ScanBarcode, FileBarChart, Printer, Package, Truck } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  showManifest: boolean;
  onRefresh: () => void;
}

export function ExpeditionDispatch({ orders, searchTerm, showManifest, onRefresh }: Props) {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [verifiedOrders, setVerifiedOrders] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const readyOrders = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return o.internal_barcode && ['label_generated', 'dispatch_verified', 'dispatched'].includes(o.expedition_status);
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleScan = useCallback((barcode: string) => {
    if (!barcode.trim()) return;
    
    const matched = readyOrders.find(o => o.internal_barcode === barcode.trim());
    if (matched) {
      setVerifiedOrders(prev => new Set(prev).add(matched.id));
      toast.success(`✓ ${matched.shopify_order_name} verificado!`);
      
      // Update in DB
      supabase
        .from('expedition_orders')
        .update({ dispatch_verified: true, dispatch_verified_at: new Date().toISOString(), expedition_status: 'dispatch_verified' })
        .eq('id', matched.id)
        .then(() => {});
    } else {
      toast.error(`Código não encontrado: ${barcode}`);
    }
    setBarcodeInput('');
  }, [readyOrders]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleScan(barcodeInput);
  };

  // Manifest - group by carrier
  const carrierGroups = new Map<string, any[]>();
  orders.filter(o => o.expedition_status === 'dispatch_verified' || o.expedition_status === 'dispatched').forEach(o => {
    const carrier = o.freight_carrier || 'Sem transportadora';
    if (!carrierGroups.has(carrier)) carrierGroups.set(carrier, []);
    carrierGroups.get(carrier)!.push(o);
  });

  const handleCreateManifest = async (carrier: string, carrierOrders: any[]) => {
    try {
      const { data: manifest } = await supabase
        .from('expedition_dispatch_manifests')
        .insert({
          carrier,
          order_count: carrierOrders.length,
          manifest_number: `ROM-${Date.now().toString().slice(-6)}`,
        })
        .select()
        .single();

      if (manifest) {
        const items = carrierOrders.map(o => ({
          manifest_id: manifest.id,
          expedition_order_id: o.id,
          tracking_code: o.freight_tracking_code,
          verified: true,
          verified_at: new Date().toISOString(),
        }));
        await supabase.from('expedition_dispatch_manifest_items').insert(items);

        // Mark orders as dispatched
        await supabase
          .from('expedition_orders')
          .update({ expedition_status: 'dispatched' })
          .in('id', carrierOrders.map(o => o.id));
      }

      toast.success(`Romaneio ${carrier} criado com ${carrierOrders.length} pedidos!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handlePrintManifest = (carrier: string, carrierOrders: any[]) => {
    const rows = carrierOrders.map((o, i) => 
      `<tr>
        <td style="text-align:center;font-weight:bold;">${i + 1}</td>
        <td style="font-weight:600;">${o.shopify_order_name}</td>
        <td>${o.customer_name || '—'}</td>
        <td style="font-family:monospace;font-size:11px;">${o.freight_tracking_code || '—'}</td>
        <td style="font-family:monospace;font-size:11px;">${o.internal_barcode || '—'}</td>
        <td style="text-align:center;">☐</td>
      </tr>`
    ).join('');
    
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<html><head><title>Romaneio - ${carrier}</title>
<style>
  @page { margin: 15mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20px; }
  .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); color: #f5c518; padding: 20px 24px; border-radius: 8px; margin-bottom: 20px; }
  .header h1 { margin: 0 0 4px 0; font-size: 22px; letter-spacing: 1px; }
  .header .sub { color: #ccc; font-size: 13px; display: flex; justify-content: space-between; }
  .header .sub strong { color: #f5c518; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #1a1a1a; color: #f5c518; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 13px; }
  tbody tr:nth-child(even) { background: #fafafa; }
  .sign-area { margin-top: 40px; border-top: 2px solid #1a1a1a; padding-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
  .sign-box { border-bottom: 1px solid #999; padding-bottom: 8px; margin-bottom: 4px; min-height: 30px; }
  .sign-label { font-size: 11px; color: #666; text-transform: uppercase; }
  .footer { margin-top: 16px; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 0; } .header, thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } tbody tr:nth-child(even) { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
  <h1>🚚 ROMANEIO DE EXPEDIÇÃO</h1>
  <div class="sub">
    <span>Transportadora: <strong>${carrier}</strong></span>
    <span>Data: <strong>${new Date().toLocaleDateString('pt-BR')}</strong> • <strong>${carrierOrders.length} pedidos</strong></span>
  </div>
</div>
<table>
  <thead><tr><th style="width:35px;text-align:center">#</th><th>Pedido</th><th>Cliente</th><th>Rastreio</th><th>Código Interno</th><th style="width:40px;text-align:center">✓</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="sign-area">
  <div><div class="sign-box"></div><div class="sign-label">Assinatura do Coletor</div></div>
  <div><div class="sign-box"></div><div class="sign-label">Nome / Documento</div></div>
  <div><div class="sign-box"></div><div class="sign-label">Data / Hora da Coleta</div></div>
  <div><div class="sign-box"></div><div class="sign-label">Observações</div></div>
</div>
<div class="footer">Impresso em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
</body></html>`);
      w.document.close();
      w.print();
    }
  };

  if (showManifest) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Romaneios por Transportadora</h2>

        {carrierGroups.size === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido verificado para romaneio.</CardContent></Card>
        ) : (
          Array.from(carrierGroups.entries()).map(([carrier, carrierOrders]) => (
            <Card key={carrier}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Truck className="h-5 w-5" />
                    {carrier}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Badge>{carrierOrders.length} pedidos</Badge>
                    <Button size="sm" variant="outline" onClick={() => handlePrintManifest(carrier, carrierOrders)} className="gap-1">
                      <Printer className="h-3 w-3" /> Imprimir
                    </Button>
                    <Button size="sm" onClick={() => handleCreateManifest(carrier, carrierOrders)} className="gap-1">
                      <FileBarChart className="h-3 w-3" /> Gerar Romaneio
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {carrierOrders.map((o: any, i: number) => (
                    <div key={o.id} className="flex items-center justify-between p-2 rounded bg-secondary/50 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{i + 1}.</span>
                        <span className="font-medium text-foreground">{o.shopify_order_name}</span>
                        <span className="text-muted-foreground">{o.customer_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{o.freight_tracking_code || 'N/A'}</span>
                        <span className="font-mono text-xs text-muted-foreground">{o.internal_barcode}</span>
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
      <h2 className="text-lg font-bold text-foreground">Conferência Final de Expedição</h2>
      <p className="text-sm text-muted-foreground">
        Bipe o código de barras interno de cada pedido para confirmar a expedição.
        {verifiedOrders.size}/{readyOrders.length} verificados
      </p>

      {/* Progress */}
      <div className="w-full bg-secondary rounded-full h-4">
        <div
          className={`h-4 rounded-full transition-all ${verifiedOrders.size === readyOrders.length && readyOrders.length > 0 ? 'bg-green-500' : 'bg-primary'}`}
          style={{ width: `${readyOrders.length > 0 ? (verifiedOrders.size / readyOrders.length) * 100 : 0}%` }}
        />
      </div>

      {/* Barcode Scanner */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          placeholder="Bipe o código de barras interno..."
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="text-lg font-mono"
          autoFocus
        />
        <Button onClick={() => handleScan(barcodeInput)}>
          <ScanBarcode className="h-5 w-5" />
        </Button>
      </div>

      <div className="space-y-2">
        {readyOrders.map(order => {
          const isVerified = verifiedOrders.has(order.id) || order.dispatch_verified;
          return (
            <Card key={order.id} className={isVerified ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : ''}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isVerified ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Package className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <span className="font-bold text-foreground">{order.shopify_order_name}</span>
                    <p className="text-sm text-muted-foreground">{order.customer_name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-foreground">{order.internal_barcode}</p>
                  <p className="text-xs text-muted-foreground">{order.freight_carrier} • {order.freight_tracking_code || 'N/A'}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

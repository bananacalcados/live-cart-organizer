import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, XCircle, ClipboardList, Printer } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  showChecking: boolean;
  onRefresh: () => void;
}

export function ExpeditionPickingList({ orders, searchTerm, showChecking, onRefresh }: Props) {
  // Aggregate all items across approved orders
  const allItems = new Map<string, { name: string; variant: string; sku: string; totalQty: number; orders: string[] }>();

  const relevantOrders = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return true;
  });

  relevantOrders.forEach(order => {
    (order.expedition_order_items || []).forEach((item: any) => {
      const key = item.sku || `${item.product_name}-${item.variant_name || ''}`;
      if (!allItems.has(key)) {
        allItems.set(key, {
          name: item.product_name,
          variant: item.variant_name || '',
          sku: item.sku || '',
          totalQty: 0,
          orders: [],
        });
      }
      const entry = allItems.get(key)!;
      entry.totalQty += item.quantity;
      entry.orders.push(order.shopify_order_name);
    });
  });

  const sortedItems = Array.from(allItems.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));

  const [checkedItems, setCheckedItems] = useState<Record<string, number>>({});

  const handleCheck = (key: string, qty: number) => {
    setCheckedItems(prev => ({ ...prev, [key]: qty }));
  };

  const totalProducts = sortedItems.reduce((sum, [, item]) => sum + item.totalQty, 0);
  const totalChecked = Object.values(checkedItems).reduce((sum, qty) => sum + qty, 0);

  const handleMarkPickingComplete = async () => {
    try {
      const orderIds = relevantOrders.map(o => o.id);
      await supabase
        .from('expedition_orders')
        .update({ expedition_status: 'picked' })
        .in('id', orderIds);
      toast.success('Separação marcada como completa!');
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handlePrint = () => {
    const rows = sortedItems.map(([, item], i) => 
      `<tr>
        <td style="text-align:center;font-weight:bold;color:#333;">${i + 1}</td>
        <td style="font-weight:600;">${item.name}${item.variant ? ` <span style="color:#e67e22;font-weight:500;">(${item.variant})</span>` : ''}</td>
        <td style="font-family:monospace;color:#666;font-size:12px;">${item.sku || '—'}</td>
        <td style="text-align:center;font-size:18px;font-weight:bold;color:#1a1a1a;background:#fff8e1;border-radius:4px;">${item.totalQty}</td>
        <td style="text-align:center;width:60px;">☐</td>
      </tr>`
    ).join('');
    
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<html><head><title>Lista de Separação</title>
<style>
  @page { margin: 15mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20px; }
  .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); color: #f5c518; padding: 20px 24px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { margin: 0; font-size: 22px; letter-spacing: 1px; }
  .header .meta { text-align: right; color: #ccc; font-size: 13px; }
  .header .meta strong { color: #f5c518; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #1a1a1a; color: #f5c518; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 13px; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody tr:hover { background: #fff8e1; }
  .footer { margin-top: 20px; padding: 12px 0; border-top: 2px solid #1a1a1a; display: flex; justify-content: space-between; font-size: 13px; color: #666; }
  .footer .total { font-size: 16px; font-weight: bold; color: #1a1a1a; }
  @media print { body { padding: 0; } .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } tbody tr:nth-child(even) { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
  <div><h1>📦 LISTA DE SEPARAÇÃO</h1></div>
  <div class="meta">Data: ${new Date().toLocaleDateString('pt-BR')}<br><strong>${sortedItems.length} produtos • ${totalProducts} unidades</strong></div>
</div>
<table>
  <thead><tr><th style="width:40px;text-align:center">#</th><th>Produto</th><th style="width:120px">SKU</th><th style="width:60px;text-align:center">Qtd</th><th style="width:60px;text-align:center">✓</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">
  <span>Impresso em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
  <span class="total">Total: ${totalProducts} itens</span>
</div>
</body></html>`);
      w.document.close();
      w.print();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {showChecking ? 'Conferência de Separação' : 'Lista de Separação (Picking)'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {sortedItems.length} produtos únicos • {totalProducts} unidades totais
            {showChecking && ` • ${totalChecked}/${totalProducts} conferidos`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
          {showChecking && totalChecked === totalProducts && (
            <Button onClick={handleMarkPickingComplete} className="gap-2">
              <CheckCircle2 className="h-4 w-4" /> Confirmar Separação
            </Button>
          )}
        </div>
      </div>

      {showChecking && (
        <div className="w-full bg-secondary rounded-full h-3">
          <div
            className="bg-primary h-3 rounded-full transition-all"
            style={{ width: `${totalProducts > 0 ? (totalChecked / totalProducts) * 100 : 0}%` }}
          />
        </div>
      )}

      <div className="space-y-2">
        {sortedItems.map(([key, item]) => (
          <Card key={key}>
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{item.name}</span>
                  {item.variant && <Badge variant="outline" className="text-xs">{item.variant}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  SKU: {item.sku || 'N/A'} • Pedidos: {item.orders.join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge className="text-base px-3 py-1">x{item.totalQty}</Badge>
                {showChecking && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={item.totalQty}
                      value={checkedItems[key] || 0}
                      onChange={(e) => handleCheck(key, Math.min(item.totalQty, parseInt(e.target.value) || 0))}
                      className="w-20 text-center"
                    />
                    {(checkedItems[key] || 0) === item.totalQty ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (checkedItems[key] || 0) > 0 ? (
                      <XCircle className="h-5 w-5 text-yellow-500" />
                    ) : null}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

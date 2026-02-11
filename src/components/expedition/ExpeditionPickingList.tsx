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
    const printContent = sortedItems.map(([, item]) => 
      `${item.name} ${item.variant ? `(${item.variant})` : ''} - SKU: ${item.sku || 'N/A'} - Qtd: ${item.totalQty}`
    ).join('\n');
    
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<pre style="font-family:monospace;font-size:14px;">LISTA DE SEPARAÇÃO\n${'='.repeat(60)}\n\n${printContent}\n\n${'='.repeat(60)}\nTotal: ${totalProducts} itens</pre>`);
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

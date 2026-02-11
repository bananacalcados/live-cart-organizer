import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, XCircle, ScanBarcode, Camera, Keyboard, Package } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  onRefresh: () => void;
}

export function ExpeditionPackingStation({ orders, searchTerm, onRefresh }: Props) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<'keyboard' | 'camera'>('keyboard');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedItems, setScannedItems] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return ['approved', 'grouped', 'picked'].includes(o.expedition_status);
  });

  const selectedOrder = filtered.find(o => o.id === selectedOrderId);
  const items = selectedOrder?.expedition_order_items || [];

  // Auto-focus barcode input
  useEffect(() => {
    if (selectedOrderId && scanMode === 'keyboard') {
      inputRef.current?.focus();
    }
  }, [selectedOrderId, scanMode]);

  const handleBarcodeScan = useCallback((barcode: string) => {
    if (!selectedOrder || !barcode.trim()) return;

    // Find matching item by barcode or SKU
    const matchedItem = items.find((item: any) => 
      item.barcode === barcode.trim() || item.sku === barcode.trim()
    );

    if (matchedItem) {
      const key = matchedItem.id;
      const current = scannedItems[key] || 0;
      if (current < matchedItem.quantity) {
        setScannedItems(prev => ({ ...prev, [key]: current + 1 }));
        toast.success(`✓ ${matchedItem.product_name} (${current + 1}/${matchedItem.quantity})`);
      } else {
        toast.warning(`${matchedItem.product_name} já foi totalmente bipado!`);
      }
    } else {
      toast.error(`Código não encontrado neste pedido: ${barcode}`);
    }

    setBarcodeInput('');
  }, [selectedOrder, items, scannedItems]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBarcodeScan(barcodeInput);
    }
  };

  const totalItems = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
  const totalScanned = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
  const allVerified = totalItems > 0 && totalScanned === totalItems;

  const handleConfirmPacking = async () => {
    if (!selectedOrderId) return;
    try {
      // Update item verification
      for (const item of items) {
        const scanned = scannedItems[item.id] || 0;
        await supabase
          .from('expedition_order_items')
          .update({ packed_quantity: scanned, pack_verified: scanned === item.quantity })
          .eq('id', item.id);
      }

      await supabase
        .from('expedition_orders')
        .update({ expedition_status: 'packed' })
        .eq('id', selectedOrderId);

      toast.success('Bipagem concluída!');
      setSelectedOrderId(null);
      setScannedItems({});
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  if (!selectedOrderId) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Estação de Bipagem (Packing)</h2>
        <p className="text-sm text-muted-foreground">Selecione um pedido para verificar os produtos por código de barras.</p>
        
        {filtered.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido pronto para bipagem.</CardContent></Card>
        ) : (
          <div className="grid gap-2">
            {filtered.map(order => (
              <Card
                key={order.id}
                className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary"
                onClick={() => setSelectedOrderId(order.id)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <span className="font-bold text-foreground">{order.shopify_order_name}</span>
                      <p className="text-sm text-muted-foreground">{order.customer_name}</p>
                    </div>
                  </div>
                  <Badge>{order.expedition_order_items?.length || 0} itens</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            Bipagem: {selectedOrder?.shopify_order_name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {selectedOrder?.customer_name} • {totalScanned}/{totalItems} itens verificados
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setSelectedOrderId(null); setScannedItems({}); }}>
            Voltar
          </Button>
          {allVerified && (
            <Button onClick={handleConfirmPacking} className="gap-2 bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-4 w-4" /> Confirmar
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="w-full bg-secondary rounded-full h-4">
        <div
          className={`h-4 rounded-full transition-all ${allVerified ? 'bg-green-500' : 'bg-primary'}`}
          style={{ width: `${totalItems > 0 ? (totalScanned / totalItems) * 100 : 0}%` }}
        />
      </div>

      {/* Scan Mode */}
      <div className="flex gap-2">
        <Button
          variant={scanMode === 'keyboard' ? 'default' : 'outline'}
          onClick={() => setScanMode('keyboard')}
          className="gap-2"
        >
          <Keyboard className="h-4 w-4" /> Leitor/Teclado
        </Button>
        <Button
          variant={scanMode === 'camera' ? 'default' : 'outline'}
          onClick={() => setScanMode('camera')}
          className="gap-2"
        >
          <Camera className="h-4 w-4" /> Câmera
        </Button>
      </div>

      {/* Barcode Input */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          placeholder="Bipe ou digite o código de barras..."
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="text-lg font-mono"
          autoFocus
        />
        <Button onClick={() => handleBarcodeScan(barcodeInput)}>
          <ScanBarcode className="h-5 w-5" />
        </Button>
      </div>

      {/* Items */}
      <div className="space-y-2">
        {items.map((item: any) => {
          const scanned = scannedItems[item.id] || 0;
          const isComplete = scanned === item.quantity;
          return (
            <Card key={item.id} className={isComplete ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : ''}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {isComplete ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <ScanBarcode className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className="font-medium text-foreground">{item.product_name}</span>
                    {item.variant_name && <Badge variant="outline" className="text-xs">{item.variant_name}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground ml-7">
                    SKU: {item.sku || 'N/A'} • Barcode: {item.barcode || 'N/A'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-bold ${isComplete ? 'text-green-500' : 'text-foreground'}`}>
                    {scanned}/{item.quantity}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, ScanBarcode, Camera, Keyboard, Package, ShieldCheck, AlertTriangle, Gift, ArrowRightLeft, Loader2, MapPin } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  onRefresh: () => void;
}

interface QualityChecks {
  feet_correct: boolean;
  no_defects: boolean;
  gift_verified: boolean;
}

interface TransferLog {
  itemId: string;
  sku: string;
  from: string;
  to: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
}

const SITE_STORE_ID = '2bd2c08d-321c-47ee-98a9-e27e936818ab';

export function ExpeditionPackingStation({ orders, searchTerm, onRefresh }: Props) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<'keyboard' | 'camera'>('keyboard');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedItems, setScannedItems] = useState<Record<string, number>>({});
  const [qualityChecks, setQualityChecks] = useState<QualityChecks>({ feet_correct: false, no_defects: false, gift_verified: false });
  const [transferLogs, setTransferLogs] = useState<TransferLog[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, { storeId: string; storeName: string; depositName: string; stock: number }[]>>({});
  const [transferring, setTransferring] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return ['approved', 'grouped', 'picked'].includes(o.expedition_status);
  });

  const selectedOrder = filtered.find(o => o.id === selectedOrderId);
  const items = selectedOrder?.expedition_order_items || [];
  const hasGift = selectedOrder?.has_gift || false;

  useEffect(() => {
    if (selectedOrderId && scanMode === 'keyboard') inputRef.current?.focus();
  }, [selectedOrderId, scanMode]);

  useEffect(() => {
    setQualityChecks({ feet_correct: false, no_defects: false, gift_verified: !hasGift });
  }, [selectedOrderId, hasGift]);

  // Load stock info for selected order items
  useEffect(() => {
    if (!selectedOrder) return;
    const skus = items.map((i: any) => i.sku).filter(Boolean);
    if (skus.length === 0) return;

    const fetchStock = async () => {
      // Query by both sku AND barcode since Shopify SKU may be stored as barcode in pos_products
      const [{ data: bySku }, { data: byBarcode }] = await Promise.all([
        supabase
          .from('pos_products')
          .select('sku, barcode, stock, store_id, pos_stores:store_id(name, tiny_deposit_name)')
          .in('sku', skus),
        supabase
          .from('pos_products')
          .select('sku, barcode, stock, store_id, pos_stores:store_id(name, tiny_deposit_name)')
          .in('barcode', skus),
      ]);

      const map: typeof stockMap = {};
      const addProduct = (p: any, matchedKey: string) => {
        if (!map[matchedKey]) map[matchedKey] = [];
        if (!map[matchedKey].some(l => l.storeId === p.store_id)) {
          map[matchedKey].push({
            storeId: p.store_id,
            storeName: p.pos_stores?.name || '',
            depositName: p.pos_stores?.tiny_deposit_name || '',
            stock: p.stock,
          });
        }
      };

      (bySku || []).forEach((p: any) => addProduct(p, p.sku));
      (byBarcode || []).forEach((p: any) => addProduct(p, p.barcode));

      setStockMap(map);
    };
    fetchStock();
  }, [selectedOrderId]);

  const transferStockIfNeeded = useCallback(async (item: any) => {
    const sku = item.sku;
    if (!sku) return;

    const locations = stockMap[sku];
    if (!locations) return;

    const siteLoc = locations.find(l => l.depositName === 'Site');
    const siteStock = siteLoc?.stock || 0;

    // If site has stock, no transfer needed
    if (siteStock > 0) return;

    // Find a source store with stock
    const source = locations.find(l => l.depositName !== 'Site' && l.stock > 0);
    if (!source) return;

    const logEntry: TransferLog = {
      itemId: item.id,
      sku,
      from: source.depositName,
      to: 'Site',
      status: 'pending',
    };

    setTransferLogs(prev => [...prev, logEntry]);
    setTransferring(true);

    try {
      const { data, error } = await supabase.functions.invoke('expedition-transfer-stock', {
        body: { sku, source_store_id: source.storeId, quantity: 1 },
      });

      if (error || !data?.success) {
        const errMsg = data?.error || error?.message || 'Erro desconhecido';
        setTransferLogs(prev => prev.map(l => l.itemId === item.id ? { ...l, status: 'error', message: errMsg } : l));
        toast.error(`Falha na transferência: ${errMsg}`);
      } else {
        setTransferLogs(prev => prev.map(l => l.itemId === item.id ? { ...l, status: 'success', message: `${source.depositName} → Site ✓` } : l));
        toast.success(`Estoque transferido: ${source.depositName} → Site (${item.product_name})`);

        // Update local stock map
        setStockMap(prev => {
          const updated = { ...prev };
          if (updated[sku]) {
            updated[sku] = updated[sku].map(l => {
              if (l.storeId === source.storeId) return { ...l, stock: l.stock - 1 };
              if (l.depositName === 'Site') return { ...l, stock: l.stock + 1 };
              return l;
            });
          }
          return updated;
        });
      }
    } catch (e: any) {
      setTransferLogs(prev => prev.map(l => l.itemId === item.id ? { ...l, status: 'error', message: e.message } : l));
      toast.error(`Erro na transferência: ${e.message}`);
    } finally {
      setTransferring(false);
    }
  }, [stockMap]);

  const handleBarcodeScan = useCallback(async (barcode: string) => {
    if (!selectedOrder || !barcode.trim()) return;
    const matchedItem = items.find((item: any) =>
      item.barcode === barcode.trim() || item.sku === barcode.trim()
    );
    if (matchedItem) {
      const key = matchedItem.id;
      const current = scannedItems[key] || 0;
      if (current < matchedItem.quantity) {
        setScannedItems(prev => ({ ...prev, [key]: current + 1 }));
        toast.success(`✓ ${matchedItem.product_name} (${current + 1}/${matchedItem.quantity})`);

        // Auto-transfer stock if needed
        await transferStockIfNeeded(matchedItem);
      } else {
        toast.warning(`${matchedItem.product_name} já foi totalmente bipado!`);
      }
    } else {
      toast.error(`Código não encontrado neste pedido: ${barcode}`);
    }
    setBarcodeInput('');
  }, [selectedOrder, items, scannedItems, transferStockIfNeeded]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleBarcodeScan(barcodeInput);
  };

  const totalItems = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
  const totalScanned = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
  const allScanned = totalItems > 0 && totalScanned === totalItems;
  const allChecked = qualityChecks.feet_correct && qualityChecks.no_defects && qualityChecks.gift_verified;
  const allVerified = allScanned && allChecked;

  const handleConfirmPacking = async () => {
    if (!selectedOrderId) return;
    try {
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

      toast.success('Conferência e verificação concluídas!');
      setSelectedOrderId(null);
      setScannedItems({});
      setTransferLogs([]);
      setQualityChecks({ feet_correct: false, no_defects: false, gift_verified: false });
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const getItemStockInfo = (sku: string) => {
    if (!sku) return null;
    const locations = stockMap[sku];
    if (!locations) return null;
    const siteLoc = locations.find(l => l.depositName === 'Site');
    const others = locations.filter(l => l.depositName !== 'Site' && l.stock > 0);

    if (siteLoc && siteLoc.stock > 0) {
      return <Badge variant="outline" className="text-[10px] gap-1 border-green-500 text-green-600"><MapPin className="h-3 w-3" />Site ({siteLoc.stock})</Badge>;
    }
    if (others.length > 0) {
      return (
        <div className="flex gap-1">
          {others.map(o => (
            <Badge key={o.storeId} variant="outline" className="text-[10px] gap-1 border-amber-500 text-amber-600">
              <MapPin className="h-3 w-3" />{o.depositName} ({o.stock})
            </Badge>
          ))}
        </div>
      );
    }
    return <Badge variant="destructive" className="text-[10px]">Sem estoque</Badge>;
  };

  if (!selectedOrderId) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Conferência & Verificação (Packing)</h2>
        <p className="text-sm text-muted-foreground">Selecione um pedido para bipar produtos e verificar qualidade.</p>

        {filtered.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido pronto para conferência.</CardContent></Card>
        ) : (
          <div className="grid gap-2">
            {filtered.map(order => (
              <Card key={order.id} className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary" onClick={() => setSelectedOrderId(order.id)}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground">{order.shopify_order_name}</span>
                        {order.has_gift && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600"><Gift className="h-3 w-3 mr-0.5" />Brinde</Badge>}
                      </div>
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
          <h2 className="text-lg font-bold text-foreground">Conferência: {selectedOrder?.shopify_order_name}</h2>
          <p className="text-sm text-muted-foreground">
            {selectedOrder?.customer_name} • {totalScanned}/{totalItems} itens bipados
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setSelectedOrderId(null); setScannedItems({}); setTransferLogs([]); }}>Voltar</Button>
          {allVerified && (
            <Button onClick={handleConfirmPacking} className="gap-2 bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-4 w-4" /> Confirmar
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="w-full bg-secondary rounded-full h-4">
        <div className={`h-4 rounded-full transition-all ${allVerified ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${totalItems > 0 ? (totalScanned / totalItems) * 100 : 0}%` }} />
      </div>

      {/* Scan Mode */}
      <div className="flex gap-2">
        <Button variant={scanMode === 'keyboard' ? 'default' : 'outline'} onClick={() => setScanMode('keyboard')} className="gap-2">
          <Keyboard className="h-4 w-4" /> Leitor/Teclado
        </Button>
        <Button variant={scanMode === 'camera' ? 'default' : 'outline'} onClick={() => setScanMode('camera')} className="gap-2">
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
        <Button onClick={() => handleBarcodeScan(barcodeInput)} disabled={transferring}>
          {transferring ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanBarcode className="h-5 w-5" />}
        </Button>
      </div>

      {/* Transfer Log */}
      {transferLogs.length > 0 && (
        <Card className="border-blue-500/50 bg-blue-50 dark:bg-blue-900/10">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <ArrowRightLeft className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-bold text-foreground">Transferências de Estoque</span>
            </div>
            <div className="space-y-1">
              {transferLogs.map((log, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {log.status === 'pending' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                  {log.status === 'success' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                  {log.status === 'error' && <AlertTriangle className="h-3 w-3 text-red-500" />}
                  <span className="font-mono">{log.sku}</span>
                  <span className="text-muted-foreground">{log.from} → {log.to}</span>
                  {log.message && <span className={log.status === 'error' ? 'text-red-500' : 'text-green-600'}>{log.message}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items */}
      <div className="space-y-2">
        {items.map((item: any) => {
          const scanned = scannedItems[item.id] || 0;
          const isComplete = scanned === item.quantity;
          return (
            <Card key={item.id} className={isComplete ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : ''}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isComplete ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <ScanBarcode className="h-5 w-5 text-muted-foreground" />}
                    <span className="font-medium text-foreground">{item.product_name}</span>
                    {item.variant_name && <Badge variant="outline" className="text-xs">{item.variant_name}</Badge>}
                    {getItemStockInfo(item.sku)}
                  </div>
                  <p className="text-xs text-muted-foreground ml-7">
                    SKU: {item.sku || 'N/A'} • Barcode: {item.barcode || 'N/A'}
                  </p>
                </div>
                <span className={`text-lg font-bold ${isComplete ? 'text-green-500' : 'text-foreground'}`}>
                  {scanned}/{item.quantity}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quality Verification Checklist */}
      {allScanned && (
        <Card className="border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-900/10">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-amber-600" />
              <h3 className="font-bold text-foreground">Verificação de Qualidade</h3>
            </div>
            <p className="text-sm text-muted-foreground">Confirme os itens abaixo antes de finalizar a conferência:</p>

            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <Checkbox checked={qualityChecks.feet_correct} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, feet_correct: !!v }))} />
                <div>
                  <span className="text-sm font-medium text-foreground">Pés corretos</span>
                  <p className="text-xs text-muted-foreground">Verificar se o calçado está com os pés esquerdo e direito corretos</p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <Checkbox checked={qualityChecks.no_defects} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, no_defects: !!v }))} />
                <div>
                  <span className="text-sm font-medium text-foreground">Sem defeitos de fabricação</span>
                  <p className="text-xs text-muted-foreground">Verificar se não há defeitos visíveis no produto (costuras, colagem, acabamento)</p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <Checkbox checked={qualityChecks.gift_verified} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, gift_verified: !!v }))} />
                <div className="flex items-center gap-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">{hasGift ? 'Brinde incluído no pedido' : 'Sem brinde neste pedido'}</span>
                    <p className="text-xs text-muted-foreground">{hasGift ? 'Confirmar que o brinde foi adicionado à embalagem' : 'Confirmar que este pedido não possui brinde'}</p>
                  </div>
                  {hasGift && <Gift className="h-4 w-4 text-amber-600" />}
                </div>
              </label>
            </div>

            {!allChecked && (
              <div className="flex items-center gap-2 text-xs text-amber-600 pt-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Marque todas as verificações para liberar a confirmação</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

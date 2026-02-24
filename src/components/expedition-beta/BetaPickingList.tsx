import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, Loader2, ScanBarcode, Camera, X, Search, Hand, Package, RefreshCw } from 'lucide-react';
import { ExpeditionBarcodeScanner } from '@/components/expedition/ExpeditionBarcodeScanner';

interface Props {
  orders: any[];
  searchTerm: string;
  showChecking: boolean;
  onRefresh: () => void;
}

interface ItemEntry {
  name: string;
  variant: string;
  sku: string;
  totalQty: number;
  pickedQty: number;
  orders: string[];
  barcodes: string[];
  lineItems: Array<{
    id: string; orderId: string; orderName: string;
    quantity: number; pickedQty: number; pickVerified: boolean;
  }>;
}

interface StockInfo {
  storeName: string;
  depositName: string;
  storeId: string;
  stock: number;
  reserved: number;
}

export function BetaPickingList({ orders, searchTerm, showChecking, onRefresh }: Props) {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<{
    key: string; name: string; variant: string; sku: string;
    itemId: string; orderName: string; isRecheck: boolean; isManual: boolean;
  } | null>(null);
  const [qualityChecks, setQualityChecks] = useState({ feet_correct: false, no_defects: false });
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [savingConfirm, setSavingConfirm] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [stockData, setStockData] = useState<Record<string, StockInfo[]>>({});
  const [loadingStock, setLoadingStock] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const localUpdatedIdsRef = useRef<Set<string>>(new Set());

  const allItems = new Map<string, ItemEntry>();

  const relevantOrders = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return true;
  });

  relevantOrders.forEach(order => {
    (order.expedition_beta_order_items || []).forEach((item: any) => {
      const key = item.sku || `${item.product_name}-${item.variant_name || ''}`;
      if (!allItems.has(key)) {
        allItems.set(key, { name: item.product_name, variant: item.variant_name || '', sku: item.sku || '', totalQty: 0, pickedQty: 0, orders: [], barcodes: [], lineItems: [] });
      }
      const entry = allItems.get(key)!;
      entry.totalQty += item.quantity;
      entry.pickedQty += (item.picked_quantity || 0);
      entry.orders.push(order.shopify_order_name || '');
      if (item.barcode && !entry.barcodes.includes(item.barcode)) entry.barcodes.push(item.barcode);
      entry.lineItems.push({
        id: item.id, orderId: order.id, orderName: order.shopify_order_name,
        quantity: item.quantity, pickedQty: item.picked_quantity || 0, pickVerified: !!item.pick_verified,
      });
    });
  });

  const sortedItems = Array.from(allItems.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const displayItems = showChecking
    ? [...sortedItems].sort((a, b) => {
        const aOk = a[1].pickedQty >= a[1].totalQty;
        const bOk = b[1].pickedQty >= b[1].totalQty;
        if (aOk && !bOk) return 1;
        if (!aOk && bOk) return -1;
        return 0;
      })
    : sortedItems;

  // Load stock on mount for all unique SKUs
  const loadStock = useCallback(async () => {
    const skus = sortedItems
      .map(([, item]) => item.sku)
      .filter(s => s && s.length > 0);
    
    if (skus.length === 0) return;

    setLoadingStock(true);
    try {
      // Call in batches of 15
      const allStock: Record<string, StockInfo[]> = {};
      for (let i = 0; i < skus.length; i += 15) {
        const batch = skus.slice(i, i + 15);
        const { data, error } = await supabase.functions.invoke('expedition-check-stock', {
          body: { skus: batch }
        });
        if (data?.stock) {
          Object.assign(allStock, data.stock);
        }
        if (error) console.error('Stock check error:', error);
      }
      setStockData(allStock);
    } catch (err) {
      console.error('Failed to load stock:', err);
    } finally {
      setLoadingStock(false);
    }
  }, [sortedItems.length]);

  useEffect(() => {
    if (sortedItems.length > 0 && Object.keys(stockData).length === 0) {
      loadStock();
    }
  }, [sortedItems.length]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('beta-items-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'expedition_beta_order_items' }, (payload: any) => {
        const id = payload.new?.id;
        if (id && localUpdatedIdsRef.current.has(id)) { localUpdatedIdsRef.current.delete(id); return; }
        onRefresh();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [onRefresh]);

  const handleBarcodeScan = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    const matched = sortedItems.find(([key, item]) =>
      item.sku === trimmed || item.barcodes.includes(trimmed)
    );

    if (!matched) {
      toast.error(`Produto não encontrado: ${trimmed}`);
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return;
    }

    const [key, item] = matched;
    const pendingLine = item.lineItems.find(li => li.pickedQty < li.quantity);

    if (!pendingLine) {
      toast.warning(`${item.name} já foi totalmente conferido!`);
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return;
    }

    setPendingConfirm({ key, name: item.name, variant: item.variant, sku: item.sku, itemId: pendingLine.id, orderName: pendingLine.orderName, isRecheck: false, isManual: false });
    setQualityChecks({ feet_correct: false, no_defects: false });
    setBarcodeInput('');
  }, [sortedItems]);

  const handleConfirmQuality = async () => {
    if (!pendingConfirm) return;
    setSavingConfirm(true);
    try {
      const { data: currentDbItem } = await supabase
        .from('expedition_beta_order_items')
        .select('picked_quantity, quantity')
        .eq('id', pendingConfirm.itemId)
        .single();

      const currentPicked = currentDbItem?.picked_quantity || 0;
      const maxQty = currentDbItem?.quantity || 1;
      const newPickedQty = Math.min(currentPicked + 1, maxQty);

      localUpdatedIdsRef.current.add(pendingConfirm.itemId);

      const { error } = await supabase
        .from('expedition_beta_order_items')
        .update({ picked_quantity: newPickedQty, pick_verified: newPickedQty >= maxQty })
        .eq('id', pendingConfirm.itemId);

      if (error) { localUpdatedIdsRef.current.delete(pendingConfirm.itemId); throw error; }

      const item = allItems.get(pendingConfirm.key);
      toast.success(`✓ ${item?.name} conferido (${(item?.pickedQty || 0) + 1}/${item?.totalQty})`);
      setPendingConfirm(null);
      onRefresh();
      setTimeout(() => barcodeRef.current?.focus(), 100);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSavingConfirm(false);
    }
  };

  const handleManualConfirm = useCallback((key: string) => {
    const item = allItems.get(key);
    if (!item) return;
    const pendingLine = item.lineItems.find(li => li.pickedQty < li.quantity);
    if (!pendingLine) { toast.warning(`${item.name} já conferido!`); return; }
    setPendingConfirm({ key, name: item.name, variant: item.variant, sku: item.sku, itemId: pendingLine.id, orderName: pendingLine.orderName, isRecheck: false, isManual: true });
    setQualityChecks({ feet_correct: false, no_defects: false });
    setShowProductSearch(false);
  }, [allItems]);

  const totalItems = sortedItems.reduce((sum, [, item]) => sum + item.totalQty, 0);
  const totalPicked = sortedItems.reduce((sum, [, item]) => sum + item.pickedQty, 0);

  const filteredSearchItems = productSearchQuery
    ? sortedItems.filter(([, item]) =>
        item.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
        item.sku.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
        item.variant.toLowerCase().includes(productSearchQuery.toLowerCase())
      )
    : sortedItems;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">
          {showChecking ? 'Conferência' : 'Lista de Separação'}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadStock} disabled={loadingStock} className="gap-1 text-xs">
            {loadingStock ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Estoque
          </Button>
          <Badge variant="outline" className="text-sm">{totalPicked}/{totalItems} conferidos</Badge>
        </div>
      </div>

      {showChecking && (
        <>
          {/* Barcode input */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center gap-2 mb-2">
                <ScanBarcode className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold text-foreground">Bipar produto para conferência</span>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setShowCameraScanner(!showCameraScanner)}>
                    {showCameraScanner ? <X className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowProductSearch(!showProductSearch)}>
                    <Hand className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {showCameraScanner ? (
                <ExpeditionBarcodeScanner onScan={handleBarcodeScan} onClose={() => setShowCameraScanner(false)} />
              ) : (
                <Input
                  ref={barcodeRef}
                  placeholder="Bipe ou digite o código..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBarcodeScan(barcodeInput)}
                  className="text-lg font-mono"
                  autoFocus
                />
              )}
            </CardContent>
          </Card>

          {/* Manual search */}
          {showProductSearch && (
            <Card>
              <CardContent className="p-3">
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar produto..." value={productSearchQuery} onChange={e => setProductSearchQuery(e.target.value)} className="pl-10" autoFocus />
                </div>
                <div className="max-h-[200px] overflow-y-auto space-y-1">
                  {filteredSearchItems.map(([key, item]) => (
                    <button key={key} className="w-full text-left p-2 rounded hover:bg-secondary/50 text-sm" onClick={() => handleManualConfirm(key)}>
                      <span className="font-medium">{item.name}</span>
                      {item.variant && <span className="text-muted-foreground ml-1">({item.variant})</span>}
                      <span className="text-muted-foreground ml-2">{item.pickedQty}/{item.totalQty}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quality confirmation dialog */}
          {pendingConfirm && (
            <Card className="border-2 border-primary bg-primary/5">
              <CardContent className="p-4">
                <h3 className="font-bold text-lg mb-2">{pendingConfirm.name}</h3>
                {pendingConfirm.variant && <p className="text-sm text-muted-foreground mb-3">Variante: {pendingConfirm.variant}</p>}
                <p className="text-xs text-muted-foreground mb-3">Pedido: {pendingConfirm.orderName}</p>
                <div className="space-y-2 mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={qualityChecks.feet_correct} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, feet_correct: !!v }))} />
                    <span className="text-sm">Pés corretos (par)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={qualityChecks.no_defects} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, no_defects: !!v }))} />
                    <span className="text-sm">Sem defeitos</span>
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleConfirmQuality} disabled={!qualityChecks.feet_correct || !qualityChecks.no_defects || savingConfirm} className="gap-2 flex-1">
                    {savingConfirm ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirmar
                  </Button>
                  <Button variant="outline" onClick={() => { setPendingConfirm(null); setTimeout(() => barcodeRef.current?.focus(), 100); }}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Items list */}
      <div className="space-y-1">
        {displayItems.map(([key, item]) => {
          const isComplete = item.pickedQty >= item.totalQty;
          const stores = stockData[item.sku] || [];
          return (
            <div key={key} className={`p-2.5 rounded-lg border transition-colors ${
              isComplete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-background border-border/50'
            }`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isComplete && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                    <span className={`font-medium text-sm ${isComplete ? 'line-through text-muted-foreground' : ''}`}>{item.name}</span>
                    {item.variant && <span className="text-xs text-muted-foreground">({item.variant})</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {item.sku && <span className="font-mono mr-2">[{item.sku}]</span>}
                    Pedidos: {item.orders.join(', ')}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {showChecking && (
                    <Badge variant={isComplete ? 'default' : 'secondary'} className="text-xs">
                      {item.pickedQty}/{item.totalQty}
                    </Badge>
                  )}
                  {!showChecking && (
                    <Badge variant="secondary" className="text-xs font-bold">{item.totalQty}×</Badge>
                  )}
                </div>
              </div>
              
              {/* Stock per store */}
              {stores.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5 ml-6">
                  {stores.map((s, i) => {
                    const hasStock = s.stock > 0;
                    return (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          hasStock
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        <Package className="h-2.5 w-2.5" />
                        {s.depositName || s.storeName}: {s.stock}
                      </span>
                    );
                  })}
                </div>
              )}
              {loadingStock && stores.length === 0 && item.sku && (
                <div className="ml-6 mt-1">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" /> Consultando estoque...
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

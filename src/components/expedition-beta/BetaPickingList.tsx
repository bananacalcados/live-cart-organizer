import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, Loader2, ScanBarcode, Camera, X, Search, Hand, Package, RefreshCw, Store, MapPin, Wrench, Printer } from 'lucide-react';
import { ExpeditionBarcodeScanner } from '@/components/expedition/ExpeditionBarcodeScanner';
import { StockCheckRequestDialog } from '@/components/expedition/StockCheckRequestDialog';
import { StockCorrectionDialog } from '@/components/expedition-beta/StockCorrectionDialog';

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
  const [shippingFilter, setShippingFilter] = useState<string>('all');
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

  // Extract unique shipping methods for filter
  const shippingMethods = Array.from(new Set(
    orders.map(o => o.shipping_method).filter(Boolean)
  )).sort();

  const relevantOrders = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    if (shippingFilter === 'priority') {
      const m = (o.shipping_method || '').toUpperCase();
      if (!m.includes('SEDEX') && !m.includes('MOTOTAXISTA')) return false;
    } else if (shippingFilter === 'no_method') {
      if (o.shipping_method) return false;
    } else if (shippingFilter !== 'all') {
      if (o.shipping_method !== shippingFilter) return false;
    }
    return true;
  }).sort((a, b) => {
    const getPriority = (o: any) => {
      const m = (o.shipping_method || '').toUpperCase();
      if (m.includes('SEDEX') || m.includes('MOTOTAXISTA')) return 0;
      if (m.includes('PAC')) return 2;
      return 1;
    };
    return getPriority(a) - getPriority(b);
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

  // Stock check request dialog state
  const [stockCheckRequest, setStockCheckRequest] = useState<{ sku: string; name: string; variant: string; qty: number; orderNames: string[]; orderIds: string[] } | null>(null);
  const [stockCorrection, setStockCorrection] = useState<{ sku: string; name: string; variant: string; stores: StockInfo[] } | null>(null);

  // Stable SKU list for dependencies
  const skuList = sortedItems.map(([, item]) => item.sku).filter(s => s && s.length > 0);
  const skuKey = skuList.join(',');

  // Load stock from local pos_products cache in batches to avoid URL length limits
  const loadStock = useCallback(async () => {
    if (skuList.length === 0) return;

    setLoadingStock(true);
    try {
      const BATCH_SIZE = 30; // Keep URLs short
      const allStock: Record<string, StockInfo[]> = {};

      const addProduct = (p: any, matchedKey: string) => {
        const storeName = p.pos_stores?.name || 'Desconhecida';
        const depositName = p.pos_stores?.tiny_deposit_name || '';
        if (!allStock[matchedKey]) allStock[matchedKey] = [];
        if (!allStock[matchedKey].some((l: StockInfo) => l.storeId === p.store_id)) {
          allStock[matchedKey].push({ storeName, depositName, storeId: p.store_id, stock: p.stock, reserved: 0 });
        }
      };

      // Process all batches in parallel
      const batchPromises: Promise<void>[] = [];
      for (let i = 0; i < skuList.length; i += BATCH_SIZE) {
        const batch = skuList.slice(i, i + BATCH_SIZE);
        batchPromises.push(
          Promise.all([
            supabase
              .from('pos_products')
              .select('sku, barcode, stock, store_id, pos_stores:store_id(name, tiny_deposit_name)')
              .in('sku', batch),
            supabase
              .from('pos_products')
              .select('sku, barcode, stock, store_id, pos_stores:store_id(name, tiny_deposit_name)')
              .in('barcode', batch),
          ]).then(([{ data: bySku }, { data: byBarcode }]) => {
            (bySku || []).forEach((p: any) => addProduct(p, p.sku));
            (byBarcode || []).forEach((p: any) => addProduct(p, p.barcode));
          })
        );
      }

      await Promise.all(batchPromises);
      setStockData(allStock);
    } catch (err) {
      console.error('Failed to load stock:', err);
    } finally {
      setLoadingStock(false);
    }
  }, [skuKey]);

  // Refresh stock from Tiny API (manual, slower but real-time)
  const handleRefreshStockFromTiny = useCallback(async () => {
    if (skuList.length === 0) return;

    setLoadingStock(true);
    toast.info('Buscando estoque em tempo real do Tiny ERP...');
    try {
      const allStock: Record<string, StockInfo[]> = {};
      for (let i = 0; i < skuList.length; i += 10) {
        const batch = skuList.slice(i, i + 10);
        const { data, error } = await supabase.functions.invoke('expedition-check-stock', {
          body: { skus: batch }
        });
        if (data?.stock) {
          Object.assign(allStock, data.stock);
        }
        if (error) console.error('Stock check error:', error);
      }
      setStockData(prev => ({ ...prev, ...allStock }));
      toast.success('Estoque atualizado em tempo real!');
    } catch (err: any) {
      console.error('Failed to refresh stock:', err);
      toast.error(`Erro ao atualizar: ${err.message}`);
    } finally {
      setLoadingStock(false);
    }
  }, [skuKey]);

  // Auto-load stock when SKUs change
  useEffect(() => {
    if (skuList.length > 0) {
      loadStock();
    }
  }, [skuKey]);

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

  const handlePrintPickingList = useCallback(() => {
    const pendingItems = sortedItems.filter(([, item]) => item.pickedQty < item.totalQty);
    const itemsToPrint = pendingItems.length > 0 ? pendingItems : sortedItems;
    const isPendingOnly = pendingItems.length > 0 && pendingItems.length < sortedItems.length;

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const rows = itemsToPrint.map(([, item], i) => {
      const stockStr = (stockData[item.sku] || []).map(s => `${s.depositName || s.storeName}: ${s.stock}`).join(' | ');
      return `<tr>
        <td style="padding:4px 8px;border:1px solid #ccc;text-align:center">${i + 1}</td>
        <td style="padding:4px 8px;border:1px solid #ccc">${item.name}${item.variant ? ` (${item.variant})` : ''}</td>
        <td style="padding:4px 8px;border:1px solid #ccc;font-family:monospace">${item.sku || '-'}</td>
        <td style="padding:4px 8px;border:1px solid #ccc;text-align:center;font-weight:bold">${item.totalQty - item.pickedQty}</td>
        <td style="padding:4px 8px;border:1px solid #ccc;text-align:center">${item.totalQty}</td>
        <td style="padding:4px 8px;border:1px solid #ccc;font-size:10px">${item.orders.join(', ')}</td>
        <td style="padding:4px 8px;border:1px solid #ccc;font-size:10px">${stockStr || '-'}</td>
        <td style="padding:4px 8px;border:1px solid #ccc;width:60px"></td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>Lista de Separação</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}
      table{border-collapse:collapse;width:100%}
      th{background:#f0f0f0;padding:6px 8px;border:1px solid #ccc;text-align:left;font-size:11px}
      @media print{body{margin:10px}}</style></head><body>
      <h2 style="margin:0 0 4px">Lista de Separação${isPendingOnly ? ' (Pendentes)' : ''}</h2>
      <p style="margin:0 0 12px;color:#666">${dateStr} — ${itemsToPrint.length} itens, ${itemsToPrint.reduce((s,[,it]) => s + (it.totalQty - it.pickedQty), 0)} unidades pendentes</p>
      <table><thead><tr>
        <th>#</th><th>Produto</th><th>SKU</th><th>Pendente</th><th>Total</th><th>Pedidos</th><th>Estoque</th><th>✓</th>
      </tr></thead><tbody>${rows}</tbody></table></body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }, [sortedItems, stockData]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">
          {showChecking ? 'Conferência' : 'Lista de Separação'}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrintPickingList} className="gap-1 text-xs">
            <Printer className="h-3 w-3" />
            <span className="hidden sm:inline">Imprimir</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={loadStock} disabled={loadingStock} className="gap-1 text-xs">
            {loadingStock ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Estoque
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRefreshStockFromTiny} disabled={loadingStock} className="gap-1 text-xs text-purple-600 dark:text-purple-400">
            <RefreshCw className="h-3 w-3" />
            Tiny
          </Button>
          <Badge variant="outline" className="text-sm">{totalPicked}/{totalItems} conferidos</Badge>
        </div>
      </div>

      {/* Shipping filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => setShippingFilter('all')}
          className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            shippingFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          Todos
        </button>
        <button
          onClick={() => setShippingFilter('priority')}
          className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            shippingFilter === 'priority' ? 'bg-destructive text-destructive-foreground' : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
          }`}
        >
          🚀 Rápidos (SEDEX / Moto)
        </button>
        {shippingMethods.map(method => (
          <button
            key={method}
            onClick={() => setShippingFilter(method)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              shippingFilter === method ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {method}
          </button>
        ))}
        <button
          onClick={() => setShippingFilter('no_method')}
          className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            shippingFilter === 'no_method' ? 'bg-muted-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Sem info
        </button>
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
                  {!isComplete && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setStockCorrection({
                          sku: item.sku || key,
                          name: item.name,
                          variant: item.variant,
                          stores,
                        })}
                        className="gap-1 text-[10px] h-7 px-2 border-orange-400/50 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                        title="Corrigir estoque (Balanço)"
                      >
                        <Wrench className="h-3 w-3" />
                        <span className="hidden sm:inline">Corrigir</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setStockCheckRequest({
                          sku: item.sku || key,
                          name: item.name,
                          variant: item.variant,
                          qty: item.totalQty - item.pickedQty,
                          orderNames: item.lineItems.map(li => li.orderName).filter(Boolean),
                          orderIds: item.lineItems.map(li => li.orderId),
                        })}
                        className="gap-1 text-[10px] h-7 px-2 border-purple-400/50 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                        title="Solicitar produto à loja física"
                      >
                        <Store className="h-3 w-3" />
                        <span className="hidden sm:inline">Pedir Loja</span>
                      </Button>
                    </>
                  )}
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

      {/* Stock check request dialog */}
      {stockCheckRequest && (
        <StockCheckRequestDialog
          open={!!stockCheckRequest}
          onClose={() => setStockCheckRequest(null)}
          sku={stockCheckRequest.sku}
          productName={stockCheckRequest.name}
          variantName={stockCheckRequest.variant}
          quantityNeeded={stockCheckRequest.qty}
          orderNames={stockCheckRequest.orderNames}
          expeditionOrderIds={stockCheckRequest.orderIds}
        />
      )}
      {/* Stock correction dialog */}
      {stockCorrection && (
        <StockCorrectionDialog
          open={!!stockCorrection}
          onClose={() => setStockCorrection(null)}
          sku={stockCorrection.sku}
          productName={stockCorrection.name}
          variantName={stockCorrection.variant}
          stockData={stockCorrection.stores}
          onCorrected={loadStock}
        />
      )}
    </div>
  );
}

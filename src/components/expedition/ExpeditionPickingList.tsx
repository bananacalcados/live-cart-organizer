import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, XCircle, Printer, MapPin, Loader2, RefreshCw, ScanBarcode, Clock, ShieldCheck } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  showChecking: boolean;
  onRefresh: () => void;
}

interface StockLocation {
  storeName: string;
  depositName: string;
  storeId: string;
  stock: number;
}

interface PendingConfirm {
  key: string;
  name: string;
  variant: string;
  sku: string;
}

export function ExpeditionPickingList({ orders, searchTerm, showChecking, onRefresh }: Props) {
  const [checkedItems, setCheckedItems] = useState<Record<string, number>>({});
  const [stockLocations, setStockLocations] = useState<Record<string, StockLocation[]>>({});
  const [loadingStock, setLoadingStock] = useState(false);
  const [refreshingStock, setRefreshingStock] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [qualityChecks, setQualityChecks] = useState({ feet_correct: false, no_defects: false });
  const barcodeRef = useRef<HTMLInputElement>(null);

  const allItems = new Map<string, { name: string; variant: string; sku: string; totalQty: number; orders: string[]; barcodes: string[] }>();

  const relevantOrders = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return true;
  });

  relevantOrders.forEach(order => {
    (order.expedition_order_items || []).forEach((item: any) => {
      const key = item.sku || `${item.product_name}-${item.variant_name || ''}`;
      if (!allItems.has(key)) {
        allItems.set(key, { name: item.product_name, variant: item.variant_name || '', sku: item.sku || '', totalQty: 0, orders: [], barcodes: [] });
      }
      const entry = allItems.get(key)!;
      entry.totalQty += item.quantity;
      entry.orders.push(order.shopify_order_name);
      if (item.barcode && !entry.barcodes.includes(item.barcode)) entry.barcodes.push(item.barcode);
    });
  });

  const sortedItems = Array.from(allItems.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));

  // In checking mode, sort: unchecked first, then checked
  const displayItems = showChecking
    ? [...sortedItems].sort((a, b) => {
        const aChecked = (checkedItems[a[0]] || 0) >= a[1].totalQty;
        const bChecked = (checkedItems[b[0]] || 0) >= b[1].totalQty;
        if (aChecked && !bChecked) return 1;
        if (!aChecked && bChecked) return -1;
        return 0;
      })
    : sortedItems;

  // Load stock locations for all SKUs
  useEffect(() => {
    const skus = sortedItems.map(([, item]) => item.sku).filter(Boolean);
    if (skus.length === 0) return;

    const fetchStockLocations = async () => {
      setLoadingStock(true);
      try {
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

        const locations: Record<string, StockLocation[]> = {};
        const addProduct = (p: any, matchedKey: string) => {
          const storeName = p.pos_stores?.name || 'Desconhecida';
          const depositName = p.pos_stores?.tiny_deposit_name || '';
          if (!locations[matchedKey]) locations[matchedKey] = [];
          if (!locations[matchedKey].some(l => l.storeId === p.store_id)) {
            locations[matchedKey].push({ storeName, depositName, storeId: p.store_id, stock: p.stock });
          }
        };

        (bySku || []).forEach((p: any) => addProduct(p, p.sku));
        (byBarcode || []).forEach((p: any) => addProduct(p, p.barcode));

        setStockLocations(locations);
      } catch (e) {
        console.error('Error fetching stock locations:', e);
      } finally {
        setLoadingStock(false);
      }
    };

    fetchStockLocations();
  }, [orders, searchTerm]);

  const handleRefreshStock = async () => {
    const skus = sortedItems.map(([, item]) => item.sku).filter(Boolean);
    if (skus.length === 0) return;
    
    setRefreshingStock(true);
    toast.info('Buscando estoque em tempo real do Tiny ERP...');
    
    try {
      const allResults: Record<string, StockLocation[]> = { ...stockLocations };
      
      for (let i = 0; i < skus.length; i += 10) {
        const batch = skus.slice(i, i + 10);
        const { data, error } = await supabase.functions.invoke('expedition-check-stock', {
          body: { skus: batch },
        });
        
        if (error) throw error;
        if (data?.stock) {
          Object.entries(data.stock).forEach(([sku, locs]: [string, any]) => {
            allResults[sku] = locs.map((l: any) => ({
              storeName: l.storeName,
              depositName: l.depositName,
              storeId: l.storeId,
              stock: l.stock,
            }));
          });
        }
      }
      
      setStockLocations(allResults);
      toast.success('Estoque atualizado em tempo real!');
    } catch (e: any) {
      console.error('Error refreshing stock:', e);
      toast.error(`Erro ao atualizar: ${e.message}`);
    } finally {
      setRefreshingStock(false);
    }
  };

  // Barcode scan handler for checking mode
  const handleBarcodeScan = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    // Find item by SKU or barcode
    const matched = sortedItems.find(([, item]) =>
      item.sku === trimmed || item.barcodes.includes(trimmed)
    );

    if (!matched) {
      toast.error(`Produto não encontrado: ${trimmed}`);
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return;
    }

    const [key, item] = matched;
    const current = checkedItems[key] || 0;

    if (current >= item.totalQty) {
      toast.warning(`${item.name} já foi totalmente conferido!`);
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return;
    }

    // Show quality confirmation
    setPendingConfirm({ key, name: item.name, variant: item.variant, sku: item.sku });
    setQualityChecks({ feet_correct: false, no_defects: false });
    setBarcodeInput('');
  }, [sortedItems, checkedItems]);

  const handleConfirmQuality = () => {
    if (!pendingConfirm) return;
    const { key } = pendingConfirm;
    const item = allItems.get(key);
    if (!item) return;

    const current = checkedItems[key] || 0;
    setCheckedItems(prev => ({ ...prev, [key]: Math.min(current + 1, item.totalQty) }));
    toast.success(`✓ ${item.name} conferido (${current + 1}/${item.totalQty})`);
    setPendingConfirm(null);
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const handleCancelConfirm = () => {
    setPendingConfirm(null);
    setTimeout(() => barcodeRef.current?.focus(), 100);
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

  const getStockBadge = (sku: string) => {
    if (!sku || loadingStock) return null;
    const locs = stockLocations[sku];
    if (!locs || locs.length === 0) {
      return <Badge variant="destructive" className="text-[10px] gap-1"><MapPin className="h-3 w-3" />Sem cadastro</Badge>;
    }

    const siteLoc = locs.find(l => l.depositName === 'Site');
    const otherLocs = locs.filter(l => l.depositName !== 'Site');

    return (
      <div className="flex gap-1 flex-wrap">
        {siteLoc && (
          <Badge variant="outline" className={`text-[10px] gap-1 ${siteLoc.stock > 0 ? 'border-green-500 text-green-600' : 'border-red-400 text-red-500'}`}>
            <MapPin className="h-3 w-3" />Site ({siteLoc.stock})
          </Badge>
        )}
        {otherLocs.map(loc => (
          <Badge key={loc.storeId} variant="outline" className={`text-[10px] gap-1 ${loc.stock > 0 ? 'border-amber-500 text-amber-600' : 'border-muted text-muted-foreground'}`}>
            <MapPin className="h-3 w-3" />{loc.depositName} ({loc.stock})
          </Badge>
        ))}
      </div>
    );
  };

  const getItemStatus = (key: string, totalQty: number) => {
    const checked = checkedItems[key] || 0;
    if (checked >= totalQty) return 'confirmed';
    return 'waiting'; // not yet scanned = waiting for stock
  };

  const handlePrint = () => {
    const rows = sortedItems.map(([, item], i) => {
      const locs = stockLocations[item.sku];
      const locText = locs?.map(l => `${l.depositName}(${l.stock})`).join(', ') || '—';
      return `<tr>
        <td style="text-align:center;font-weight:bold;color:#333;">${i + 1}</td>
        <td style="font-weight:600;">${item.name}${item.variant ? ` <span style="color:#e67e22;font-weight:500;">(${item.variant})</span>` : ''}</td>
        <td style="font-family:monospace;color:#666;font-size:12px;">${item.sku || '—'}</td>
        <td style="font-size:11px;color:#555;">${locText}</td>
        <td style="text-align:center;font-size:18px;font-weight:bold;color:#1a1a1a;background:#fff8e1;border-radius:4px;">${item.totalQty}</td>
        <td style="text-align:center;width:60px;">☐</td>
      </tr>`;
    }).join('');

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
  .footer { margin-top: 20px; padding: 12px 0; border-top: 2px solid #1a1a1a; display: flex; justify-content: space-between; font-size: 13px; color: #666; }
  .footer .total { font-size: 16px; font-weight: bold; color: #1a1a1a; }
  @media print { body { padding: 0; } .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
  <div><h1>📦 LISTA DE SEPARAÇÃO</h1></div>
  <div class="meta">Data: ${new Date().toLocaleDateString('pt-BR')}<br><strong>${sortedItems.length} produtos • ${totalProducts} unidades</strong></div>
</div>
<table>
  <thead><tr><th style="width:40px;text-align:center">#</th><th>Produto</th><th style="width:100px">SKU</th><th style="width:120px">Estoque</th><th style="width:50px;text-align:center">Qtd</th><th style="width:50px;text-align:center">✓</th></tr></thead>
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
            {showChecking ? 'Conferência por Bipagem' : 'Lista de Separação (Picking)'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {sortedItems.length} produtos únicos • {totalProducts} unidades totais
            {showChecking && ` • ${totalChecked}/${totalProducts} conferidos`}
            {loadingStock && ' • Carregando estoques...'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefreshStock} disabled={refreshingStock} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${refreshingStock ? 'animate-spin' : ''}`} /> {refreshingStock ? 'Atualizando...' : 'Atualizar Estoque'}
          </Button>
          <Button variant="outline" onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
          {showChecking && totalChecked === totalProducts && totalProducts > 0 && (
            <Button onClick={handleMarkPickingComplete} className="gap-2">
              <CheckCircle2 className="h-4 w-4" /> Confirmar Separação
            </Button>
          )}
        </div>
      </div>

      {/* Barcode scanner for checking mode */}
      {showChecking && (
        <>
          <div className="w-full bg-secondary rounded-full h-3">
            <div
              className="bg-primary h-3 rounded-full transition-all"
              style={{ width: `${totalProducts > 0 ? (totalChecked / totalProducts) * 100 : 0}%` }}
            />
          </div>

          <div className="flex gap-2">
            <Input
              ref={barcodeRef}
              placeholder="Bipe o código de barras ou SKU do produto..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBarcodeScan(barcodeInput); }}
              className="text-lg font-mono"
              autoFocus
              disabled={!!pendingConfirm}
            />
            <Button onClick={() => handleBarcodeScan(barcodeInput)} disabled={!!pendingConfirm}>
              <ScanBarcode className="h-5 w-5" />
            </Button>
          </div>

          {/* Quality confirmation dialog */}
          {pendingConfirm && (
            <Card className="border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/10 animate-in fade-in slide-in-from-top-2">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-amber-600" />
                  <h3 className="font-bold text-foreground">Verificação de Qualidade</h3>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <p className="font-medium text-foreground">{pendingConfirm.name}</p>
                  {pendingConfirm.variant && <p className="text-sm text-muted-foreground">{pendingConfirm.variant}</p>}
                  <p className="text-xs text-muted-foreground font-mono">SKU: {pendingConfirm.sku}</p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                    <Checkbox checked={qualityChecks.feet_correct} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, feet_correct: !!v }))} />
                    <div>
                      <span className="text-sm font-medium text-foreground">Pés corretos</span>
                      <p className="text-xs text-muted-foreground">Esquerdo e direito conferidos</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                    <Checkbox checked={qualityChecks.no_defects} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, no_defects: !!v }))} />
                    <div>
                      <span className="text-sm font-medium text-foreground">Sem defeitos</span>
                      <p className="text-xs text-muted-foreground">Sem defeitos visíveis (costuras, colagem, acabamento)</p>
                    </div>
                  </label>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleConfirmQuality}
                    disabled={!qualityChecks.feet_correct || !qualityChecks.no_defects}
                    className="flex-1 gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Confirmar Produto
                  </Button>
                  <Button variant="outline" onClick={handleCancelConfirm}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="space-y-2">
        {displayItems.map(([key, item]) => {
          const status = showChecking ? getItemStatus(key, item.totalQty) : null;
          const checked = checkedItems[key] || 0;
          const isFullyChecked = checked >= item.totalQty;

          return (
            <Card key={key} className={isFullyChecked && showChecking ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : ''}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {showChecking && (
                      isFullyChecked
                        ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                        : <Clock className="h-5 w-5 text-amber-500 shrink-0" />
                    )}
                    <span className="font-medium text-foreground">{item.name}</span>
                    {item.variant && <Badge variant="outline" className="text-xs">{item.variant}</Badge>}
                    {showChecking && !isFullyChecked && (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-[10px]">
                        Aguardando
                      </Badge>
                    )}
                    {getStockBadge(item.sku)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    SKU: {item.sku || 'N/A'} • Pedidos: {item.orders.join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {showChecking ? (
                    <span className={`text-lg font-bold ${isFullyChecked ? 'text-green-500' : 'text-foreground'}`}>
                      {checked}/{item.totalQty}
                    </span>
                  ) : (
                    <Badge className="text-base px-3 py-1">x{item.totalQty}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

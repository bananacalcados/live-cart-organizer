import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, XCircle, Printer, MapPin, Loader2, RefreshCw, ScanBarcode, Clock, ShieldCheck, Camera, X, Users, Search, AlertTriangle, Hand } from 'lucide-react';
import { ExpeditionBarcodeScanner } from '@/components/expedition/ExpeditionBarcodeScanner';

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
  itemId: string;
  orderName: string;
  tinyOrderId: string | null;
  isRecheck: boolean;
  isManualOverride: boolean;
}

export function ExpeditionPickingList({ orders, searchTerm, showChecking, onRefresh }: Props) {
  const [stockLocations, setStockLocations] = useState<Record<string, StockLocation[]>>({});
  const [loadingStock, setLoadingStock] = useState(false);
  const [refreshingStock, setRefreshingStock] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [qualityChecks, setQualityChecks] = useState({ feet_correct: false, no_defects: false });
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [savingConfirm, setSavingConfirm] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  // Map of item key -> extra GTINs/barcodes from pos_products (enrichment)
  const [enrichedBarcodes, setEnrichedBarcodes] = useState<Record<string, string[]>>({});
  // Reverse map: scanned GTIN -> item key (for products whose Shopify SKU doesn't match Tiny SKU)
  const [gtinToKeyMap, setGtinToKeyMap] = useState<Record<string, string>>({});
  // Product search state for manual confirmation
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);

  // Build items from orders — now tracking individual line items with their DB state
  interface ItemEntry {
    name: string;
    variant: string;
    sku: string;
    totalQty: number;
    pickedQty: number; // from DB pick_verified items
    orders: string[];
    barcodes: string[];
    lineItems: Array<{ id: string; orderId: string; orderName: string; tinyOrderId: string | null; quantity: number; pickedQty: number; pickVerified: boolean }>;
  }

  const allItems = new Map<string, ItemEntry>();

  const relevantOrders = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return true;
  });

  relevantOrders.forEach(order => {
    (order.expedition_order_items || []).forEach((item: any) => {
      const key = item.sku || `${item.product_name}-${item.variant_name || ''}`;
      if (!allItems.has(key)) {
        allItems.set(key, { name: item.product_name, variant: item.variant_name || '', sku: item.sku || '', totalQty: 0, pickedQty: 0, orders: [], barcodes: [], lineItems: [] });
      }
      const entry = allItems.get(key)!;
      entry.totalQty += item.quantity;
      entry.pickedQty += (item.picked_quantity || 0);
      entry.orders.push(order.shopify_order_name || order.tiny_order_id || '');
      if (item.barcode && !entry.barcodes.includes(item.barcode)) entry.barcodes.push(item.barcode);
      entry.lineItems.push({
        id: item.id,
        orderId: order.id,
        orderName: order.shopify_order_name,
        tinyOrderId: order.tiny_order_id || null,
        quantity: item.quantity,
        pickedQty: item.picked_quantity || 0,
        pickVerified: !!item.pick_verified,
      });
    });
  });

  const sortedItems = Array.from(allItems.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));

  // In checking mode, sort: unchecked first, then checked
  const displayItems = showChecking
    ? [...sortedItems].sort((a, b) => {
        const aChecked = a[1].pickedQty >= a[1].totalQty;
        const bChecked = b[1].pickedQty >= b[1].totalQty;
        if (aChecked && !bChecked) return 1;
        if (!aChecked && bChecked) return -1;
        return 0;
      })
    : sortedItems;

  // Track item IDs that THIS device just updated to skip redundant refreshes
  const localUpdatedIdsRef = useRef<Set<string>>(new Set());

  // Subscribe to realtime changes on expedition_order_items
  useEffect(() => {
    const channel = supabase
      .channel('expedition-items-realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'expedition_order_items',
      }, (payload: any) => {
        const updatedId = payload.new?.id;
        // If this device just updated this item, skip the refresh
        if (updatedId && localUpdatedIdsRef.current.has(updatedId)) {
          localUpdatedIdsRef.current.delete(updatedId);
          return;
        }
        // Another user updated an item — refresh to get their changes
        onRefresh();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [onRefresh]);

  // Load stock locations and enrich barcodes from pos_products (GTIN)
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

        // Enrich barcodes map: SKU -> extra GTINs from pos_products so scanning by GTIN works
        const newEnriched: Record<string, string[]> = {};
        (bySku || []).forEach((p: any) => {
          if (p.barcode && p.sku) {
            if (!newEnriched[p.sku]) newEnriched[p.sku] = [];
            if (!newEnriched[p.sku].includes(p.barcode)) {
              newEnriched[p.sku].push(p.barcode);
            }
          }
        });

        // For items whose Shopify SKU doesn't match any pos_products SKU,
        // search by product name to find the Tiny GTIN and build a reverse map
        const unmatchedItems = sortedItems.filter(([, item]) => {
          const sku = item.sku;
          if (!sku) return true;
          // Check if this SKU was found in pos_products
          const foundInSku = (bySku || []).some((p: any) => p.sku === sku);
          const foundInBarcode = (byBarcode || []).some((p: any) => p.barcode === sku);
          return !foundInSku && !foundInBarcode;
        });

        const newGtinToKey: Record<string, string> = {};

        if (unmatchedItems.length > 0) {
          // Extract short product names for fuzzy search in pos_products
          for (const [key, item] of unmatchedItems) {
            // Try to find by variant (size) and partial name
            const nameParts = item.name.split(/\s+/).slice(0, 3).join(' ');
            const { data: nameMatches } = await supabase
              .from('pos_products')
              .select('sku, barcode, name, variant')
              .ilike('name', `%${nameParts}%`)
              .limit(20);

            if (nameMatches && nameMatches.length > 0) {
              // Filter by variant/size match
              const sizeMatch = item.variant?.match(/\d+/)?.[0];
              const matched = sizeMatch
                ? nameMatches.filter((p: any) => p.variant === sizeMatch || p.name?.includes(sizeMatch))
                : nameMatches;

              const targets = matched.length > 0 ? matched : nameMatches;
              for (const p of targets) {
                if (p.barcode) {
                  if (!newEnriched[key]) newEnriched[key] = [];
                  if (!newEnriched[key].includes(p.barcode)) newEnriched[key].push(p.barcode);
                  newGtinToKey[p.barcode] = key;
                }
                if (p.sku && p.sku !== key) {
                  if (!newEnriched[key]) newEnriched[key] = [];
                  if (!newEnriched[key].includes(p.sku)) newEnriched[key].push(p.sku);
                  newGtinToKey[p.sku] = key;
                }
              }
            }
          }
        }

        setEnrichedBarcodes(newEnriched);
        setGtinToKeyMap(prev => ({ ...prev, ...newGtinToKey }));
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

    // Find item by SKU, barcode from order, GTIN from pos_products, or reverse GTIN map
    let matched = sortedItems.find(([key, item]) =>
      item.sku === trimmed ||
      item.barcodes.includes(trimmed) ||
      (enrichedBarcodes[item.sku] && enrichedBarcodes[item.sku].includes(trimmed)) ||
      (enrichedBarcodes[key] && enrichedBarcodes[key].includes(trimmed))
    );

    // Fallback: check gtinToKeyMap for products whose Shopify SKU != Tiny SKU
    if (!matched && gtinToKeyMap[trimmed]) {
      const mappedKey = gtinToKeyMap[trimmed];
      matched = sortedItems.find(([key]) => key === mappedKey);
    }

    if (!matched) {
      toast.error(`Produto não encontrado: ${trimmed}`);
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return;
    }

    const [key, item] = matched;

    // Find the first line item that still needs picking
    const pendingLine = item.lineItems.find(li => li.pickedQty < li.quantity);

    if (!pendingLine) {
      // All units already checked — allow RE-CHECK by resetting the last checked item
      const lastCheckedLine = item.lineItems.find(li => li.pickedQty > 0);
      if (lastCheckedLine) {
        toast.info(`${item.name} já conferido (${item.pickedQty}/${item.totalQty}). Re-verificando...`);
        setPendingConfirm({ key, name: item.name, variant: item.variant, sku: item.sku, itemId: lastCheckedLine.id, orderName: lastCheckedLine.orderName, tinyOrderId: lastCheckedLine.tinyOrderId, isRecheck: true, isManualOverride: false });
        setQualityChecks({ feet_correct: false, no_defects: false });
        setBarcodeInput('');
        return;
      }
      toast.warning(`${item.name} já foi totalmente conferido!`);
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return;
    }

    // Show quality confirmation
    setPendingConfirm({ key, name: item.name, variant: item.variant, sku: item.sku, itemId: pendingLine.id, orderName: pendingLine.orderName, tinyOrderId: pendingLine.tinyOrderId, isRecheck: false, isManualOverride: false });
    setQualityChecks({ feet_correct: false, no_defects: false });
    setBarcodeInput('');
  }, [sortedItems, enrichedBarcodes, gtinToKeyMap]);

  const handleConfirmQuality = async () => {
    if (!pendingConfirm) return;
    setSavingConfirm(true);

    try {
      // Find the line item to update
      const item = allItems.get(pendingConfirm.key);
      if (!item) throw new Error('Item not found');

      const lineItem = item.lineItems.find(li => li.id === pendingConfirm.itemId);
      if (!lineItem) throw new Error('Line item not found');

      // Fetch current value from DB to avoid stale in-memory state
      const { data: currentDbItem } = await supabase
        .from('expedition_order_items')
        .select('picked_quantity, quantity')
        .eq('id', pendingConfirm.itemId)
        .single();

      const currentPicked = currentDbItem?.picked_quantity || 0;
      const maxQty = currentDbItem?.quantity || lineItem.quantity;
      const newPickedQty = Math.min(currentPicked + 1, maxQty);
      const isFullyPicked = newPickedQty >= maxQty;

      // Mark this item as locally updated so realtime handler skips it
      localUpdatedIdsRef.current.add(pendingConfirm.itemId);

      // Save to DB immediately
      const { error } = await supabase
        .from('expedition_order_items')
        .update({
          picked_quantity: newPickedQty,
          pick_verified: isFullyPicked,
        })
        .eq('id', pendingConfirm.itemId);

      if (error) {
        localUpdatedIdsRef.current.delete(pendingConfirm.itemId);
        throw error;
      }

      // If manual override, log to unscannable items table
      if (pendingConfirm.isManualOverride) {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('expedition_unscannable_items').insert({
          expedition_order_id: lineItem.orderId,
          expedition_order_item_id: pendingConfirm.itemId,
          product_name: pendingConfirm.name,
          variant_name: pendingConfirm.variant || null,
          sku: pendingConfirm.sku || null,
          barcode: item.barcodes?.[0] || null,
          reason: 'manual_override',
          created_by: user?.id || null,
        });
      }

      toast.success(`✓ ${item.name} conferido${pendingConfirm.isManualOverride ? ' (manual)' : ''} (${item.pickedQty + 1}/${item.totalQty})`);
      setPendingConfirm(null);

      // Refetch only THIS device's data (local confirmation)
      onRefresh();

      setTimeout(() => barcodeRef.current?.focus(), 100);
    } catch (err: any) {
      console.error('Error saving pick verification:', err);
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSavingConfirm(false);
    }
  };

  // Manual confirmation handler — select product from list without scanning
  const handleManualConfirm = useCallback((key: string) => {
    const item = allItems.get(key);
    if (!item) return;

    const pendingLine = item.lineItems.find(li => li.pickedQty < li.quantity);
    if (!pendingLine) {
      const lastCheckedLine = item.lineItems.find(li => li.pickedQty > 0);
      if (lastCheckedLine) {
        setPendingConfirm({ key, name: item.name, variant: item.variant, sku: item.sku, itemId: lastCheckedLine.id, orderName: lastCheckedLine.orderName, tinyOrderId: lastCheckedLine.tinyOrderId, isRecheck: true, isManualOverride: true });
        setQualityChecks({ feet_correct: false, no_defects: false });
        return;
      }
      toast.warning(`${item.name} já foi totalmente conferido!`);
      return;
    }

    setPendingConfirm({ key, name: item.name, variant: item.variant, sku: item.sku, itemId: pendingLine.id, orderName: pendingLine.orderName, tinyOrderId: pendingLine.tinyOrderId, isRecheck: false, isManualOverride: true });
    setQualityChecks({ feet_correct: false, no_defects: false });
    setShowProductSearch(false);
    setProductSearchQuery('');
  }, [allItems]);

  const handleCancelConfirm = () => {
    setPendingConfirm(null);
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const totalProducts = sortedItems.reduce((sum, [, item]) => sum + item.totalQty, 0);
  const totalChecked = sortedItems.reduce((sum, [, item]) => sum + item.pickedQty, 0);

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

  // Helper: get display SKU — if SKU looks like a random Shopify code, show enriched GTIN instead
  const getDisplaySku = (key: string, sku: string) => {
    if (!sku) return 'N/A';
    // Random Shopify SKUs are usually short alphanumeric (not all digits)
    const isRandomSku = sku.length <= 12 && /[A-Z]/.test(sku) && /\d/.test(sku);
    if (isRandomSku) {
      const gtins = enrichedBarcodes[key] || enrichedBarcodes[sku];
      if (gtins && gtins.length > 0) return gtins[0];
    }
    return sku;
  };

  const handlePrint = () => {
    const rows = sortedItems.map(([key, item], i) => {
      const displaySku = getDisplaySku(key, item.sku);
      const locs = stockLocations[item.sku];
      const locText = locs?.map(l => `${l.depositName}(${l.stock})`).join(', ') || '—';
      return `<tr>
        <td style="text-align:center;font-weight:bold;color:#333;">${i + 1}</td>
        <td style="font-weight:600;">${item.name}${item.variant ? ` <span style="color:#e67e22;font-weight:500;">(${item.variant})</span>` : ''}</td>
        <td style="font-family:monospace;color:#666;font-size:12px;">${displaySku}</td>
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
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base md:text-lg font-bold text-foreground">
            {showChecking ? 'Conferência por Bipagem' : 'Lista de Separação (Picking)'}
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground">
            {sortedItems.length} produtos • {totalProducts} unidades
            {showChecking && ` • ${totalChecked}/${totalProducts} conferidos`}
            {loadingStock && ' • Carregando estoques...'}
          </p>
          {showChecking && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <Users className="h-3 w-3" /> Colaborativo — bipagens salvas em tempo real
            </p>
          )}
        </div>
        <div className="flex gap-1.5 md:gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRefreshStock} disabled={refreshingStock} className="gap-1 md:gap-2 text-xs md:text-sm">
            <RefreshCw className={`h-3 w-3 md:h-4 md:w-4 ${refreshingStock ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">{refreshingStock ? 'Atualizando...' : 'Atualizar Estoque'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1 md:gap-2 text-xs md:text-sm">
            <Printer className="h-3 w-3 md:h-4 md:w-4" /> <span className="hidden sm:inline">Imprimir</span>
          </Button>
          {showChecking && totalChecked === totalProducts && totalProducts > 0 && (
            <Button size="sm" onClick={handleMarkPickingComplete} className="gap-1 md:gap-2 text-xs md:text-sm">
              <CheckCircle2 className="h-3 w-3 md:h-4 md:w-4" /> Confirmar
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
              placeholder="Bipe o código de barras ou SKU..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBarcodeScan(barcodeInput); }}
              className="text-lg font-mono flex-1"
              autoFocus
              disabled={!!pendingConfirm || showCameraScanner}
            />
            <Button onClick={() => handleBarcodeScan(barcodeInput)} disabled={!!pendingConfirm || showCameraScanner}>
              <ScanBarcode className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowCameraScanner(true)}
              disabled={!!pendingConfirm || showCameraScanner}
              className="gap-2"
            >
              <Camera className="h-5 w-5" />
              <span className="hidden sm:inline">Câmera</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowProductSearch(!showProductSearch)}
              disabled={!!pendingConfirm}
              className="gap-2"
            >
              <Search className="h-5 w-5" />
              <span className="hidden sm:inline">Buscar</span>
            </Button>
          </div>

          {/* Product search panel for manual confirmation */}
          {showProductSearch && !pendingConfirm && (
            <Card className="border-2 border-blue-400 dark:border-blue-600">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-bold text-foreground">Buscar produto para conferência manual</h3>
                  <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => { setShowProductSearch(false); setProductSearchQuery(''); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Itens conferidos manualmente serão registrados para auditoria posterior.
                </div>
                <Input
                  placeholder="Digite o nome do produto..."
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                  className="text-sm"
                  autoFocus
                />
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {sortedItems
                    .filter(([, item]) => {
                      if (!productSearchQuery.trim()) return false;
                      const q = productSearchQuery.toLowerCase();
                      return item.name.toLowerCase().includes(q) || item.variant?.toLowerCase().includes(q) || item.sku?.toLowerCase().includes(q);
                    })
                    .map(([key, item]) => {
                      const isFullyChecked = item.pickedQty >= item.totalQty;
                      return (
                        <button
                          key={key}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-secondary/70 transition-colors border border-border/50 flex items-center justify-between gap-2"
                          onClick={() => handleManualConfirm(key)}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {item.variant && `${item.variant} • `}SKU: {getDisplaySku(key, item.sku)} • {item.pickedQty}/{item.totalQty}
                            </p>
                          </div>
                          {isFullyChecked ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : (
                            <Hand className="h-4 w-4 text-blue-500 shrink-0" />
                          )}
                        </button>
                      );
                    })
                  }
                </div>
              </CardContent>
            </Card>
          )}

          {/* Camera scanner overlay */}
          {showCameraScanner && (
            <div className="fixed inset-0 z-[9999] bg-background/95 flex flex-col items-center justify-center p-4">
              <div className="w-full max-w-md space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <Camera className="h-5 w-5" /> Scanner de Código de Barras
                  </h3>
                  <Button variant="ghost" size="icon" onClick={() => setShowCameraScanner(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <ExpeditionBarcodeScanner
                  onScan={(code) => {
                    setShowCameraScanner(false);
                    handleBarcodeScan(code);
                  }}
                  onClose={() => setShowCameraScanner(false)}
                />
              </div>
            </div>
          )}

          {/* Quality confirmation dialog */}
          {pendingConfirm && (
            <Card className="border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/10 animate-in fade-in slide-in-from-top-2">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-amber-600" />
                  <h3 className="font-bold text-foreground">
                    {pendingConfirm.isManualOverride ? 'Conferência Manual' : pendingConfirm.isRecheck ? 'Re-verificação de Qualidade' : 'Verificação de Qualidade'}
                  </h3>
                </div>
                {pendingConfirm.isManualOverride && (
                  <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-300 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Conferência manual — este item será registrado para auditoria.
                  </div>
                )}
                {pendingConfirm.isRecheck && !pendingConfirm.isManualOverride && (
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-400">
                    ⚠️ Este produto já foi conferido anteriormente. Confirme novamente se necessário.
                  </div>
                )}
                <div className="p-3 rounded-lg bg-background border">
                  <p className="font-medium text-foreground">{pendingConfirm.name}</p>
                  {pendingConfirm.variant && <p className="text-sm text-muted-foreground">{pendingConfirm.variant}</p>}
                  <p className="text-xs text-muted-foreground font-mono">SKU: {pendingConfirm.sku}</p>
                  <p className="text-xs font-semibold text-primary mt-1">
                    Pedido: {pendingConfirm.orderName}{pendingConfirm.tinyOrderId ? ` / Tiny: ${pendingConfirm.tinyOrderId}` : ''}
                  </p>
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
                    disabled={!qualityChecks.feet_correct || !qualityChecks.no_defects || savingConfirm}
                    className="flex-1 gap-2"
                  >
                    {savingConfirm ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {savingConfirm ? 'Salvando...' : 'Confirmar Produto'}
                  </Button>
                  <Button variant="outline" onClick={handleCancelConfirm} disabled={savingConfirm}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Verified items list */}
          {totalChecked > 0 && (
            <Card className="border-green-500/30 bg-green-50/50 dark:bg-green-900/5">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <h3 className="text-sm font-bold text-foreground">Itens Conferidos ({totalChecked}/{totalProducts})</h3>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {sortedItems
                    .filter(([, item]) => item.pickedQty > 0)
                    .map(([key, item]) => {
                      const isFullyChecked = item.pickedQty >= item.totalQty;
                      return (
                        <div key={key} className={`flex items-center justify-between px-2 py-1.5 rounded text-sm ${isFullyChecked ? 'bg-green-100 dark:bg-green-900/20' : 'bg-amber-50 dark:bg-amber-900/10'}`}>
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {isFullyChecked
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              : <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            }
                            <span className="truncate text-foreground">{item.name}</span>
                            {item.variant && <span className="text-xs text-muted-foreground shrink-0">({item.variant})</span>}
                          </div>
                          <span className={`font-mono font-bold text-xs shrink-0 ml-2 ${isFullyChecked ? 'text-green-600' : 'text-amber-600'}`}>
                            {item.pickedQty}/{item.totalQty}
                          </span>
                        </div>
                      );
                    })
                  }
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="space-y-2">
        {displayItems.map(([key, item]) => {
          const isFullyChecked = item.pickedQty >= item.totalQty;

          return (
            <Card key={key} className={isFullyChecked && showChecking ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : ''}>
              <CardContent className="p-2.5 md:p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
                    {showChecking && (
                      isFullyChecked
                        ? <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 text-green-500 shrink-0" />
                        : <Clock className="h-4 w-4 md:h-5 md:w-5 text-amber-500 shrink-0" />
                    )}
                    <span className="font-medium text-foreground text-sm md:text-base truncate">{item.name}</span>
                    {item.variant && <Badge variant="outline" className="text-[10px] md:text-xs">{item.variant}</Badge>}
                    {showChecking && !isFullyChecked && (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-[10px]">
                        Aguardando
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                    {getStockBadge(item.sku)}
                  </div>
                  <p className="text-[10px] md:text-xs text-muted-foreground truncate">
                    SKU: {getDisplaySku(key, item.sku)} • Pedidos: {item.lineItems.map(li => {
                      const parts = [li.orderName];
                      if (li.tinyOrderId) parts.push(`Tiny:${li.tinyOrderId}`);
                      return parts.join('/');
                    }).join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  {showChecking && !isFullyChecked && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleManualConfirm(key)}
                      disabled={!!pendingConfirm}
                      className="gap-1 text-[10px] h-7 px-2"
                      title="Conferir manualmente (sem bipar)"
                    >
                      <Hand className="h-3 w-3" />
                      <span className="hidden sm:inline">Manual</span>
                    </Button>
                  )}
                  {showChecking ? (
                    <span className={`text-base md:text-lg font-bold ${isFullyChecked ? 'text-green-500' : 'text-foreground'}`}>
                      {item.pickedQty}/{item.totalQty}
                    </span>
                  ) : (
                    <Badge className="text-sm md:text-base px-2.5 md:px-3 py-0.5 md:py-1">x{item.totalQty}</Badge>
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

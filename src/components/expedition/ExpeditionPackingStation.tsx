import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CheckCircle2, ScanBarcode, Camera, Keyboard, Package, ShieldCheck, AlertTriangle, Gift, ArrowRightLeft, Loader2, MapPin, Clock, Play, PackageCheck, PackageX, PackageMinus, Search, Filter, Users } from 'lucide-react';

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

type PackingCategory = 'all' | 'complete' | 'incomplete' | 'missing';

interface CustomerGroup {
  key: string;
  customerName: string;
  customerEmail: string;
  orders: any[];
  allItems: any[];
  hasGift: boolean;
  orderNames: string[];
}

const SITE_STORE_ID = '2bd2c08d-321c-47ee-98a9-e27e936818ab';

// Group orders by customer (email or name fallback)
function groupOrdersByCustomer(orders: any[]): CustomerGroup[] {
  const map = new Map<string, any[]>();

  for (const order of orders) {
    // Group key: prefer email, fallback to normalized name
    const email = (order.customer_email || '').toLowerCase().trim();
    const name = (order.customer_name || '').toLowerCase().trim();
    const key = email || name || order.id; // fallback to order id if no identifiers
    
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(order);
  }

  return Array.from(map.entries()).map(([key, groupOrders]) => {
    const allItems = groupOrders.flatMap(o => o.expedition_order_items || []);
    const hasGift = groupOrders.some(o => o.has_gift);
    const orderNames = groupOrders.map(o => o.shopify_order_name).filter(Boolean);
    return {
      key,
      customerName: groupOrders[0].customer_name || 'Sem nome',
      customerEmail: groupOrders[0].customer_email || '',
      orders: groupOrders,
      allItems,
      hasGift,
      orderNames,
    };
  });
}

export function ExpeditionPackingStation({ orders, searchTerm, onRefresh }: Props) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<'keyboard' | 'camera'>('keyboard');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedItems, setScannedItems] = useState<Record<string, number>>({});
  const [qualityChecks, setQualityChecks] = useState<QualityChecks>({ feet_correct: false, no_defects: false, gift_verified: false });
  const [transferLogs, setTransferLogs] = useState<TransferLog[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, { storeId: string; storeName: string; depositName: string; stock: number }[]>>({});
  const [transferring, setTransferring] = useState(false);
  const [activeCategory, setActiveCategory] = useState<PackingCategory>('all');
  const [productScanInput, setProductScanInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const productScanRef = useRef<HTMLInputElement>(null);

  // Filter orders eligible for packing
  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return ['approved', 'grouped', 'picked', 'awaiting_stock'].includes(o.expedition_status);
  });

  // Group filtered orders by customer
  const customerGroups = useMemo(() => groupOrdersByCustomer(filtered), [filtered]);

  // Categorize a group by pick verification completeness
  const categorizeGroup = (group: CustomerGroup): 'complete' | 'incomplete' | 'missing' => {
    const items = group.allItems;
    if (items.length === 0) return 'missing';

    let totalVerified = 0;
    let totalItems = 0;

    for (const item of items) {
      totalItems += item.quantity;
      const picked = item.picked_quantity || 0;
      totalVerified += Math.min(picked, item.quantity);
    }

    if (totalItems === 0) return 'missing';
    if (totalVerified >= totalItems) return 'complete';
    if (totalVerified > 0) return 'incomplete';
    return 'missing';
  };

  const categorizedGroups = customerGroups.reduce((acc, group) => {
    const cat = categorizeGroup(group);
    acc[cat].push(group);
    return acc;
  }, { complete: [] as CustomerGroup[], incomplete: [] as CustomerGroup[], missing: [] as CustomerGroup[] });

  const getFilteredGroups = () => {
    const isGroupAwaiting = (g: CustomerGroup) => g.orders.every(o => o.expedition_status === 'awaiting_stock');
    let list: CustomerGroup[];
    switch (activeCategory) {
      case 'complete': list = categorizedGroups.complete; break;
      case 'incomplete': list = categorizedGroups.incomplete; break;
      case 'missing': list = categorizedGroups.missing; break;
      default: list = customerGroups;
    }
    return [...list].sort((a, b) => {
      if (isGroupAwaiting(a) && !isGroupAwaiting(b)) return 1;
      if (!isGroupAwaiting(a) && isGroupAwaiting(b)) return -1;
      return 0;
    });
  };

  const sortedGroups = getFilteredGroups();
  const selectedGroup = selectedGroupKey ? customerGroups.find(g => g.key === selectedGroupKey) : null;
  const items = selectedGroup?.allItems || [];
  const hasGift = selectedGroup?.hasGift || false;

  useEffect(() => {
    if (selectedGroupKey && scanMode === 'keyboard') inputRef.current?.focus();
  }, [selectedGroupKey, scanMode]);

  useEffect(() => {
    setQualityChecks({ feet_correct: false, no_defects: false, gift_verified: !hasGift });
  }, [selectedGroupKey, hasGift]);

  // Load stock info for selected group items
  useEffect(() => {
    if (!selectedGroup) return;
    const skus = items.map((i: any) => i.sku).filter(Boolean);
    if (skus.length === 0) return;

    const fetchStock = async () => {
      const [{ data: bySku }, { data: byBarcode }] = await Promise.all([
        supabase.from('pos_products').select('sku, barcode, stock, store_id, pos_stores:store_id(name, tiny_deposit_name)').in('sku', skus),
        supabase.from('pos_products').select('sku, barcode, stock, store_id, pos_stores:store_id(name, tiny_deposit_name)').in('barcode', skus),
      ]);

      const map: typeof stockMap = {};
      const addProduct = (p: any, matchedKey: string) => {
        if (!map[matchedKey]) map[matchedKey] = [];
        if (!map[matchedKey].some(l => l.storeId === p.store_id)) {
          map[matchedKey].push({ storeId: p.store_id, storeName: p.pos_stores?.name || '', depositName: p.pos_stores?.tiny_deposit_name || '', stock: p.stock });
        }
      };
      (bySku || []).forEach((p: any) => addProduct(p, p.sku));
      (byBarcode || []).forEach((p: any) => addProduct(p, p.barcode));
      setStockMap(map);
    };
    fetchStock();
  }, [selectedGroupKey]);

  const transferStockIfNeeded = useCallback(async (item: any) => {
    const sku = item.sku;
    if (!sku) return;
    const locations = stockMap[sku];
    if (!locations) return;
    const siteLoc = locations.find(l => l.depositName === 'Site');
    if ((siteLoc?.stock || 0) > 0) return;
    const source = locations.find(l => l.depositName !== 'Site' && l.stock > 0);
    if (!source) return;

    const logEntry: TransferLog = { itemId: item.id, sku, from: source.depositName, to: 'Site', status: 'pending' };
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
    if (!selectedGroup || !barcode.trim()) return;
    const matchedItem = items.find((item: any) => item.barcode === barcode.trim() || item.sku === barcode.trim());
    if (matchedItem) {
      const key = matchedItem.id;
      const current = scannedItems[key] || 0;
      if (current < matchedItem.quantity) {
        setScannedItems(prev => ({ ...prev, [key]: current + 1 }));
        toast.success(`✓ ${matchedItem.product_name} (${current + 1}/${matchedItem.quantity})`);
        await transferStockIfNeeded(matchedItem);
      } else {
        toast.warning(`${matchedItem.product_name} já foi totalmente bipado!`);
      }
    } else {
      toast.error(`Código não encontrado nestes pedidos: ${barcode}`);
    }
    setBarcodeInput('');
  }, [selectedGroup, items, scannedItems, transferStockIfNeeded]);

  // Product-first scan: find group by scanned barcode/sku
  const handleProductScan = useCallback((barcode: string) => {
    if (!barcode.trim()) return;
    const trimmed = barcode.trim();

    const matchingGroups = customerGroups.filter(group =>
      group.allItems.some((item: any) => item.barcode === trimmed || item.sku === trimmed)
    );

    if (matchingGroups.length === 0) {
      toast.error(`Nenhum pedido encontrado com o código: ${trimmed}`);
    } else if (matchingGroups.length === 1) {
      setSelectedGroupKey(matchingGroups[0].key);
      const names = matchingGroups[0].orderNames.join(', ');
      toast.success(`Pedido(s) ${names} localizado(s)!`);
    } else {
      toast.info(`${matchingGroups.length} clientes encontrados com esse produto. Selecione um.`);
      setActiveCategory('all');
    }
    setProductScanInput('');
  }, [customerGroups]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleBarcodeScan(barcodeInput);
  };

  const handleProductScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleProductScan(productScanInput);
  };

  const totalItems = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
  const totalScanned = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
  const allScanned = totalItems > 0 && totalScanned === totalItems;
  const allChecked = qualityChecks.feet_correct && qualityChecks.no_defects && qualityChecks.gift_verified;
  const allVerified = allScanned && allChecked;

  const handleConfirmPacking = async () => {
    if (!selectedGroup) return;
    try {
      // Update all items across all orders in the group
      for (const item of items) {
        const scanned = scannedItems[item.id] || 0;
        await supabase.from('expedition_order_items').update({ packed_quantity: scanned, pack_verified: scanned === item.quantity }).eq('id', item.id);
      }
      // Mark all orders in the group as packed
      const orderIds = selectedGroup.orders.map(o => o.id);
      await supabase.from('expedition_orders').update({ expedition_status: 'packed' }).in('id', orderIds);
      toast.success(`Conferência concluída para ${selectedGroup.orderNames.length} pedido(s)!`);
      setSelectedGroupKey(null);
      setScannedItems({});
      setTransferLogs([]);
      setQualityChecks({ feet_correct: false, no_defects: false, gift_verified: false });
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const getItemStockInfo = (sku: string, item?: any) => {
    if (item?.pick_verified) {
      return <Badge variant="outline" className="text-[10px] gap-1 border-green-500 text-green-600"><CheckCircle2 className="h-3 w-3" />Conferido ✓</Badge>;
    }
    if (item && (item.picked_quantity || 0) > 0) {
      return <Badge variant="outline" className="text-[10px] gap-1 border-amber-500 text-amber-600"><CheckCircle2 className="h-3 w-3" />Parcial ({item.picked_quantity}/{item.quantity})</Badge>;
    }
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

  // Find which order an item belongs to (for display in detail view)
  const getOrderForItem = (itemId: string) => {
    if (!selectedGroup) return null;
    return selectedGroup.orders.find(o =>
      (o.expedition_order_items || []).some((i: any) => i.id === itemId)
    );
  };

  // ── GROUP LIST VIEW ──
  if (!selectedGroupKey) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Bipagem & Conferência (Packing)</h2>

        {/* Product-first scan input */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <ScanBarcode className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold text-foreground">Bipar produto para localizar pedido</span>
            </div>
            <div className="flex gap-2">
              <Input
                ref={productScanRef}
                placeholder="Bipe ou digite o código de barras do produto..."
                value={productScanInput}
                onChange={(e) => setProductScanInput(e.target.value)}
                onKeyDown={handleProductScanKeyDown}
                className="text-lg font-mono"
                autoFocus
              />
              <Button onClick={() => handleProductScan(productScanInput)}>
                <Search className="h-5 w-5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Category tabs */}
        <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as PackingCategory)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all" className="gap-1 text-xs md:text-sm">
              <Package className="h-3 w-3 md:h-4 md:w-4" />
              Todos ({customerGroups.length})
            </TabsTrigger>
            <TabsTrigger value="complete" className="gap-1 text-xs md:text-sm text-green-600 data-[state=active]:text-green-700">
              <PackageCheck className="h-3 w-3 md:h-4 md:w-4" />
              Completos ({categorizedGroups.complete.length})
            </TabsTrigger>
            <TabsTrigger value="incomplete" className="gap-1 text-xs md:text-sm text-amber-600 data-[state=active]:text-amber-700">
              <PackageMinus className="h-3 w-3 md:h-4 md:w-4" />
              Incompletos ({categorizedGroups.incomplete.length})
            </TabsTrigger>
            <TabsTrigger value="missing" className="gap-1 text-xs md:text-sm text-red-600 data-[state=active]:text-red-700">
              <PackageX className="h-3 w-3 md:h-4 md:w-4" />
              Em Falta ({categorizedGroups.missing.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {sortedGroups.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido nesta categoria.</CardContent></Card>
        ) : (
          <div className="grid gap-2">
            {sortedGroups.map(group => {
              const isAwaiting = group.orders.every(o => o.expedition_status === 'awaiting_stock');
              const cat = categorizeGroup(group);
              const catColors = {
                complete: 'border-l-4 border-l-green-500',
                incomplete: 'border-l-4 border-l-amber-500',
                missing: 'border-l-4 border-l-red-500',
              };
              const totalQty = group.allItems.reduce((s: number, i: any) => s + i.quantity, 0);
              const pickedQty = group.allItems.reduce((s: number, i: any) => s + (i.picked_quantity || 0), 0);
              const isMultiOrder = group.orders.length > 1;

              return (
                <Card
                  key={group.key}
                  className={`cursor-pointer transition-shadow ${catColors[cat]} ${isAwaiting ? 'opacity-60 border-amber-400/50' : 'hover:shadow-md hover:border-primary'} ${isMultiOrder ? 'ring-2 ring-blue-400/40' : ''}`}
                  onClick={() => !isAwaiting && setSelectedGroupKey(group.key)}
                >
                  <CardContent className="p-3 md:p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isAwaiting ? <Clock className="h-5 w-5 text-amber-500" /> : cat === 'complete' ? <PackageCheck className="h-5 w-5 text-green-500" /> : cat === 'incomplete' ? <PackageMinus className="h-5 w-5 text-amber-500" /> : <PackageX className="h-5 w-5 text-red-500" />}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {group.orderNames.map((name, i) => (
                            <span key={i} className="font-bold text-foreground">{name}</span>
                          ))}
                          {isMultiOrder && (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 gap-1">
                              <Users className="h-3 w-3" /> {group.orders.length} pedidos
                            </Badge>
                          )}
                          {isAwaiting && (
                            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 gap-1">
                              <Clock className="h-3 w-3" /> Aguardando
                            </Badge>
                          )}
                          {group.hasGift && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600"><Gift className="h-3 w-3 mr-0.5" />Brinde</Badge>}
                          <Badge variant="outline" className={`text-[10px] ${cat === 'complete' ? 'border-green-500 text-green-600' : cat === 'incomplete' ? 'border-amber-500 text-amber-600' : 'border-red-500 text-red-600'}`}>
                            {pickedQty}/{totalQty} conferidos
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{group.customerName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{totalQty} itens</Badge>
                      {isAwaiting && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 border-green-500/50 text-green-700 dark:text-green-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            Promise.all(
                              group.orders.map(o =>
                                supabase.from('expedition_orders').update({ expedition_status: 'approved' }).eq('id', o.id)
                              )
                            ).then(() => { toast.success('Pedidos retomados!'); onRefresh(); });
                          }}
                        >
                          <Play className="h-3 w-3" /> Retomar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── GROUP DETAIL / SCANNING VIEW ──
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            Conferência: {selectedGroup?.orderNames.join(' + ')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {selectedGroup?.customerName} • {totalScanned}/{totalItems} itens bipados
            {(selectedGroup?.orders.length || 0) > 1 && (
              <span className="ml-2 text-blue-600 font-medium">({selectedGroup?.orders.length} pedidos agrupados)</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setSelectedGroupKey(null); setScannedItems({}); setTransferLogs([]); }}>Voltar</Button>
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

      {/* Items grouped by order */}
      <div className="space-y-2">
        {selectedGroup && selectedGroup.orders.map(order => {
          const orderItems = order.expedition_order_items || [];
          if (orderItems.length === 0) return null;
          return (
            <div key={order.id} className="space-y-1">
              {selectedGroup.orders.length > 1 && (
                <div className="flex items-center gap-2 px-1 pt-2">
                  <Badge variant="outline" className="text-xs font-mono">{order.shopify_order_name}</Badge>
                  <span className="text-xs text-muted-foreground">{orderItems.length} itens</span>
                </div>
              )}
              {orderItems.map((item: any) => {
                const scanned = scannedItems[item.id] || 0;
                const isComplete = scanned === item.quantity;
                const hasNoBarcode = !item.barcode && !item.sku;
                return (
                  <Card key={item.id} className={isComplete ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : ''}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isComplete ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <ScanBarcode className="h-5 w-5 text-muted-foreground" />}
                          <span className="font-medium text-foreground">{item.product_name}</span>
                          {item.variant_name && <Badge variant="outline" className="text-xs">{item.variant_name}</Badge>}
                          {getItemStockInfo(item.sku, item)}
                        </div>
                        <p className="text-xs text-muted-foreground ml-7">
                          SKU: {item.sku || 'N/A'} • Barcode: {item.barcode || 'N/A'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isComplete && (
                          <Button
                            size="sm"
                            variant="outline"
                            className={`gap-1 text-xs ${hasNoBarcode ? 'border-amber-500 text-amber-700 dark:text-amber-400 animate-pulse' : 'border-muted'}`}
                            onClick={async () => {
                              const current = scannedItems[item.id] || 0;
                              if (current < item.quantity) {
                                setScannedItems(prev => ({ ...prev, [item.id]: current + 1 }));
                                toast.success(`✓ ${item.product_name} confirmado manualmente (${current + 1}/${item.quantity})`);
                                supabase.from('expedition_unscannable_items').insert({
                                  expedition_order_id: order.id,
                                  expedition_order_item_id: item.id,
                                  product_name: item.product_name,
                                  sku: item.sku || null,
                                  reason: 'manual_confirm',
                                  confirmed_by: 'operator',
                                }).then(() => {});
                                await transferStockIfNeeded(item);
                              }
                            }}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Confirmar
                          </Button>
                        )}
                        <span className={`text-lg font-bold ${isComplete ? 'text-green-500' : 'text-foreground'}`}>
                          {scanned}/{item.quantity}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
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

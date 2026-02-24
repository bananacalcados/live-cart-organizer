import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, ScanBarcode, Camera, Package, Loader2, PackageCheck, PackageMinus, PackageX, Search, Users, Gift } from 'lucide-react';
import Barcode from 'react-barcode';

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

type PackingCategory = 'all' | 'complete' | 'incomplete' | 'missing';

interface CustomerGroup {
  key: string;
  customerName: string;
  orders: any[];
  allItems: any[];
  hasGift: boolean;
  orderNames: string[];
}

function groupOrdersByCustomer(orders: any[]): CustomerGroup[] {
  const map = new Map<string, any[]>();
  for (const order of orders) {
    const key = (order.customer_email || order.customer_name || order.id).toLowerCase().trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(order);
  }
  return Array.from(map.entries()).map(([key, groupOrders]) => ({
    key,
    customerName: groupOrders[0].customer_name || 'Sem nome',
    orders: groupOrders,
    allItems: groupOrders.flatMap(o => o.expedition_beta_order_items || []),
    hasGift: groupOrders.some(o => o.has_gift),
    orderNames: groupOrders.map(o => o.shopify_order_name).filter(Boolean),
  }));
}

export function BetaPackingStation({ orders, searchTerm, onRefresh }: Props) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedItems, setScannedItems] = useState<Record<string, number>>({});
  const [qualityChecks, setQualityChecks] = useState<QualityChecks>({ feet_correct: false, no_defects: false, gift_verified: false });
  const [activeCategory, setActiveCategory] = useState<PackingCategory>('all');
  const [productScanInput, setProductScanInput] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const productScanRef = useRef<HTMLInputElement>(null);

  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (term && !(o.shopify_order_name?.toLowerCase().includes(term) || o.customer_name?.toLowerCase().includes(term))) return false;
    return ['approved', 'grouped', 'picked', 'awaiting_stock'].includes(o.expedition_status);
  });

  const customerGroups = useMemo(() => groupOrdersByCustomer(filtered), [filtered]);

  const categorizeGroup = (group: CustomerGroup): 'complete' | 'incomplete' | 'missing' => {
    const items = group.allItems;
    if (items.length === 0) return 'missing';
    let total = 0, verified = 0;
    for (const item of items) {
      total += item.quantity;
      verified += Math.min(item.picked_quantity || 0, item.quantity);
    }
    if (total === 0) return 'missing';
    if (verified >= total) return 'complete';
    if (verified > 0) return 'incomplete';
    return 'missing';
  };

  const categorized = customerGroups.reduce((acc, g) => {
    acc[categorizeGroup(g)].push(g);
    return acc;
  }, { complete: [] as CustomerGroup[], incomplete: [] as CustomerGroup[], missing: [] as CustomerGroup[] });

  const getFilteredGroups = () => {
    switch (activeCategory) {
      case 'complete': return categorized.complete;
      case 'incomplete': return categorized.incomplete;
      case 'missing': return categorized.missing;
      default: return customerGroups;
    }
  };

  const selectedGroup = selectedGroupKey ? customerGroups.find(g => g.key === selectedGroupKey) : null;
  const items = selectedGroup?.allItems || [];
  const hasGift = selectedGroup?.hasGift || false;

  useEffect(() => {
    if (selectedGroupKey) inputRef.current?.focus();
  }, [selectedGroupKey]);

  useEffect(() => {
    setQualityChecks({ feet_correct: false, no_defects: false, gift_verified: !hasGift });
  }, [selectedGroupKey, hasGift]);

  const handleBarcodeScan = useCallback((barcode: string) => {
    if (!selectedGroup || !barcode.trim()) return;
    const matchedItem = items.find((item: any) => item.barcode === barcode.trim() || item.sku === barcode.trim());
    if (matchedItem) {
      const key = matchedItem.id;
      const current = scannedItems[key] || 0;
      if (current < matchedItem.quantity) {
        setScannedItems(prev => ({ ...prev, [key]: current + 1 }));
        toast.success(`✓ ${matchedItem.product_name} (${current + 1}/${matchedItem.quantity})`);
      } else {
        toast.warning(`${matchedItem.product_name} já bipado!`);
      }
    } else {
      toast.error(`Código não encontrado: ${barcode}`);
    }
    setBarcodeInput('');
  }, [selectedGroup, items, scannedItems]);

  const handleProductScan = useCallback((barcode: string) => {
    if (!barcode.trim()) return;
    const matching = customerGroups.filter(g => g.allItems.some((i: any) => i.barcode === barcode.trim() || i.sku === barcode.trim()));
    if (matching.length === 1) {
      setSelectedGroupKey(matching[0].key);
      toast.success(`Pedido(s) ${matching[0].orderNames.join(', ')} localizado(s)!`);
    } else if (matching.length > 1) {
      toast.info(`${matching.length} clientes encontrados. Selecione manualmente.`);
    } else {
      toast.error(`Nenhum pedido com esse código.`);
    }
    setProductScanInput('');
  }, [customerGroups]);

  const totalItems = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
  const totalScanned = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
  const allScanned = totalItems > 0 && totalScanned === totalItems;
  const allChecked = qualityChecks.feet_correct && qualityChecks.no_defects && qualityChecks.gift_verified;
  const allVerified = allScanned && allChecked;

  const handleConfirmPacking = async () => {
    if (!selectedGroup) return;
    setIsConfirming(true);
    try {
      // Update items
      for (const item of items) {
        const scanned = scannedItems[item.id] || 0;
        await supabase.from('expedition_beta_order_items').update({ packed_quantity: scanned, pack_verified: scanned === item.quantity }).eq('id', item.id);
      }

      // Generate EAN-13 for each order and mark as packed
      for (const order of selectedGroup.orders) {
        // Generate EAN-13 via DB function
        const { data: eanData } = await supabase.rpc('generate_ean13_barcode');
        const ean13 = eanData as string;

        await supabase.from('expedition_beta_orders').update({
          expedition_status: 'packed',
          ean13_barcode: ean13,
          internal_barcode: ean13,
        }).eq('id', order.id);
      }

      toast.success(`✅ Bipagem concluída! EAN-13 gerado para ${selectedGroup.orders.length} pedido(s).`);
      setSelectedGroupKey(null);
      setScannedItems({});
      setQualityChecks({ feet_correct: false, no_defects: false, gift_verified: false });
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    } finally {
      setIsConfirming(false);
    }
  };

  // GROUP LIST VIEW
  if (!selectedGroupKey) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Bipagem & EAN-13</h2>

        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <ScanBarcode className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold text-foreground">Bipar produto para localizar pedido</span>
            </div>
            <div className="flex gap-2">
              <Input
                ref={productScanRef}
                placeholder="Bipe o código de barras do produto..."
                value={productScanInput}
                onChange={(e) => setProductScanInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleProductScan(productScanInput)}
                className="text-lg font-mono"
                autoFocus
              />
              <Button onClick={() => handleProductScan(productScanInput)}><Search className="h-5 w-5" /></Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as PackingCategory)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all" className="gap-1 text-xs"><Package className="h-3 w-3" />Todos ({customerGroups.length})</TabsTrigger>
            <TabsTrigger value="complete" className="gap-1 text-xs text-green-600"><PackageCheck className="h-3 w-3" />OK ({categorized.complete.length})</TabsTrigger>
            <TabsTrigger value="incomplete" className="gap-1 text-xs text-amber-600"><PackageMinus className="h-3 w-3" />Parcial ({categorized.incomplete.length})</TabsTrigger>
            <TabsTrigger value="missing" className="gap-1 text-xs text-red-600"><PackageX className="h-3 w-3" />Falta ({categorized.missing.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid gap-2">
          {getFilteredGroups().map(group => {
            const cat = categorizeGroup(group);
            const totalQty = group.allItems.reduce((s: number, i: any) => s + i.quantity, 0);
            const pickedQty = group.allItems.reduce((s: number, i: any) => s + (i.picked_quantity || 0), 0);
            const catBorder = { complete: 'border-l-green-500', incomplete: 'border-l-amber-500', missing: 'border-l-red-500' }[cat];
            const hasEan = group.orders.some(o => o.ean13_barcode);

            return (
              <Card key={group.key} className={`border-l-4 ${catBorder} cursor-pointer hover:bg-secondary/30 transition-colors`} onClick={() => setSelectedGroupKey(group.key)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{group.customerName}</span>
                        {group.orders.length > 1 && <Badge variant="secondary" className="text-[10px]"><Users className="h-3 w-3 mr-1" />{group.orders.length}</Badge>}
                        {group.hasGift && <Gift className="h-3.5 w-3.5 text-pink-500" />}
                        {hasEan && <Badge variant="outline" className="text-[10px] text-green-600">EAN-13 ✓</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{group.orderNames.join(', ')} • {totalQty} itens</p>
                    </div>
                    <Badge variant={cat === 'complete' ? 'default' : 'secondary'} className="text-xs">{pickedQty}/{totalQty}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // DETAIL VIEW
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">{selectedGroup?.customerName}</h2>
          <p className="text-sm text-muted-foreground">{selectedGroup?.orderNames.join(', ')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setSelectedGroupKey(null); setScannedItems({}); }}>← Voltar</Button>
      </div>

      {/* Already has EAN-13? Show it */}
      {selectedGroup?.orders.some(o => o.ean13_barcode) && (
        <Card className="bg-white border">
          <CardContent className="p-4 flex flex-col items-center gap-2">
            <h3 className="font-bold text-sm text-foreground">Código de barras EAN-13 gerado</h3>
            {selectedGroup.orders.filter(o => o.ean13_barcode).map(o => (
              <div key={o.id} className="flex flex-col items-center">
                <p className="text-xs text-muted-foreground mb-1">{o.shopify_order_name}</p>
                <Barcode value={o.ean13_barcode} format="EAN13" width={2} height={60} fontSize={14} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Scan input */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <ScanBarcode className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Bipar itens do pedido</span>
          </div>
          <Input
            ref={inputRef}
            placeholder="Bipe o código de barras..."
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBarcodeScan(barcodeInput)}
            className="text-lg font-mono"
          />
        </CardContent>
      </Card>

      {/* Progress */}
      <div className="flex items-center justify-between p-2 rounded-lg bg-secondary/50">
        <span className="text-sm font-medium">Progresso</span>
        <Badge variant={allScanned ? 'default' : 'secondary'} className="text-sm">{totalScanned}/{totalItems}</Badge>
      </div>

      {/* Items */}
      <div className="space-y-1">
        {items.map((item: any) => {
          const scanned = scannedItems[item.id] || 0;
          const isOk = scanned >= item.quantity;
          return (
            <div key={item.id} className={`flex items-center justify-between p-2.5 rounded-lg border ${isOk ? 'bg-green-50 border-green-200 dark:bg-green-900/20' : 'bg-background border-border/50'}`}>
              <div className="min-w-0">
                {isOk && <CheckCircle2 className="h-4 w-4 text-green-600 inline mr-1" />}
                <span className={`font-medium text-sm ${isOk ? 'line-through text-muted-foreground' : ''}`}>{item.product_name}</span>
                {item.variant_name && <span className="text-xs text-muted-foreground ml-1">({item.variant_name})</span>}
              </div>
              <Badge variant={isOk ? 'default' : 'secondary'} className="text-xs">{scanned}/{item.quantity}</Badge>
            </div>
          );
        })}
      </div>

      {/* Quality checks */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <h3 className="font-bold text-sm">Checklist de Qualidade</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={qualityChecks.feet_correct} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, feet_correct: !!v }))} />
            <span className="text-sm">Pés corretos (par)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={qualityChecks.no_defects} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, no_defects: !!v }))} />
            <span className="text-sm">Sem defeitos</span>
          </label>
          {hasGift && (
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={qualityChecks.gift_verified} onCheckedChange={(v) => setQualityChecks(prev => ({ ...prev, gift_verified: !!v }))} />
              <span className="text-sm">Brinde verificado 🎁</span>
            </label>
          )}
        </CardContent>
      </Card>

      {/* Confirm */}
      <Button onClick={handleConfirmPacking} disabled={!allVerified || isConfirming} className="w-full gap-2" size="lg">
        {isConfirming ? <Loader2 className="h-5 w-5 animate-spin" /> : <PackageCheck className="h-5 w-5" />}
        Confirmar Bipagem & Gerar EAN-13
      </Button>
    </div>
  );
}

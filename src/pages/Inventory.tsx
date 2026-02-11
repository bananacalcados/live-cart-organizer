import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Package, BarChart3, ScanBarcode, CheckCircle2,
  AlertTriangle, Loader2, Play, Pause, RotateCcw, Store,
  ClipboardList, Trash2, Search, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PosStore {
  id: string;
  name: string;
  tiny_token: string | null;
}

interface CountItem {
  id: string;
  count_id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  counted_quantity: number;
  current_stock: number | null;
  divergence: number | null;
  correction_status: string;
  correction_error: string | null;
}

interface InventoryCount {
  id: string;
  store_id: string;
  scope: string;
  categories: string[];
  status: string;
  total_products: number;
  counted_products: number;
  divergent_products: number;
  corrected_products: number;
  correction_errors: number;
  started_at: string;
  completed_at: string | null;
}

export default function Inventory() {
  const navigate = useNavigate();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [stores, setStores] = useState<PosStore[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [activeCount, setActiveCount] = useState<InventoryCount | null>(null);
  const [countItems, setCountItems] = useState<CountItem[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("1");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingStores, setIsLoadingStores] = useState(true);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionProgress, setCorrectionProgress] = useState({ processed: 0, total: 0, errors: 0 });
  const [showNewCountDialog, setShowNewCountDialog] = useState(false);
  const [newCountScope, setNewCountScope] = useState<'total' | 'partial'>('total');
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [lastBipedProduct, setLastBipedProduct] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("counting");
  const [pastCounts, setPastCounts] = useState<InventoryCount[]>([]);

  // Load stores
  useEffect(() => {
    const loadStores = async () => {
      const { data } = await supabase.from('pos_stores').select('id, name, tiny_token').eq('is_active', true);
      if (data) setStores(data);
      setIsLoadingStores(false);
    };
    loadStores();
  }, []);

  // Load active count for selected store
  useEffect(() => {
    if (!selectedStoreId) return;
    const loadActiveCount = async () => {
      const { data } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', selectedStoreId)
        .in('status', ['counting', 'reviewing', 'correcting'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setActiveCount(data[0] as unknown as InventoryCount);
        loadCountItems(data[0].id);
      } else {
        setActiveCount(null);
        setCountItems([]);
      }

      // Load past counts
      const { data: past } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', selectedStoreId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(10);
      if (past) setPastCounts(past as unknown as InventoryCount[]);
    };
    loadActiveCount();
  }, [selectedStoreId]);

  const loadCountItems = async (countId: string) => {
    const { data } = await supabase
      .from('inventory_count_items')
      .select('*')
      .eq('count_id', countId)
      .order('created_at', { ascending: false });
    if (data) setCountItems(data as unknown as CountItem[]);
  };

  // Realtime for count items
  useEffect(() => {
    if (!activeCount) return;
    const channel = supabase
      .channel(`inventory-${activeCount.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_count_items', filter: `count_id=eq.${activeCount.id}` },
        () => loadCountItems(activeCount.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_counts', filter: `id=eq.${activeCount.id}` },
        async () => {
          const { data } = await supabase.from('inventory_counts').select('*').eq('id', activeCount.id).single();
          if (data) setActiveCount(data as unknown as InventoryCount);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeCount?.id]);

  const handleCreateCount = async () => {
    if (!selectedStoreId) return;
    const { data, error } = await supabase
      .from('inventory_counts')
      .insert({ store_id: selectedStoreId, scope: newCountScope, status: 'counting' })
      .select()
      .single();
    if (error) { toast.error('Erro ao criar balanço'); return; }
    setActiveCount(data as unknown as InventoryCount);
    setCountItems([]);
    setShowNewCountDialog(false);
    toast.success('Balanço iniciado!');
    setTimeout(() => barcodeInputRef.current?.focus(), 300);
  };

  const handleBarcodeScan = async () => {
    if (!barcodeInput.trim() || !activeCount) return;
    const barcode = barcodeInput.trim();
    const qty = parseInt(quantityInput) || 1;
    setBarcodeInput("");
    setQuantityInput("1");

    // Check if product already counted
    const existing = countItems.find(i => i.barcode === barcode || i.sku === barcode);
    if (existing) {
      // Increment quantity
      const newQty = existing.counted_quantity + qty;
      await supabase.from('inventory_count_items').update({ counted_quantity: newQty }).eq('id', existing.id);
      setLastBipedProduct(`${existing.product_name} → ${newQty} un`);
      toast.success(`+${qty} ${existing.product_name} (total: ${newQty})`);
      barcodeInputRef.current?.focus();
      return;
    }

    // Search in pos_products cache
    const { data: products } = await supabase
      .from('pos_products')
      .select('*')
      .eq('store_id', selectedStoreId)
      .or(`barcode.eq.${barcode},sku.eq.${barcode}`)
      .limit(1);

    if (!products || products.length === 0) {
      toast.error(`Produto não encontrado: ${barcode}`);
      barcodeInputRef.current?.focus();
      return;
    }

    const p = products[0];
    const productName = p.name + (p.variant ? ` - ${p.variant}` : '');

    // Insert new count item
    const { error } = await supabase.from('inventory_count_items').insert({
      count_id: activeCount.id,
      product_id: String(p.tiny_id),
      product_name: productName,
      sku: p.sku,
      barcode: p.barcode,
      counted_quantity: qty,
    });

    if (error) {
      toast.error('Erro ao registrar produto');
    } else {
      // Update counted_products
      await supabase.from('inventory_counts').update({
        counted_products: countItems.length + 1
      }).eq('id', activeCount.id);
      setLastBipedProduct(`${productName} → ${qty} un`);
      toast.success(`${productName} bipado! (${qty} un)`);
    }
    barcodeInputRef.current?.focus();
  };

  const handleFinishCounting = async () => {
    if (!activeCount) return;
    setShowFinishDialog(false);
    toast.info('Consultando saldos no Tiny... Isso pode levar alguns minutos.');

    // For each counted item, get current stock from Tiny
    for (const item of countItems) {
      try {
        const { data } = await supabase.functions.invoke('inventory-get-stock', {
          body: { store_id: selectedStoreId, product_id: item.product_id }
        });
        if (data?.success) {
          const currentStock = data.stock;
          const divergence = item.counted_quantity - currentStock;
          await supabase.from('inventory_count_items').update({
            current_stock: currentStock,
            divergence: divergence,
          }).eq('id', item.id);
        }
        // Throttle
        await new Promise(r => setTimeout(r, 2100));
      } catch (e) {
        console.error('Error getting stock:', e);
      }
    }

    // Now handle non-counted products (set stock to 0) for total scope
    if (activeCount.scope === 'total') {
      // Get ALL products from cache that were NOT counted
      const { data: allProducts } = await supabase
        .from('pos_products')
        .select('tiny_id, name, variant, sku, barcode')
        .eq('store_id', selectedStoreId);

      const countedProductIds = new Set(countItems.map(i => i.product_id));
      const uncounted = (allProducts || []).filter(p => !countedProductIds.has(String(p.tiny_id)));

      // Insert uncounted products with qty=0
      for (const p of uncounted) {
        const productName = p.name + (p.variant ? ` - ${p.variant}` : '');
        await supabase.from('inventory_count_items').insert({
          count_id: activeCount.id,
          product_id: String(p.tiny_id),
          product_name: productName,
          sku: p.sku,
          barcode: p.barcode,
          counted_quantity: 0,
          current_stock: null, // will be fetched
          divergence: null,
        });
      }
    }

    // Update count status
    const { data: allItems } = await supabase
      .from('inventory_count_items')
      .select('divergence')
      .eq('count_id', activeCount.id);

    const divergent = allItems?.filter(i => i.divergence !== null && i.divergence !== 0).length || 0;

    await supabase.from('inventory_counts').update({
      status: 'reviewing',
      total_products: allItems?.length || 0,
      divergent_products: divergent,
    }).eq('id', activeCount.id);

    loadCountItems(activeCount.id);
    setActiveTab('review');
    toast.success(`Contagem finalizada! ${divergent} divergências encontradas.`);
  };

  const handleStartCorrection = async () => {
    if (!activeCount) return;

    // Create correction queue entries for divergent items
    const divergentItems = countItems.filter(i => i.divergence !== null && i.divergence !== 0);
    // Also add uncounted items (qty=0 but stock > 0)
    const allDivergent = countItems.filter(i =>
      (i.divergence !== null && i.divergence !== 0) ||
      (i.counted_quantity === 0 && i.current_stock && i.current_stock > 0)
    );

    for (const item of allDivergent) {
      await supabase.from('inventory_correction_queue').insert({
        count_id: activeCount.id,
        count_item_id: item.id,
        store_id: selectedStoreId,
        product_id: item.product_id,
        product_name: item.product_name,
        new_quantity: item.counted_quantity,
        old_quantity: item.current_stock,
      });
    }

    await supabase.from('inventory_counts').update({ status: 'correcting' }).eq('id', activeCount.id);
    setCorrectionProgress({ processed: 0, total: allDivergent.length, errors: 0 });
    setIsCorrecting(true);
    setActiveTab('correction');

    // Start correction loop
    runCorrectionBatch(activeCount.id, allDivergent.length);
  };

  const runCorrectionBatch = async (countId: string, total: number) => {
    let done = false;
    let processed = 0;
    let errors = 0;

    while (!done) {
      try {
        const { data } = await supabase.functions.invoke('inventory-correct-stock', {
          body: { count_id: countId, batch_size: 10 }
        });
        if (data?.done) {
          done = true;
        }
        processed += (data?.processed || 0);
        errors += (data?.errors || 0);
        setCorrectionProgress({ processed, total, errors });
      } catch (e) {
        console.error('Correction batch error:', e);
        // Wait and retry
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    setIsCorrecting(false);
    toast.success('Correção de estoque finalizada!');
  };

  const handleDeleteItem = async (itemId: string) => {
    await supabase.from('inventory_count_items').delete().eq('id', itemId);
    loadCountItems(activeCount!.id);
  };

  const handleDeleteCount = async (countId: string) => {
    await supabase.from('inventory_count_items').delete().eq('count_id', countId);
    await supabase.from('inventory_correction_queue').delete().eq('count_id', countId);
    await supabase.from('inventory_counts').delete().eq('id', countId);
    setActiveCount(null);
    setCountItems([]);
    toast.success('Balanço excluído');
  };

  // Filtered items for review
  const divergentItems = countItems.filter(i => i.divergence !== null && i.divergence !== 0);
  const okItems = countItems.filter(i => i.divergence === 0);
  const pendingStockItems = countItems.filter(i => i.current_stock === null);

  const filteredCountItems = countItems.filter(i =>
    !searchQuery || 
    i.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedStore = stores.find(s => s.id === selectedStoreId);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Package className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Controle de Estoque</h1>
          <div className="flex-1" />
          {stores.length > 0 && (
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger className="w-48">
                <Store className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Selecione a loja" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      <main className="flex-1 container py-6">
        {isLoadingStores ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !selectedStoreId ? (
          <div className="text-center py-20">
            <Store className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold text-muted-foreground">Selecione uma loja</h2>
            <p className="text-sm text-muted-foreground mt-1">Escolha a loja para iniciar o controle de estoque</p>
          </div>
        ) : !activeCount ? (
          /* No active count - show start screen */
          <div className="max-w-lg mx-auto space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Novo Balanço de Estoque
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Inicie um novo balanço para a loja <strong>{selectedStore?.name}</strong>.
                  Bipe os produtos para contagem e o sistema comparará com o saldo do Tiny.
                </p>
                <Button onClick={() => setShowNewCountDialog(true)} className="w-full gap-2">
                  <Play className="h-4 w-4" />
                  Iniciar Balanço
                </Button>
              </CardContent>
            </Card>

            {/* Past counts */}
            {pastCounts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Balanços Anteriores</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pastCounts.map(c => (
                      <div key={c.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">
                            {new Date(c.started_at).toLocaleDateString('pt-BR')}
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {c.scope === 'total' ? 'Total' : 'Parcial'}
                            </Badge>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c.total_products} produtos • {c.divergent_products} divergências • {c.corrected_products} corrigidos
                          </p>
                        </div>
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          /* Active count */
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{countItems.length}</p>
                  <p className="text-xs text-muted-foreground">Bipados</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{countItems.reduce((s, i) => s + i.counted_quantity, 0)}</p>
                  <p className="text-xs text-muted-foreground">Unidades</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-amber-500">{divergentItems.length}</p>
                  <p className="text-xs text-muted-foreground">Divergências</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-green-500">{activeCount.corrected_products}</p>
                  <p className="text-xs text-muted-foreground">Corrigidos</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-destructive">{activeCount.correction_errors}</p>
                  <p className="text-xs text-muted-foreground">Erros</p>
                </CardContent>
              </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger value="counting" className="flex-1">
                  <ScanBarcode className="h-4 w-4 mr-1" /> Bipagem
                </TabsTrigger>
                <TabsTrigger value="review" className="flex-1">
                  <BarChart3 className="h-4 w-4 mr-1" /> Revisão
                </TabsTrigger>
                <TabsTrigger value="correction" className="flex-1">
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Correção
                </TabsTrigger>
              </TabsList>

              {/* Counting Tab */}
              <TabsContent value="counting" className="space-y-4">
                {activeCount.status === 'counting' && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex gap-2">
                        <Input
                          ref={barcodeInputRef}
                          placeholder="Bipe o código de barras ou SKU..."
                          value={barcodeInput}
                          onChange={(e) => setBarcodeInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleBarcodeScan()}
                          className="flex-1 text-lg h-12"
                          autoFocus
                        />
                        <Input
                          placeholder="Qtd"
                          type="number"
                          min="1"
                          value={quantityInput}
                          onChange={(e) => setQuantityInput(e.target.value)}
                          className="w-20 h-12 text-center text-lg"
                        />
                        <Button onClick={handleBarcodeScan} className="h-12 px-6">
                          <ScanBarcode className="h-5 w-5" />
                        </Button>
                      </div>
                      {lastBipedProduct && (
                        <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-2 rounded">
                          ✅ Último: {lastBipedProduct}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar produto..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {activeCount.status === 'counting' && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowFinishDialog(true)}>
                        Finalizar Contagem
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteCount(activeCount.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {filteredCountItems.map(item => (
                      <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 group">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.product_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.sku && `SKU: ${item.sku}`} {item.barcode && `• ${item.barcode}`}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-sm font-bold">
                          {item.counted_quantity} un
                        </Badge>
                        {activeCount.status === 'counting' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100"
                            onClick={() => handleDeleteItem(item.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {filteredCountItems.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">
                        {countItems.length === 0 ? 'Nenhum produto bipado ainda' : 'Nenhum resultado'}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Review Tab */}
              <TabsContent value="review" className="space-y-4">
                {activeCount.status === 'reviewing' && (
                  <Card className="border-amber-200 dark:border-amber-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">
                            {divergentItems.length} divergências encontradas
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {okItems.length} produtos OK • {pendingStockItems.length} pendentes de consulta
                          </p>
                        </div>
                        <Button onClick={handleStartCorrection} className="gap-2" disabled={divergentItems.length === 0}>
                          <Play className="h-4 w-4" />
                          Corrigir Estoque
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <ScrollArea className="h-[450px]">
                  <div className="space-y-1">
                    {divergentItems.map(item => (
                      <div key={item.id} className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border",
                        item.divergence! > 0 ? "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20" :
                        "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                      )}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.product_name}</p>
                          <p className="text-xs text-muted-foreground">{item.sku || item.barcode || ''}</p>
                        </div>
                        <div className="text-right text-xs space-y-0.5">
                          <p>Tiny: <span className="font-bold">{item.current_stock ?? '?'}</span></p>
                          <p>Contagem: <span className="font-bold">{item.counted_quantity}</span></p>
                        </div>
                        <Badge className={cn("text-xs",
                          item.divergence! > 0 ? "bg-blue-500" : "bg-amber-500"
                        )}>
                          {item.divergence! > 0 ? '+' : ''}{item.divergence}
                        </Badge>
                      </div>
                    ))}
                    {divergentItems.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">
                        {activeCount.status === 'counting' ? 'Finalize a contagem para ver divergências' : 'Nenhuma divergência! 🎉'}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Correction Tab */}
              <TabsContent value="correction" className="space-y-4">
                {isCorrecting && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Corrigindo estoque...
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {correctionProgress.processed}/{correctionProgress.total}
                        </p>
                      </div>
                      <Progress value={correctionProgress.total > 0 ? (correctionProgress.processed / correctionProgress.total) * 100 : 0} />
                      <p className="text-xs text-muted-foreground">
                        {correctionProgress.errors > 0 && `${correctionProgress.errors} erros (serão retentados)`}
                        {' • '}Não feche esta página
                      </p>
                    </CardContent>
                  </Card>
                )}

                {activeCount.status === 'completed' && (
                  <Card className="border-green-200 dark:border-green-800">
                    <CardContent className="p-4 text-center space-y-2">
                      <CheckCircle2 className="h-12 w-12 mx-auto text-green-500" />
                      <p className="font-semibold text-lg">Balanço Concluído!</p>
                      <p className="text-sm text-muted-foreground">
                        {activeCount.corrected_products} corrigidos • {activeCount.correction_errors} erros
                      </p>
                    </CardContent>
                  </Card>
                )}

                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {countItems.filter(i => i.correction_status !== 'pending' || i.divergence !== 0).map(item => (
                      <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.product_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.current_stock ?? '?'} → {item.counted_quantity}
                          </p>
                        </div>
                        {item.correction_status === 'corrected' && (
                          <Badge className="bg-green-500 text-xs">✓ Corrigido</Badge>
                        )}
                        {item.correction_status === 'error' && (
                          <Badge variant="destructive" className="text-xs" title={item.correction_error || ''}>
                            Erro
                          </Badge>
                        )}
                        {item.correction_status === 'pending' && item.divergence !== 0 && (
                          <Badge variant="secondary" className="text-xs">Pendente</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>

      {/* New Count Dialog */}
      <Dialog open={showNewCountDialog} onOpenChange={setShowNewCountDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Balanço de Estoque</DialogTitle>
            <DialogDescription>
              Loja: {selectedStore?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Escopo do balanço:</p>
              <div className="grid grid-cols-2 gap-3">
                <Card
                  className={cn("cursor-pointer p-4 transition-all", newCountScope === 'total' && "border-primary ring-2 ring-primary/20")}
                  onClick={() => setNewCountScope('total')}
                >
                  <p className="font-semibold text-sm">Total</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Todos os produtos. O que não for bipado terá estoque zerado.
                  </p>
                </Card>
                <Card
                  className={cn("cursor-pointer p-4 transition-all", newCountScope === 'partial' && "border-primary ring-2 ring-primary/20")}
                  onClick={() => setNewCountScope('partial')}
                >
                  <p className="font-semibold text-sm">Parcial</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Apenas os produtos bipados serão conferidos.
                  </p>
                </Card>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCountDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreateCount}>Iniciar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finish Counting Dialog */}
      <Dialog open={showFinishDialog} onOpenChange={setShowFinishDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar Contagem?</DialogTitle>
            <DialogDescription>
              {activeCount?.scope === 'total'
                ? `Balanço TOTAL: ${countItems.length} produtos bipados. Todos os outros produtos da loja terão estoque ZERADO.`
                : `Balanço PARCIAL: ${countItems.length} produtos bipados serão conferidos.`
              }
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O sistema irá consultar o saldo atual de cada produto no Tiny para calcular divergências.
            Este processo pode levar alguns minutos.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFinishDialog(false)}>Voltar</Button>
            <Button onClick={handleFinishCounting} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

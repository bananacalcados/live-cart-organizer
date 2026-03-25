import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Package, BarChart3, ScanBarcode, CheckCircle2,
  AlertTriangle, Loader2, Play, Pause, RotateCcw, Store,
  ClipboardList, Trash2, Search, ChevronDown, HelpCircle,
  Camera, Tag, Printer, Download, FileText, Link2, ShoppingBag, ClipboardCheck
} from "lucide-react";
import { InventoryVerification } from "@/components/inventory/InventoryVerification";
import { ProductCaptureTab } from "@/components/inventory/ProductCaptureTab";
import { POSBarcodeScanner } from "@/components/pos/POSBarcodeScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

interface UnresolvedBarcode {
  id: string;
  count_id: string;
  store_id: string;
  barcode: string;
  scanned_quantity: number;
  photo_url: string | null;
  notes: string | null;
  status: string;
  resolved_product_tiny_id: number | null;
  resolved_product_name: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface PosProduct {
  id: string;
  tiny_id: number;
  name: string;
  variant: string;
  sku: string;
  barcode: string;
  category: string | null;
}

// ---- GTIN-13 helpers ----
function calcCheckDigit(digits12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const remainder = sum % 10;
  return remainder === 0 ? "0" : String(10 - remainder);
}

function generateGTIN13(seq: number): string {
  // Prefix 200 = internal/in-store use (GS1 standard)
  const base = "200" + String(seq).padStart(9, "0");
  return base + calcCheckDigit(base);
}

// ---- ZPL label generator ----
function generateZPL(barcode: string, productName: string, sku: string): string {
  const truncName = productName.length > 40 ? productName.substring(0, 40) + "..." : productName;
  return `^XA
^FO30,30^A0N,28,28^FD${truncName}^FS
^FO30,65^A0N,22,22^FDSKU: ${sku}^FS
^FO30,100^BY2^BCN,60,Y,N,N^FD${barcode}^FS
^XZ`;
}

// ---- PDF label generator ----
function generateLabelPDF(labels: Array<{ barcode: string; productName: string; sku: string }>): void {
  // Generate a simple printable HTML page with barcode labels
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Etiquetas de Código de Barras</title>
<style>
  @page { size: auto; margin: 5mm; }
  body { font-family: Arial, sans-serif; margin: 0; padding: 10px; }
  .label-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .label { border: 1px dashed #ccc; padding: 8px; text-align: center; page-break-inside: avoid; }
  .label .name { font-size: 10px; font-weight: bold; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .label .sku { font-size: 9px; color: #666; margin-bottom: 6px; }
  .label .barcode { font-size: 14px; font-family: 'Libre Barcode 128', monospace; letter-spacing: 2px; }
  .label .barcode-text { font-size: 10px; margin-top: 2px; }
  @media print { .no-print { display: none; } }
</style>
<link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
</head><body>
<div class="no-print" style="margin-bottom:10px;">
  <button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer;">🖨️ Imprimir</button>
</div>
<div class="label-grid">
${labels.map(l => `<div class="label">
  <div class="name">${l.productName}</div>
  <div class="sku">SKU: ${l.sku}</div>
  <div class="barcode">${l.barcode}</div>
  <div class="barcode-text">${l.barcode}</div>
</div>`).join('')}
</div></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
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
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState({ current: 0, total: 0 });
  const [lastBipedProduct, setLastBipedProduct] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("counting");
  const [pastCounts, setPastCounts] = useState<InventoryCount[]>([]);
  const [inventoryMode, setInventoryMode] = useState<"stock" | "capture">("stock");

  // Unknown barcode states
  const [unresolvedBarcodes, setUnresolvedBarcodes] = useState<UnresolvedBarcode[]>([]);
  const [showUnknownBarcodeDialog, setShowUnknownBarcodeDialog] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState("");
  const [unknownQty, setUnknownQty] = useState(1);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<PosProduct[]>([]);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [unresolvedNotes, setUnresolvedNotes] = useState("");

  // Resolve dialog
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [resolvingBarcode, setResolvingBarcode] = useState<UnresolvedBarcode | null>(null);
  const [resolveSearchQuery, setResolveSearchQuery] = useState("");
  const [resolveSearchResults, setResolveSearchResults] = useState<PosProduct[]>([]);
  const [isResolveSearching, setIsResolveSearching] = useState(false);

  // Auto re-lookup
  const [isAutoRelooking, setIsAutoRelooking] = useState(false);
  const [relookupProgress, setRelookupProgress] = useState({ done: 0, total: 0, found: 0 });

  // Label printing
  const [showLabelDialog, setShowLabelDialog] = useState(false);
  const [labelItems, setLabelItems] = useState<Array<{ barcode: string; productName: string; sku: string; qty: number }>>([]);
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  // Standalone label generator
  const [labelSearchQuery, setLabelSearchQuery] = useState("");
  const [labelSearchResults, setLabelSearchResults] = useState<PosProduct[]>([]);
  const [isLabelSearching, setIsLabelSearching] = useState(false);
  const [selectedLabelProducts, setSelectedLabelProducts] = useState<Array<{ product: PosProduct; qty: number }>>([]);

  // Load stores
  useEffect(() => {
    const loadStores = async () => {
      const { data } = await supabase.from('pos_stores').select('id, name, tiny_token').eq('is_active', true).eq('is_simulation', false);
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
        loadUnresolvedBarcodes(data[0].id);
      } else {
        setActiveCount(null);
        setCountItems([]);
        setUnresolvedBarcodes([]);
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

  // Auto-resume correction when page loads with a 'correcting' count
  useEffect(() => {
    if (!activeCount || activeCount.status !== 'correcting' || isCorrecting) return;
    const resumeCorrection = async () => {
      const { count: pendingCount } = await supabase
        .from('inventory_correction_queue')
        .select('id', { count: 'exact', head: true })
        .eq('count_id', activeCount.id)
        .in('status', ['pending', 'error']);
      const totalPending = pendingCount || 0;
      if (totalPending > 0) {
        const { count: totalCount } = await supabase
          .from('inventory_correction_queue')
          .select('id', { count: 'exact', head: true })
          .eq('count_id', activeCount.id);
        setCorrectionProgress({ processed: (totalCount || 0) - totalPending, total: totalCount || 0, errors: 0 });
        setIsCorrecting(true);
        setActiveTab('correction');
        runCorrectionBatch(activeCount.id, totalCount || 0);
      }
    };
    resumeCorrection();
  }, [activeCount]);

  const loadCountItems = async (countId: string) => {
    // Load all items in batches to bypass the 1000-row default limit
    let allData: CountItem[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from('inventory_count_items')
        .select('*')
        .eq('count_id', countId)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      allData = allData.concat(data as unknown as CountItem[]);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setCountItems(allData);
  };

  const loadUnresolvedBarcodes = async (countId: string) => {
    const { data } = await supabase
      .from('inventory_unresolved_barcodes')
      .select('*')
      .eq('count_id', countId)
      .order('created_at', { ascending: false });
    if (data) setUnresolvedBarcodes(data as unknown as UnresolvedBarcode[]);
  };

  // Realtime for count items and unresolved
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_unresolved_barcodes', filter: `count_id=eq.${activeCount.id}` },
        () => loadUnresolvedBarcodes(activeCount.id))
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
    setUnresolvedBarcodes([]);
    setShowNewCountDialog(false);
    toast.success('Balanço iniciado!');
    setTimeout(() => barcodeInputRef.current?.focus(), 300);
  };

  const handleBarcodeScan = async (overrideBarcode?: string, overrideQty?: number) => {
    const barcode = (overrideBarcode || barcodeInput).trim();
    if (!barcode || !activeCount) return;
    const qty = overrideQty ?? (parseInt(quantityInput) || 1);
    setBarcodeInput("");
    setQuantityInput("1");

    // Check if product already counted
    const existing = countItems.find(i => i.barcode === barcode || i.sku === barcode);
    if (existing) {
      const newQty = existing.counted_quantity + qty;
      await supabase.from('inventory_count_items').update({ counted_quantity: newQty }).eq('id', existing.id);
      setLastBipedProduct(`${existing.product_name} → ${newQty} un`);
      toast.success(`+${qty} ${existing.product_name} (total: ${newQty})`);
      barcodeInputRef.current?.focus();
      return;
    }

    // Check if it's an already-registered unresolved barcode
    const existingUnresolved = unresolvedBarcodes.find(u => u.barcode === barcode && u.status === 'pending');
    if (existingUnresolved) {
      await supabase.from('inventory_unresolved_barcodes')
        .update({ scanned_quantity: existingUnresolved.scanned_quantity + qty })
        .eq('id', existingUnresolved.id);
      setLastBipedProduct(`⚠️ ${barcode} (não encontrado) → ${existingUnresolved.scanned_quantity + qty} un`);
      toast.warning(`Código ${barcode} já está na lista de pendentes (+${qty})`);
      barcodeInputRef.current?.focus();
      return;
    }

    // Check barcode aliases first
    const { data: aliases } = await supabase
      .from('inventory_barcode_aliases')
      .select('*')
      .eq('store_id', selectedStoreId)
      .eq('original_barcode', barcode)
      .limit(1);

    if (aliases && aliases.length > 0) {
      const alias = aliases[0];
      // Find in count items by product_id
      const existingByProduct = countItems.find(i => i.product_id === String(alias.product_tiny_id));
      if (existingByProduct) {
        const newQty = existingByProduct.counted_quantity + qty;
        await supabase.from('inventory_count_items').update({ counted_quantity: newQty }).eq('id', existingByProduct.id);
        setLastBipedProduct(`${existingByProduct.product_name} (alias) → ${newQty} un`);
        toast.success(`+${qty} ${existingByProduct.product_name} (via alias, total: ${newQty})`);
      } else {
        await supabase.from('inventory_count_items').insert({
          count_id: activeCount.id,
          product_id: String(alias.product_tiny_id),
          product_name: alias.product_name,
          sku: alias.product_sku,
          barcode: barcode,
          counted_quantity: qty,
        });
        setLastBipedProduct(`${alias.product_name} (alias) → ${qty} un`);
        toast.success(`${alias.product_name} bipado via alias! (${qty} un)`);
      }
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
      // NOT FOUND — show dialog
      setUnknownBarcode(barcode);
      setUnknownQty(qty);
      setProductSearchQuery("");
      setProductSearchResults([]);
      setUnresolvedNotes("");
      setShowUnknownBarcodeDialog(true);
      return;
    }

    const p = products[0];
    const productName = p.name + (p.variant ? ` - ${p.variant}` : '');

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
      await supabase.from('inventory_counts').update({
        counted_products: countItems.length + 1
      }).eq('id', activeCount.id);
      setLastBipedProduct(`${productName} → ${qty} un`);
      toast.success(`${productName} bipado! (${qty} un)`);
    }
    barcodeInputRef.current?.focus();
  };

  // Product search for unknown barcode dialog
  const handleProductSearch = async (query: string) => {
    setProductSearchQuery(query);
    if (query.length < 2) { setProductSearchResults([]); return; }
    setIsSearchingProducts(true);
    const { data } = await supabase
      .from('pos_products')
      .select('id, tiny_id, name, variant, sku, barcode, category')
      .eq('store_id', selectedStoreId)
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%,variant.ilike.%${query}%`)
      .limit(20);
    setProductSearchResults((data || []) as unknown as PosProduct[]);
    setIsSearchingProducts(false);
  };

  // Link unknown barcode to a product
  const handleLinkBarcodeToProduct = async (product: PosProduct) => {
    if (!activeCount) return;
    const productName = product.name + (product.variant ? ` - ${product.variant}` : '');

    // Create alias for future scans
    await supabase.from('inventory_barcode_aliases').upsert({
      store_id: selectedStoreId,
      original_barcode: unknownBarcode,
      product_tiny_id: product.tiny_id,
      product_name: productName,
      product_sku: product.sku,
      notes: `Vinculado durante balanço em ${new Date().toLocaleDateString('pt-BR')}`,
    }, { onConflict: 'store_id,original_barcode' });

    // Add to count
    const existingByProduct = countItems.find(i => i.product_id === String(product.tiny_id));
    if (existingByProduct) {
      const newQty = existingByProduct.counted_quantity + unknownQty;
      await supabase.from('inventory_count_items').update({ counted_quantity: newQty }).eq('id', existingByProduct.id);
      setLastBipedProduct(`${productName} (vinculado) → ${newQty} un`);
      toast.success(`+${unknownQty} ${productName} (total: ${newQty}). Alias criado!`);
    } else {
      await supabase.from('inventory_count_items').insert({
        count_id: activeCount.id,
        product_id: String(product.tiny_id),
        product_name: productName,
        sku: product.sku,
        barcode: unknownBarcode,
        counted_quantity: unknownQty,
      });
      setLastBipedProduct(`${productName} (vinculado) → ${unknownQty} un`);
      toast.success(`${productName} bipado e alias criado! (${unknownQty} un)`);
    }

    setShowUnknownBarcodeDialog(false);
    barcodeInputRef.current?.focus();
  };

  // Skip unknown barcode — save for later
  const handleSkipUnknownBarcode = async () => {
    if (!activeCount) return;
    await supabase.from('inventory_unresolved_barcodes').insert({
      count_id: activeCount.id,
      store_id: selectedStoreId,
      barcode: unknownBarcode,
      scanned_quantity: unknownQty,
      notes: unresolvedNotes || null,
    });
    setLastBipedProduct(`⚠️ ${unknownBarcode} → pendente (${unknownQty} un)`);
    toast.warning(`Código ${unknownBarcode} salvo como pendente`);
    setShowUnknownBarcodeDialog(false);
    barcodeInputRef.current?.focus();
  };

  // Resolve an unresolved barcode later
  const handleResolveSearch = async (query: string) => {
    setResolveSearchQuery(query);
    if (query.length < 2) { setResolveSearchResults([]); return; }
    setIsResolveSearching(true);
    const { data } = await supabase
      .from('pos_products')
      .select('id, tiny_id, name, variant, sku, barcode, category')
      .eq('store_id', selectedStoreId)
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%,variant.ilike.%${query}%`)
      .limit(20);
    setResolveSearchResults((data || []) as unknown as PosProduct[]);
    setIsResolveSearching(false);
  };

  const handleResolveBarcode = async (product: PosProduct) => {
    if (!resolvingBarcode || !activeCount) return;
    const productName = product.name + (product.variant ? ` - ${product.variant}` : '');

    // Create alias
    await supabase.from('inventory_barcode_aliases').upsert({
      store_id: selectedStoreId,
      original_barcode: resolvingBarcode.barcode,
      product_tiny_id: product.tiny_id,
      product_name: productName,
      product_sku: product.sku,
      notes: `Resolvido durante balanço`,
    }, { onConflict: 'store_id,original_barcode' });

    // Add/update count item
    const existingByProduct = countItems.find(i => i.product_id === String(product.tiny_id));
    if (existingByProduct) {
      const newQty = existingByProduct.counted_quantity + resolvingBarcode.scanned_quantity;
      await supabase.from('inventory_count_items').update({ counted_quantity: newQty }).eq('id', existingByProduct.id);
    } else {
      await supabase.from('inventory_count_items').insert({
        count_id: activeCount.id,
        product_id: String(product.tiny_id),
        product_name: productName,
        sku: product.sku,
        barcode: resolvingBarcode.barcode,
        counted_quantity: resolvingBarcode.scanned_quantity,
      });
    }

    // Update unresolved status
    await supabase.from('inventory_unresolved_barcodes').update({
      status: 'resolved',
      resolved_product_tiny_id: product.tiny_id,
      resolved_product_name: productName,
      resolved_at: new Date().toISOString(),
    }).eq('id', resolvingBarcode.id);

    toast.success(`${productName} vinculado ao código ${resolvingBarcode.barcode}!`);
    setShowResolveDialog(false);
    setResolvingBarcode(null);
  };

  // Generate GTIN and prepare labels
  const handleGenerateGTIN = async (unresolvedIds: string[]) => {
    const items: typeof labelItems = [];
    for (const id of unresolvedIds) {
      const item = unresolvedBarcodes.find(u => u.id === id);
      if (!item || item.status !== 'resolved' || !item.resolved_product_name) continue;

      // Get next GTIN sequence
      const { data: seqData } = await supabase.rpc('nextval' as never, { seq_name: 'inventory_gtin_seq' } as never);
      // Fallback: use timestamp-based seq
      const seq = seqData ? Number(seqData) : Date.now() % 1000000000;
      const gtin = generateGTIN13(seq);

      // Update the alias with the generated GTIN
      await supabase.from('inventory_barcode_aliases')
        .update({ notes: `GTIN gerado: ${gtin}` })
        .eq('store_id', selectedStoreId)
        .eq('original_barcode', item.barcode);

      items.push({
        barcode: gtin,
        productName: item.resolved_product_name,
        sku: item.barcode, // original barcode as reference
        qty: item.scanned_quantity,
      });
    }
    if (items.length === 0) {
      toast.error('Nenhum item resolvido selecionado');
      return;
    }
    setLabelItems(items);
    setShowLabelDialog(true);
  };

  // Generate GTIN for all resolved
  const handleGenerateAllGTINs = async () => {
    const resolvedIds = unresolvedBarcodes.filter(u => u.status === 'resolved').map(u => u.id);
    if (resolvedIds.length === 0) { toast.error('Nenhum código resolvido para gerar GTIN'); return; }
    await handleGenerateGTIN(resolvedIds);
  };

  // Standalone label search
  const handleLabelSearch = async (query: string) => {
    setLabelSearchQuery(query);
    if (query.length < 2) { setLabelSearchResults([]); return; }
    setIsLabelSearching(true);
    const { data } = await supabase
      .from('pos_products')
      .select('id, tiny_id, name, variant, sku, barcode, category')
      .eq('store_id', selectedStoreId)
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%,variant.ilike.%${query}%`)
      .limit(20);
    setLabelSearchResults((data || []) as unknown as PosProduct[]);
    setIsLabelSearching(false);
  };

  const handleAddLabelProduct = (product: PosProduct) => {
    const exists = selectedLabelProducts.find(p => p.product.id === product.id);
    if (exists) {
      setSelectedLabelProducts(prev => prev.map(p => p.product.id === product.id ? { ...p, qty: p.qty + 1 } : p));
    } else {
      setSelectedLabelProducts(prev => [...prev, { product, qty: 1 }]);
    }
    setLabelSearchQuery("");
    setLabelSearchResults([]);
  };

  const handlePrintStandaloneLabels = () => {
    if (selectedLabelProducts.length === 0) { toast.error('Adicione produtos para gerar etiquetas'); return; }
    const items = selectedLabelProducts.flatMap(({ product, qty }) => {
      const productName = product.name + (product.variant ? ` - ${product.variant}` : '');
      const barcode = product.barcode || product.sku || '';
      return Array(qty).fill({ barcode, productName, sku: product.sku || '' });
    });
    setLabelItems(items.map(i => ({ ...i, qty: 1 })));
    setShowLabelDialog(true);
  };

  const handleFinishCounting = async () => {
    if (!activeCount) return;
    setShowFinishDialog(false);
    setIsVerifying(true);

    // Step 1: If total scope, insert uncounted products with qty=0
    if (activeCount.scope === 'total') {
      toast.info('Inserindo produtos não bipados (balanço total)...');
      let allProducts: any[] = [];
      let prodFrom = 0;
      const prodPageSize = 1000;
      while (true) {
        const { data: batch } = await supabase
          .from('pos_products')
          .select('tiny_id, name, variant, sku, barcode')
          .eq('store_id', selectedStoreId)
          .range(prodFrom, prodFrom + prodPageSize - 1);
        if (!batch || batch.length === 0) break;
        allProducts = allProducts.concat(batch);
        if (batch.length < prodPageSize) break;
        prodFrom += prodPageSize;
      }

      const countedProductIds = new Set(countItems.map(i => i.product_id));
      const uncounted = allProducts.filter(p => !countedProductIds.has(String(p.tiny_id)));

      // Batch insert uncounted products
      const batchSize = 50;
      for (let i = 0; i < uncounted.length; i += batchSize) {
        const batch = uncounted.slice(i, i + batchSize).map(p => ({
          count_id: activeCount.id,
          product_id: String(p.tiny_id),
          product_name: p.name + (p.variant ? ` - ${p.variant}` : ''),
          sku: p.sku,
          barcode: p.barcode,
          counted_quantity: 0,
          current_stock: null,
          divergence: null,
        }));
        await supabase.from('inventory_count_items').insert(batch);
      }

      toast.success(`${uncounted.length} produtos não bipados adicionados com qty=0`);
    }

    // Step 2: Use server-side Edge Function to verify stock in batches
    toast.info('Verificando saldos no Tiny (server-side)... Isso pode levar alguns minutos.');
    let done = false;
    let totalVerified = 0;
    
    while (!done) {
      try {
        const { data } = await supabase.functions.invoke('inventory-verify-and-correct', {
          body: { count_id: activeCount.id, store_id: selectedStoreId, batch_size: 20 }
        });
        if (data?.done) {
          done = true;
        }
        totalVerified += (data?.verified || 0);
        const remaining = data?.remaining || 0;
        setVerifyProgress({ current: totalVerified, total: totalVerified + remaining });
      } catch (e) {
        console.error('Verify batch error:', e);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    setIsVerifying(false);
    loadCountItems(activeCount.id);
    setActiveTab('review');
    toast.success('Verificação de saldos finalizada! Confira as divergências.');
  };

  const handleStartCorrection = async () => {
    if (!activeCount) return;

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
        if (data?.done) done = true;
        processed += (data?.processed || 0);
        errors += (data?.errors || 0);
        setCorrectionProgress({ processed, total, errors });
      } catch (e) {
        console.error('Correction batch error:', e);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    setIsCorrecting(false);
    loadCountItems(countId);
    toast.success('Correção de estoque finalizada!');
  };

  const handleRetryErrors = async () => {
    if (!activeCount) return;

    // Reset attempts and status for error items in the queue
    const { error } = await supabase
      .from('inventory_correction_queue')
      .update({ status: 'pending', attempts: 0 })
      .eq('count_id', activeCount.id)
      .eq('status', 'error');

    if (error) { toast.error('Erro ao resetar itens'); return; }

    // Also reset correction_status on count items
    const errorItems = countItems.filter(i => i.correction_status === 'error');
    for (const item of errorItems) {
      await supabase.from('inventory_count_items').update({
        correction_status: 'pending', correction_error: null
      }).eq('id', item.id);
    }

    // Get total pending
    const { count: totalCount } = await supabase
      .from('inventory_correction_queue')
      .select('id', { count: 'exact', head: true })
      .eq('count_id', activeCount.id)
      .in('status', ['pending']);

    const total = totalCount || errorItems.length;
    setCorrectionProgress({ processed: 0, total, errors: 0 });
    setIsCorrecting(true);

    await supabase.from('inventory_counts').update({ status: 'correcting' }).eq('id', activeCount.id);
    runCorrectionBatch(activeCount.id, total);
    toast.info(`Retentando ${errorItems.length} itens com erro...`);
  };

  const handleDeleteItem = async (itemId: string) => {
    await supabase.from('inventory_count_items').delete().eq('id', itemId);
    loadCountItems(activeCount!.id);
  };

  const handleDeleteCount = async (countId: string) => {
    await supabase.from('inventory_count_items').delete().eq('count_id', countId);
    await supabase.from('inventory_correction_queue').delete().eq('count_id', countId);
    await supabase.from('inventory_unresolved_barcodes').delete().eq('count_id', countId);
    await supabase.from('inventory_counts').delete().eq('id', countId);
    setActiveCount(null);
    setCountItems([]);
    setUnresolvedBarcodes([]);
    toast.success('Balanço excluído');
  };

  // Filtered items for review
  const divergentItems = countItems.filter(i => i.divergence !== null && i.divergence !== 0);
  const okItems = countItems.filter(i => i.divergence === 0);
  const pendingStockItems = countItems.filter(i => i.current_stock === null);
  const pendingUnresolved = unresolvedBarcodes.filter(u => u.status === 'pending');
  const resolvedUnresolved = unresolvedBarcodes.filter(u => u.status === 'resolved');

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
          {stores.length > 0 && selectedStoreId && (
            <div className="flex gap-1 bg-muted rounded-lg p-0.5">
              <Button
                variant={inventoryMode === "stock" ? "default" : "ghost"}
                size="sm"
                onClick={() => setInventoryMode("stock")}
                className="text-xs h-7 gap-1"
              >
                <ClipboardList className="h-3 w-3" /> Balanço
              </Button>
              <Button
                variant={inventoryMode === "capture" ? "default" : "ghost"}
                size="sm"
                onClick={() => setInventoryMode("capture")}
                className="text-xs h-7 gap-1"
              >
                <ShoppingBag className="h-3 w-3" /> Captação
              </Button>
            </div>
          )}
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
        ) : inventoryMode === "capture" ? (
          <ProductCaptureTab storeId={selectedStoreId} storeName={selectedStore?.name || ""} />
        ) : !activeCount ? (
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
                </p>
                <Button onClick={() => setShowNewCountDialog(true)} className="w-full gap-2">
                  <Play className="h-4 w-4" />
                  Iniciar Balanço
                </Button>
              </CardContent>
            </Card>

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
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm('Tem certeza que deseja excluir este balanço?')) {
                                handleDeleteCount(c.id);
                                setPastCounts(prev => prev.filter(p => p.id !== c.id));
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Standalone Label Generator */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Printer className="h-5 w-5" />
                  Gerar Etiquetas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Pesquise produtos para gerar etiquetas com código de barras e descrição. Útil para devoluções ou produtos com etiqueta danificada.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Buscar por nome, SKU ou código de barras..."
                    value={labelSearchQuery}
                    onChange={(e) => handleLabelSearch(e.target.value)}
                    className="flex-1"
                  />
                  {isLabelSearching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mt-2" />}
                </div>

                {labelSearchResults.length > 0 && (
                  <ScrollArea className="max-h-48 border rounded-lg">
                    <div className="p-1">
                      {labelSearchResults.map(p => {
                        const fullName = p.name + (p.variant ? ` - ${p.variant}` : '');
                        return (
                          <button
                            key={p.id}
                            onClick={() => handleAddLabelProduct(p)}
                            className="w-full text-left p-2 hover:bg-muted/50 rounded text-sm flex items-center justify-between"
                          >
                            <div>
                              <p className="font-medium">{fullName}</p>
                              <p className="text-xs text-muted-foreground">
                                SKU: {p.sku || '—'} · Cod: {p.barcode || '—'}
                              </p>
                            </div>
                            <Tag className="h-4 w-4 text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}

                {selectedLabelProducts.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Produtos selecionados:</Label>
                    {selectedLabelProducts.map(({ product, qty }, i) => {
                      const fullName = product.name + (product.variant ? ` - ${product.variant}` : '');
                      return (
                        <div key={product.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{fullName}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {product.barcode || product.sku || '—'}
                            </p>
                          </div>
                          <Input
                            type="number"
                            min="1"
                            value={qty}
                            onChange={(e) => {
                              const newQty = parseInt(e.target.value) || 1;
                              setSelectedLabelProducts(prev => prev.map((p, idx) => idx === i ? { ...p, qty: newQty } : p));
                            }}
                            className="w-16 h-8 text-center text-sm"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setSelectedLabelProducts(prev => prev.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      );
                    })}
                    <div className="flex gap-2">
                      <Button onClick={handlePrintStandaloneLabels} className="flex-1 gap-2">
                        <Printer className="h-4 w-4" />
                        Gerar Etiquetas ({selectedLabelProducts.reduce((s, p) => s + p.qty, 0)})
                      </Button>
                      <Button variant="outline" onClick={() => setSelectedLabelProducts([])}>
                        Limpar
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Active count */
          <div className="space-y-4">
            {/* Active count header with delete button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{activeCount.scope === 'total' ? 'Balanço Total' : 'Balanço Parcial'}</Badge>
                <span className="text-xs text-muted-foreground">
                  Iniciado em {new Date(activeCount.started_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1"
                onClick={() => {
                  if (confirm('Tem certeza que deseja excluir este balanço e todos os itens? Esta ação não pode ser desfeita.')) {
                    handleDeleteCount(activeCount.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                Apagar Balanço
              </Button>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
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
              <Card>
                <CardContent className="p-3 text-center">
                  <p className={cn("text-2xl font-bold", pendingUnresolved.length > 0 ? "text-orange-500" : "text-muted-foreground")}>
                    {pendingUnresolved.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Pendentes</p>
                </CardContent>
              </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger value="counting" className="flex-1">
                  <ScanBarcode className="h-4 w-4 mr-1" /> Bipagem
                </TabsTrigger>
                <TabsTrigger value="verification" className="flex-1">
                  <ClipboardCheck className="h-4 w-4 mr-1" /> Conferência
                </TabsTrigger>
                <TabsTrigger value="unresolved" className="flex-1 relative">
                  <HelpCircle className="h-4 w-4 mr-1" /> Pendentes
                  {pendingUnresolved.length > 0 && (
                    <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 text-[10px] flex items-center justify-center rounded-full">
                      {pendingUnresolved.length}
                    </Badge>
                  )}
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
                        <Button onClick={() => handleBarcodeScan()} className="h-12 px-4">
                          <ScanBarcode className="h-5 w-5" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowCameraScanner(true)}
                          className="h-12 px-4"
                        >
                          <Camera className="h-5 w-5" />
                        </Button>
                      </div>
                      {lastBipedProduct && (
                        <div className={cn(
                          "text-sm p-2 rounded",
                          lastBipedProduct.includes("⚠️")
                            ? "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30"
                            : "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30"
                        )}>
                          {lastBipedProduct.includes("⚠️") ? "" : "✅ "}Último: {lastBipedProduct}
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

              {/* Verification Tab */}
              <TabsContent value="verification" className="space-y-4">
                {countItems.length === 0 ? (
                  <div className="text-center py-12">
                    <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-muted-foreground">Nenhum produto bipado ainda.</p>
                    <p className="text-xs text-muted-foreground mt-1">Bipe os produtos na aba "Bipagem" primeiro.</p>
                  </div>
                ) : (
                  <InventoryVerification
                    countItems={countItems}
                    storeName={selectedStore?.name || ""}
                    countDate={activeCount.started_at}
                    countScope={activeCount.scope}
                  />
                )}
              </TabsContent>

              <TabsContent value="unresolved" className="space-y-4">
                {unresolvedBarcodes.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="h-12 w-12 mx-auto text-green-500/30 mb-3" />
                    <p className="text-muted-foreground">Nenhum código de barras pendente!</p>
                    <p className="text-xs text-muted-foreground mt-1">Todos os códigos bipados foram encontrados no sistema.</p>
                  </div>
                ) : (
                  <>
                    {resolvedUnresolved.length > 0 && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-2" onClick={handleGenerateAllGTINs}>
                          <Tag className="h-4 w-4" />
                          Gerar GTIN para resolvidos ({resolvedUnresolved.length})
                        </Button>
                      </div>
                    )}
                    <ScrollArea className="h-[450px]">
                      <div className="space-y-2">
                        {unresolvedBarcodes.map(item => (
                          <Card key={item.id} className={cn(
                            "transition-all",
                            item.status === 'resolved' ? "border-green-200 dark:border-green-800" : "border-orange-200 dark:border-orange-800"
                          )}>
                            <CardContent className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-mono font-bold">{item.barcode}</p>
                                  {item.status === 'resolved' ? (
                                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                                      ✅ Vinculado: {item.resolved_product_name}
                                    </p>
                                  ) : (
                                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                                      ⚠️ Não identificado
                                    </p>
                                  )}
                                  {item.notes && (
                                    <p className="text-xs text-muted-foreground mt-0.5">📝 {item.notes}</p>
                                  )}
                                </div>
                                <Badge variant="secondary">{item.scanned_quantity} un</Badge>
                                {item.status === 'pending' && (
                                  <Button variant="outline" size="sm" onClick={() => {
                                    setResolvingBarcode(item);
                                    setResolveSearchQuery("");
                                    setResolveSearchResults([]);
                                    setShowResolveDialog(true);
                                  }}>
                                    <Link2 className="h-4 w-4 mr-1" /> Vincular
                                  </Button>
                                )}
                                {item.status === 'resolved' && (
                                  <Button variant="outline" size="sm" onClick={() => handleGenerateGTIN([item.id])}>
                                    <Tag className="h-4 w-4 mr-1" /> GTIN
                                  </Button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </TabsContent>

              {/* Review Tab */}
              <TabsContent value="review" className="space-y-4">
                {activeCount.status === 'reviewing' && (
                  <Card className="border-amber-200 dark:border-amber-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{divergentItems.length} divergências encontradas</p>
                          <p className="text-sm text-muted-foreground">
                            {okItems.length} produtos OK • {pendingStockItems.length} pendentes de consulta
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {pendingStockItems.length > 0 && (
                            <Button
                              variant="outline"
                              onClick={async () => {
                                setIsVerifying(true);
                                toast.info('Re-verificando saldos no Tiny (server-side)...');
                                let done = false;
                                let totalVerified = 0;
                                while (!done) {
                                  try {
                                    const { data } = await supabase.functions.invoke('inventory-verify-and-correct', {
                                      body: { count_id: activeCount.id, store_id: selectedStoreId, batch_size: 20 }
                                    });
                                    if (data?.done) done = true;
                                    totalVerified += (data?.verified || 0);
                                    const remaining = data?.remaining || 0;
                                    setVerifyProgress({ current: totalVerified, total: totalVerified + remaining });
                                  } catch (e) {
                                    console.error('Verify batch error:', e);
                                    await new Promise(r => setTimeout(r, 5000));
                                  }
                                }
                                setIsVerifying(false);
                                loadCountItems(activeCount.id);
                                toast.success('Verificação de saldos concluída!');
                              }}
                              className="gap-2"
                              disabled={isVerifying}
                            >
                              {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                              Re-verificar saldos ({pendingStockItems.length})
                            </Button>
                          )}
                          <Button onClick={handleStartCorrection} className="gap-2" disabled={divergentItems.length === 0 || pendingStockItems.length > 0}>
                            <Play className="h-4 w-4" />
                            Corrigir Estoque
                          </Button>
                        </div>
                      </div>
                      {isVerifying && (
                        <div className="mt-3 space-y-2">
                          <Progress value={verifyProgress.total > 0 ? (verifyProgress.current / verifyProgress.total) * 100 : 0} />
                          <p className="text-xs text-muted-foreground">
                            {verifyProgress.current}/{verifyProgress.total} produtos verificados • Não feche esta página
                          </p>
                        </div>
                      )}
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

                {/* Error items section */}
                {(() => {
                  const errorItems = countItems.filter(i => i.correction_status === 'error');
                  if (errorItems.length === 0) return null;
                  return (
                    <Card className="border-destructive/30 bg-destructive/5">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-destructive flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            {errorItems.length} produto(s) com erro
                          </p>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleRetryErrors}
                            disabled={isCorrecting}
                            className="gap-1"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Retentar com Erro
                          </Button>
                        </div>
                        <ScrollArea className="max-h-[250px]">
                          <div className="space-y-1">
                            {errorItems.map(item => (
                              <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg bg-background border text-sm">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{item.product_name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    SKU: {item.sku || '—'} · ID: {item.product_id} · Estoque: {item.current_stock ?? '?'} → {item.counted_quantity}
                                  </p>
                                  {item.correction_error && (
                                    <p className="text-xs text-destructive mt-0.5">
                                      ❌ {item.correction_error}
                                    </p>
                                  )}
                                </div>
                                <Badge variant="destructive" className="text-xs shrink-0">Erro</Badge>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  );
                })()}

                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {countItems.filter(i => i.correction_status === 'corrected' || (i.correction_status === 'pending' && i.divergence !== 0)).map(item => (
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
            <DialogDescription>Loja: {selectedStore?.name}</DialogDescription>
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
                  <p className="text-xs text-muted-foreground mt-1">Todos os produtos. O que não for bipado terá estoque zerado.</p>
                </Card>
                <Card
                  className={cn("cursor-pointer p-4 transition-all", newCountScope === 'partial' && "border-primary ring-2 ring-primary/20")}
                  onClick={() => setNewCountScope('partial')}
                >
                  <p className="font-semibold text-sm">Parcial</p>
                  <p className="text-xs text-muted-foreground mt-1">Apenas os produtos bipados serão conferidos.</p>
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
                ? `Balanço TOTAL: ${countItems.length} produtos bipados. Todos os outros terão estoque ZERADO.`
                : `Balanço PARCIAL: ${countItems.length} produtos bipados serão conferidos.`
              }
            </DialogDescription>
          </DialogHeader>
          {pendingUnresolved.length > 0 && (
            <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg border border-orange-200 dark:border-orange-800">
              <p className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                ⚠️ {pendingUnresolved.length} código(s) pendente(s) não resolvido(s)
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                Esses produtos não serão incluídos na contagem. Resolva-os na aba "Pendentes" antes de finalizar, se possível.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            O sistema consultará o saldo atual de cada produto no Tiny para calcular divergências.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFinishDialog(false)}>Voltar</Button>
            <Button onClick={handleFinishCounting} className="gap-2">
              <CheckCircle2 className="h-4 w-4" /> Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unknown Barcode Dialog */}
      <Dialog open={showUnknownBarcodeDialog} onOpenChange={(open) => {
        setShowUnknownBarcodeDialog(open);
        if (!open) barcodeInputRef.current?.focus();
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Código não encontrado
            </DialogTitle>
            <DialogDescription>
              O código <strong className="font-mono">{unknownBarcode}</strong> não foi encontrado no sistema ({unknownQty} un).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Buscar produto para vincular:</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nome, SKU ou variante..."
                  value={productSearchQuery}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  className="pl-10"
                  autoFocus
                />
              </div>
              {isSearchingProducts && <Loader2 className="h-4 w-4 animate-spin mt-2" />}
              {productSearchResults.length > 0 && (
                <ScrollArea className="h-[200px] mt-2 border rounded-lg">
                  <div className="space-y-0.5 p-1">
                    {productSearchResults.map(p => (
                      <button
                        key={p.id}
                        className="w-full text-left p-2 rounded hover:bg-primary/10 transition-colors"
                        onClick={() => handleLinkBarcodeToProduct(p)}
                      >
                        <p className="text-sm font-medium truncate">
                          {p.name}{p.variant ? ` - ${p.variant}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          SKU: {p.sku} • CB: {p.barcode}
                        </p>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <div>
              <Label className="text-sm">Observações (opcional):</Label>
              <Textarea
                placeholder="Ex: Produto diferente da fábrica X, cor azul..."
                value={unresolvedNotes}
                onChange={(e) => setUnresolvedNotes(e.target.value)}
                rows={2}
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => {
              setShowUnknownBarcodeDialog(false);
              barcodeInputRef.current?.focus();
            }}>
              Cancelar
            </Button>
            <Button variant="secondary" onClick={handleSkipUnknownBarcode} className="gap-2">
              <FileText className="h-4 w-4" />
              Pular (resolver depois)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Barcode Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" />
              Vincular Código de Barras
            </DialogTitle>
            <DialogDescription>
              Código: <strong className="font-mono">{resolvingBarcode?.barcode}</strong> ({resolvingBarcode?.scanned_quantity} un)
              {resolvingBarcode?.notes && <><br/>📝 {resolvingBarcode.notes}</>}
            </DialogDescription>
          </DialogHeader>

          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, SKU ou variante..."
                value={resolveSearchQuery}
                onChange={(e) => handleResolveSearch(e.target.value)}
                className="pl-10"
                autoFocus
              />
            </div>
            {isResolveSearching && <Loader2 className="h-4 w-4 animate-spin mt-2" />}
            {resolveSearchResults.length > 0 && (
              <ScrollArea className="h-[250px] mt-2 border rounded-lg">
                <div className="space-y-0.5 p-1">
                  {resolveSearchResults.map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left p-2 rounded hover:bg-primary/10 transition-colors"
                      onClick={() => handleResolveBarcode(p)}
                    >
                      <p className="text-sm font-medium truncate">
                        {p.name}{p.variant ? ` - ${p.variant}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        SKU: {p.sku} • CB: {p.barcode} {p.category ? `• ${p.category}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolveDialog(false)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Label Printing Dialog */}
      <Dialog open={showLabelDialog} onOpenChange={setShowLabelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" />
              Imprimir Etiquetas
            </DialogTitle>
            <DialogDescription>
              {labelItems.length} etiqueta(s) prontas para impressão
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[200px]">
            <div className="space-y-2">
              {labelItems.map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.productName}</p>
                    <p className="text-xs font-mono text-muted-foreground">GTIN: {item.barcode}</p>
                  </div>
                  <Badge variant="secondary">{item.qty} un</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="gap-2" onClick={() => {
              const zplContent = labelItems.map(l => generateZPL(l.barcode, l.productName, l.sku)).join('\n');
              const blob = new Blob([zplContent], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'etiquetas.zpl'; a.click();
              URL.revokeObjectURL(url);
              toast.success('Arquivo ZPL baixado!');
            }}>
              <Download className="h-4 w-4" />
              Baixar ZPL (Térmica)
            </Button>
            <Button className="gap-2" onClick={() => {
              generateLabelPDF(labelItems);
              toast.success('PDF de etiquetas gerado!');
            }}>
              <Printer className="h-4 w-4" />
              Imprimir PDF (A4)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Camera Barcode Scanner Overlay */}
      {showCameraScanner && (
        <div className="fixed inset-0 z-50 bg-background/95 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md">
            <div className="mb-4 text-center">
              <h3 className="text-lg font-bold text-foreground">📷 Scanner de Câmera</h3>
              <p className="text-sm text-muted-foreground">Aponte para o código de barras do produto</p>
            </div>
            <POSBarcodeScanner
              onScan={(code) => {
                setShowCameraScanner(false);
                const qty = parseInt(quantityInput) || 1;
                handleBarcodeScan(code, qty);
              }}
              onClose={() => setShowCameraScanner(false)}
            />
          </div>
        </div>
      )}

      {/* Verification Progress Overlay */}
      {isVerifying && (
        <div className="fixed inset-0 z-50 bg-background/95 flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-md space-y-6 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div>
              <h3 className="text-xl font-bold text-foreground">Verificando saldos no Tiny</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Consultando estoque de cada produto. Por favor, aguarde...
              </p>
            </div>
            <div className="space-y-2">
              <Progress value={verifyProgress.total > 0 ? (verifyProgress.current / verifyProgress.total) * 100 : 0} className="h-4" />
              <p className="text-sm font-medium text-foreground">
                {verifyProgress.current} de {verifyProgress.total} produtos verificados
                {verifyProgress.total > 0 && (
                  <span className="text-muted-foreground ml-2">
                    ({Math.round((verifyProgress.current / verifyProgress.total) * 100)}%)
                  </span>
                )}
              </p>
              {verifyProgress.total > 0 && (
                <p className="text-xs text-muted-foreground">
                  Tempo estimado restante: ~{Math.ceil(((verifyProgress.total - verifyProgress.current) * 2.5) / 60)} min
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

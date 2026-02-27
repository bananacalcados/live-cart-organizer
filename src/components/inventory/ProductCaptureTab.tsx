import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Plus, Package, ChevronDown, ChevronRight, Trash2,
  Send, Loader2, ScanBarcode, CheckCircle2, AlertTriangle, X,
  DollarSign, FileText, ClipboardList, Printer
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CapturePhotoScanner } from "@/components/inventory/CapturePhotoScanner";

interface CaptureSession {
  id: string;
  store_id: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface CaptureItem {
  id: string;
  session_id: string;
  parent_code: string;
  product_name: string;
  barcode: string;
  size: string | null;
  color: string | null;
  price: number;
  cost_price: number;
  reference_code: string | null;
  quantity: number;
  tiny_product_id: number | null;
  created_at: string;
}

interface GroupedProduct {
  parentCode: string;
  productName: string;
  items: CaptureItem[];
}

interface Props {
  storeId: string;
  storeName: string;
}

// Consignment report types
interface ConsignmentSale {
  sku: string;
  product_name: string;
  parent_code: string;
  store_name: string;
  order_number: string;
  order_date: string;
  customer_name: string;
  quantity_sold: number;
  unit_price: number;
  total: number;
  cost_price: number;
}

interface ConsignmentReport {
  sales: ConsignmentSale[];
  by_sku: { sku: string; product_name: string; parent_code: string; total_qty: number; total_value: number; cost_price: number }[];
  by_store: { store_name: string; total_qty: number; total_value: number }[];
  totals: { total_pairs: number; total_value: number; total_cost: number; total_profit: number };
  capture_summary: { total_captured_skus: number; total_captured_units: number };
}

export function ProductCaptureTab({ storeId, storeName }: Props) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCamera, setShowCamera] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeRef = useRef<HTMLInputElement>(null);

  // New item dialog
  const [showNewItemDialog, setShowNewItemDialog] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [newParentCode, setNewParentCode] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newSize, setNewSize] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCostPrice, setNewCostPrice] = useState("");
  const [newRefCode, setNewRefCode] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [existingParentCodes, setExistingParentCodes] = useState<string[]>([]);

  // Sending to Tiny
  const [sendingParent, setSendingParent] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

  // Cost report dialog
  const [showCostReport, setShowCostReport] = useState(false);

  // Consignment report
  const [showConsignmentReport, setShowConsignmentReport] = useState(false);
  const [consignmentData, setConsignmentData] = useState<ConsignmentReport | null>(null);
  const [loadingConsignment, setLoadingConsignment] = useState(false);

  // Load session
  useEffect(() => {
    loadSession();
  }, [storeId]);

  const loadSession = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("product_capture_sessions")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "capturing")
      .order("created_at", { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const s = data[0] as unknown as CaptureSession;
      setSession(s);
      await loadItems(s.id);
    } else {
      setSession(null);
      setItems([]);
    }
    setLoading(false);
  };

  const loadItems = async (sessionId: string) => {
    const { data } = await supabase
      .from("product_capture_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (data) setItems(data as unknown as CaptureItem[]);
  };

  const startSession = async () => {
    const { data, error } = await supabase
      .from("product_capture_sessions")
      .insert({ store_id: storeId })
      .select()
      .single();
    if (error) { toast.error("Erro ao criar sessão"); return; }
    setSession(data as unknown as CaptureSession);
    setItems([]);
    toast.success("Sessão de captação iniciada!");
    setTimeout(() => barcodeRef.current?.focus(), 300);
  };

  const handleBarcodeScan = (barcode: string) => {
    const code = barcode.trim();
    if (!code || !session) return;
    setBarcodeInput("");

    const existing = items.find(i => i.barcode === code);
    if (existing) {
      const newQty = existing.quantity + 1;
      supabase.from("product_capture_items")
        .update({ quantity: newQty })
        .eq("id", existing.id)
        .then(() => {
          setItems(prev => prev.map(i => i.id === existing.id ? { ...i, quantity: newQty } : i));
          toast.success(`+1 ${existing.product_name} (total: ${newQty})`);
        });
      barcodeRef.current?.focus();
      return;
    }

    const parentCodes = [...new Set(items.map(i => i.parent_code))];
    setExistingParentCodes(parentCodes);
    setScannedBarcode(code);

    if (parentCodes.length === 1) {
      const lastItem = items[items.length - 1];
      setNewParentCode(lastItem.parent_code);
      setNewProductName(lastItem.product_name);
      setNewRefCode(lastItem.reference_code || "");
      setNewPrice(String(lastItem.price || ""));
      setNewCostPrice(String(lastItem.cost_price || ""));
      setNewColor(lastItem.color || "");
    } else {
      setNewParentCode("");
      setNewProductName("");
      setNewRefCode("");
      setNewPrice("");
      setNewCostPrice("");
      setNewColor("");
    }
    setNewSize("");
    setNewQty("1");
    setShowNewItemDialog(true);
  };

  const handleAddItem = async () => {
    if (!session || !scannedBarcode || !newParentCode || !newProductName) {
      toast.error("Preencha código pai e nome do produto");
      return;
    }

    const { data, error } = await supabase
      .from("product_capture_items")
      .insert({
        session_id: session.id,
        parent_code: newParentCode.trim().toUpperCase(),
        product_name: newProductName.trim(),
        barcode: scannedBarcode,
        size: newSize.trim() || null,
        color: newColor.trim() || null,
        price: parseFloat(newPrice) || 0,
        cost_price: parseFloat(newCostPrice) || 0,
        reference_code: newRefCode.trim() || null,
        quantity: parseInt(newQty) || 1,
      })
      .select()
      .single();

    if (error) { toast.error("Erro ao salvar item"); return; }
    setItems(prev => [...prev, data as unknown as CaptureItem]);
    setShowNewItemDialog(false);
    toast.success(`${newProductName} adicionado!`);
    setTimeout(() => barcodeRef.current?.focus(), 200);
  };

  const selectExistingParent = (parentCode: string) => {
    const parentItems = items.filter(i => i.parent_code === parentCode);
    if (parentItems.length > 0) {
      const first = parentItems[0];
      setNewParentCode(first.parent_code);
      setNewProductName(first.product_name);
      setNewRefCode(first.reference_code || "");
      setNewPrice(String(first.price || ""));
      setNewCostPrice(String(first.cost_price || ""));
      setNewColor(first.color || "");
    }
  };

  const handleDeleteItem = async (id: string) => {
    await supabase.from("product_capture_items").delete().eq("id", id);
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success("Item removido");
  };

  const handleUpdateItem = async (id: string, field: string, value: string | number) => {
    await supabase.from("product_capture_items").update({ [field]: value }).eq("id", id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
  };

  // Group items by parent_code
  const grouped: GroupedProduct[] = (() => {
    const map = new Map<string, CaptureItem[]>();
    items.forEach(item => {
      const arr = map.get(item.parent_code) || [];
      arr.push(item);
      map.set(item.parent_code, arr);
    });
    return Array.from(map.entries()).map(([parentCode, items]) => ({
      parentCode,
      productName: items[0].product_name,
      items,
    }));
  })();

  const totalModels = grouped.length;
  const totalVariations = items.length;
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const totalCost = items.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0);

  // Send to Tiny
  const handleSendToTiny = async (parentCode: string) => {
    const group = grouped.find(g => g.parentCode === parentCode);
    if (!group) return;

    setSendingParent(parentCode);
    try {
      const { data, error } = await supabase.functions.invoke("tiny-create-product-with-variations", {
        body: {
          store_id: storeId,
          parent_code: group.parentCode,
          product_name: group.productName,
          items: group.items.map(i => ({
            id: i.id,
            barcode: i.barcode,
            size: i.size,
            color: i.color,
            price: i.price,
            quantity: i.quantity,
          })),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.tiny_product_id) {
        const updatedItems = items.map(i =>
          i.parent_code === parentCode ? { ...i, tiny_product_id: data.tiny_product_id } : i
        );
        setItems(updatedItems);
      }

      toast.success(`${group.productName} criado no Tiny!`);
    } catch (err: any) {
      toast.error(`Erro ao criar ${group.productName}: ${err.message}`);
    } finally {
      setSendingParent(null);
    }
  };

  const handleSendAllToTiny = async () => {
    const unsent = grouped.filter(g => !g.items[0].tiny_product_id);
    if (unsent.length === 0) { toast.info("Todos os produtos já foram enviados"); return; }

    setSendingAll(true);
    let ok = 0;
    let fail = 0;
    for (const group of unsent) {
      try {
        await handleSendToTiny(group.parentCode);
        ok++;
      } catch {
        fail++;
      }
    }
    setSendingAll(false);
    toast.success(`Envio concluído: ${ok} ok, ${fail} erros`);
  };

  const handleFinishSession = async () => {
    if (!session) return;
    await supabase.from("product_capture_sessions")
      .update({ status: "completed" })
      .eq("id", session.id);
    toast.success("Sessão finalizada!");
    setSession(null);
    setItems([]);
  };

  // Cost report - open in print window
  const handleCostReport = () => {
    setShowCostReport(true);
  };

  const printCostReport = () => {
    const costGrouped = grouped.map(g => ({
      parentCode: g.parentCode,
      productName: g.productName,
      totalQty: g.items.reduce((s, i) => s + i.quantity, 0),
      avgCost: g.items.length > 0
        ? g.items.reduce((s, i) => s + (i.cost_price || 0), 0) / g.items.length
        : 0,
      totalCost: g.items.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0),
      items: g.items,
    }));
    const grandTotal = costGrouped.reduce((s, g) => s + g.totalCost, 0);

    const html = `<!DOCTYPE html><html><head><title>Relatório de Custo - ${storeName}</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;font-size:12px}
h1{font-size:18px;margin-bottom:4px}
h2{font-size:14px;color:#666;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
th{background:#f5f5f5;font-weight:600}
.right{text-align:right}
.total-row{font-weight:bold;background:#f0f0f0}
.grand-total{font-size:16px;font-weight:bold;margin-top:16px;text-align:right}
</style></head><body>
<h1>Relatório de Custo de Estoque</h1>
<h2>Loja: ${storeName} · Data: ${new Date().toLocaleDateString("pt-BR")}</h2>
<table>
<thead><tr><th>Modelo</th><th>Produto</th><th class="right">Qtd</th><th class="right">Custo Unit. Médio</th><th class="right">Custo Total</th></tr></thead>
<tbody>
${costGrouped.map(g => `<tr>
<td>${g.parentCode}</td><td>${g.productName}</td>
<td class="right">${g.totalQty}</td>
<td class="right">R$ ${g.avgCost.toFixed(2)}</td>
<td class="right">R$ ${g.totalCost.toFixed(2)}</td>
</tr>`).join("")}
</tbody>
<tfoot><tr class="total-row">
<td colspan="2">TOTAL</td>
<td class="right">${totalUnits}</td>
<td></td>
<td class="right">R$ ${grandTotal.toFixed(2)}</td>
</tr></tfoot>
</table>
<script>window.print();</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  // Consignment report
  const handleConsignmentReport = async () => {
    if (!session) return;
    setLoadingConsignment(true);
    setShowConsignmentReport(true);

    try {
      const { data, error } = await supabase.functions.invoke("consignment-sales-report", {
        body: { session_id: session.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setConsignmentData(data as ConsignmentReport);
    } catch (err: any) {
      toast.error(`Erro ao gerar relatório: ${err.message}`);
      setShowConsignmentReport(false);
    } finally {
      setLoadingConsignment(false);
    }
  };

  const printConsignmentReport = () => {
    if (!consignmentData) return;
    const { sales, by_store, totals } = consignmentData;

    const html = `<!DOCTYPE html><html><head><title>Relatório Consignado - ${storeName}</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;font-size:11px}
h1{font-size:18px;margin-bottom:4px}
h2{font-size:14px;color:#666;margin-bottom:16px}
h3{font-size:13px;margin-top:20px;margin-bottom:8px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #ddd;padding:5px 8px;text-align:left}
th{background:#f5f5f5;font-weight:600}
.right{text-align:right}
.total-row{font-weight:bold;background:#f0f0f0}
.summary{margin-top:20px;padding:12px;border:2px solid #333;font-size:14px}
</style></head><body>
<h1>Relatório de Vendas Consignado</h1>
<h2>Loja: ${storeName} · Data: ${new Date().toLocaleDateString("pt-BR")}</h2>
<h3>Vendas por Loja</h3>
<table>
<thead><tr><th>Loja</th><th class="right">Pares</th><th class="right">Valor Total</th></tr></thead>
<tbody>${by_store.map(s => `<tr><td>${s.store_name}</td><td class="right">${s.total_qty}</td><td class="right">R$ ${s.total_value.toFixed(2)}</td></tr>`).join("")}</tbody>
</table>
<h3>Detalhamento de Vendas</h3>
<table>
<thead><tr><th>Produto</th><th>SKU</th><th>Loja</th><th>Data</th><th>Pedido</th><th class="right">Qtd</th><th class="right">Unit.</th><th class="right">Total</th></tr></thead>
<tbody>${sales.map(s => `<tr>
<td>${s.product_name}</td><td>${s.sku}</td><td>${s.store_name}</td>
<td>${s.order_date}</td><td>${s.order_number}</td>
<td class="right">${s.quantity_sold}</td><td class="right">R$ ${s.unit_price.toFixed(2)}</td>
<td class="right">R$ ${s.total.toFixed(2)}</td>
</tr>`).join("")}</tbody>
</table>
<div class="summary">
<p><strong>Total de pares vendidos:</strong> ${totals.total_pairs}</p>
<p><strong>Valor total a repassar:</strong> R$ ${totals.total_value.toFixed(2)}</p>
<p><strong>Custo total:</strong> R$ ${totals.total_cost.toFixed(2)}</p>
</div>
<script>window.print();</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanBarcode className="h-5 w-5" />
              Captação de Produtos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Inicie uma sessão de captação para a loja <strong>{storeName}</strong>.
              Bipe os códigos de barras dos produtos e agrupe automaticamente por modelo (Pai/Filho).
            </p>
            <Button onClick={startSession} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Iniciar Sessão de Captação
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{totalModels}</p>
            <p className="text-xs text-muted-foreground">Modelos (Pai)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{totalVariations}</p>
            <p className="text-xs text-muted-foreground">Variações</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{totalUnits}</p>
            <p className="text-xs text-muted-foreground">Unidades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary">
              R$ {totalCost.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">Custo Total</p>
          </CardContent>
        </Card>
      </div>

      {/* Report buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={handleCostReport} className="gap-1">
          <DollarSign className="h-3 w-3" />
          Relatório de Custo
        </Button>
        <Button variant="outline" size="sm" onClick={handleConsignmentReport} className="gap-1">
          <ClipboardList className="h-3 w-3" />
          Relatório Consignado
        </Button>
      </div>

      {/* Scan input */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <Input
              ref={barcodeRef}
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleBarcodeScan(barcodeInput); }}
              placeholder="Bipe ou digite o código de barras..."
              className="flex-1"
              autoFocus
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowCamera(true)}
            >
              <Camera className="h-4 w-4" />
            </Button>
            <Button onClick={() => handleBarcodeScan(barcodeInput)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Camera overlay */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-background/95 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <CapturePhotoScanner
              onScan={(code) => {
                setShowCamera(false);
                handleBarcodeScan(code);
              }}
              onClose={() => setShowCamera(false)}
            />
          </div>
        </div>
      )}

      {/* Grouped products */}
      {grouped.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Produtos Capturados</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSendAllToTiny}
                  disabled={sendingAll || grouped.every(g => g.items[0].tiny_product_id)}
                  className="gap-1"
                >
                  {sendingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Criar Todos no Tiny
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Accordion type="multiple" className="w-full">
              {grouped.map(group => {
                const isSent = !!group.items[0].tiny_product_id;
                const isSending = sendingParent === group.parentCode;
                return (
                  <AccordionItem key={group.parentCode} value={group.parentCode}>
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex items-center gap-3 flex-1 text-left">
                        <Package className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{group.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            Código: {group.parentCode} · {group.items.length} variação(ões)
                          </p>
                        </div>
                        {isSent ? (
                          <Badge variant="secondary" className="shrink-0 bg-green-500/10 text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Criado
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0">
                            {group.items.reduce((s, i) => s + i.quantity, 0)} un
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-2 pl-7">
                        {group.items.map(item => (
                          <div key={item.id} className="flex items-start gap-2 p-2 bg-muted/50 rounded-lg">
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-[10px]">
                                  GTIN: {item.barcode}
                                </Badge>
                                {item.size && (
                                  <Badge className="text-[10px]">Tam: {item.size}</Badge>
                                )}
                                {item.color && (
                                  <Badge variant="secondary" className="text-[10px]">Cor: {item.color}</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <div className="flex items-center gap-1">
                                  <Label className="text-[10px] text-muted-foreground">Tam:</Label>
                                  <Input
                                    value={item.size || ""}
                                    onChange={e => handleUpdateItem(item.id, "size", e.target.value)}
                                    className="h-7 w-16 text-xs"
                                    placeholder="—"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <Label className="text-[10px] text-muted-foreground">Cor:</Label>
                                  <Input
                                    value={item.color || ""}
                                    onChange={e => handleUpdateItem(item.id, "color", e.target.value)}
                                    className="h-7 w-20 text-xs"
                                    placeholder="—"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <Label className="text-[10px] text-muted-foreground">Qtd:</Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    value={item.quantity}
                                    onChange={e => handleUpdateItem(item.id, "quantity", parseInt(e.target.value) || 1)}
                                    className="h-7 w-14 text-xs text-center"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <Label className="text-[10px] text-muted-foreground">R$:</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.price || ""}
                                    onChange={e => handleUpdateItem(item.id, "price", parseFloat(e.target.value) || 0)}
                                    className="h-7 w-20 text-xs"
                                    placeholder="0,00"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <Label className="text-[10px] text-muted-foreground">Custo:</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.cost_price || ""}
                                    onChange={e => handleUpdateItem(item.id, "cost_price", parseFloat(e.target.value) || 0)}
                                    className="h-7 w-20 text-xs"
                                    placeholder="0,00"
                                  />
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => handleDeleteItem(item.id)}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        ))}
                        {!isSent && (
                          <Button
                            size="sm"
                            onClick={() => handleSendToTiny(group.parentCode)}
                            disabled={isSending}
                            className="w-full gap-1 mt-2"
                          >
                            {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                            Criar "{group.productName}" no Tiny
                          </Button>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Finish session */}
      <Button variant="outline" onClick={handleFinishSession} className="w-full">
        Finalizar Sessão
      </Button>

      {/* New item dialog */}
      <Dialog open={showNewItemDialog} onOpenChange={setShowNewItemDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Produto Bipado</DialogTitle>
            <DialogDescription>
              Código de barras: <strong>{scannedBarcode}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {existingParentCodes.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground">
                  Agrupar com produto existente:
                </Label>
                <div className="flex flex-wrap gap-1">
                  {existingParentCodes.map(code => {
                    const group = grouped.find(g => g.parentCode === code);
                    return (
                      <Button
                        key={code}
                        variant={newParentCode === code ? "default" : "outline"}
                        size="sm"
                        onClick={() => selectExistingParent(code)}
                        className="text-xs"
                      >
                        {code} ({group?.productName})
                      </Button>
                    );
                  })}
                  <Button
                    variant={!existingParentCodes.includes(newParentCode) ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setNewParentCode(""); setNewProductName(""); setNewRefCode(""); }}
                    className="text-xs"
                  >
                    + Novo Modelo
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Código Pai *</Label>
                <Input
                  value={newParentCode}
                  onChange={e => setNewParentCode(e.target.value)}
                  placeholder="Ex: UC0602005"
                  className="uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Referência</Label>
                <Input
                  value={newRefCode}
                  onChange={e => setNewRefCode(e.target.value)}
                  placeholder="Ex: 6003702928"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Nome do Produto *</Label>
              <Input
                value={newProductName}
                onChange={e => setNewProductName(e.target.value)}
                placeholder="Ex: TENIS CADARCO OURO LIGHT"
              />
            </div>

            <div className="grid grid-cols-5 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tamanho</Label>
                <Input
                  value={newSize}
                  onChange={e => setNewSize(e.target.value)}
                  placeholder="40"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cor</Label>
                <Input
                  value={newColor}
                  onChange={e => setNewColor(e.target.value)}
                  placeholder="Ouro"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preço</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPrice}
                  onChange={e => setNewPrice(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Custo</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newCostPrice}
                  onChange={e => setNewCostPrice(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qtd</Label>
                <Input
                  type="number"
                  min="1"
                  value={newQty}
                  onChange={e => setNewQty(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewItemDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddItem} disabled={!newParentCode || !newProductName}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cost report dialog */}
      <Dialog open={showCostReport} onOpenChange={setShowCostReport}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Relatório de Custo de Estoque
            </DialogTitle>
            <DialogDescription>
              Custo total do estoque capturado na sessão de {storeName}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Custo Unit. Médio</TableHead>
                <TableHead className="text-right">Custo Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map(g => {
                const qty = g.items.reduce((s, i) => s + i.quantity, 0);
                const cost = g.items.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0);
                const avgCost = qty > 0 ? cost / qty : 0;
                return (
                  <TableRow key={g.parentCode}>
                    <TableCell className="font-mono text-xs">{g.parentCode}</TableCell>
                    <TableCell>{g.productName}</TableCell>
                    <TableCell className="text-right">{qty}</TableCell>
                    <TableCell className="text-right">R$ {avgCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">R$ {cost.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-bold">TOTAL</TableCell>
                <TableCell className="text-right font-bold">{totalUnits}</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold">R$ {totalCost.toFixed(2)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCostReport(false)}>Fechar</Button>
            <Button onClick={printCostReport} className="gap-1">
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Consignment report dialog */}
      <Dialog open={showConsignmentReport} onOpenChange={setShowConsignmentReport}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Relatório de Vendas Consignado
            </DialogTitle>
            <DialogDescription>
              Vendas encontradas para os SKUs capturados nesta sessão
            </DialogDescription>
          </DialogHeader>

          {loadingConsignment ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Buscando vendas em todas as lojas...</span>
            </div>
          ) : consignmentData ? (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold">{consignmentData.totals.total_pairs}</p>
                    <p className="text-xs text-muted-foreground">Pares Vendidos</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold text-primary">
                      R$ {consignmentData.totals.total_value.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">Valor Total</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold text-destructive">
                      R$ {consignmentData.totals.total_cost.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">Custo Total</p>
                  </CardContent>
                </Card>
              </div>

              {/* By store */}
              {consignmentData.by_store.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Vendas por Loja</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Loja</TableHead>
                        <TableHead className="text-right">Pares</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consignmentData.by_store.map((s, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{s.store_name}</TableCell>
                          <TableCell className="text-right">{s.total_qty}</TableCell>
                          <TableCell className="text-right">R$ {s.total_value.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Detailed sales */}
              {consignmentData.sales.length > 0 ? (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Detalhamento</h4>
                  <ScrollArea className="max-h-[300px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead>Loja</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Pedido</TableHead>
                          <TableHead className="text-right">Qtd</TableHead>
                          <TableHead className="text-right">Unit.</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {consignmentData.sales.map((s, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{s.product_name}</TableCell>
                            <TableCell className="text-xs">{s.store_name}</TableCell>
                            <TableCell className="text-xs">{s.order_date}</TableCell>
                            <TableCell className="text-xs">{s.order_number}</TableCell>
                            <TableCell className="text-right">{s.quantity_sold}</TableCell>
                            <TableCell className="text-right text-xs">R$ {s.unit_price.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium text-xs">R$ {s.total.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Nenhuma venda encontrada para os SKUs desta sessão</p>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConsignmentReport(false)}>Fechar</Button>
            {consignmentData && consignmentData.sales.length > 0 && (
              <Button onClick={printConsignmentReport} className="gap-1">
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

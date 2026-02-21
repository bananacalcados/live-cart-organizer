import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Plus, Package, ChevronDown, ChevronRight, Trash2,
  Send, Loader2, ScanBarcode, CheckCircle2, AlertTriangle, X
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { POSBarcodeScanner } from "@/components/pos/POSBarcodeScanner";

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
  const [newRefCode, setNewRefCode] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [existingParentCodes, setExistingParentCodes] = useState<string[]>([]);

  // Sending to Tiny
  const [sendingParent, setSendingParent] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

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

    // Check if barcode already exists in this session
    const existing = items.find(i => i.barcode === code);
    if (existing) {
      // Increment quantity
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

    // Check if there's a known parent_code for auto-grouping
    const parentCodes = [...new Set(items.map(i => i.parent_code))];
    setExistingParentCodes(parentCodes);
    setScannedBarcode(code);

    // Pre-fill with last used parent if only one group
    if (parentCodes.length === 1) {
      const lastItem = items[items.length - 1];
      setNewParentCode(lastItem.parent_code);
      setNewProductName(lastItem.product_name);
      setNewRefCode(lastItem.reference_code || "");
      setNewPrice(String(lastItem.price || ""));
      setNewColor(lastItem.color || "");
    } else {
      setNewParentCode("");
      setNewProductName("");
      setNewRefCode("");
      setNewPrice("");
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

      // Update items with tiny_product_id
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
      <div className="grid grid-cols-3 gap-3">
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
            <POSBarcodeScanner
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
                              <div className="flex items-center gap-2 mt-1">
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

            <div className="grid grid-cols-4 gap-3">
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
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  RotateCcw, Plus, Search, Package, CreditCard, ArrowLeftRight,
  Ticket, Check, X, Loader2, ChevronDown, ScanBarcode
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  storeId: string;
}

interface ExchangeItem {
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
}

interface Exchange {
  id: string;
  exchange_type: string;
  status: string;
  returned_items: ExchangeItem[];
  returned_total: number;
  new_items: ExchangeItem[];
  new_total: number;
  difference_amount: number;
  difference_payment_method: string | null;
  credit_amount: number;
  credit_code: string | null;
  credit_expires_at: string | null;
  credit_used_at: string | null;
  return_reason: string | null;
  notes: string | null;
  created_at: string;
  seller_id: string | null;
  customer_id: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendente", color: "bg-yellow-500/20 text-yellow-400" },
  approved: { label: "Aprovada", color: "bg-blue-500/20 text-blue-400" },
  completed: { label: "Concluída", color: "bg-green-500/20 text-green-400" },
  cancelled: { label: "Cancelada", color: "bg-red-500/20 text-red-400" },
};

const TYPE_MAP: Record<string, { label: string; icon: typeof RotateCcw }> = {
  swap: { label: "Troca no Ato", icon: ArrowLeftRight },
  credit: { label: "Vale/Crédito", icon: Ticket },
  difference: { label: "Troca c/ Diferença", icon: CreditCard },
};

export function POSExchanges({ storeId }: Props) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);

  // New exchange form
  const [exchangeType, setExchangeType] = useState<string>("swap");
  const [selectedSeller, setSelectedSeller] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [notes, setNotes] = useState("");
  const [returnedItems, setReturnedItems] = useState<ExchangeItem[]>([{ product_name: "", sku: "", quantity: 1, unit_price: 0 }]);
  const [newItems, setNewItems] = useState<ExchangeItem[]>([{ product_name: "", sku: "", quantity: 1, unit_price: 0 }]);
  const [diffPaymentMethod, setDiffPaymentMethod] = useState("pix");
  const [creditDays, setCreditDays] = useState("30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadExchanges();
    loadSellers();
  }, [storeId]);

  const loadExchanges = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("pos_exchanges")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    setExchanges((data as any[]) || []);
    setLoading(false);
  };

  const loadSellers = async () => {
    const { data } = await supabase.from("pos_sellers").select("id, name").eq("store_id", storeId).eq("is_active", true);
    setSellers(data || []);
  };

  const returnedTotal = returnedItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const newTotal = newItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const differenceAmount = newTotal - returnedTotal;

  const handleSave = async () => {
    if (returnedItems.every(i => !i.product_name.trim())) {
      toast.error("Adicione ao menos um produto devolvido");
      return;
    }
    setSaving(true);
    try {
      const creditExpires = exchangeType === "credit"
        ? new Date(Date.now() + parseInt(creditDays) * 86400000).toISOString()
        : null;

      const creditCode = exchangeType === "credit"
        ? `VALE-${Date.now().toString(36).toUpperCase()}`
        : null;

      const { error } = await supabase.from("pos_exchanges").insert({
        store_id: storeId,
        seller_id: selectedSeller || null,
        exchange_type: exchangeType,
        returned_items: returnedItems.filter(i => i.product_name.trim()),
        returned_total: returnedTotal,
        new_items: exchangeType !== "credit" ? newItems.filter(i => i.product_name.trim()) : [],
        new_total: exchangeType !== "credit" ? newTotal : 0,
        difference_amount: exchangeType === "difference" ? differenceAmount : 0,
        difference_payment_method: exchangeType === "difference" ? diffPaymentMethod : null,
        credit_amount: exchangeType === "credit" ? returnedTotal : 0,
        credit_code: creditCode,
        credit_expires_at: creditExpires,
        return_reason: returnReason || null,
        notes: notes || null,
        status: "completed",
      } as any);

      if (error) throw error;
      toast.success("Troca registrada com sucesso!");
      setShowNew(false);
      resetForm();
      loadExchanges();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setExchangeType("swap");
    setSelectedSeller("");
    setReturnReason("");
    setNotes("");
    setReturnedItems([{ product_name: "", sku: "", quantity: 1, unit_price: 0 }]);
    setNewItems([{ product_name: "", sku: "", quantity: 1, unit_price: 0 }]);
    setDiffPaymentMethod("pix");
    setCreditDays("30");
  };

  const updateItem = (list: ExchangeItem[], setList: React.Dispatch<React.SetStateAction<ExchangeItem[]>>, idx: number, field: string, value: any) => {
    setList(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const filtered = exchanges.filter(e => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const matchItems = [...(e.returned_items || []), ...(e.new_items || [])].some(
        i => i.product_name?.toLowerCase().includes(s) || i.sku?.toLowerCase().includes(s)
      );
      if (!matchItems && !e.credit_code?.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const ItemRow = ({ items, setItems, idx }: { items: ExchangeItem[]; setItems: React.Dispatch<React.SetStateAction<ExchangeItem[]>>; idx: number }) => (
    <div className="grid grid-cols-[1fr_80px_60px_80px_32px] gap-2 items-end">
      <div>
        <Label className="text-pos-white/50 text-[10px]">Produto</Label>
        <Input value={items[idx].product_name} onChange={e => updateItem(items, setItems, idx, "product_name", e.target.value)} placeholder="Nome ou SKU" className="h-8 text-xs bg-pos-white/5 border-pos-yellow/30 text-pos-white" />
      </div>
      <div>
        <Label className="text-pos-white/50 text-[10px]">SKU</Label>
        <Input value={items[idx].sku} onChange={e => updateItem(items, setItems, idx, "sku", e.target.value)} className="h-8 text-xs bg-pos-white/5 border-pos-yellow/30 text-pos-white" />
      </div>
      <div>
        <Label className="text-pos-white/50 text-[10px]">Qtd</Label>
        <Input type="number" value={items[idx].quantity} onChange={e => updateItem(items, setItems, idx, "quantity", parseInt(e.target.value) || 1)} className="h-8 text-xs bg-pos-white/5 border-pos-yellow/30 text-pos-white" />
      </div>
      <div>
        <Label className="text-pos-white/50 text-[10px]">Preço</Label>
        <Input type="number" step="0.01" value={items[idx].unit_price} onChange={e => updateItem(items, setItems, idx, "unit_price", parseFloat(e.target.value) || 0)} className="h-8 text-xs bg-pos-white/5 border-pos-yellow/30 text-pos-white" />
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} disabled={items.length <= 1}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-pos-white flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-pos-yellow" /> Trocas & Devoluções
          </h2>
          <Button className="bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold gap-2" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Nova Troca
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/30" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por produto, SKU ou vale..." className="pl-9 bg-pos-white/5 border-pos-yellow/20 text-pos-white h-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 bg-pos-white/5 border-pos-yellow/20 text-pos-white h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="completed">Concluídas</SelectItem>
              <SelectItem value="cancelled">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-pos-yellow" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-pos-white/40">
            <RotateCcw className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>Nenhuma troca registrada</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(ex => {
              const typeInfo = TYPE_MAP[ex.exchange_type] || TYPE_MAP.swap;
              const statusInfo = STATUS_MAP[ex.status] || STATUS_MAP.pending;
              const TypeIcon = typeInfo.icon;
              return (
                <Card key={ex.id} className="bg-pos-white/5 border-pos-yellow/10">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <TypeIcon className="h-4 w-4 text-pos-yellow" />
                        <span className="text-sm font-bold text-pos-white">{typeInfo.label}</span>
                        <Badge className={`text-[10px] ${statusInfo.color} border-0`}>{statusInfo.label}</Badge>
                      </div>
                      <span className="text-[10px] text-pos-white/40">{new Date(ex.created_at).toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="text-pos-white/50 mb-1">Devolvido</p>
                        {(ex.returned_items || []).map((it, i) => (
                          <p key={i} className="text-pos-white">{it.quantity}x {it.product_name} <span className="text-pos-white/40">R$ {it.unit_price?.toFixed(2)}</span></p>
                        ))}
                        <p className="text-pos-yellow font-bold mt-1">Total: R$ {ex.returned_total?.toFixed(2)}</p>
                      </div>
                      {ex.exchange_type === "credit" ? (
                        <div>
                          <p className="text-pos-white/50 mb-1">Vale Gerado</p>
                          <p className="text-pos-yellow font-bold text-lg">{ex.credit_code}</p>
                          <p className="text-pos-white/40">R$ {ex.credit_amount?.toFixed(2)}</p>
                          {ex.credit_expires_at && <p className="text-pos-white/40">Expira: {new Date(ex.credit_expires_at).toLocaleDateString("pt-BR")}</p>}
                          {ex.credit_used_at && <p className="text-green-400">Utilizado em {new Date(ex.credit_used_at).toLocaleDateString("pt-BR")}</p>}
                        </div>
                      ) : (
                        <div>
                          <p className="text-pos-white/50 mb-1">Novo Produto</p>
                          {(ex.new_items || []).map((it, i) => (
                            <p key={i} className="text-pos-white">{it.quantity}x {it.product_name} <span className="text-pos-white/40">R$ {it.unit_price?.toFixed(2)}</span></p>
                          ))}
                          <p className="text-pos-yellow font-bold mt-1">Total: R$ {ex.new_total?.toFixed(2)}</p>
                          {ex.exchange_type === "difference" && (
                            <p className={`font-bold mt-1 ${ex.difference_amount > 0 ? "text-red-400" : "text-green-400"}`}>
                              {ex.difference_amount > 0 ? `Cliente paga: R$ ${ex.difference_amount.toFixed(2)}` : `Devolver: R$ ${Math.abs(ex.difference_amount).toFixed(2)}`}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {ex.return_reason && <p className="text-[10px] text-pos-white/40 mt-2">Motivo: {ex.return_reason}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* New Exchange Dialog */}
        <Dialog open={showNew} onOpenChange={v => { if (!v) resetForm(); setShowNew(v); }}>
          <DialogContent className="bg-pos-black border-pos-yellow/30 max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-pos-white flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-pos-yellow" /> Registrar Troca
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Type */}
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(TYPE_MAP).map(([key, { label, icon: Icon }]) => (
                  <button
                    key={key}
                    onClick={() => setExchangeType(key)}
                    className={`p-3 rounded-lg border text-center transition-all ${exchangeType === key ? "border-pos-yellow bg-pos-yellow/10 text-pos-yellow" : "border-pos-white/10 text-pos-white/50 hover:border-pos-white/30"}`}
                  >
                    <Icon className="h-5 w-5 mx-auto mb-1" />
                    <p className="text-xs font-medium">{label}</p>
                  </button>
                ))}
              </div>

              {/* Seller */}
              {sellers.length > 0 && (
                <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-yellow/30 text-pos-white">
                    <SelectValue placeholder="Vendedora (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              <Separator className="bg-pos-white/10" />

              {/* Returned Items */}
              <div>
                <Label className="text-pos-white text-sm font-bold mb-2 block">🔙 Produtos Devolvidos</Label>
                <div className="space-y-2">
                  {returnedItems.map((_, idx) => <ItemRow key={idx} items={returnedItems} setItems={setReturnedItems} idx={idx} />)}
                </div>
                <Button variant="ghost" className="mt-2 text-pos-yellow text-xs gap-1" onClick={() => setReturnedItems(p => [...p, { product_name: "", sku: "", quantity: 1, unit_price: 0 }])}>
                  <Plus className="h-3 w-3" /> Adicionar Produto
                </Button>
                <p className="text-right text-sm text-pos-yellow font-bold">Subtotal devolvido: R$ {returnedTotal.toFixed(2)}</p>
              </div>

              {/* New Items (swap / difference) */}
              {exchangeType !== "credit" && (
                <>
                  <Separator className="bg-pos-white/10" />
                  <div>
                    <Label className="text-pos-white text-sm font-bold mb-2 block">📦 Novo(s) Produto(s)</Label>
                    <div className="space-y-2">
                      {newItems.map((_, idx) => <ItemRow key={idx} items={newItems} setItems={setNewItems} idx={idx} />)}
                    </div>
                    <Button variant="ghost" className="mt-2 text-pos-yellow text-xs gap-1" onClick={() => setNewItems(p => [...p, { product_name: "", sku: "", quantity: 1, unit_price: 0 }])}>
                      <Plus className="h-3 w-3" /> Adicionar Produto
                    </Button>
                    <p className="text-right text-sm text-pos-yellow font-bold">Subtotal novo: R$ {newTotal.toFixed(2)}</p>
                  </div>
                </>
              )}

              {/* Difference */}
              {exchangeType === "difference" && differenceAmount !== 0 && (
                <Card className={`border-0 ${differenceAmount > 0 ? "bg-red-500/10" : "bg-green-500/10"}`}>
                  <CardContent className="p-3">
                    <p className={`text-sm font-bold ${differenceAmount > 0 ? "text-red-400" : "text-green-400"}`}>
                      {differenceAmount > 0 ? `💳 Cliente paga: R$ ${differenceAmount.toFixed(2)}` : `💰 Devolver ao cliente: R$ ${Math.abs(differenceAmount).toFixed(2)}`}
                    </p>
                    {differenceAmount > 0 && (
                      <Select value={diffPaymentMethod} onValueChange={setDiffPaymentMethod}>
                        <SelectTrigger className="mt-2 bg-pos-white/5 border-pos-yellow/30 text-pos-white h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pix">PIX</SelectItem>
                          <SelectItem value="credito">Cartão Crédito</SelectItem>
                          <SelectItem value="debito">Cartão Débito</SelectItem>
                          <SelectItem value="dinheiro">Dinheiro</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Credit config */}
              {exchangeType === "credit" && (
                <Card className="bg-pos-yellow/10 border-pos-yellow/30">
                  <CardContent className="p-3 space-y-2">
                    <p className="text-pos-yellow font-bold text-sm">🎫 Vale de R$ {returnedTotal.toFixed(2)}</p>
                    <div>
                      <Label className="text-pos-white/60 text-[10px]">Validade (dias)</Label>
                      <Input type="number" value={creditDays} onChange={e => setCreditDays(e.target.value)} className="h-8 w-24 text-xs bg-pos-white/5 border-pos-yellow/30 text-pos-white" />
                    </div>
                  </CardContent>
                </Card>
              )}

              <Separator className="bg-pos-white/10" />

              {/* Reason & Notes */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-pos-white/50 text-xs">Motivo da troca</Label>
                  <Select value={returnReason} onValueChange={setReturnReason}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-yellow/30 text-pos-white h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="defeito">Defeito</SelectItem>
                      <SelectItem value="tamanho">Tamanho errado</SelectItem>
                      <SelectItem value="cor">Cor diferente</SelectItem>
                      <SelectItem value="arrependimento">Arrependimento</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-pos-white/50 text-xs">Observações</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-xs bg-pos-white/5 border-pos-yellow/30 text-pos-white" />
                </div>
              </div>

              <Button className="w-full bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold h-12 gap-2" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Registrar Troca
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}

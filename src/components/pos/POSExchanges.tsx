import { useState, useEffect } from "react";
import {
  RotateCcw, Plus, Search, Package, CreditCard, ArrowLeftRight,
  Ticket, Check, X, Loader2, ChevronDown, ScanBarcode, AlertTriangle, User
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
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { POSTinyProductPicker } from "./POSTinyProductPicker";

interface Props {
  storeId: string;
}

interface ExchangeItem {
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  tiny_id?: number;
  barcode?: string;
  reason?: string;
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
  original_sale_id?: string | null;
  original_seller_name?: string | null;
}

interface OriginalSaleResult {
  id: string;
  source: "pos" | "tiny";
  date: string;
  customer_name: string | null;
  seller_name: string | null;
  seller_id: string | null;
  total: number;
  tiny_order_number?: string | null;
  items: { name: string; sku: string; quantity: number; price: number }[];
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

const RETURN_REASONS = [
  { value: "pes_trocados", label: "Pés trocados" },
  { value: "defeito", label: "Defeito" },
  { value: "tamanho", label: "Tamanho errado" },
  { value: "outro", label: "Outro" },
];

export function POSExchanges({ storeId }: Props) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);

  // Step-based exchange form
  const [formStep, setFormStep] = useState<"search_sale" | "select_items" | "exchange_details">("search_sale");
  const [saleSearch, setSaleSearch] = useState("");
  const [searchingSale, setSearchingSale] = useState(false);
  const [saleResults, setSaleResults] = useState<OriginalSaleResult[]>([]);
  const [selectedSale, setSelectedSale] = useState<OriginalSaleResult | null>(null);
  const [selectedReturnItems, setSelectedReturnItems] = useState<Map<number, { selected: boolean; reason: string }>>(new Map());

  // Exchange form
  const [exchangeType, setExchangeType] = useState<string>("swap");
  const [selectedSeller, setSelectedSeller] = useState("");
  const [notes, setNotes] = useState("");
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

  // Search original sale by GTIN, product name, customer name, phone, CPF
  const searchOriginalSale = async () => {
    const term = saleSearch.trim();
    if (!term || term.length < 3) { toast.error("Digite pelo menos 3 caracteres"); return; }
    setSearchingSale(true);
    setSaleResults([]);

    try {
      const results: OriginalSaleResult[] = [];

      // 1. Search local POS sales (ALL stores for cross-store exchanges)
      const searchTerm = `%${term}%`;
      const { data: posSales } = await supabase
        .from("pos_sales" as any)
        .select("id, created_at, customer_name, customer_phone, seller_name, seller_id, total, status, store_id")
        .or(`customer_name.ilike.${searchTerm},customer_phone.ilike.${searchTerm}`)
        .order("created_at", { ascending: false })
        .limit(20);

      for (const sale of ((posSales as any[]) || [])) {
        const { data: saleItems } = await supabase
          .from("pos_sale_items" as any)
          .select("sku, name, quantity, price, barcode")
          .eq("sale_id", sale.id);

        // Check if any item matches by SKU/barcode/name
        const itemsArr = (saleItems as any[]) || [];
        const itemMatch = itemsArr.some(i =>
          i.sku?.includes(term) || i.barcode?.includes(term) || i.name?.toLowerCase().includes(term.toLowerCase())
        );
        const customerMatch = sale.customer_name?.toLowerCase().includes(term.toLowerCase()) ||
          sale.customer_phone?.includes(term);

        if (itemMatch || customerMatch) {
          results.push({
            id: sale.id,
            source: "pos",
            date: sale.created_at,
            customer_name: sale.customer_name,
            seller_name: sale.seller_name,
            seller_id: sale.seller_id,
            total: sale.total || 0,
            items: itemsArr.map((i: any) => ({ name: i.name, sku: i.sku, quantity: i.quantity, price: i.price })),
          });
        }
      }

      // Also search items directly if no customer match
      if (results.length === 0) {
        const { data: itemMatches } = await supabase
          .from("pos_sale_items" as any)
          .select("sale_id, sku, name, quantity, price, barcode")
          .or(`sku.ilike.${searchTerm},barcode.ilike.${searchTerm},name.ilike.${searchTerm}`)
          .limit(20);

        const saleIds = [...new Set((itemMatches as any[])?.map(i => i.sale_id) || [])];
        for (const saleId of saleIds.slice(0, 5)) {
          const { data: sale } = await supabase
            .from("pos_sales" as any)
            .select("id, created_at, customer_name, customer_phone, seller_name, seller_id, total")
            .eq("id", saleId)
            .eq("store_id", storeId)
            .single();
          if (!sale) continue;
          const s = sale as any;

          const { data: allItems } = await supabase
            .from("pos_sale_items" as any)
            .select("sku, name, quantity, price")
            .eq("sale_id", saleId);

          results.push({
            id: s.id,
            source: "pos",
            date: s.created_at,
            customer_name: s.customer_name,
            seller_name: s.seller_name,
            seller_id: s.seller_id,
            total: s.total || 0,
            items: ((allItems as any[]) || []).map((i: any) => ({ name: i.name, sku: i.sku, quantity: i.quantity, price: i.price })),
          });
        }
      }

      // 2. Search Tiny orders via edge function, then fetch detail for each
      try {
        const { data: tinyData } = await supabase.functions.invoke("pos-tiny-search-orders", {
          body: { store_id: storeId, search_term: term },
        });
        if (tinyData?.success && tinyData?.orders) {
          // Fetch details in parallel for up to 5 orders
          const detailPromises = tinyData.orders.slice(0, 5).map(async (order: any) => {
            try {
              const { data: detailData } = await supabase.functions.invoke("pos-tiny-search-orders", {
                body: { store_id: storeId, mode: "detail", tiny_order_id: order.tiny_order_id || order.id },
              });
              return detailData?.success ? detailData.detail : null;
            } catch { return null; }
          });
          const details = await Promise.all(detailPromises);

          for (let idx = 0; idx < tinyData.orders.length; idx++) {
            const order = tinyData.orders[idx];
            const detail = idx < details.length ? details[idx] : null;
            const items = detail?.items || (order.itens || order.items || []).map((i: any) => ({
              name: i.descricao || i.name || "",
              sku: i.codigo || i.sku || "",
              quantity: i.quantidade || i.quantity || 1,
              price: parseFloat(i.valor_unitario || i.price || "0"),
            }));
            results.push({
              id: String(order.tiny_order_id || order.id),
              source: "tiny",
              date: detail?.date || order.date || order.data_pedido || order.created_at || "",
              customer_name: detail?.customer?.name || order.customer_name || null,
              seller_name: detail?.seller_name || order.seller_name || null,
              seller_id: null,
              total: detail?.total ?? order.total ?? order.valor ?? 0,
              tiny_order_number: detail?.tiny_order_number || order.tiny_order_number || null,
              items: items.map((i: any) => ({
                name: i.product_name || i.name || "",
                sku: i.sku || "",
                quantity: i.quantity || 1,
                price: i.unit_price || i.price || 0,
              })),
            });
          }
        }
      } catch (e) {
        console.warn("Tiny search failed:", e);
      }

      setSaleResults(results);
      if (results.length === 0) toast.info("Nenhum pedido encontrado");
    } catch (e: any) {
      console.error("Sale search error:", e);
      toast.error("Erro na busca: " + e.message);
    } finally {
      setSearchingSale(false);
    }
  };

  const selectSale = (sale: OriginalSaleResult) => {
    setSelectedSale(sale);
    // Pre-fill seller
    if (sale.seller_id) setSelectedSeller(sale.seller_id);
    // Init return items selection
    const map = new Map<number, { selected: boolean; reason: string }>();
    sale.items.forEach((_, idx) => map.set(idx, { selected: false, reason: "" }));
    setSelectedReturnItems(map);
    setFormStep("select_items");
  };

  const toggleReturnItem = (idx: number) => {
    setSelectedReturnItems(prev => {
      const next = new Map(prev);
      const current = next.get(idx) || { selected: false, reason: "" };
      next.set(idx, { ...current, selected: !current.selected });
      return next;
    });
  };

  const setItemReason = (idx: number, reason: string) => {
    setSelectedReturnItems(prev => {
      const next = new Map(prev);
      const current = next.get(idx) || { selected: false, reason: "" };
      next.set(idx, { ...current, reason });
      return next;
    });
  };

  const getSelectedItems = () => {
    if (!selectedSale) return [];
    return selectedSale.items.filter((_, idx) => selectedReturnItems.get(idx)?.selected);
  };

  const returnedTotal = getSelectedItems().reduce((s, i) => s + i.quantity * i.price, 0);
  const newTotal = newItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const differenceAmount = newTotal - returnedTotal;

  const proceedToDetails = () => {
    const selected = getSelectedItems();
    if (selected.length === 0) { toast.error("Selecione pelo menos um item"); return; }
    // Check reasons for all selected items
    for (let i = 0; i < selectedSale!.items.length; i++) {
      const entry = selectedReturnItems.get(i);
      if (entry?.selected && !entry.reason) {
        toast.error("Selecione o motivo de cada item");
        return;
      }
    }
    setFormStep("exchange_details");
  };

  const startExchangeWithoutOrder = () => {
    setSelectedSale({
      id: "manual",
      source: "pos",
      date: new Date().toISOString(),
      customer_name: null,
      seller_name: null,
      seller_id: null,
      total: 0,
      items: [],
    });
    setFormStep("exchange_details");
  };

  const adjustStockInTiny = async (returned: ExchangeItem[], given: ExchangeItem[]) => {
    const stockItems: { tiny_id: number; product_name: string; quantity: number; direction: "in" | "out" }[] = [];
    for (const item of returned) {
      if (item.tiny_id && item.quantity > 0) {
        stockItems.push({ tiny_id: item.tiny_id, product_name: item.product_name, quantity: item.quantity, direction: "in" });
      }
    }
    for (const item of given) {
      if (item.tiny_id && item.quantity > 0) {
        stockItems.push({ tiny_id: item.tiny_id, product_name: item.product_name, quantity: item.quantity, direction: "out" });
      }
    }
    if (stockItems.length === 0) return;
    try {
      const { data, error } = await supabase.functions.invoke("pos-exchange-stock-adjust", {
        body: { store_id: storeId, items: stockItems },
      });
      if (error) throw error;
      if (data?.success) toast.success("Estoque ajustado no Tiny!");
    } catch (e: any) {
      console.error("Stock adjust error:", e);
      toast.error("Erro ao ajustar estoque: " + e.message);
    }
  };

  const handleSave = async () => {
    if (!selectedSale) { toast.error("Selecione o pedido original"); return; }
    const selected = getSelectedItems();
    if (selected.length === 0) { toast.error("Selecione itens devolvidos"); return; }
    setSaving(true);
    try {
      const creditExpires = exchangeType === "credit"
        ? new Date(Date.now() + parseInt(creditDays) * 86400000).toISOString()
        : null;
      const creditCode = exchangeType === "credit"
        ? `VALE-${Date.now().toString(36).toUpperCase()}`
        : null;

      const returnedItems: ExchangeItem[] = [];
      for (let i = 0; i < selectedSale.items.length; i++) {
        const entry = selectedReturnItems.get(i);
        if (!entry?.selected) continue;
        const item = selectedSale.items[i];
        returnedItems.push({
          product_name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          unit_price: item.price,
          reason: entry.reason,
        });
      }

      const validNewItems = exchangeType !== "credit" ? newItems.filter(i => i.product_name.trim()) : [];

      const { data: exchangeData, error } = await supabase.from("pos_exchanges").insert({
        store_id: storeId,
        seller_id: selectedSeller || null,
        exchange_type: exchangeType,
        returned_items: returnedItems,
        returned_total: returnedTotal,
        new_items: validNewItems,
        new_total: exchangeType !== "credit" ? newTotal : 0,
        difference_amount: exchangeType === "difference" ? differenceAmount : 0,
        difference_payment_method: exchangeType === "difference" ? diffPaymentMethod : null,
        credit_amount: exchangeType === "credit" ? returnedTotal : 0,
        credit_code: creditCode,
        credit_expires_at: creditExpires,
        return_reason: returnedItems.map(i => i.reason).filter(Boolean).join(", "),
        notes: notes || null,
        status: "completed",
        original_sale_id: selectedSale.id,
        original_sale_source: selectedSale.source,
        original_seller_id: selectedSale.seller_id || null,
        original_seller_name: selectedSale.seller_name || null,
      } as any).select("id").single();

      if (error) throw error;

      // Register complaints for "pes_trocados" or "defeito"
      for (const item of returnedItems) {
        if (item.reason === "pes_trocados" || item.reason === "defeito") {
          const complaintType = item.reason === "pes_trocados" ? "wrong_feet" : "defective";
          // Find seller_id from the sale or current selection
          const complaintSellerId = selectedSale.seller_id ||
            sellers.find(s => s.name === selectedSale.seller_name)?.id;

          if (complaintSellerId) {
            await supabase.from("pos_seller_complaints" as any).insert({
              store_id: storeId,
              seller_id: complaintSellerId,
              exchange_id: (exchangeData as any)?.id || null,
              sale_id: selectedSale.id,
              complaint_type: complaintType,
              product_name: item.product_name,
              notes: notes || null,
            });
          }
        }
      }

      // Auto-adjust stock
      await adjustStockInTiny(returnedItems, validNewItems);

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
    setFormStep("search_sale");
    setSaleSearch("");
    setSaleResults([]);
    setSelectedSale(null);
    setSelectedReturnItems(new Map());
    setExchangeType("swap");
    setSelectedSeller("");
    setNotes("");
    setNewItems([{ product_name: "", sku: "", quantity: 1, unit_price: 0 }]);
    setDiffPaymentMethod("pix");
    setCreditDays("30");
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

  const ItemRow = ({ items, setItems, idx, labelPrefix }: { items: ExchangeItem[]; setItems: React.Dispatch<React.SetStateAction<ExchangeItem[]>>; idx: number; labelPrefix?: string }) => (
    <div className="grid grid-cols-[1fr_60px_80px_32px] gap-2 items-end">
      <POSTinyProductPicker
        storeId={storeId}
        label={labelPrefix || "Produto"}
        value={items[idx].product_name}
        placeholder="Buscar no Tiny..."
        onSelect={(p) => {
          setItems(prev => prev.map((item, i) => i === idx ? {
            ...item,
            product_name: p.product_name,
            sku: p.sku,
            unit_price: p.unit_price,
            tiny_id: p.tiny_id,
            barcode: p.barcode,
          } : item));
        }}
      />
      <div>
        <Label className="text-pos-white/50 text-[10px]">Qtd</Label>
        <Input type="number" value={items[idx].quantity} onChange={e => setItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: parseInt(e.target.value) || 1 } : item))} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
      </div>
      <div>
        <Label className="text-pos-white/50 text-[10px]">Preço</Label>
        <Input type="number" step="0.01" value={items[idx].unit_price} onChange={e => setItems(prev => prev.map((item, i) => i === idx ? { ...item, unit_price: parseFloat(e.target.value) || 0 } : item))} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
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
            <RotateCcw className="h-5 w-5 text-pos-orange" /> Trocas & Devoluções
          </h2>
          <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Nova Troca
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/30" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por produto, SKU ou vale..." className="pl-9 bg-pos-white/5 border-pos-orange/20 text-pos-white h-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 bg-pos-white/5 border-pos-orange/20 text-pos-white h-9">
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
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-pos-orange" /></div>
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
                <Card key={ex.id} className="bg-pos-white/5 border-pos-orange/10">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <TypeIcon className="h-4 w-4 text-pos-orange" />
                        <span className="text-sm font-bold text-pos-white">{typeInfo.label}</span>
                        <Badge className={`text-[10px] ${statusInfo.color} border-0`}>{statusInfo.label}</Badge>
                      </div>
                      <span className="text-[10px] text-pos-white/40">{new Date(ex.created_at).toLocaleString("pt-BR")}</span>
                    </div>
                    {ex.original_seller_name && (
                      <p className="text-[10px] text-pos-white/50 mb-2 flex items-center gap-1">
                        <User className="h-3 w-3" /> Vendedor original: <span className="font-medium text-pos-white/70">{ex.original_seller_name}</span>
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="text-pos-white/50 mb-1">Devolvido</p>
                        {(ex.returned_items || []).map((it, i) => (
                          <p key={i} className="text-pos-white">{it.quantity}x {it.product_name} <span className="text-pos-white/40">R$ {it.unit_price?.toFixed(2)}</span></p>
                        ))}
                        <p className="text-pos-orange font-bold mt-1">Total: R$ {ex.returned_total?.toFixed(2)}</p>
                      </div>
                      {ex.exchange_type === "credit" ? (
                        <div>
                          <p className="text-pos-white/50 mb-1">Vale Gerado</p>
                          <p className="text-pos-orange font-bold text-lg">{ex.credit_code}</p>
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
                          <p className="text-pos-orange font-bold mt-1">Total: R$ {ex.new_total?.toFixed(2)}</p>
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

        {/* New Exchange Dialog - Step-based */}
        <Dialog open={showNew} onOpenChange={v => { if (!v) resetForm(); setShowNew(v); }}>
          <DialogContent className="bg-pos-black border-pos-orange/30 max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-pos-white flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-pos-orange" />
                {formStep === "search_sale" ? "1. Buscar Pedido Original" :
                 formStep === "select_items" ? "2. Selecionar Itens Devolvidos" :
                 "3. Detalhes da Troca"}
              </DialogTitle>
            </DialogHeader>

            {/* Step 1: Search Original Sale */}
            {formStep === "search_sale" && (
              <div className="space-y-4">
                <p className="text-xs text-pos-white/60">
                  Pesquise o pedido original por GTIN, nome do produto, nome do cliente, telefone ou CPF.
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/30" />
                    <Input
                      placeholder="GTIN, produto, cliente, telefone, CPF..."
                      value={saleSearch}
                      onChange={e => setSaleSearch(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && searchOriginalSale()}
                      className="pl-9 bg-pos-white/5 border-pos-orange/30 text-pos-white h-10"
                    />
                  </div>
                  <Button onClick={searchOriginalSale} disabled={searchingSale} className="bg-pos-orange text-pos-black gap-1">
                    {searchingSale ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Buscar
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" className="text-xs border-pos-orange/30 text-pos-white/70 hover:bg-pos-white/5" onClick={startExchangeWithoutOrder}>
                    <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-yellow-400" />
                    Criar Sem Pedido
                  </Button>
                </div>

                {saleResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-pos-white/50">{saleResults.length} pedido(s) encontrado(s)</p>
                    {saleResults.map(sale => (
                      <button
                        key={`${sale.source}-${sale.id}`}
                        onClick={() => selectSale(sale)}
                        className="w-full text-left p-3 rounded-lg border border-pos-orange/10 bg-pos-white/5 hover:border-pos-orange/40 transition-all"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[9px] ${sale.source === "pos" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"}`}>
                              {sale.source === "pos" ? "POS" : "Tiny"}
                            </Badge>
                            {sale.tiny_order_number && (
                              <Badge className="text-[9px] bg-pos-white/10 text-pos-white/70 border-0">
                                Pedido #{sale.tiny_order_number}
                              </Badge>
                            )}
                            {sale.customer_name && <span className="text-xs text-pos-white font-medium">{sale.customer_name}</span>}
                          </div>
                          <span className="text-[10px] text-pos-white/40">
                            {sale.date ? new Date(sale.date + (sale.date.includes('T') ? '' : 'T12:00:00')).toLocaleDateString("pt-BR") : ""}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-pos-white/50">
                            {sale.items.length} item(s) · Vendedor: {sale.seller_name || "—"}
                          </p>
                          <span className="text-xs text-pos-orange font-bold">R$ {sale.total.toFixed(2)}</span>
                        </div>
                        {sale.items.length > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {sale.items.slice(0, 4).map((item, i) => (
                              <p key={i} className="text-[10px] text-pos-white/50">
                                {item.quantity}x {item.name} {item.sku ? `(${item.sku})` : ''} — R$ {(item.price * item.quantity).toFixed(2)}
                              </p>
                            ))}
                            {sale.items.length > 4 && (
                              <p className="text-[10px] text-pos-white/30">+ {sale.items.length - 4} item(s) a mais</p>
                            )}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Select Return Items */}
            {formStep === "select_items" && selectedSale && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/20">
                  <p className="text-xs text-pos-white/50">Pedido selecionado</p>
                  <p className="text-sm text-pos-white font-medium">
                    {selectedSale.customer_name || "Sem cliente"} — R$ {selectedSale.total.toFixed(2)}
                  </p>
                  {selectedSale.seller_name && (
                    <p className="text-[10px] text-pos-white/50 flex items-center gap-1">
                      <User className="h-3 w-3" /> Vendedor: {selectedSale.seller_name}
                    </p>
                  )}
                </div>

                <Label className="text-pos-white text-sm font-bold">Selecione os itens para devolução:</Label>
                <div className="space-y-2">
                  {selectedSale.items.map((item, idx) => {
                    const entry = selectedReturnItems.get(idx);
                    return (
                      <div key={idx} className={`p-3 rounded-lg border transition-all ${entry?.selected ? "border-pos-orange/40 bg-pos-orange/5" : "border-pos-white/10 bg-pos-white/5"}`}>
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={entry?.selected || false}
                            onCheckedChange={() => toggleReturnItem(idx)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-pos-white font-medium">{item.name}</p>
                            <p className="text-[10px] text-pos-white/40">{item.sku} · Qtd: {item.quantity} · R$ {item.price.toFixed(2)}</p>
                          </div>
                        </div>
                        {entry?.selected && (
                          <div className="mt-2 ml-7">
                            <Select value={entry.reason} onValueChange={v => setItemReason(idx, v)}>
                              <SelectTrigger className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white">
                                <SelectValue placeholder="Motivo da devolução *" />
                              </SelectTrigger>
                              <SelectContent>
                                {RETURN_REASONS.map(r => (
                                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {(entry.reason === "pes_trocados" || entry.reason === "defeito") && (
                              <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Reclamação será registrada contra {selectedSale.seller_name || "o vendedor"}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" className="text-pos-white/60" onClick={() => setFormStep("search_sale")}>
                    Voltar
                  </Button>
                  <Button className="flex-1 bg-pos-orange text-pos-black" onClick={proceedToDetails}>
                    Continuar
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Exchange Details */}
            {formStep === "exchange_details" && selectedSale && (
              <div className="space-y-4">
                {/* Summary */}
                <Card className="bg-pos-white/5 border-pos-orange/20">
                  <CardContent className="p-3">
                    <p className="text-xs text-pos-white/50 mb-1">Itens devolvidos ({getSelectedItems().length})</p>
                    {getSelectedItems().map((it, i) => (
                      <p key={i} className="text-xs text-pos-white">{it.quantity}x {it.name} — R$ {(it.price * it.quantity).toFixed(2)}</p>
                    ))}
                    <p className="text-sm text-pos-orange font-bold mt-1">Total: R$ {returnedTotal.toFixed(2)}</p>
                  </CardContent>
                </Card>

                {/* Type */}
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(TYPE_MAP).map(([key, { label, icon: Icon }]) => (
                    <button
                      key={key}
                      onClick={() => setExchangeType(key)}
                      className={`p-3 rounded-lg border text-center transition-all ${exchangeType === key ? "border-pos-orange bg-pos-orange/10 text-pos-orange" : "border-pos-white/10 text-pos-white/50 hover:border-pos-white/30"}`}
                    >
                      <Icon className="h-5 w-5 mx-auto mb-1" />
                      <p className="text-xs font-medium">{label}</p>
                    </button>
                  ))}
                </div>

                {/* New Items (swap / difference) */}
                {exchangeType !== "credit" && (
                  <>
                    <Separator className="bg-pos-white/10" />
                    <div>
                      <Label className="text-pos-white text-sm font-bold mb-2 block">📦 Novo(s) Produto(s)</Label>
                      <div className="space-y-2">
                        {newItems.map((_, idx) => <ItemRow key={idx} items={newItems} setItems={setNewItems} idx={idx} labelPrefix="Novo" />)}
                      </div>
                      <Button variant="ghost" className="mt-2 text-pos-orange text-xs gap-1" onClick={() => setNewItems(p => [...p, { product_name: "", sku: "", quantity: 1, unit_price: 0 }])}>
                        <Plus className="h-3 w-3" /> Adicionar Produto
                      </Button>
                      <p className="text-right text-sm text-pos-orange font-bold">Subtotal novo: R$ {newTotal.toFixed(2)}</p>
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
                          <SelectTrigger className="mt-2 bg-pos-white/5 border-pos-orange/30 text-pos-white h-8 text-xs">
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

                {/* Credit */}
                {exchangeType === "credit" && (
                  <Card className="bg-pos-orange/10 border-pos-orange/30">
                    <CardContent className="p-3 space-y-2">
                      <p className="text-pos-orange font-bold text-sm">🎫 Vale de R$ {returnedTotal.toFixed(2)}</p>
                      <div>
                        <Label className="text-pos-white/60 text-[10px]">Validade (dias)</Label>
                        <Input type="number" value={creditDays} onChange={e => setCreditDays(e.target.value)} className="h-8 w-24 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Notes */}
                <div>
                  <Label className="text-pos-white/50 text-xs">Observações</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" className="text-pos-white/60" onClick={() => setFormStep("select_items")}>
                    Voltar
                  </Button>
                  <Button className="flex-1 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12 gap-2" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {saving ? "Registrando..." : "Registrar Troca"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}

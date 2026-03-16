import { useState, useEffect, useCallback } from "react";
import {
  Package, Loader2, User, CreditCard, Receipt, Check,
  RefreshCw, Store, DollarSign, ChevronRight, FileText, Instagram
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  storeId: string;
}

interface PickupOrder {
  id: string;
  store_id: string;
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  notes: string | null;
  source_order_id: string | null;
  payment_method: string | null;
  payment_details: any;
  seller_id: string | null;
  created_at: string;
  items: PickupItem[];
}

interface PickupItem {
  id: string;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  unit_price: number;
  quantity: number;
  total_price: number;
}

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

interface PaymentMethod {
  id: string;
  name: string;
}

type ProcessStep = "seller" | "payment" | "confirm" | "invoice";

export function POSPickupOrders({ storeId }: Props) {
  const [orders, setOrders] = useState<PickupOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // Processing dialog state
  const [processingOrder, setProcessingOrder] = useState<PickupOrder | null>(null);
  const [processStep, setProcessStep] = useState<ProcessStep>("seller");
  const [selectedSeller, setSelectedSeller] = useState("");
  const [selectedPayment, setSelectedPayment] = useState("");
  const [useMultiPayment, setUseMultiPayment] = useState(false);
  const [multiPayments, setMultiPayments] = useState<{ method_id: string; method_name: string; amount: number }[]>([]);
  const [multiPaymentMethodId, setMultiPaymentMethodId] = useState("");
  const [multiPaymentAmount, setMultiPaymentAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [saleResult, setSaleResult] = useState<any>(null);
  const [emittingNfce, setEmittingNfce] = useState(false);
  const [nfceResult, setNfceResult] = useState<any>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch pending_pickup sales for this store
      const { data: sales, error } = await supabase
        .from("pos_sales")
        .select("id, store_id, subtotal, discount, total, status, notes, source_order_id, payment_method, payment_details, seller_id, created_at")
        .eq("store_id", storeId)
        .eq("status", "pending_pickup")
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!sales || sales.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      // Fetch items for all these sales
      const saleIds = sales.map(s => s.id);
      const { data: items } = await supabase
        .from("pos_sale_items")
        .select("id, sale_id, product_name, variant_name, sku, unit_price, quantity, total_price")
        .in("sale_id", saleIds);

      const enriched: PickupOrder[] = sales.map(s => ({
        ...s,
        payment_details: s.payment_details || {},
        items: (items || []).filter(i => i.sale_id === s.id),
      }));

      setOrders(enriched);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao carregar pedidos de retirada");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  const loadSellers = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('pos_sellers')
        .select('id, name, tiny_seller_id')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('name');
      setSellers(data || []);
    } catch (e) {
      console.error(e);
    }
  }, [storeId]);

  const loadPaymentMethods = useCallback(async () => {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-payment-methods`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ store_id: storeId }),
      });
      const data = await resp.json();
      if (data.success && data.methods?.length > 0) {
        setPaymentMethods(data.methods);
      } else {
        const { data: cached } = await supabase
          .from("pos_payment_methods")
          .select("id, name")
          .eq("store_id", storeId)
          .eq("is_active", true)
          .order("sort_order");
        if (cached) setPaymentMethods(cached);
      }
    } catch {
      const { data: cached } = await supabase
        .from("pos_payment_methods")
        .select("id, name")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("sort_order");
      if (cached) setPaymentMethods(cached);
    }
  }, [storeId]);

  useEffect(() => {
    loadOrders();
    loadSellers();
    loadPaymentMethods();
  }, [loadOrders, loadSellers, loadPaymentMethods]);

  // Realtime subscription for new pickup orders
  useEffect(() => {
    const channel = supabase
      .channel("pos-pickup-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_sales", filter: `store_id=eq.${storeId}` }, () => {
        loadOrders();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId, loadOrders]);

  const openProcessDialog = (order: PickupOrder) => {
    setProcessingOrder(order);
    setProcessStep("seller");
    setSelectedSeller("");
    setSelectedPayment("");
    setUseMultiPayment(false);
    setMultiPayments([]);
    setSaleResult(null);
    setNfceResult(null);
  };

  const addMultiPayment = () => {
    const method = paymentMethods.find(m => m.id === multiPaymentMethodId);
    const amount = parseFloat(multiPaymentAmount.replace(",", "."));
    if (!method || isNaN(amount) || amount <= 0) return;
    setMultiPayments(prev => [...prev, { method_id: method.id, method_name: method.name, amount }]);
    setMultiPaymentMethodId("");
    setMultiPaymentAmount("");
  };

  const removeMultiPayment = (idx: number) => {
    setMultiPayments(prev => prev.filter((_, i) => i !== idx));
  };

  const multiTotal = multiPayments.reduce((s, p) => s + p.amount, 0);

  const handleConfirmPayment = async () => {
    if (!processingOrder) return;
    setProcessing(true);
    try {
      let paymentMethodName = "";
      if (useMultiPayment && multiPayments.length > 0) {
        paymentMethodName = multiPayments.map(p => `${p.method_name} (R$${p.amount.toFixed(2)})`).join(" + ");
      } else {
        const pm = paymentMethods.find(m => m.id === selectedPayment);
        paymentMethodName = pm?.name || "";
      }

      // Create sale in Tiny ERP
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-create-sale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          store_id: storeId,
          seller_id: selectedSeller || undefined,
          tiny_seller_id: sellers.find(s => s.id === selectedSeller)?.tiny_seller_id || undefined,
          items: processingOrder.items.map(item => ({
            sku: item.sku,
            name: item.product_name,
            variant: item.variant_name,
            price: item.unit_price,
            quantity: item.quantity,
          })),
          payment_method_name: paymentMethodName,
          discount: processingOrder.discount > 0 ? processingOrder.discount : undefined,
        }),
      });
      const data = await resp.json();

      // Update the pos_sales record
      await supabase
        .from("pos_sales")
        .update({
          status: "completed",
          seller_id: selectedSeller || null,
          payment_method: paymentMethodName,
          payment_details: useMultiPayment
            ? { multi: true, payments: multiPayments, source: processingOrder.payment_details?.source }
            : { source: processingOrder.payment_details?.source },
          tiny_order_id: data.tiny_order_id ? String(data.tiny_order_id) : null,
          tiny_order_number: data.tiny_order_number ? String(data.tiny_order_number) : null,
        })
        .eq("id", processingOrder.id);

      // Update CRM order stage to 'paid' if linked
      if (processingOrder.source_order_id) {
        await supabase
          .from("orders")
          .update({ is_paid: true, paid_at: new Date().toISOString(), stage: "paid" })
          .eq("id", processingOrder.source_order_id);

        await supabase.functions.invoke("payment-confirmed-hook", {
          body: {
            pedido_id: processingOrder.source_order_id,
            loja: "centro",
            source: "pos-pickup-confirmation",
          },
        });
      }

      if (data.success) {
        if (data.tiny_failed) {
          toast.warning("Pagamento registrado! Tiny indisponível — sincronize depois.");
        } else {
          toast.success(`Pagamento registrado! Pedido Tiny #${data.tiny_order_number || ""}`);
        }
      } else {
        toast.warning("Pagamento registrado localmente. Erro Tiny: " + (data.error || ""));
      }

      setSaleResult(data);
      setProcessStep("invoice");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao processar pagamento");
    } finally {
      setProcessing(false);
    }
  };

  const handleEmitNfce = async () => {
    if (!processingOrder || !saleResult?.sale_id) return;
    setEmittingNfce(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-emit-nfce`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          store_id: storeId,
          tiny_order_id: saleResult.tiny_order_id,
          sale_id: saleResult.sale_id || processingOrder.id,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success("NFC-e emitida com sucesso!");
        setNfceResult(data);
      } else {
        toast.error(data.error || "Erro ao emitir NFC-e");
      }
    } catch (e) {
      toast.error("Erro ao emitir NFC-e");
    } finally {
      setEmittingNfce(false);
    }
  };

  const closeDialog = () => {
    setProcessingOrder(null);
    loadOrders();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-pos-white/50">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando retiradas...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-pos-orange/20">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-pos-orange" />
          <h2 className="text-lg font-bold text-pos-white">Retiradas na Loja</h2>
          <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30">
            {orders.length} pendente{orders.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <Button variant="outline" size="sm" className="gap-1 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10" onClick={loadOrders}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {orders.length === 0 ? (
            <div className="text-center py-16 text-pos-white/40">
              <Package className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Nenhum pedido de retirada pendente</p>
              <p className="text-sm mt-1">Pedidos enviados do módulo Eventos aparecerão aqui</p>
            </div>
          ) : (
            orders.map((order) => {
              const details = order.payment_details || {};
              const instagram = details.customer_instagram || "";
              const whatsapp = details.customer_whatsapp || "";
              const createdAt = new Date(order.created_at).toLocaleString("pt-BR", {
                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
              });

              return (
                <div key={order.id} className="rounded-xl border border-pos-orange/20 bg-pos-white/5 p-4 space-y-3">
                  {/* Customer info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {instagram && (
                        <div className="flex items-center gap-1.5 text-sm text-pos-orange font-medium">
                          <Instagram className="h-4 w-4" />
                          {instagram}
                        </div>
                      )}
                      {!instagram && (
                        <span className="text-sm text-pos-white/60">Cliente da Live</span>
                      )}
                    </div>
                    <span className="text-xs text-pos-white/40">{createdAt}</span>
                  </div>

                  {/* Items */}
                  <div className="space-y-1.5">
                    {order.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <div className="flex-1 min-w-0">
                          <span className="text-pos-white">{item.quantity}x </span>
                          <span className="text-pos-white/80">{item.product_name}</span>
                          {item.variant_name && (
                            <span className="text-pos-white/50 ml-1">({item.variant_name})</span>
                          )}
                        </div>
                        <span className="text-pos-orange font-medium ml-2">
                          R$ {(item.unit_price * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <Separator className="bg-pos-orange/10" />

                  {/* Total + action */}
                  <div className="flex items-center justify-between">
                    <div>
                      {order.discount > 0 && (
                        <p className="text-xs text-red-400">Desconto: -R$ {order.discount.toFixed(2)}</p>
                      )}
                      <p className="text-lg font-bold text-pos-orange">R$ {order.total.toFixed(2)}</p>
                    </div>
                    <Button
                      className="bg-pos-orange hover:bg-pos-orange/90 text-pos-black font-bold gap-1.5"
                      onClick={() => openProcessDialog(order)}
                    >
                      <CreditCard className="h-4 w-4" />
                      Receber Pagamento
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  {order.notes && (
                    <p className="text-xs text-pos-white/40 italic">{order.notes}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Processing Dialog */}
      {processingOrder && (
        <Dialog open={!!processingOrder} onOpenChange={(v) => !v && closeDialog()}>
          <DialogContent className="max-w-lg bg-pos-black border-pos-orange/30 text-pos-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-pos-orange">
                {processStep === "seller" && <><User className="h-5 w-5" /> Selecionar Vendedor</>}
                {processStep === "payment" && <><CreditCard className="h-5 w-5" /> Forma de Pagamento</>}
                {processStep === "confirm" && <><Check className="h-5 w-5" /> Confirmar Pagamento</>}
                {processStep === "invoice" && <><Receipt className="h-5 w-5" /> Nota Fiscal</>}
              </DialogTitle>
            </DialogHeader>

            {/* Step: Seller */}
            {processStep === "seller" && (
              <div className="space-y-4">
                <div className="bg-pos-white/5 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-medium text-pos-orange">
                    {processingOrder.payment_details?.customer_instagram || "Cliente Live"}
                  </p>
                  <p className="text-xs text-pos-white/50">
                    {processingOrder.items.length} itens • R$ {processingOrder.total.toFixed(2)}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-pos-white/70">Vendedor responsável</Label>
                  <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                    <SelectTrigger className="border-pos-orange/30 bg-pos-white/5 text-pos-white">
                      <SelectValue placeholder="Selecione o vendedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sellers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={closeDialog} className="border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10">
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => setProcessStep("payment")}
                    disabled={!selectedSeller}
                    className="bg-pos-orange hover:bg-pos-orange/90 text-pos-black font-bold"
                  >
                    Próximo <ChevronRight className="h-4 w-4" />
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* Step: Payment */}
            {processStep === "payment" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-pos-white/70">Pagamento misto</Label>
                  <Switch checked={useMultiPayment} onCheckedChange={setUseMultiPayment} />
                </div>

                {!useMultiPayment ? (
                  <div className="space-y-2">
                    <Label className="text-pos-white/70">Forma de pagamento</Label>
                    <Select value={selectedPayment} onValueChange={setSelectedPayment}>
                      <SelectTrigger className="border-pos-orange/30 bg-pos-white/5 text-pos-white">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Select value={multiPaymentMethodId} onValueChange={setMultiPaymentMethodId}>
                        <SelectTrigger className="flex-1 border-pos-orange/30 bg-pos-white/5 text-pos-white">
                          <SelectValue placeholder="Método..." />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Valor"
                        value={multiPaymentAmount}
                        onChange={(e) => setMultiPaymentAmount(e.target.value)}
                        className="w-28 border-pos-orange/30 bg-pos-white/5 text-pos-white"
                      />
                      <Button size="sm" onClick={addMultiPayment} className="bg-pos-orange text-pos-black">+</Button>
                    </div>
                    {multiPayments.length > 0 && (
                      <div className="space-y-1">
                        {multiPayments.map((mp, i) => (
                          <div key={i} className="flex items-center justify-between text-sm bg-pos-white/5 rounded p-2">
                            <span className="text-pos-white/80">{mp.method_name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-pos-orange font-medium">R$ {mp.amount.toFixed(2)}</span>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={() => removeMultiPayment(i)}>×</Button>
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-between text-sm font-bold pt-1">
                          <span className="text-pos-white/70">Total parcial:</span>
                          <span className={multiTotal >= processingOrder.total ? "text-green-400" : "text-red-400"}>
                            R$ {multiTotal.toFixed(2)} / R$ {processingOrder.total.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-pos-white/5 rounded-lg p-3 text-center">
                  <p className="text-xs text-pos-white/50">Total a receber</p>
                  <p className="text-2xl font-bold text-pos-orange">R$ {processingOrder.total.toFixed(2)}</p>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setProcessStep("seller")} className="border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10">
                    Voltar
                  </Button>
                  <Button
                    onClick={() => setProcessStep("confirm")}
                    disabled={
                      useMultiPayment
                        ? multiPayments.length === 0 || multiTotal < processingOrder.total
                        : !selectedPayment
                    }
                    className="bg-pos-orange hover:bg-pos-orange/90 text-pos-black font-bold"
                  >
                    Próximo <ChevronRight className="h-4 w-4" />
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* Step: Confirm */}
            {processStep === "confirm" && (
              <div className="space-y-4">
                <div className="bg-pos-white/5 rounded-lg p-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-pos-white/60">Vendedor:</span>
                    <span className="text-pos-white font-medium">{sellers.find(s => s.id === selectedSeller)?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-pos-white/60">Pagamento:</span>
                    <span className="text-pos-white font-medium">
                      {useMultiPayment
                        ? multiPayments.map(p => p.method_name).join(" + ")
                        : paymentMethods.find(m => m.id === selectedPayment)?.name}
                    </span>
                  </div>
                  <Separator className="bg-pos-orange/10" />
                  {processingOrder.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-pos-white/70">{item.quantity}x {item.product_name}</span>
                      <span className="text-pos-orange">R$ {(item.unit_price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                  <Separator className="bg-pos-orange/10" />
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-pos-white">Total:</span>
                    <span className="text-pos-orange">R$ {processingOrder.total.toFixed(2)}</span>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setProcessStep("payment")} className="border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10">
                    Voltar
                  </Button>
                  <Button
                    onClick={handleConfirmPayment}
                    disabled={processing}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold gap-1.5"
                  >
                    {processing ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Processando...</>
                    ) : (
                      <><Check className="h-4 w-4" /> Confirmar Pagamento</>
                    )}
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* Step: Invoice */}
            {processStep === "invoice" && (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="h-16 w-16 rounded-full bg-green-600/20 flex items-center justify-center mx-auto mb-3">
                    <Check className="h-8 w-8 text-green-400" />
                  </div>
                  <p className="text-lg font-bold text-green-400">Pagamento Registrado!</p>
                  {saleResult?.tiny_order_number && (
                    <p className="text-sm text-pos-white/60 mt-1">Pedido Tiny #{saleResult.tiny_order_number}</p>
                  )}
                  {saleResult?.tiny_failed && (
                    <p className="text-xs text-yellow-400 mt-1">⚠️ Tiny indisponível — sincronize depois</p>
                  )}
                </div>

                {!nfceResult ? (
                  <Button
                    onClick={handleEmitNfce}
                    disabled={emittingNfce || !saleResult?.tiny_order_id}
                    className="w-full bg-pos-orange hover:bg-pos-orange/90 text-pos-black font-bold gap-1.5"
                  >
                    {emittingNfce ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Emitindo NFC-e...</>
                    ) : (
                      <><FileText className="h-4 w-4" /> Emitir NFC-e</>
                    )}
                  </Button>
                ) : (
                  <div className="bg-green-600/10 rounded-lg p-3 text-center">
                    <p className="text-sm text-green-400 font-medium">✅ NFC-e Emitida</p>
                    {nfceResult.pdf_url && (
                      <a href={nfceResult.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-pos-orange underline mt-1 inline-block">
                        Abrir PDF
                      </a>
                    )}
                  </div>
                )}

                <Button variant="outline" onClick={closeDialog} className="w-full border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10">
                  Fechar
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

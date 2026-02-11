import { useState, useEffect, useCallback } from "react";
import {
  ScanBarcode, Search, Plus, Minus, Trash2, User, CreditCard,
  Receipt, Printer, Camera, ShoppingCart, Package, Check,
  QrCode, Banknote, FileText, ChevronRight, Loader2, Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { POSCustomerForm } from "./POSCustomerForm";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CartItem {
  id: string;
  tiny_id?: number;
  sku: string;
  name: string;
  variant: string;
  size?: string;
  category?: string;
  price: number;
  quantity: number;
  barcode: string;
  stock?: number;
}

interface PaymentMethod {
  id: string;
  name: string;
}

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

type SaleStep = "scan" | "customer" | "payment" | "invoice";

interface Props {
  storeId: string;
  sellerId?: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function POSSalesView({ storeId, sellerId }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [step, setStep] = useState<SaleStep>("scan");
  const [showCamera, setShowCamera] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string; cpf?: string; email?: string; whatsapp?: string; address?: string; cep?: string; city?: string; state?: string; age_range?: string; preferred_style?: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CartItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [selectedSeller, setSelectedSeller] = useState<string>("");
  const [loadingSellers, setLoadingSellers] = useState(false);
  const [finalizingSale, setFinalizingSale] = useState(false);
  const [saleResult, setSaleResult] = useState<{ tiny_order_id?: string; tiny_order_number?: string; sale_id?: string } | null>(null);
  const [emittingNfce, setEmittingNfce] = useState(false);
  const [nfceResult, setNfceResult] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [installments, setInstallments] = useState("1");
  const [cashReceived, setCashReceived] = useState("");

  const subtotal = cart.reduce((s, item) => s + item.price * item.quantity, 0);
  const totalItems = cart.reduce((s, item) => s + item.quantity, 0);

  // Load sellers on mount
  useEffect(() => {
    loadSellers();
  }, [storeId]);

  const loadSellers = async () => {
    setLoadingSellers(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-sellers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ store_id: storeId }),
      });
      const data = await resp.json();
      if (data.success) {
        setSellers(data.sellers || []);
      }
    } catch (e) {
      console.error('Error loading sellers:', e);
    } finally {
      setLoadingSellers(false);
    }
  };

  const loadPaymentMethods = useCallback(async () => {
    if (paymentMethods.length > 0) return;
    setLoadingPayments(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ store_id: storeId }),
      });
      const data = await resp.json();
      if (data.success) {
        setPaymentMethods(data.methods || []);
      }
    } catch (e) {
      console.error('Error loading payment methods:', e);
    } finally {
      setLoadingPayments(false);
    }
  }, [storeId, paymentMethods.length]);

  useEffect(() => {
    if (step === "payment") loadPaymentMethods();
  }, [step, loadPaymentMethods]);

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = Math.max(1, item.quantity + delta);
      return { ...item, quantity: newQty };
    }));
  };

  const removeItem = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

  const handleBarcodeScan = async () => {
    if (!barcodeInput.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const isBarcode = /^\d{8,14}$/.test(barcodeInput.trim());
      const body = isBarcode
        ? { store_id: storeId, gtin: barcodeInput.trim() }
        : { store_id: storeId, query: barcodeInput.trim() };

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-search-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify(body),
      });
      const data = await resp.json();

      if (data.success && data.products.length > 0) {
        if (data.products.length === 1 || isBarcode) {
          const product = data.products[0];
          addToCart(product);
          setBarcodeInput("");
        } else {
          setSearchResults(data.products);
        }
      } else {
        toast.error(data.error || "Produto não encontrado");
      }
    } catch (e) {
      toast.error("Erro ao buscar produto");
    } finally {
      setSearching(false);
    }
  };

  const addToCart = (product: any) => {
    const cartId = `${product.tiny_id}-${product.sku}-${product.variant}`;
    setCart(prev => {
      const existing = prev.find(item => item.id === cartId);
      if (existing) {
        return prev.map(item =>
          item.id === cartId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, {
        id: cartId,
        tiny_id: product.tiny_id,
        sku: product.sku,
        name: product.name,
        variant: product.variant || '',
        size: product.size,
        category: product.category,
        price: product.price,
        quantity: 1,
        barcode: product.barcode || '',
        stock: product.stock,
      }];
    });
    setSearchResults([]);
    setBarcodeInput("");
  };

  const searchCustomerByTerm = async () => {
    if (!customerSearch.trim()) return;
    setSearchingCustomer(true);
    try {
      const term = customerSearch.trim();
      const { data } = await supabase
        .from('pos_customers')
        .select('*')
        .or(`cpf.ilike.%${term}%,name.ilike.%${term}%,whatsapp.ilike.%${term}%`)
        .limit(10);
      setCustomerResults(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSearchingCustomer(false);
    }
  };

  const finalizeSale = async () => {
    if (cart.length === 0) return;
    setFinalizingSale(true);
    try {
      const selectedPaymentMethod = paymentMethods.find(m => m.id === selectedPayment);
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-create-sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          store_id: storeId,
          seller_id: selectedSeller || undefined,
          customer: selectedCustomer || undefined,
          items: cart.map(item => ({
            tiny_id: item.tiny_id,
            sku: item.sku,
            name: item.name,
            variant: item.variant,
            size: item.size,
            category: item.category,
            price: item.price,
            quantity: item.quantity,
            barcode: item.barcode,
          })),
          payment_method_id: selectedPayment,
          payment_method_name: selectedPaymentMethod?.name || '',
        }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success("Venda criada no Tiny ERP!");
        setSaleResult(data);
        setStep("invoice");
      } else {
        toast.error(data.error || "Erro ao criar venda");
      }
    } catch (e) {
      toast.error("Erro ao finalizar venda");
    } finally {
      setFinalizingSale(false);
    }
  };

  const emitNfce = async () => {
    if (!saleResult?.tiny_order_id) return;
    setEmittingNfce(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-emit-nfce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          store_id: storeId,
          sale_id: saleResult.sale_id,
          tiny_order_id: saleResult.tiny_order_id,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setNfceResult(data);
        toast.success("NFC-e emitida!");
      } else {
        toast.error(data.error || "Erro ao emitir NFC-e");
      }
    } catch (e) {
      toast.error("Erro ao emitir NFC-e");
    } finally {
      setEmittingNfce(false);
    }
  };

  const resetSale = () => {
    setCart([]);
    setSelectedCustomer(null);
    setSelectedPayment("");
    setSelectedSeller("");
    setStep("scan");
    setSaleResult(null);
    setNfceResult(null);
    setSearchResults([]);
    setCashReceived("");
    setInstallments("1");
  };

  const steps: { id: SaleStep; label: string; icon: typeof ScanBarcode }[] = [
    { id: "scan", label: "Produtos", icon: ScanBarcode },
    { id: "customer", label: "Cliente", icon: User },
    { id: "payment", label: "Pagamento", icon: CreditCard },
    { id: "invoice", label: "Nota Fiscal", icon: Receipt },
  ];

  const stepIndex = steps.findIndex(s => s.id === step);
  const selectedPaymentName = paymentMethods.find(m => m.id === selectedPayment)?.name || '';
  const cashChange = cashReceived ? Math.max(0, parseFloat(cashReceived) - subtotal) : 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Seller selector + Step Navigation */}
      <div className="flex items-center gap-1 p-3 border-b border-pos-yellow/10 bg-pos-black">
        {/* Seller */}
        <div className="mr-3">
          <Select value={selectedSeller} onValueChange={setSelectedSeller}>
            <SelectTrigger className="h-8 w-36 bg-pos-white/5 border-pos-yellow/30 text-pos-white text-xs">
              <Users className="h-3 w-3 mr-1 text-pos-orange" />
              <SelectValue placeholder="Vendedora" />
            </SelectTrigger>
            <SelectContent>
              {sellers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === s.id;
          const isDone = i < stepIndex;
          return (
            <button
              key={s.id}
              onClick={() => setStep(s.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                isActive && "bg-pos-yellow text-pos-black shadow-md shadow-pos-yellow/30",
                isDone && "bg-pos-orange/20 text-pos-orange",
                !isActive && !isDone && "text-pos-white/50 hover:bg-pos-white/10"
              )}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Step Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {step === "scan" && (
            <>
              <div className="p-4 border-b border-pos-yellow/10 bg-pos-black">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-yellow" />
                    <Input
                      placeholder="Bipe o código de barras ou digite o SKU..."
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleBarcodeScan()}
                      className="pl-10 text-lg h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow focus:ring-pos-yellow/30"
                      autoFocus
                    />
                  </div>
                  <Button variant="outline" size="icon" className="h-12 w-12 border-pos-yellow/30 text-pos-yellow hover:bg-pos-yellow/10" onClick={() => setShowCamera(true)}>
                    <Camera className="h-5 w-5" />
                  </Button>
                  <Button className="h-12 px-6 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold" onClick={handleBarcodeScan} disabled={searching}>
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-2" /> Buscar</>}
                  </Button>
                </div>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="p-4 border-b border-pos-yellow/10 bg-pos-yellow/5">
                  <p className="text-xs text-pos-yellow mb-2 font-medium">Resultados da busca — clique para adicionar:</p>
                  <div className="space-y-1.5">
                    {searchResults.map((product, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-lg border border-pos-yellow/20 bg-pos-black cursor-pointer hover:border-pos-yellow transition-all" onClick={() => addToCart(product)}>
                        <Package className="h-4 w-4 text-pos-yellow flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-pos-white truncate">{product.name}</p>
                          <div className="flex gap-2 text-[10px]">
                            <span className="text-pos-orange">{product.sku}</span>
                            {product.variant && <span className="text-pos-white/50">{product.variant}</span>}
                            {product.stock !== undefined && <span className="text-pos-white/40">Est: {product.stock}</span>}
                          </div>
                        </div>
                        <span className="font-bold text-sm text-pos-yellow">R$ {product.price.toFixed(2)}</span>
                        <Plus className="h-4 w-4 text-pos-yellow" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {cart.length === 0 ? (
                    <div className="text-center py-20 text-pos-white/40">
                      <ScanBarcode className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-medium">Nenhum produto adicionado</p>
                      <p className="text-sm mt-1">Bipe um código de barras ou busque por SKU</p>
                    </div>
                  ) : cart.map(item => (
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-pos-yellow/10 bg-pos-white/5 hover:border-pos-yellow/30 transition-all">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-pos-yellow/10">
                        <Package className="h-5 w-5 text-pos-yellow" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate text-pos-white">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange border-pos-orange/30">{item.sku}</Badge>
                          {item.variant && <span className="text-xs text-pos-white/50">{item.variant}</span>}
                          {item.size && <span className="text-xs text-pos-white/40">Tam: {item.size}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7 border-pos-white/20 text-pos-white hover:bg-pos-white/10" onClick={() => updateQuantity(item.id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-bold text-sm text-pos-yellow">{item.quantity}</span>
                        <Button variant="outline" size="icon" className="h-7 w-7 border-pos-white/20 text-pos-white hover:bg-pos-white/10" onClick={() => updateQuantity(item.id, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-right min-w-[80px]">
                        <p className="font-bold text-sm text-pos-white">R$ {(item.price * item.quantity).toFixed(2)}</p>
                        {item.quantity > 1 && <p className="text-[10px] text-pos-white/40">{item.quantity}x R$ {item.price.toFixed(2)}</p>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => removeItem(item.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          {step === "customer" && (
            <div className="p-6 space-y-6 overflow-auto">
              <div>
                <h2 className="text-lg font-bold mb-1 text-pos-white">Identificação do Cliente</h2>
                <p className="text-sm text-pos-white/50">Busque pelo CPF ou cadastre um novo cliente</p>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Buscar por CPF, nome ou telefone..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchCustomerByTerm()}
                  className="h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow"
                />
                <Button className="h-12 gap-2 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold" onClick={searchCustomerByTerm} disabled={searchingCustomer}>
                  {searchingCustomer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
                <Button className="h-12 gap-2 bg-pos-orange text-pos-white hover:bg-pos-orange-muted font-bold" onClick={() => setShowCustomerForm(true)}>
                  <Plus className="h-4 w-4" /> Novo
                </Button>
              </div>
              {customerResults.length > 0 && !selectedCustomer && (
                <div className="space-y-2">
                  {customerResults.map(c => (
                    <div key={c.id} className="cursor-pointer rounded-lg border border-pos-yellow/20 bg-pos-white/5 p-3 hover:border-pos-yellow transition-all" onClick={() => setSelectedCustomer(c)}>
                      <p className="font-medium text-pos-white">{c.name || 'Sem nome'}</p>
                      <div className="flex gap-3 text-xs text-pos-white/50 mt-1">
                        {c.cpf && <span>CPF: {c.cpf}</span>}
                        {c.whatsapp && <span>WhatsApp: {c.whatsapp}</span>}
                        {c.email && <span>{c.email}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selectedCustomer ? (
                <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-4 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-pos-orange/20 flex items-center justify-center">
                    <Check className="h-5 w-5 text-pos-orange" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-pos-white">{selectedCustomer.name}</p>
                    {selectedCustomer.cpf && <p className="text-sm text-pos-white/50">CPF: {selectedCustomer.cpf}</p>}
                  </div>
                  <Button variant="ghost" size="sm" className="text-pos-white/70 hover:text-pos-yellow hover:bg-pos-yellow/10" onClick={() => { setSelectedCustomer(null); setCustomerResults([]); }}>Trocar</Button>
                </div>
              ) : (
                <p className="text-xs text-pos-white/40">* Pule esta etapa para NFC-e sem identificação.</p>
              )}
            </div>
          )}

          {step === "payment" && (
            <div className="p-6 space-y-6 overflow-auto">
              <div>
                <h2 className="text-lg font-bold mb-1 text-pos-white">Forma de Pagamento</h2>
                <p className="text-sm text-pos-white/50">Formas de pagamento do Tiny ERP</p>
              </div>
              {loadingPayments ? (
                <div className="flex items-center justify-center py-12 text-pos-white/50">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando formas de pagamento do Tiny...
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {paymentMethods.map(method => {
                    const isSelected = selectedPayment === method.id;
                    const lowerName = method.name.toLowerCase();
                    let Icon = CreditCard;
                    if (lowerName.includes('dinheiro')) Icon = Banknote;
                    else if (lowerName.includes('pix')) Icon = QrCode;
                    else if (lowerName.includes('crediário') || lowerName.includes('crediario')) Icon = FileText;
                    return (
                      <div key={method.id} className={cn(
                        "cursor-pointer rounded-xl border-2 p-6 flex flex-col items-center justify-center gap-3 transition-all hover:shadow-lg",
                        isSelected ? "border-pos-yellow bg-pos-yellow/10 shadow-[0_0_20px_hsl(48_100%_50%/0.15)]" : "border-pos-white/10 bg-pos-white/5 hover:border-pos-yellow/30"
                      )} onClick={() => setSelectedPayment(method.id)}>
                        <div className={cn("p-3 rounded-xl transition-colors", isSelected ? "bg-pos-yellow text-pos-black" : "bg-pos-white/10 text-pos-white/60")}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <span className={cn("font-medium text-sm text-center", isSelected ? "text-pos-yellow" : "text-pos-white/70")}>{method.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedPaymentName.toLowerCase().includes('crédito') && (
                <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-yellow/20">
                  <Label className="text-pos-white">Parcelas</Label>
                  <Select value={installments} onValueChange={setInstallments}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-yellow/30 text-pos-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 6, 10, 12].map(n => (
                        <SelectItem key={n} value={String(n)}>{n}x de R$ {(subtotal / n).toFixed(2)}{n === 1 ? ' (à vista)' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selectedPaymentName.toLowerCase().includes('dinheiro') && (
                <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-yellow/20">
                  <Label className="text-pos-white">Valor recebido</Label>
                  <Input type="number" value={cashReceived} onChange={e => setCashReceived(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-pos-white/50">Troco:</span>
                    <span className="font-bold text-lg text-pos-yellow">R$ {cashChange.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "invoice" && (
            <div className="p-6 space-y-6 overflow-auto">
              <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-6 text-center space-y-4">
                <div className="h-16 w-16 mx-auto rounded-full bg-pos-orange/20 flex items-center justify-center">
                  <Check className="h-8 w-8 text-pos-orange" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-pos-white">Venda Finalizada!</h3>
                  <p className="text-pos-white/50 mt-1">
                    {saleResult?.tiny_order_number
                      ? `Pedido #${saleResult.tiny_order_number} criado no Tiny ERP`
                      : 'Pedido criado no Tiny ERP'}
                  </p>
                </div>
                <div className="text-2xl font-bold text-pos-yellow">R$ {subtotal.toFixed(2)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10"
                  variant="outline"
                  onClick={emitNfce}
                  disabled={emittingNfce || !!nfceResult}
                >
                  {emittingNfce ? <Loader2 className="h-5 w-5 animate-spin" /> : <Receipt className="h-5 w-5" />}
                  {nfceResult ? 'NFC-e Emitida ✓' : 'Emitir NFC-e'}
                </Button>
                {nfceResult?.invoice_pdf_url && (
                  <Button className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10" variant="outline" onClick={() => window.open(nfceResult.invoice_pdf_url, '_blank')}>
                    <Printer className="h-5 w-5" /> Imprimir Nota
                  </Button>
                )}
                <Button className="h-14 gap-2 text-base bg-pos-orange text-pos-white hover:bg-pos-orange-muted font-bold col-span-2" onClick={resetSale}>
                  <ShoppingCart className="h-5 w-5" /> Nova Venda
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Cart Summary */}
        <div className="w-[280px] border-l border-pos-yellow/20 bg-pos-black flex flex-col">
          <div className="p-3 border-b border-pos-yellow/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-pos-yellow" />
                <span className="font-semibold text-sm text-pos-white">Resumo</span>
              </div>
              <Badge className="bg-pos-yellow/20 text-pos-yellow border-pos-yellow/30">{totalItems} itens</Badge>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1.5">
              {cart.map(item => (
                <div key={item.id} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-xs text-pos-white">{item.name}</p>
                    <p className="text-[10px] text-pos-white/40">{item.quantity}x R$ {item.price.toFixed(2)}</p>
                  </div>
                  <span className="font-semibold text-xs ml-2 text-pos-white">R$ {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t border-pos-yellow/20 p-3 space-y-2">
            {selectedSeller && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <Users className="h-3 w-3" />{sellers.find(s => s.id === selectedSeller)?.name}
              </div>
            )}
            {selectedCustomer && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <User className="h-3 w-3" />{selectedCustomer.name}
              </div>
            )}
            {selectedPayment && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <CreditCard className="h-3 w-3" />{selectedPaymentName}
              </div>
            )}
            <Separator className="bg-pos-yellow/20" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-pos-white/50">Subtotal</span>
              <span className="font-bold text-lg text-pos-yellow">R$ {subtotal.toFixed(2)}</span>
            </div>
            <Button
              className="w-full h-10 text-sm gap-2 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold"
              disabled={cart.length === 0 || finalizingSale}
              onClick={() => {
                if (step === "payment") {
                  finalizeSale();
                } else if (stepIndex < steps.length - 1) {
                  setStep(steps[stepIndex + 1].id);
                }
              }}
            >
              {finalizingSale ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Finalizando...</>
              ) : step === "payment" ? (
                <><Check className="h-4 w-4" /> Finalizar Venda</>
              ) : step === "invoice" ? (
                <><ShoppingCart className="h-4 w-4" /> Nova Venda</>
              ) : (
                <>Avançar <ChevronRight className="h-4 w-4" /></>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Camera Dialog */}
      <Dialog open={showCamera} onOpenChange={setShowCamera}>
        <DialogContent className="max-w-md bg-pos-black border-pos-yellow/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-pos-white">
              <Camera className="h-5 w-5 text-pos-yellow" /> Scanner de Código de Barras
            </DialogTitle>
          </DialogHeader>
          <div className="aspect-video bg-pos-white/5 rounded-xl flex items-center justify-center border border-pos-yellow/10">
            <div className="text-center text-pos-white/40">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Câmera será ativada aqui</p>
            </div>
          </div>
          <Button className="bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold" onClick={() => setShowCamera(false)}>Fechar</Button>
        </DialogContent>
      </Dialog>

      {/* Customer Form Dialog */}
      <POSCustomerForm
        open={showCustomerForm}
        onOpenChange={setShowCustomerForm}
        onSaved={(customer) => {
          setSelectedCustomer(customer);
          setShowCustomerForm(false);
        }}
      />
    </div>
  );
}

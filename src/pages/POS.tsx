import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Home, ScanBarcode, Search, Plus, Minus, Trash2, User, CreditCard,
  Receipt, Printer, Camera, ShoppingCart, Store, ChevronRight, X,
  DollarSign, QrCode, Banknote, FileText, Check, Package
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ── Mock data for visual prototype ──
const MOCK_STORES = [
  { id: "1", name: "Loja Centro", tinyAccount: "Tiny Loja Centro" },
  { id: "2", name: "Loja Shopping", tinyAccount: "Tiny Loja Shopping" },
];

interface CartItem {
  id: string;
  sku: string;
  name: string;
  variant: string;
  price: number;
  quantity: number;
  barcode: string;
}

const MOCK_CART: CartItem[] = [
  { id: "1", sku: "CAM-001", name: "Camiseta Básica", variant: "Branca - M", price: 59.90, quantity: 2, barcode: "7891234567890" },
  { id: "2", sku: "CAL-015", name: "Calça Jeans Skinny", variant: "Azul - 38", price: 189.90, quantity: 1, barcode: "7891234567891" },
  { id: "3", sku: "VES-008", name: "Vestido Floral", variant: "Estampado - P", price: 149.90, quantity: 1, barcode: "7891234567892" },
];

const MOCK_PAYMENT_METHODS = [
  { id: "dinheiro", name: "Dinheiro", icon: Banknote },
  { id: "credito", name: "Cartão de Crédito", icon: CreditCard },
  { id: "debito", name: "Cartão de Débito", icon: CreditCard },
  { id: "pix", name: "PIX", icon: QrCode },
  { id: "crediario", name: "Crediário", icon: FileText },
];

type POSStep = "scan" | "customer" | "payment" | "invoice";

export default function POS() {
  const navigate = useNavigate();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>(MOCK_CART);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [step, setStep] = useState<POSStep>("scan");
  const [showCamera, setShowCamera] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<{ name: string; cpf: string } | null>(null);

  const subtotal = cart.reduce((s, item) => s + item.price * item.quantity, 0);
  const totalItems = cart.reduce((s, item) => s + item.quantity, 0);

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = Math.max(0, item.quantity + delta);
      return newQty === 0 ? item : { ...item, quantity: newQty };
    }));
  };

  const removeItem = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const handleBarcodeScan = () => {
    if (!barcodeInput.trim()) return;
    // In real implementation: search Tiny API by barcode
    setBarcodeInput("");
  };

  const steps: { id: POSStep; label: string; icon: typeof ScanBarcode }[] = [
    { id: "scan", label: "Produtos", icon: ScanBarcode },
    { id: "customer", label: "Cliente", icon: User },
    { id: "payment", label: "Pagamento", icon: CreditCard },
    { id: "invoice", label: "Nota Fiscal", icon: Receipt },
  ];

  // ── Store selector screen ──
  if (!selectedStore) {
    return (
      <div className="min-h-screen bg-pos-black flex flex-col">
        <header className="sticky top-0 z-50 w-full border-b border-pos-yellow/20 bg-pos-black/95 backdrop-blur">
          <div className="container flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pos-yellow text-pos-black">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-pos-white">Frente de Caixa</h1>
                <p className="text-xs text-pos-yellow-muted">Selecione a loja</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 text-pos-white hover:text-pos-yellow hover:bg-pos-yellow/10">
                <Home className="h-4 w-4" /> Início
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 container py-10 flex items-center justify-center">
          <div className="w-full max-w-lg space-y-4">
            <div className="text-center mb-8">
              <Store className="h-12 w-12 mx-auto text-pos-yellow mb-3" />
              <h2 className="text-2xl font-bold text-pos-white">Qual loja você está?</h2>
              <p className="text-pos-white/60 mt-1">Selecione para conectar ao Tiny ERP correto</p>
            </div>
            {MOCK_STORES.map(store => (
              <div
                key={store.id}
                className="cursor-pointer rounded-xl border-2 border-pos-yellow/30 bg-pos-black hover:border-pos-yellow hover:shadow-[0_0_20px_hsl(48_100%_50%/0.15)] transition-all group p-6 flex items-center justify-between"
                onClick={() => setSelectedStore(store.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-pos-yellow/10 text-pos-yellow group-hover:bg-pos-yellow group-hover:text-pos-black transition-all group-hover:scale-110">
                    <Store className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-pos-white">{store.name}</h3>
                    <p className="text-sm text-pos-white/50">{store.tinyAccount}</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-pos-white/40 group-hover:text-pos-yellow transition-colors" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  const currentStore = MOCK_STORES.find(s => s.id === selectedStore);

  return (
    <div className="h-screen flex flex-col bg-pos-black">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-pos-yellow/20 bg-pos-black/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pos-yellow text-pos-black font-bold">
              <Store className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-pos-white">Frente de Caixa</h1>
              <p className="text-xs text-pos-yellow-muted">{currentStore?.name}</p>
            </div>
          </div>

          {/* Step Navigation */}
          <div className="flex items-center gap-1">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isActive = step === s.id;
              const stepIndex = steps.findIndex(st => st.id === step);
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

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedStore("")} className="gap-1 text-xs text-pos-white/70 hover:text-pos-yellow hover:bg-pos-yellow/10">
              Trocar Loja
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 text-pos-white/70 hover:text-pos-yellow hover:bg-pos-yellow/10">
              <Home className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Product area / Step content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {step === "scan" && (
            <>
              {/* Barcode Input */}
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
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 border-pos-yellow/30 text-pos-yellow hover:bg-pos-yellow/10 hover:text-pos-yellow"
                    onClick={() => setShowCamera(true)}
                    title="Usar câmera"
                  >
                    <Camera className="h-5 w-5" />
                  </Button>
                  <Button
                    className="h-12 px-6 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold"
                    onClick={handleBarcodeScan}
                  >
                    <Search className="h-4 w-4 mr-2" />
                    Buscar
                  </Button>
                </div>
              </div>

              {/* Product List */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {cart.length === 0 ? (
                    <div className="text-center py-20 text-pos-white/40">
                      <ScanBarcode className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-medium">Nenhum produto adicionado</p>
                      <p className="text-sm mt-1">Bipe um código de barras ou busque por SKU</p>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-pos-yellow/10 bg-pos-white/5 hover:border-pos-yellow/30 transition-all"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-pos-yellow/10">
                          <Package className="h-5 w-5 text-pos-yellow" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate text-pos-white">{item.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange border-pos-orange/30">{item.sku}</Badge>
                            <span className="text-xs text-pos-white/50">{item.variant}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 border-pos-white/20 text-pos-white hover:bg-pos-white/10"
                            onClick={() => updateQuantity(item.id, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-bold text-sm text-pos-yellow">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 border-pos-white/20 text-pos-white hover:bg-pos-white/10"
                            onClick={() => updateQuantity(item.id, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="text-right min-w-[80px]">
                          <p className="font-bold text-sm text-pos-white">
                            R$ {(item.price * item.quantity).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-pos-white/40">
                            {item.quantity > 1 && `${item.quantity}x R$ ${item.price.toFixed(2)}`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </>
          )}

          {step === "customer" && (
            <div className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1 text-pos-white">Identificação do Cliente</h2>
                <p className="text-sm text-pos-white/50">Busque pelo CPF ou cadastre um novo cliente</p>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-yellow" />
                  <Input
                    placeholder="Buscar por CPF, nome ou telefone..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-10 h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow"
                  />
                </div>
                <Button className="h-12 gap-2 bg-pos-orange text-pos-white hover:bg-pos-orange-muted font-bold">
                  <Plus className="h-4 w-4" /> Novo Cliente
                </Button>
              </div>

              {/* Mock found customer */}
              {!selectedCustomer ? (
                <div
                  className="cursor-pointer rounded-xl border border-pos-yellow/20 bg-pos-white/5 hover:border-pos-yellow/50 transition-all p-4 flex items-center gap-4"
                  onClick={() => setSelectedCustomer({ name: "Maria Silva", cpf: "123.456.789-00" })}
                >
                  <div className="h-12 w-12 rounded-full bg-pos-yellow/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-pos-yellow" />
                  </div>
                  <div>
                    <p className="font-semibold text-pos-white">Maria Silva</p>
                    <p className="text-sm text-pos-white/50">CPF: 123.456.789-00 • (11) 99999-9999</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-4 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-pos-orange/20 flex items-center justify-center">
                    <Check className="h-5 w-5 text-pos-orange" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-pos-white">{selectedCustomer.name}</p>
                    <p className="text-sm text-pos-white/50">CPF: {selectedCustomer.cpf}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-pos-white/70 hover:text-pos-yellow hover:bg-pos-yellow/10" onClick={() => setSelectedCustomer(null)}>
                    Trocar
                  </Button>
                </div>
              )}

              <p className="text-xs text-pos-white/40">
                * Para NFC-e, o CPF é opcional. Para NF-e, é obrigatório.
              </p>
            </div>
          )}

          {step === "payment" && (
            <div className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1 text-pos-white">Forma de Pagamento</h2>
                <p className="text-sm text-pos-white/50">Formas de pagamento do Tiny ERP</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MOCK_PAYMENT_METHODS.map(method => {
                  const Icon = method.icon;
                  const isSelected = selectedPayment === method.id;
                  return (
                    <div
                      key={method.id}
                      className={cn(
                        "cursor-pointer rounded-xl border-2 p-6 flex flex-col items-center justify-center gap-3 transition-all hover:shadow-lg",
                        isSelected
                          ? "border-pos-yellow bg-pos-yellow/10 shadow-[0_0_20px_hsl(48_100%_50%/0.15)]"
                          : "border-pos-white/10 bg-pos-white/5 hover:border-pos-yellow/30"
                      )}
                      onClick={() => setSelectedPayment(method.id)}
                    >
                      <div className={cn(
                        "p-3 rounded-xl transition-colors",
                        isSelected ? "bg-pos-yellow text-pos-black" : "bg-pos-white/10 text-pos-white/60"
                      )}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <span className={cn(
                        "font-medium text-sm",
                        isSelected ? "text-pos-yellow" : "text-pos-white/70"
                      )}>
                        {method.name}
                      </span>
                    </div>
                  );
                })}
              </div>

              {selectedPayment === "credito" && (
                <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-yellow/20">
                  <Label className="text-pos-white">Parcelas</Label>
                  <Select defaultValue="1">
                    <SelectTrigger className="bg-pos-white/5 border-pos-yellow/30 text-pos-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1x de R$ {subtotal.toFixed(2)} (à vista)</SelectItem>
                      <SelectItem value="2">2x de R$ {(subtotal / 2).toFixed(2)}</SelectItem>
                      <SelectItem value="3">3x de R$ {(subtotal / 3).toFixed(2)}</SelectItem>
                      <SelectItem value="6">6x de R$ {(subtotal / 6).toFixed(2)}</SelectItem>
                      <SelectItem value="10">10x de R$ {(subtotal / 10).toFixed(2)}</SelectItem>
                      <SelectItem value="12">12x de R$ {(subtotal / 12).toFixed(2)}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedPayment === "dinheiro" && (
                <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-yellow/20">
                  <Label className="text-pos-white">Valor recebido</Label>
                  <Input type="number" placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-pos-white/50">Troco:</span>
                    <span className="font-bold text-lg text-pos-yellow">R$ 0,00</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "invoice" && (
            <div className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1 text-pos-white">Nota Fiscal</h2>
                <p className="text-sm text-pos-white/50">Emitir NFC-e via Tiny ERP</p>
              </div>

              <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-6 text-center space-y-4">
                <div className="h-16 w-16 mx-auto rounded-full bg-pos-orange/20 flex items-center justify-center">
                  <Check className="h-8 w-8 text-pos-orange" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-pos-white">Venda Finalizada!</h3>
                  <p className="text-pos-white/50 mt-1">Pedido criado no Tiny ERP</p>
                </div>
                <div className="flex items-center justify-center gap-2 text-2xl font-bold text-pos-yellow">
                  R$ {subtotal.toFixed(2)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10" variant="outline">
                  <Receipt className="h-5 w-5" />
                  Emitir NFC-e
                </Button>
                <Button className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10" variant="outline">
                  <Printer className="h-5 w-5" />
                  Imprimir Nota
                </Button>
                <Button className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10" variant="outline">
                  <Search className="h-5 w-5" />
                  Buscar NF no Tiny
                </Button>
                <Button
                  className="h-14 gap-2 text-base bg-pos-orange text-pos-white hover:bg-pos-orange-muted font-bold"
                  onClick={() => {
                    setCart([]);
                    setSelectedCustomer(null);
                    setSelectedPayment("");
                    setStep("scan");
                  }}
                >
                  <ShoppingCart className="h-5 w-5" />
                  Nova Venda
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Cart Summary (always visible) */}
        <div className="w-[320px] border-l border-pos-yellow/20 bg-pos-black flex flex-col">
          <div className="p-4 border-b border-pos-yellow/20">
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
                  <span className="font-semibold text-xs ml-2 text-pos-white">
                    R$ {(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t border-pos-yellow/20 p-4 space-y-3">
            {selectedCustomer && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <User className="h-3 w-3" />
                {selectedCustomer.name}
              </div>
            )}
            {selectedPayment && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <CreditCard className="h-3 w-3" />
                {MOCK_PAYMENT_METHODS.find(m => m.id === selectedPayment)?.name}
              </div>
            )}
            <Separator className="bg-pos-yellow/20" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-pos-white/50">Subtotal</span>
              <span className="font-bold text-lg text-pos-yellow">R$ {subtotal.toFixed(2)}</span>
            </div>
            <Button
              className="w-full h-12 text-base gap-2 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold"
              disabled={cart.length === 0}
              onClick={() => {
                const currentIndex = steps.findIndex(s => s.id === step);
                if (currentIndex < steps.length - 1) {
                  setStep(steps[currentIndex + 1].id);
                }
              }}
            >
              {step === "invoice" ? (
                <>
                  <Printer className="h-4 w-4" /> Finalizar
                </>
              ) : (
                <>
                  Avançar <ChevronRight className="h-4 w-4" />
                </>
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
              <p className="text-xs mt-1">Aponte para o código de barras</p>
            </div>
          </div>
          <Button className="bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold" onClick={() => setShowCamera(false)}>Fechar</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

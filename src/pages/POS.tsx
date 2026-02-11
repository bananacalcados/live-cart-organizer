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
import { ThemeToggle } from "@/components/ThemeToggle";
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
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
          <div className="container flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Frente de Caixa</h1>
                <p className="text-xs text-muted-foreground">Selecione a loja</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1">
                <Home className="h-4 w-4" /> Início
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 container py-10 flex items-center justify-center">
          <div className="w-full max-w-lg space-y-4">
            <div className="text-center mb-8">
              <Store className="h-12 w-12 mx-auto text-primary mb-3" />
              <h2 className="text-2xl font-bold">Qual loja você está?</h2>
              <p className="text-muted-foreground mt-1">Selecione para conectar ao Tiny ERP correto</p>
            </div>
            {MOCK_STORES.map(store => (
              <Card
                key={store.id}
                className="cursor-pointer hover:shadow-lg hover:border-primary/30 transition-all group"
                onClick={() => setSelectedStore(store.id)}
              >
                <CardContent className="flex items-center justify-between p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                      <Store className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{store.name}</h3>
                      <p className="text-sm text-muted-foreground">{store.tinyAccount}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </div>
    );
  }

  const currentStore = MOCK_STORES.find(s => s.id === selectedStore);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Store className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold">Frente de Caixa</h1>
              <p className="text-xs text-muted-foreground">{currentStore?.name}</p>
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
                    isActive && "bg-primary text-primary-foreground shadow-md",
                    isDone && "bg-stage-paid/20 text-stage-paid",
                    !isActive && !isDone && "text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => setSelectedStore("")} className="gap-1 text-xs">
              Trocar Loja
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1">
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
              <div className="p-4 border-b border-border/40 bg-card">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Bipe o código de barras ou digite o SKU..."
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleBarcodeScan()}
                      className="pl-10 text-lg h-12"
                      autoFocus
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12"
                    onClick={() => setShowCamera(true)}
                    title="Usar câmera"
                  >
                    <Camera className="h-5 w-5" />
                  </Button>
                  <Button
                    className="h-12 px-6"
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
                    <div className="text-center py-20 text-muted-foreground">
                      <ScanBarcode className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-medium">Nenhum produto adicionado</p>
                      <p className="text-sm mt-1">Bipe um código de barras ou busque por SKU</p>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-card hover:shadow-sm transition-shadow"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-[10px]">{item.sku}</Badge>
                            <span className="text-xs text-muted-foreground">{item.variant}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.id, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-bold text-sm">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.id, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="text-right min-w-[80px]">
                          <p className="font-bold text-sm">
                            R$ {(item.price * item.quantity).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.quantity > 1 && `${item.quantity}x R$ ${item.price.toFixed(2)}`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
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
                <h2 className="text-lg font-bold mb-1">Identificação do Cliente</h2>
                <p className="text-sm text-muted-foreground">Busque pelo CPF ou cadastre um novo cliente</p>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por CPF, nome ou telefone..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-10 h-12"
                  />
                </div>
                <Button variant="outline" className="h-12 gap-2">
                  <Plus className="h-4 w-4" /> Novo Cliente
                </Button>
              </div>

              {/* Mock found customer */}
              {!selectedCustomer ? (
                <Card
                  className="cursor-pointer hover:border-primary/30 transition-all"
                  onClick={() => setSelectedCustomer({ name: "Maria Silva", cpf: "123.456.789-00" })}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">Maria Silva</p>
                      <p className="text-sm text-muted-foreground">CPF: 123.456.789-00 • (11) 99999-9999</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-stage-paid/50 bg-stage-paid/5">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="h-12 w-12 rounded-full bg-stage-paid/20 flex items-center justify-center">
                      <Check className="h-5 w-5 text-stage-paid" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{selectedCustomer.name}</p>
                      <p className="text-sm text-muted-foreground">CPF: {selectedCustomer.cpf}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(null)}>
                      Trocar
                    </Button>
                  </CardContent>
                </Card>
              )}

              <p className="text-xs text-muted-foreground">
                * Para NFC-e, o CPF é opcional. Para NF-e, é obrigatório.
              </p>
            </div>
          )}

          {step === "payment" && (
            <div className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Forma de Pagamento</h2>
                <p className="text-sm text-muted-foreground">Formas de pagamento do Tiny ERP</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MOCK_PAYMENT_METHODS.map(method => {
                  const Icon = method.icon;
                  const isSelected = selectedPayment === method.id;
                  return (
                    <Card
                      key={method.id}
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-md",
                        isSelected && "border-primary shadow-md ring-2 ring-primary/20"
                      )}
                      onClick={() => setSelectedPayment(method.id)}
                    >
                      <CardContent className="flex flex-col items-center justify-center p-6 gap-3">
                        <div className={cn(
                          "p-3 rounded-xl transition-colors",
                          isSelected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                        )}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <span className={cn(
                          "font-medium text-sm",
                          isSelected && "text-primary"
                        )}>
                          {method.name}
                        </span>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {selectedPayment === "credito" && (
                <div className="space-y-3 p-4 rounded-xl bg-card border border-border/50">
                  <Label>Parcelas</Label>
                  <Select defaultValue="1">
                    <SelectTrigger>
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
                <div className="space-y-3 p-4 rounded-xl bg-card border border-border/50">
                  <Label>Valor recebido</Label>
                  <Input type="number" placeholder="0,00" className="text-lg h-12" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Troco:</span>
                    <span className="font-bold text-lg">R$ 0,00</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "invoice" && (
            <div className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Nota Fiscal</h2>
                <p className="text-sm text-muted-foreground">Emitir NFC-e via Tiny ERP</p>
              </div>

              <Card className="border-stage-paid/50 bg-stage-paid/5">
                <CardContent className="p-6 text-center space-y-4">
                  <div className="h-16 w-16 mx-auto rounded-full bg-stage-paid/20 flex items-center justify-center">
                    <Check className="h-8 w-8 text-stage-paid" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Venda Finalizada!</h3>
                    <p className="text-muted-foreground mt-1">Pedido criado no Tiny ERP</p>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-2xl font-bold">
                    R$ {subtotal.toFixed(2)}
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-3">
                <Button className="h-14 gap-2 text-base" variant="outline">
                  <Receipt className="h-5 w-5" />
                  Emitir NFC-e
                </Button>
                <Button className="h-14 gap-2 text-base" variant="outline">
                  <Printer className="h-5 w-5" />
                  Imprimir Nota
                </Button>
                <Button className="h-14 gap-2 text-base" variant="outline">
                  <Search className="h-5 w-5" />
                  Buscar NF no Tiny
                </Button>
                <Button
                  className="h-14 gap-2 text-base"
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
        <div className="w-[320px] border-l border-border/40 bg-card flex flex-col">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Resumo</span>
              </div>
              <Badge variant="secondary">{totalItems} itens</Badge>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1.5">
              {cart.map(item => (
                <div key={item.id} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-xs">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground">{item.quantity}x R$ {item.price.toFixed(2)}</p>
                  </div>
                  <span className="font-semibold text-xs ml-2">
                    R$ {(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t border-border/40 p-4 space-y-3">
            {selectedCustomer && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {selectedCustomer.name}
              </div>
            )}
            {selectedPayment && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CreditCard className="h-3 w-3" />
                {MOCK_PAYMENT_METHODS.find(m => m.id === selectedPayment)?.name}
              </div>
            )}
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Subtotal</span>
              <span className="font-bold text-lg">R$ {subtotal.toFixed(2)}</span>
            </div>
            <Button
              className="w-full h-12 text-base gap-2"
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" /> Scanner de Código de Barras
            </DialogTitle>
          </DialogHeader>
          <div className="aspect-video bg-secondary rounded-xl flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Câmera será ativada aqui</p>
              <p className="text-xs mt-1">Aponte para o código de barras</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setShowCamera(false)}>Fechar</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import {
  ScanBarcode, Search, Plus, Minus, Trash2, User, CreditCard,
  Receipt, Printer, Camera, ShoppingCart, Package, Check,
  QrCode, Banknote, FileText, ChevronRight
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

interface CartItem {
  id: string;
  sku: string;
  name: string;
  variant: string;
  size?: string;
  category?: string;
  price: number;
  quantity: number;
  barcode: string;
}

const MOCK_PAYMENT_METHODS = [
  { id: "dinheiro", name: "Dinheiro", icon: Banknote },
  { id: "credito", name: "Cartão de Crédito", icon: CreditCard },
  { id: "debito", name: "Cartão de Débito", icon: CreditCard },
  { id: "pix", name: "PIX", icon: QrCode },
  { id: "crediario", name: "Crediário", icon: FileText },
];

type SaleStep = "scan" | "customer" | "payment" | "invoice";

interface Props {
  storeId: string;
  sellerId?: string;
}

export function POSSalesView({ storeId, sellerId }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [step, setStep] = useState<SaleStep>("scan");
  const [showCamera, setShowCamera] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string; cpf?: string } | null>(null);

  const subtotal = cart.reduce((s, item) => s + item.price * item.quantity, 0);
  const totalItems = cart.reduce((s, item) => s + item.quantity, 0);

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = Math.max(1, item.quantity + delta);
      return { ...item, quantity: newQty };
    }));
  };

  const removeItem = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

  const handleBarcodeScan = () => {
    if (!barcodeInput.trim()) return;
    // TODO: Search Tiny API by barcode
    setBarcodeInput("");
  };

  const steps: { id: SaleStep; label: string; icon: typeof ScanBarcode }[] = [
    { id: "scan", label: "Produtos", icon: ScanBarcode },
    { id: "customer", label: "Cliente", icon: User },
    { id: "payment", label: "Pagamento", icon: CreditCard },
    { id: "invoice", label: "Nota Fiscal", icon: Receipt },
  ];

  const stepIndex = steps.findIndex(s => s.id === step);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Step Navigation */}
      <div className="flex items-center gap-1 p-3 border-b border-pos-yellow/10 bg-pos-black">
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
                  <Button className="h-12 px-6 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold" onClick={handleBarcodeScan}>
                    <Search className="h-4 w-4 mr-2" /> Buscar
                  </Button>
                </div>
              </div>
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
                          <span className="text-xs text-pos-white/50">{item.variant}</span>
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
                <Input placeholder="Buscar por CPF, nome ou telefone..." className="h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                <Button className="h-12 gap-2 bg-pos-orange text-pos-white hover:bg-pos-orange-muted font-bold" onClick={() => setShowCustomerForm(true)}>
                  <Plus className="h-4 w-4" /> Novo Cliente
                </Button>
              </div>
              {selectedCustomer ? (
                <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-4 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-pos-orange/20 flex items-center justify-center">
                    <Check className="h-5 w-5 text-pos-orange" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-pos-white">{selectedCustomer.name}</p>
                    {selectedCustomer.cpf && <p className="text-sm text-pos-white/50">CPF: {selectedCustomer.cpf}</p>}
                  </div>
                  <Button variant="ghost" size="sm" className="text-pos-white/70 hover:text-pos-yellow hover:bg-pos-yellow/10" onClick={() => setSelectedCustomer(null)}>Trocar</Button>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MOCK_PAYMENT_METHODS.map(method => {
                  const Icon = method.icon;
                  const isSelected = selectedPayment === method.id;
                  return (
                    <div key={method.id} className={cn(
                      "cursor-pointer rounded-xl border-2 p-6 flex flex-col items-center justify-center gap-3 transition-all hover:shadow-lg",
                      isSelected ? "border-pos-yellow bg-pos-yellow/10 shadow-[0_0_20px_hsl(48_100%_50%/0.15)]" : "border-pos-white/10 bg-pos-white/5 hover:border-pos-yellow/30"
                    )} onClick={() => setSelectedPayment(method.id)}>
                      <div className={cn("p-3 rounded-xl transition-colors", isSelected ? "bg-pos-yellow text-pos-black" : "bg-pos-white/10 text-pos-white/60")}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <span className={cn("font-medium text-sm", isSelected ? "text-pos-yellow" : "text-pos-white/70")}>{method.name}</span>
                    </div>
                  );
                })}
              </div>
              {selectedPayment === "credito" && (
                <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-yellow/20">
                  <Label className="text-pos-white">Parcelas</Label>
                  <Select defaultValue="1">
                    <SelectTrigger className="bg-pos-white/5 border-pos-yellow/30 text-pos-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 6, 10, 12].map(n => (
                        <SelectItem key={n} value={String(n)}>{n}x de R$ {(subtotal / n).toFixed(2)}{n === 1 ? ' (à vista)' : ''}</SelectItem>
                      ))}
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
            <div className="p-6 space-y-6 overflow-auto">
              <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-6 text-center space-y-4">
                <div className="h-16 w-16 mx-auto rounded-full bg-pos-orange/20 flex items-center justify-center">
                  <Check className="h-8 w-8 text-pos-orange" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-pos-white">Venda Finalizada!</h3>
                  <p className="text-pos-white/50 mt-1">Pedido criado no Tiny ERP</p>
                </div>
                <div className="text-2xl font-bold text-pos-yellow">R$ {subtotal.toFixed(2)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10" variant="outline">
                  <Receipt className="h-5 w-5" /> Emitir NFC-e
                </Button>
                <Button className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10" variant="outline">
                  <Printer className="h-5 w-5" /> Imprimir Nota
                </Button>
                <Button className="h-14 gap-2 text-base border-2 border-pos-yellow/30 bg-pos-white/5 text-pos-yellow hover:bg-pos-yellow/10" variant="outline">
                  <Search className="h-5 w-5" /> Buscar NF no Tiny
                </Button>
                <Button className="h-14 gap-2 text-base bg-pos-orange text-pos-white hover:bg-pos-orange-muted font-bold" onClick={() => {
                  setCart([]);
                  setSelectedCustomer(null);
                  setSelectedPayment("");
                  setStep("scan");
                }}>
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
            {selectedCustomer && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <User className="h-3 w-3" />{selectedCustomer.name}
              </div>
            )}
            {selectedPayment && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <CreditCard className="h-3 w-3" />{MOCK_PAYMENT_METHODS.find(m => m.id === selectedPayment)?.name}
              </div>
            )}
            <Separator className="bg-pos-yellow/20" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-pos-white/50">Subtotal</span>
              <span className="font-bold text-lg text-pos-yellow">R$ {subtotal.toFixed(2)}</span>
            </div>
            <Button
              className="w-full h-10 text-sm gap-2 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold"
              disabled={cart.length === 0}
              onClick={() => {
                if (stepIndex < steps.length - 1) setStep(steps[stepIndex + 1].id);
              }}
            >
              {step === "invoice" ? <><Printer className="h-4 w-4" /> Finalizar</> : <>Avançar <ChevronRight className="h-4 w-4" /></>}
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

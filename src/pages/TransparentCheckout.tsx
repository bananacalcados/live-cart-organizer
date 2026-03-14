import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { initMetaPixel, trackPixelEvent, trackPageView } from "@/lib/metaPixel";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ShoppingBag, Lock, CreditCard, QrCode, Copy, Check, Clock, Trophy, User, MapPin, Wallet, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface OrderProduct {
  title: string;
  variant?: string;
  price: number;
  quantity: number;
  image?: string;
}

interface OrderData {
  id: string;
  customerName: string;
  customerId?: string;
  products: OrderProduct[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  isPaid: boolean;
  checkoutStartedAt: string | null;
  freeShipping: boolean;
  shippingCost: number;
}

interface PixData {
  qrCode: string;
  qrCodeBase64: string;
  amount: string;
  expirationDate: string;
}

interface InstallmentConfig {
  max_installments: number;
  interest_free_installments: number;
  monthly_interest_rate: number;
}

interface CustomerFormData {
  fullName: string;
  email: string;
  cpf: string;
  whatsapp: string;
  cep: string;
  address: string;
  addressNumber: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

// ── Formatters ──────────────────────────────────────────────────
function formatCPF(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatCEP(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function formatPhone(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatCardNumber(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 16);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function formatExpiry(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

function calculateInstallmentAmount(total: number, installments: number, config: InstallmentConfig) {
  if (installments <= config.interest_free_installments) {
    return { installmentValue: total / installments, totalWithInterest: total, hasInterest: false };
  }
  const rate = config.monthly_interest_rate / 100;
  const totalWithInterest = total * Math.pow(1 + rate, installments);
  return {
    installmentValue: totalWithInterest / installments,
    totalWithInterest: Math.round(totalWithInterest * 100) / 100,
    hasInterest: true,
  };
}

// ── Stepper ─────────────────────────────────────────────────────
function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: "Identificação", icon: User },
    { num: 2, label: "Entrega", icon: MapPin },
    { num: 3, label: "Pagamento", icon: Wallet },
  ];
  return (
    <div className="flex items-center justify-center gap-1 mb-6">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isActive = currentStep === step.num;
        const isDone = currentStep > step.num;
        return (
          <div key={step.num} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              isActive ? 'bg-primary text-primary-foreground' : isDone ? 'bg-stage-paid/20 text-stage-paid' : 'bg-secondary text-muted-foreground'
            }`}>
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{step.label}</span>
              <span className="sm:hidden">{step.num}</span>
            </div>
            {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Order Summary Sidebar ───────────────────────────────────────
function OrderSummary({ orderData, collapsed, onToggle }: { orderData: OrderData; collapsed?: boolean; onToggle?: () => void }) {
  const totalItems = orderData.products.reduce((s, p) => s + p.quantity, 0);
  return (
    <div className="bg-secondary/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between cursor-pointer sm:cursor-default" onClick={onToggle}>
        <div className="flex items-center gap-2 font-medium text-sm">
          <ShoppingBag className="h-4 w-4" />
          Resumo ({totalItems} {totalItems === 1 ? 'item' : 'itens'})
        </div>
        <span className="font-bold text-primary">R$ {orderData.totalAmount.toFixed(2)}</span>
      </div>
      {!collapsed && (
        <>
          {orderData.products.map((product, index) => (
            <div key={index} className="flex items-center gap-3 p-2 bg-background/50 rounded-lg">
              {product.image && (
                <img src={product.image} alt={product.title} className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs truncate">{product.title}</p>
                {product.variant && <p className="text-[10px] text-muted-foreground">{product.variant}</p>}
                <p className="text-[10px] text-muted-foreground">Qtd: {product.quantity}</p>
              </div>
              <p className="font-semibold text-xs flex-shrink-0">R$ {(product.price * product.quantity).toFixed(2)}</p>
            </div>
          ))}
          <div className="border-t pt-2 space-y-1">
            {orderData.discountAmount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Desconto</span>
                <span className="text-stage-paid font-medium">-R$ {orderData.discountAmount.toFixed(2)}</span>
              </div>
            )}
            {orderData.shippingCost > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Frete</span>
                <span className="font-medium">R$ {orderData.shippingCost.toFixed(2)}</span>
              </div>
            )}
            {orderData.freeShipping && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Frete</span>
                <span className="text-stage-paid font-medium">GRÁTIS 🎉</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-sm pt-1">
              <span>Total</span>
              <span className="text-primary">R$ {orderData.totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Countdown Timer ─────────────────────────────────────────────
function CountdownTimer({ checkoutStartedAt }: { checkoutStartedAt: string | null }) {
  const [timeLeft, setTimeLeft] = useState(600);

  useEffect(() => {
    if (!checkoutStartedAt) return;
    const endTime = new Date(checkoutStartedAt).getTime() + 10 * 60 * 1000;
    const update = () => setTimeLeft(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [checkoutStartedAt]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isUrgent = timeLeft <= 120;

  if (timeLeft <= 0) {
    return (
      <div className="text-center p-2 bg-muted rounded-lg">
        <p className="text-xs text-muted-foreground">⏰ Tempo para roleta expirou, mas você ainda pode pagar</p>
      </div>
    );
  }

  return (
    <div className={`text-center p-3 rounded-lg border ${isUrgent ? 'border-destructive bg-destructive/10 animate-pulse' : 'border-primary/30 bg-primary/5'}`}>
      <div className="flex items-center justify-center gap-2 mb-1">
        <Trophy className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium">Pague em até 10 min e concorra a prêmios!</span>
      </div>
      <div className="flex items-center justify-center gap-1">
        <Clock className={`h-4 w-4 ${isUrgent ? 'text-destructive' : 'text-primary'}`} />
        <span className={`text-2xl font-bold font-mono ${isUrgent ? 'text-destructive' : 'text-primary'}`}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}

// ── Step 1: Identification ──────────────────────────────────────
function StepIdentification({ form, setForm, onNext }: { form: CustomerFormData; setForm: (f: CustomerFormData) => void; onNext: () => void }) {
  const handleNext = () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.cpf.trim() || !form.whatsapp.trim()) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    if (form.cpf.replace(/\D/g, "").length !== 11) {
      toast.error("CPF inválido");
      return;
    }
    onNext();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <User className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-lg">Identificação</h2>
        <Badge variant="secondary" className="text-[10px]">1 de 3</Badge>
      </div>
      <div className="space-y-3">
        <div>
          <Label className="text-sm">Nome completo *</Label>
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="João da Silva" />
        </div>
        <div>
          <Label className="text-sm">E-mail *</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="seu@email.com" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">CPF *</Label>
            <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: formatCPF(e.target.value) })} placeholder="000.000.000-00" maxLength={14} />
          </div>
          <div>
            <Label className="text-sm">WhatsApp *</Label>
            <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: formatPhone(e.target.value) })} placeholder="(11) 99999-9999" maxLength={15} />
          </div>
        </div>
      </div>
      <Button onClick={handleNext} className="w-full h-12 text-base font-semibold" size="lg">
        Ir para Entrega <ChevronRight className="h-5 w-5 ml-1" />
      </Button>
    </div>
  );
}

interface FreightOption {
  id: string;
  carrier: string;
  service: string;
  price: number;
  delivery_days: number | null;
  type: string;
}

// ── Step 2: Delivery Address ────────────────────────────────────
function StepDelivery({ form, setForm, onNext, onBack, orderId, orderData, onShippingSelected }: {
  form: CustomerFormData; setForm: (f: CustomerFormData) => void;
  onNext: () => void; onBack: () => void;
  orderId?: string; orderData: OrderData | null;
  onShippingSelected: (option: FreightOption) => void;
}) {
  const [fetchingCep, setFetchingCep] = useState(false);
  const [freightOptions, setFreightOptions] = useState<FreightOption[]>([]);
  const [loadingFreight, setLoadingFreight] = useState(false);
  const [selectedFreight, setSelectedFreight] = useState<string | null>(null);
  const freightQuotedCep = useRef<string>("");

  const lookupCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setFetchingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm({
          ...form,
          cep: cepValue,
          address: data.logradouro || form.address,
          neighborhood: data.bairro || form.neighborhood,
          city: data.localidade || form.city,
          state: data.uf || form.state,
        });
      }
    } catch {}
    setFetchingCep(false);
    // Quote freight after CEP lookup
    quoteFreight(digits);
  };

  const quoteFreight = async (cepDigits: string) => {
    if (cepDigits.length !== 8 || cepDigits === freightQuotedCep.current) return;
    freightQuotedCep.current = cepDigits;
    setLoadingFreight(true);
    setFreightOptions([]);
    setSelectedFreight(null);
    try {
      const totalValue = orderData?.subtotal || 0;
      const totalQty = orderData?.products.reduce((s, p) => s + p.quantity, 0) || 1;
      const { data, error } = await supabase.functions.invoke("checkout-quote-freight", {
        body: {
          recipient_cep: cepDigits,
          store: "centro", // default store
          total_value: totalValue,
          weight_kg: 0.3,
          items_count: totalQty,
        },
      });
      if (error) throw error;
      if (data?.quotes) {
        setFreightOptions(data.quotes);
      }
    } catch (err) {
      console.error("Error quoting freight:", err);
      // Fallback: at least show pickup
      setFreightOptions([{
        id: 'pickup', carrier: 'Retirada na Loja', service: 'Grátis',
        price: 0, delivery_days: 0, type: 'pickup',
      }]);
    }
    setLoadingFreight(false);
  };

  // Auto-quote freight if CEP is already filled on mount (e.g. pre-filled from previous registration)
  useEffect(() => {
    const digits = form.cep.replace(/\D/g, "");
    if (digits.length === 8 && freightOptions.length === 0 && !loadingFreight) {
      quoteFreight(digits);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

    setSelectedFreight(option.id);
    onShippingSelected(option);
  };

  const handleNext = () => {
    if (!form.cep.trim() || !form.address.trim() || !form.addressNumber.trim() || !form.neighborhood.trim() || !form.city.trim() || !form.state.trim()) {
      toast.error("Preencha todos os campos obrigatórios do endereço");
      return;
    }
    if (!selectedFreight) {
      toast.error("Selecione uma opção de frete");
      return;
    }
    onNext();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-lg">Endereço de Entrega</h2>
        <Badge variant="secondary" className="text-[10px]">2 de 3</Badge>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <Label className="text-sm">CEP *</Label>
            <div className="relative">
              <Input value={form.cep} onChange={(e) => { const v = formatCEP(e.target.value); setForm({ ...form, cep: v }); lookupCep(v); }} placeholder="00000-000" maxLength={9} />
              {fetchingCep && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
          <div className="col-span-2">
            <Label className="text-sm">Rua *</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-sm">Número *</Label>
            <Input value={form.addressNumber} onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} />
          </div>
          <div>
            <Label className="text-sm">Complemento</Label>
            <Input value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} placeholder="Apto, Bloco" />
          </div>
          <div>
            <Label className="text-sm">Bairro *</Label>
            <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label className="text-sm">Cidade *</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <Label className="text-sm">UF *</Label>
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} />
          </div>
        </div>
      </div>

      {/* Freight Options */}
      {loadingFreight && (
        <div className="flex items-center gap-2 p-4 bg-secondary/30 rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Calculando opções de frete...</span>
        </div>
      )}

      {freightOptions.length > 0 && !loadingFreight && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Opção de Frete *</Label>
          <div className="space-y-2">
            {freightOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelectFreight(opt)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all text-left ${
                  selectedFreight === opt.id
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 bg-background'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{opt.carrier}</span>
                    {opt.type === 'pickup' && <Badge variant="secondary" className="text-[10px]">🏪</Badge>}
                    {opt.type === 'local' && <Badge variant="secondary" className="text-[10px]">🏍️</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{opt.service}</span>
                    {opt.delivery_days !== null && opt.delivery_days > 0 && (
                      <span className="text-xs text-muted-foreground">• {opt.delivery_days} dia{opt.delivery_days > 1 ? 's' : ''} úteis</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {opt.price === 0 ? (
                    <span className="font-bold text-sm text-stage-paid">GRÁTIS</span>
                  ) : (
                    <span className="font-bold text-sm">R$ {opt.price.toFixed(2)}</span>
                  )}
                </div>
                {selectedFreight === opt.id && (
                  <CheckCircle2 className="h-5 w-5 text-primary ml-2 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1 h-12">Voltar</Button>
        <Button onClick={handleNext} className="flex-[2] h-12 text-base font-semibold" disabled={!selectedFreight}>
          Ir para Pagamento <ChevronRight className="h-5 w-5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Payment ─────────────────────────────────────────────
function StepPayment({
  orderId,
  amount,
  products,
  form,
  installmentConfig,
  onPaymentConfirmed,
  onBack,
}: {
  orderId: string;
  amount: number;
  products: OrderProduct[];
  form: CustomerFormData;
  installmentConfig: InstallmentConfig;
  onPaymentConfirmed: (info?: { platform: string; method: string; customerData?: any }) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-lg">Pagamento</h2>
        <Badge variant="secondary" className="text-[10px]">3 de 3</Badge>
      </div>

      <Tabs defaultValue="card" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="card" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Cartão
          </TabsTrigger>
          <TabsTrigger value="pix" className="flex items-center gap-2">
            <QrCode className="h-4 w-4" /> PIX
          </TabsTrigger>
        </TabsList>

        <TabsContent value="card" className="mt-4">
          <CardPaymentForm
            orderId={orderId}
            amount={amount}
            products={products}
            form={form}
            installmentConfig={installmentConfig}
            onPaymentConfirmed={onPaymentConfirmed}
          />
        </TabsContent>

        <TabsContent value="pix" className="mt-4">
          <PixPaymentForm
            orderId={orderId}
            amount={amount}
            form={form}
            onPaymentConfirmed={onPaymentConfirmed}
          />
        </TabsContent>
      </Tabs>

      <Button variant="ghost" onClick={onBack} className="w-full text-sm text-muted-foreground">
        ← Voltar para Entrega
      </Button>
    </div>
  );
}

// ── PIX Payment Form (step 3) ───────────────────────────────────
function PixPaymentForm({ orderId, amount, form, onPaymentConfirmed }: { orderId: string; amount: number; form: CustomerFormData; onPaymentConfirmed: (info?: { platform: string; method: string; customerData?: any }) => void }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pixPaid, setPixPaid] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const customerData = {
    name: form.fullName,
    email: form.email,
    cpf: form.cpf.replace(/\D/g, ""),
    phone: form.whatsapp.replace(/\D/g, ""),
    address: { street: form.address, number: form.addressNumber, neighborhood: form.neighborhood, city: form.city, state: form.state, cep: form.cep.replace(/\D/g, "") },
  };

  useEffect(() => {
    if (!pixPaymentId || pixPaid) return;
    const check = async () => {
      try {
        const { data } = await supabase.functions.invoke("mercadopago-check-payment", {
          body: { paymentId: pixPaymentId, orderId },
        });
        if (data?.status === "approved") {
          setPixPaid(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
          onPaymentConfirmed({ platform: "mercadopago", method: "pix", customerData });
        }
      } catch {}
    };
    check();
    pollingRef.current = setInterval(check, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [pixPaymentId, pixPaid, orderId]);

  const handleGeneratePix = async () => {
    setIsGenerating(true);
    trackPixelEvent("AddPaymentInfo", { content_category: "pix" });

    // Save customer registration early
    if (orderId && !orderId.startsWith("live-")) {
      try {
        await supabase.from("customer_registrations").insert({
          order_id: orderId,
          full_name: form.fullName,
          email: form.email,
          cpf: form.cpf.replace(/\D/g, ""),
          whatsapp: form.whatsapp.replace(/\D/g, ""),
          cep: form.cep.replace(/\D/g, ""),
          address: form.address,
          address_number: form.addressNumber,
          complement: form.complement,
          neighborhood: form.neighborhood,
          city: form.city,
          state: form.state,
        });
      } catch {}
    }

    try {
      const nameParts = form.fullName.split(" ");
      const response = await supabase.functions.invoke("mercadopago-create-pix", {
        body: {
          orderId,
          payer: {
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            email: form.email,
            cpf: form.cpf,
            address: form.cep ? { zipCode: form.cep, street: form.address, number: form.addressNumber, neighborhood: form.neighborhood, city: form.city, state: form.state } : undefined,
          },
        },
      });
      const data = response.data;
      if (response.error) throw new Error(typeof response.error === 'object' && response.error.message ? response.error.message : String(response.error));
      if (!data?.qrCode) throw new Error("QR Code não retornado");
      setPixData(data);
      if (data.paymentId) setPixPaymentId(String(data.paymentId));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      toast.error(msg.includes("CPF") ? "CPF inválido." : "Erro ao gerar PIX.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (pixPaid) {
    return (
      <div className="text-center space-y-4 py-4">
        <CheckCircle2 className="h-12 w-12 text-stage-paid mx-auto" />
        <h3 className="text-lg font-bold">PIX Confirmado!</h3>
      </div>
    );
  }

  if (pixData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-2 p-3 bg-primary/10 rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium text-primary">Aguardando pagamento...</span>
        </div>
        {pixData.qrCodeBase64 && (
          <div className="flex justify-center">
            <img src={`data:image/png;base64,${pixData.qrCodeBase64}`} alt="QR Code PIX" className="w-48 h-48 rounded-lg border" />
          </div>
        )}
        <div className="relative">
          <div className="p-3 bg-secondary/50 rounded-lg text-xs font-mono break-all max-h-20 overflow-y-auto">{pixData.qrCode}</div>
          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={async () => {
            try { await navigator.clipboard.writeText(pixData.qrCode); setCopied(true); toast.success("Copiado!"); setTimeout(() => setCopied(false), 3000); } catch { window.prompt("Copie:", pixData.qrCode); }
          }}>
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? "Copiado!" : "Copiar código PIX"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center">Valor: <span className="font-bold text-foreground">R$ {pixData.amount}</span></p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Seus dados já foram preenchidos. Clique para gerar o PIX.</p>
      <Button onClick={handleGeneratePix} disabled={isGenerating} className="w-full h-14 text-lg font-semibold" size="lg">
        {isGenerating ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Gerando PIX...</> : <><QrCode className="h-5 w-5 mr-2" />Gerar PIX - R$ {amount.toFixed(2)}</>}
      </Button>
    </div>
  );
}

// ── Credit Card Payment Form (step 3) ───────────────────────────
function CardPaymentForm({
  orderId, amount, products, form, installmentConfig, onPaymentConfirmed,
}: {
  orderId: string; amount: number; products: OrderProduct[]; form: CustomerFormData;
  installmentConfig: InstallmentConfig; onPaymentConfirmed: (info?: { platform: string; method: string; customerData?: any }) => void;
}) {
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [installments, setInstallments] = useState("1");
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);

  // Restore processing state from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(`checkout_payment_${orderId}`);
    if (stored) {
      attemptIdRef.current = stored;
      setIsProcessing(true);
      processingRef.current = true;
      // Poll backend to check if this attempt resolved
      pollPaymentResult(stored);
    }
  }, [orderId]);

  const pollPaymentResult = async (attemptId: string) => {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        // Check if order is now paid
        const { data: freshOrder } = await supabase.from("orders").select("is_paid").eq("id", orderId).maybeSingle();
        if (freshOrder?.is_paid) {
          sessionStorage.removeItem(`checkout_payment_${orderId}`);
          onPaymentConfirmed({ platform: "gateway", method: "credit_card", customerData: buildCustomerData() });
          return;
        }
        // Check if attempt finished (failed)
        const { data: attempt } = await supabase.from("pos_checkout_attempts").select("status, error_message").eq("transaction_id", attemptId).maybeSingle();
        if (attempt && attempt.status === "failed") {
          sessionStorage.removeItem(`checkout_payment_${orderId}`);
          setPaymentError((attempt as any).error_message || "A operadora do seu cartão não aprovou a compra. Revise os dados ou tente com outro cartão.");
          setIsProcessing(false);
          processingRef.current = false;
          return;
        }
        if (attempt && attempt.status === "success") {
          sessionStorage.removeItem(`checkout_payment_${orderId}`);
          onPaymentConfirmed({ platform: "gateway", method: "credit_card", customerData: buildCustomerData() });
          return;
        }
      } catch {}
    }
    // Timeout — release form
    sessionStorage.removeItem(`checkout_payment_${orderId}`);
    setPaymentError("Tempo esgotado. Verifique se o pagamento foi aprovado ou tente novamente.");
    setIsProcessing(false);
    processingRef.current = false;
  };

  const buildCustomerData = () => ({
    name: form.fullName, email: form.email, cpf: form.cpf.replace(/\D/g, ""), phone: form.whatsapp.replace(/\D/g, ""),
    address: { street: form.address, number: form.addressNumber, neighborhood: form.neighborhood, city: form.city, state: form.state, cep: form.cep.replace(/\D/g, "") },
  });

  const installmentOptions = [];
  for (let i = 1; i <= installmentConfig.max_installments; i++) {
    const calc = calculateInstallmentAmount(amount, i, installmentConfig);
    const label = i === 1
      ? `1x de R$ ${amount.toFixed(2)} (à vista)`
      : `${i}x de R$ ${calc.installmentValue.toFixed(2)}${calc.hasInterest ? ` (total R$ ${calc.totalWithInterest.toFixed(2)})` : " sem juros"}`;
    installmentOptions.push({ value: String(i), label });
  }

  const selectedInstallments = parseInt(installments);
  const { totalWithInterest } = calculateInstallmentAmount(amount, selectedInstallments, installmentConfig);

  const handleSubmit = async () => {
    // Prevent double-click with ref (synchronous check)
    if (processingRef.current) return;

    if (!cardNumber.trim() || !cardName.trim() || !expiry.trim() || !cvv.trim()) {
      toast.error("Preencha todos os dados do cartão");
      return;
    }
    if (cardNumber.replace(/\D/g, "").length < 13) {
      toast.error("Número do cartão inválido");
      return;
    }
    const expiryParts = expiry.split("/");
    if (expiryParts.length !== 2) {
      toast.error("Validade inválida. Use MM/AA");
      return;
    }

    // Lock immediately
    processingRef.current = true;
    setIsProcessing(true);
    setPaymentError(null);

    // Generate attempt ID and persist to sessionStorage
    const attemptId = crypto.randomUUID();
    attemptIdRef.current = attemptId;
    sessionStorage.setItem(`checkout_payment_${orderId}`, attemptId);

    trackPixelEvent("AddPaymentInfo", { content_category: "credit_card" });
    try {
      const totalCents = Math.round(totalWithInterest * 100);
      const { data, error } = await supabase.functions.invoke("pagarme-create-charge", {
        body: {
          orderId,
          paymentAttemptId: attemptId,
          card: {
            number: cardNumber.replace(/\s/g, ""),
            holderName: cardName.trim(),
            expMonth: expiryParts[0],
            expYear: expiryParts[1].length === 2 ? `20${expiryParts[1]}` : expiryParts[1],
            cvv: cvv.trim(),
          },
          installments: selectedInstallments,
          customer: {
            name: form.fullName,
            email: form.email,
            cpf: form.cpf,
            phone: form.whatsapp,
          },
          billingAddress: {
            street: form.address,
            number: form.addressNumber,
            neighborhood: form.neighborhood,
            city: form.city,
            state: form.state,
            zipCode: form.cep,
            country: "BR",
          },
          totalAmountCents: totalCents,
        },
      });

      if (error) throw new Error(typeof error === 'object' && error.message ? error.message : String(error));

      if (data?.already_paid) {
        sessionStorage.removeItem(`checkout_payment_${orderId}`);
        toast.success("Pagamento já confirmado!");
        onPaymentConfirmed({ platform: "cached", method: "credit_card", customerData: buildCustomerData() });
        return;
      }

      if (data?.already_processing) {
        // Another request is already running — poll for result
        pollPaymentResult(attemptId);
        return;
      }

      if (data?.success) {
        sessionStorage.removeItem(`checkout_payment_${orderId}`);
        toast.success(`Pagamento aprovado via ${data.gateway === 'pagarme' ? 'Pagar.me' : data.gateway === 'vindi' ? 'VINDI' : 'APPMAX'}!`);
        onPaymentConfirmed({ platform: data.gateway || "pagarme", method: "credit_card", customerData: buildCustomerData() });
      } else {
        throw new Error(data?.error || "Pagamento recusado.");
      }
    } catch (error) {
      // On timeout/error, poll backend to check if payment was approved by fallback gateway
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const { data: freshOrder } = await supabase
            .from("orders")
            .select("is_paid, stage")
            .eq("id", orderId)
            .maybeSingle();
          if (freshOrder?.is_paid) {
            sessionStorage.removeItem(`checkout_payment_${orderId}`);
            toast.success("Pagamento aprovado!");
            onPaymentConfirmed({ platform: "appmax", method: "credit_card", customerData: buildCustomerData() });
            return;
          }
        } catch (_) { /* ignore poll error */ }
      }
      // All gateways declined — show friendly error and release form
      sessionStorage.removeItem(`checkout_payment_${orderId}`);
      const errMsg = error instanceof Error ? error.message : "Erro ao processar pagamento.";
      setPaymentError(errMsg);
      setIsProcessing(false);
      processingRef.current = false;
    }
  };

  // ── Processing overlay ──
  if (isProcessing) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-6 text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500 mx-auto" />
          <h3 className="font-bold text-lg text-amber-800 dark:text-amber-300">Processando seu pagamento...</h3>
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Estamos verificando com a operadora do seu cartão de crédito.
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
            ⚠️ Não feche esta página. Isso pode levar alguns segundos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error message from previous attempt */}
      {paymentError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <XCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Pagamento não aprovado</p>
              <p className="text-xs text-destructive/80 mt-1">{paymentError}</p>
              <p className="text-xs text-muted-foreground mt-2">Revise os dados ou tente com outro cartão.</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <Label className="text-sm">Nome no cartão *</Label>
          <Input value={cardName} onChange={(e) => setCardName(e.target.value.toUpperCase())} placeholder="JOÃO SILVA" />
        </div>
        <div>
          <Label className="text-sm">Número do cartão *</Label>
          <Input value={cardNumber} onChange={(e) => setCardNumber(formatCardNumber(e.target.value))} placeholder="0000 0000 0000 0000" maxLength={19} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Validade *</Label>
            <Input value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} placeholder="MM/AA" maxLength={5} />
          </div>
          <div>
            <Label className="text-sm">CVV *</Label>
            <Input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="123" maxLength={4} type="password" />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Parcelas</Label>
        <Select value={installments} onValueChange={setInstallments}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {installmentOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={handleSubmit} disabled={isProcessing} className="w-full h-14 text-lg font-semibold" size="lg">
        <Lock className="h-5 w-5 mr-2" />Pagar R$ {totalWithInterest.toFixed(2)}
      </Button>
    </div>
  );
}

// ── Floating Live Mini Player ───────────────────────────────────
function LiveMiniPlayer({ videoId }: { videoId: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [muted, setMuted] = useState(false);

  if (dismissed || !videoId) return null;

  return (
    <div className="fixed top-3 right-3 z-50 flex flex-col items-center gap-2">
      <div className="w-[140px] rounded-xl overflow-hidden shadow-2xl border-2 border-primary/40 bg-black">
        <div className="relative aspect-[9/16]">
          <div className="absolute inset-0 z-10 cursor-pointer" onClick={() => window.location.href = "/live"} title="Voltar para a Live" />
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1&controls=0`}
            className="absolute inset-0 w-full h-full pointer-events-none"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            title="Live"
          />
          <div className="absolute top-1 left-1 flex gap-1 z-20">
            <span className="bg-destructive text-destructive-foreground text-[8px] font-bold px-1.5 py-0.5 rounded">AO VIVO</span>
          </div>
          <div className="absolute bottom-1 right-1 flex gap-1 z-20">
            <button onClick={(e) => { e.stopPropagation(); setMuted(!muted); }} className="w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-[10px]">
              {muted ? "🔇" : "🔊"}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setDismissed(true); }} className="w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-[10px]">✕</button>
          </div>
        </div>
      </div>
      <button onClick={() => window.location.href = "/live"} className="w-[140px] bg-primary text-primary-foreground text-xs font-bold py-2 rounded-lg shadow-lg hover:opacity-90 transition-opacity">
        ↩ VOLTAR À LIVE
      </button>
    </div>
  );
}

// ── Main Transparent Checkout ───────────────────────────────────
export default function TransparentCheckout() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const liveVideoId = searchParams.get("videoId") || "";
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "success">("pending");
  const [isEligibleForPrize, setIsEligibleForPrize] = useState(false);
  const [liveCartRaw, setLiveCartRaw] = useState<{ items: any[]; customer: any } | null>(null);
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig>({
    max_installments: 12,
    interest_free_installments: 6,
    monthly_interest_rate: 2.49,
  });
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);

  // 3-step state
  const [currentStep, setCurrentStep] = useState(1);
  const [customerForm, setCustomerForm] = useState<CustomerFormData>({
    fullName: "", email: "", cpf: "", whatsapp: "",
    cep: "", address: "", addressNumber: "", complement: "",
    neighborhood: "", city: "", state: "",
  });
  const [registrationId, setRegistrationId] = useState<string | null>(null);

  // Init Meta Pixel
  useEffect(() => {
    initMetaPixel();
    trackPixelEvent("InitiateCheckout");
  }, []);

  useEffect(() => {
    const liveParam = searchParams.get("live");
    if (liveParam && !orderId) {
      try {
        const decoded = JSON.parse(decodeURIComponent(liveParam));
        const products: OrderProduct[] = decoded.items || [];
        const subtotal = products.reduce((s, p) => s + p.price * p.quantity, 0);
        const now = new Date().toISOString();
        setLiveCartRaw({ items: decoded.items || [], customer: decoded.customer || null });
        let shippingCost = 0;
        let freeShipping = false;
        const fc = decoded.freightConfig;
        if (fc && fc.enabled) {
          if (fc.free_above && subtotal >= fc.free_above) freeShipping = true;
          else if (fc.flat_rate) shippingCost = fc.flat_rate;
        }
        setOrderData({
          id: `live-${Date.now()}`, customerName: decoded.customer?.name || "Cliente Live",
          products, subtotal, discountAmount: 0, totalAmount: Math.round((subtotal + shippingCost) * 100) / 100,
          isPaid: false, checkoutStartedAt: now, freeShipping, shippingCost,
        });
        setIsLoading(false);
        loadInstallmentConfig();
      } catch (err) {
        console.error("Error parsing live cart:", err);
        setIsLoading(false);
      }
      return;
    }
    if (!orderId) { setIsLoading(false); return; }
    loadOrder();
    loadInstallmentConfig();
  }, [orderId]);

  const loadOrder = async () => {
    try {
      const { data: order, error } = await supabase
        .from("orders")
        .select("*, customer:customers(*)")
        .eq("id", orderId)
        .maybeSingle();

      if (error || !order) throw new Error("Pedido não encontrado");

      const products = (order.products || []) as unknown as OrderProduct[];
      const subtotal = products.reduce((s, p) => s + p.price * p.quantity, 0);
      let discountAmount = 0;
      if (order.discount_type && order.discount_value) {
        discountAmount = order.discount_type === "percentage"
          ? subtotal * (order.discount_value / 100)
          : order.discount_value;
      }
      const orderShippingCost = (order.free_shipping) ? 0 : Number(order.shipping_cost || 0);
      const totalAmount = Math.round(Math.max(0, subtotal - discountAmount + orderShippingCost) * 100) / 100;

      setOrderData({
        id: order.id,
        customerName: (order.customer as any)?.instagram_handle || "Cliente",
        customerId: order.customer_id || undefined,
        products, subtotal, discountAmount, totalAmount,
        isPaid: order.is_paid, checkoutStartedAt: order.checkout_started_at,
        freeShipping: order.free_shipping || false, shippingCost: orderShippingCost,
      });

      if (order.is_paid) {
        setPaymentStatus("success");
      } else if (!order.checkout_started_at) {
        const now = new Date().toISOString();
        await supabase.from("orders").update({ checkout_started_at: now }).eq("id", order.id);
        setOrderData((prev) => prev ? { ...prev, checkoutStartedAt: now } : prev);
      }

      // Pre-fill from existing registration
      if (order.customer_id) {
        const { data: prevReg } = await supabase
          .rpc('get_latest_registration_by_customer', { p_customer_id: order.customer_id })
          .maybeSingle();
        if (prevReg) {
          setCustomerForm({
            fullName: prevReg.full_name || "",
            email: prevReg.email || "",
            cpf: formatCPF(prevReg.cpf || ""),
            whatsapp: formatPhone(prevReg.whatsapp || ""),
            cep: formatCEP(prevReg.cep || ""),
            address: prevReg.address || "",
            addressNumber: prevReg.address_number || "",
            complement: prevReg.complement || "",
            neighborhood: prevReg.neighborhood || "",
            city: prevReg.city || "",
            state: prevReg.state || "",
          });
        }
      }
    } catch (error) {
      console.error("Error loading order:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadInstallmentConfig = async () => {
    try {
      const { data } = await supabase
        .from("app_settings").select("value").eq("key", "installment_config").maybeSingle();
      if (data?.value) {
        const config = data.value as any;
        setInstallmentConfig({
          max_installments: config.max_installments || 12,
          interest_free_installments: config.interest_free_installments || 6,
          monthly_interest_rate: config.monthly_interest_rate || 2.49,
        });
      }
    } catch {}
  };

  // Save/update registration progressively
  const saveRegistration = async (step: number) => {
    if (!orderData || orderData.id.startsWith("live-")) return;
    try {
      if (registrationId) {
        // Update existing
        await supabase.from("customer_registrations").update({
          full_name: customerForm.fullName,
          email: customerForm.email,
          cpf: customerForm.cpf.replace(/\D/g, ""),
          whatsapp: customerForm.whatsapp.replace(/\D/g, ""),
          ...(step >= 2 ? {
            cep: customerForm.cep.replace(/\D/g, ""),
            address: customerForm.address,
            address_number: customerForm.addressNumber,
            complement: customerForm.complement,
            neighborhood: customerForm.neighborhood,
            city: customerForm.city,
            state: customerForm.state,
          } : {}),
        }).eq("id", registrationId);
      } else {
        // Insert new
        const { data: reg } = await supabase.from("customer_registrations").insert({
          order_id: orderData.id,
          full_name: customerForm.fullName,
          email: customerForm.email,
          cpf: customerForm.cpf.replace(/\D/g, ""),
          whatsapp: customerForm.whatsapp.replace(/\D/g, ""),
          cep: customerForm.cep.replace(/\D/g, "") || "00000000",
          address: customerForm.address || "Pendente",
          address_number: customerForm.addressNumber || "0",
          neighborhood: customerForm.neighborhood || "Pendente",
          city: customerForm.city || "Pendente",
          state: customerForm.state || "SP",
          complement: customerForm.complement,
          ...(orderData.customerId ? { customer_id: orderData.customerId } : {}),
        }).select("id").single();
        if (reg) setRegistrationId(reg.id);
      }
    } catch (err) {
      console.error("Error saving registration:", err);
    }
  };

  const handleStep1Next = async () => {
    await saveRegistration(1);
    setCurrentStep(2);
  };

  const handleStep2Next = async () => {
    // Ensure address is fully saved BEFORE moving to payment step
    await saveRegistration(2);
    // Verify the registration was actually saved with address data
    if (orderData && !orderData.id.startsWith("live-")) {
      try {
        const { data: reg } = await supabase
          .from("customer_registrations")
          .select("id, address, city")
          .eq("order_id", orderData.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!reg || !reg.address || reg.address === "Pendente") {
          toast.error("Erro ao salvar endereço. Tente novamente.");
          return;
        }
      } catch {}
    }
    setCurrentStep(3);
  };

  const handlePaymentConfirmed = useCallback(async (paymentInfo?: { platform: string; method: string; customerData?: any }) => {
    setPaymentStatus("success");
    const cd = paymentInfo?.customerData;

    if (orderData) {
      trackPixelEvent("Purchase", {
        value: orderData.totalAmount, currency: "BRL",
        content_type: "product", num_items: orderData.products.reduce((s, p) => s + p.quantity, 0),
      });
    }

    if (orderData?.checkoutStartedAt) {
      const elapsed = (Date.now() - new Date(orderData.checkoutStartedAt).getTime()) / 1000;
      if (elapsed <= 600) {
        setIsEligibleForPrize(true);
        if (orderId) supabase.from("orders").update({ eligible_for_prize: true }).eq("id", orderId);
      }
    }

    // Mark live viewer checkout completed
    const liveParam = searchParams.get("live");
    if (liveParam) {
      try {
        const decoded = JSON.parse(decodeURIComponent(liveParam));
        const customer = decoded.customer;
        const sessionId = decoded.sessionId;
        if (customer?.phone && sessionId) {
          await supabase.from("live_viewers").update({
            checkout_completed: true, checkout_completed_at: new Date().toISOString(),
            payment_platform: paymentInfo?.platform || null, payment_method: paymentInfo?.method || null,
          }).eq("session_id", sessionId).eq("phone", customer.phone);
        }
      } catch {}
    }

    // Create Shopify order for live commerce
    if (liveCartRaw && liveCartRaw.items.length > 0) {
      try {
        // Fetch customer data from DB to avoid relying on potentially stale in-memory state (e.g. PIX polling)
        let enrichedCustomer = {
          ...liveCartRaw.customer,
          ...(cd ? { name: cd.name, email: cd.email, phone: cd.phone, cpf: cd.cpf, address: cd.address } : {}),
        };
        
        // If cd is undefined/incomplete (PIX polling case), try to get from customerForm state
        if (!cd || !cd.address) {
          enrichedCustomer = {
            ...enrichedCustomer,
            name: customerForm.fullName || enrichedCustomer.name,
            email: customerForm.email || enrichedCustomer.email,
            phone: customerForm.whatsapp?.replace(/\D/g, "") || enrichedCustomer.phone,
            cpf: customerForm.cpf?.replace(/\D/g, "") || enrichedCustomer.cpf,
            address: customerForm.address ? {
              street: customerForm.address,
              number: customerForm.addressNumber,
              neighborhood: customerForm.neighborhood,
              city: customerForm.city,
              state: customerForm.state,
              cep: customerForm.cep?.replace(/\D/g, ""),
            } : enrichedCustomer.address,
          };
        }
        
        await supabase.functions.invoke("shopify-create-live-order", {
          body: {
            items: liveCartRaw.items.map((item: any) => ({
              variantId: item.variantId, title: item.title || item.productTitle, price: item.price, quantity: item.quantity || 1,
            })),
            customer: enrichedCustomer,
          },
        });
      } catch (err) { console.error("Error creating Shopify live order:", err); }
    }

    // Save final customer data for CRM orders
    if (orderId && !liveCartRaw && cd) {
      try {
        await supabase.from("customer_registrations").upsert({
          order_id: orderId,
          full_name: cd.name || "Cliente",
          email: cd.email || "",
          cpf: cd.cpf || "",
          whatsapp: cd.phone || "",
          cep: cd.address?.cep || "",
          address: cd.address?.street || "",
          address_number: cd.address?.number || "",
          complement: "",
          neighborhood: cd.address?.neighborhood || "",
          city: cd.address?.city || "",
          state: cd.address?.state || "",
          ...(orderData?.customerId ? { customer_id: orderData.customerId } : {}),
        }, { onConflict: 'order_id' });
      } catch (err) { console.error("Error saving customer registration:", err); }
    }

    // Create Shopify order for CRM orders
    if (orderId && !liveCartRaw) {
      try {
        await supabase.functions.invoke("shopify-create-order", { body: { orderId } });
      } catch (err) { console.error("Error creating Shopify order:", err); }
    }
  }, [orderData, orderId, liveCartRaw, searchParams, customerForm]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Carregando pedido...</p>
        </div>
      </div>
    );
  }

  if (!orderData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center space-y-4">
            <XCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold">Pedido não encontrado</h2>
            <p className="text-muted-foreground">Este link de pagamento é inválido ou expirou.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (paymentStatus === "success") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        {liveVideoId && <LiveMiniPlayer videoId={liveVideoId} />}
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-24 h-24 rounded-full bg-primary/10 animate-pulse" />
              </div>
              <CheckCircle2 className="h-16 w-16 text-primary mx-auto relative" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Pagamento Confirmado! 🎉</h2>
              <p className="text-muted-foreground">
                Obrigado, <span className="font-semibold text-foreground">{orderData.customerName}</span>!
              </p>
              <p className="text-sm text-muted-foreground">Seu pedido foi confirmado e está sendo preparado com carinho.</p>
            </div>
            <div className="p-4 bg-secondary/50 rounded-xl space-y-3">
              <p className="text-sm text-muted-foreground">Valor pago</p>
              <p className="text-3xl font-bold text-primary">R$ {orderData.totalAmount.toFixed(2)}</p>
            </div>
            {isEligibleForPrize && (
              <div className="p-4 bg-accent/50 border-2 border-primary/30 rounded-xl">
                <Trophy className="h-10 w-10 text-primary mx-auto mb-2" />
                <p className="font-bold text-lg">🎉 Parabéns!</p>
                <p className="text-sm text-muted-foreground">Você pagou dentro do prazo e está participando da <strong>Roleta de Prêmios</strong>!</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">📦 Acompanhe a entrega pelo WhatsApp</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      {liveVideoId && <LiveMiniPlayer videoId={liveVideoId} />}
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-4">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Lock className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-bold">Checkout Seguro</h1>
          </div>
          <p className="text-xs text-muted-foreground">Olá, {orderData.customerName}!</p>
        </div>

        <StepIndicator currentStep={currentStep} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2">
            <Card>
              <CardContent className="p-6">
                <CountdownTimer checkoutStartedAt={orderData.checkoutStartedAt} />
                <div className="mt-6">
                  {currentStep === 1 && (
                    <StepIdentification form={customerForm} setForm={setCustomerForm} onNext={handleStep1Next} />
                  )}
                  {currentStep === 2 && (
                    <StepDelivery
                      form={customerForm}
                      setForm={setCustomerForm}
                      onNext={handleStep2Next}
                      onBack={() => setCurrentStep(1)}
                      orderId={orderId}
                      orderData={orderData}
                      onShippingSelected={async (option) => {
                        // Update order shipping_cost in DB and local state
                        const newShippingCost = option.price;
                        const isPickup = option.type === 'pickup';
                        if (orderId && !orderData.id.startsWith("live-")) {
                          await supabase.from("orders").update({
                            shipping_cost: newShippingCost,
                            free_shipping: isPickup,
                          }).eq("id", orderId);
                        }
                        // Recalculate total
                        setOrderData(prev => {
                          if (!prev) return prev;
                          const totalAmount = Math.round(Math.max(0, prev.subtotal - prev.discountAmount + newShippingCost) * 100) / 100;
                          return { ...prev, shippingCost: newShippingCost, freeShipping: isPickup, totalAmount };
                        });
                      }}
                    />
                  )}
                  {currentStep === 3 && (
                    <StepPayment
                      orderId={orderData.id}
                      amount={orderData.totalAmount}
                      products={orderData.products}
                      form={customerForm}
                      installmentConfig={installmentConfig}
                      onPaymentConfirmed={handlePaymentConfirmed}
                      onBack={() => setCurrentStep(2)}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Order Summary */}
          <div className="lg:col-span-1">
            {/* Mobile: collapsible, Desktop: always visible */}
            <div className="lg:hidden">
              <OrderSummary orderData={orderData} collapsed={summaryCollapsed} onToggle={() => setSummaryCollapsed(!summaryCollapsed)} />
            </div>
            <div className="hidden lg:block sticky top-4">
              <OrderSummary orderData={orderData} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-6">
          <Lock className="h-3 w-3" />
          <span>Pagamento processado com segurança</span>
        </div>
      </div>
    </div>
  );
}

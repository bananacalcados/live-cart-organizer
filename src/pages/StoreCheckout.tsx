import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ShoppingBag, Lock, CreditCard, QrCode, Copy, Check, User, MapPin, Wallet, ChevronRight, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface SaleItem {
  sku: string;
  name: string;
  variant: string;
  price: number;
  quantity: number;
  compare_at_price?: number | null;
}

interface SaleData {
  id: string;
  store_id: string;
  store_name: string;
  total: number;
  discount_amount: number;
  shipping_amount: number;
  customer_name: string;
  customer_phone: string;
  items: SaleItem[];
  status: string;
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

interface InstallmentConfig {
  max_installments: number;
  interest_free_installments: number;
  monthly_interest_rate: number;
}

interface PixData {
  qrCode: string;
  qrCodeBase64: string;
  amount: string;
  expirationDate: string;
}

// ── Formatters & Validators ─────────────────────────────────────
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  for (let t = 9; t <= 10; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += parseInt(digits[i]) * (t + 1 - i);
    const remainder = (sum * 10) % 11;
    if ((remainder === 10 ? 0 : remainder) !== parseInt(digits[t])) return false;
  }
  return true;
}

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

// ── StepIndicator ───────────────────────────────────────────────
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
              isActive ? 'bg-primary text-primary-foreground' : isDone ? 'bg-green-500/20 text-green-600' : 'bg-secondary text-muted-foreground'
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

// ── OrderSummary ────────────────────────────────────────────────
function OrderSummary({ saleData }: { saleData: SaleData }) {
  const subtotal = saleData.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const fullSubtotal = saleData.items.reduce((s, i) => {
    const full = i.compare_at_price && i.compare_at_price > i.price ? i.compare_at_price : i.price;
    return s + full * i.quantity;
  }, 0);
  const totalItems = saleData.items.reduce((s, i) => s + i.quantity, 0);
  const hasItemDiscounts = saleData.items.some(i => i.compare_at_price && i.compare_at_price > i.price);
  const itemSavings = fullSubtotal - subtotal;
  const totalSavings = itemSavings + saleData.discount_amount;
  const shippingAmount = saleData.shipping_amount || 0;
  // Net product subtotal after all discounts (before shipping)
  const netProductSubtotal = subtotal - saleData.discount_amount;
  const totalFinal = netProductSubtotal + shippingAmount;

  return (
    <div className="bg-secondary/30 rounded-xl p-4 space-y-3">
      {/* Discount Prize Banner */}
      {totalSavings > 0 && (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 p-4 text-white shadow-lg">
          <div className="absolute top-0 right-0 opacity-20 text-6xl">🎁</div>
          <div className="relative z-10 text-center">
            <p className="text-xs font-medium uppercase tracking-wider opacity-90">Você ganhou</p>
            <p className="text-2xl font-black mt-0.5">R$ {totalSavings.toFixed(2)} OFF</p>
            <p className="text-xs opacity-80 mt-1">de desconto nesta compra! 🎉</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium text-sm">
          <ShoppingBag className="h-4 w-4" />
          Resumo ({totalItems} {totalItems === 1 ? 'item' : 'itens'})
        </div>
      </div>

      {saleData.items.map((item, i) => {
        const hasCompare = item.compare_at_price && item.compare_at_price > item.price;
        const lineTotal = item.price * item.quantity;
        const fullLineTotal = hasCompare ? item.compare_at_price! * item.quantity : lineTotal;
        return (
          <div key={i} className="p-2.5 bg-background/50 rounded-lg space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs leading-snug">{item.name}</p>
                {item.variant && <p className="text-[10px] text-muted-foreground">{item.variant}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                {hasCompare ? (
                  <>
                    <p className="text-[10px] line-through text-muted-foreground">R$ {fullLineTotal.toFixed(2)}</p>
                    <p className="font-bold text-xs text-primary">R$ {lineTotal.toFixed(2)}</p>
                  </>
                ) : (
                  <p className="font-semibold text-xs">R$ {lineTotal.toFixed(2)}</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Qtd: {item.quantity} × R$ {item.price.toFixed(2)}</span>
              {hasCompare && (
                <span className="text-green-600 font-medium">
                  -{( ((item.compare_at_price! - item.price) / item.compare_at_price!) * 100 ).toFixed(0)}% OFF
                </span>
              )}
            </div>
          </div>
        );
      })}

      <div className="border-t pt-2 space-y-1.5">
        {/* Always show subtotal of products */}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Subtotal dos produtos</span>
          <span className={totalSavings > 0 ? "line-through text-muted-foreground" : ""}>
            R$ {fullSubtotal.toFixed(2)}
          </span>
        </div>
        {hasItemDiscounts && (
          <div className="flex justify-between text-xs">
            <span className="text-green-600 font-medium">🏷️ Desconto nos itens</span>
            <span className="text-green-600 font-bold">-R$ {itemSavings.toFixed(2)}</span>
          </div>
        )}
        {saleData.discount_amount > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-green-600 font-medium">🎁 Desconto extra</span>
            <span className="text-green-600 font-bold">-R$ {saleData.discount_amount.toFixed(2)}</span>
          </div>
        )}

        {/* Always show shipping line */}
        {shippingAmount > 0 ? (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">🚚 Frete</span>
            <span>R$ {shippingAmount.toFixed(2)}</span>
          </div>
        ) : (
          <div className="flex justify-between text-xs">
            <span className="text-green-600 font-medium">🚚 Frete grátis!</span>
            <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-600 border-0">Grátis</Badge>
          </div>
        )}

        {/* Total Final */}
        <div className="flex justify-between font-bold text-base pt-1.5 border-t">
          <span>Total Final</span>
          <span className="text-primary">R$ {totalFinal.toFixed(2)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Store className="h-3 w-3" />
        <span>{saleData.store_name}</span>
      </div>
    </div>
  );
}

// ── Step 1 ──────────────────────────────────────────────────────
function StepIdentification({ form, setForm, onNext, prefilled }: { form: CustomerFormData; setForm: (f: CustomerFormData) => void; onNext: () => void; prefilled: boolean }) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleNext = () => {
    const newErrors: Record<string, string> = {};
    if (!form.fullName.trim()) newErrors.fullName = "Nome é obrigatório";
    else if (form.fullName.trim().split(/\s+/).length < 2) newErrors.fullName = "Informe nome e sobrenome";

    const emailTrimmed = form.email.trim();
    if (!emailTrimmed) newErrors.email = "E-mail é obrigatório";
    else if (!isValidEmail(emailTrimmed)) newErrors.email = "E-mail inválido (ex: nome@email.com)";

    if (!form.cpf.trim()) newErrors.cpf = "CPF é obrigatório";
    else if (!isValidCPF(form.cpf)) newErrors.cpf = "CPF inválido";

    const whatsDigits = form.whatsapp.replace(/\D/g, "");
    if (!form.whatsapp.trim()) newErrors.whatsapp = "WhatsApp é obrigatório";
    else if (whatsDigits.length < 10 || whatsDigits.length > 11) newErrors.whatsapp = "WhatsApp inválido";

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
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
          <Input value={form.fullName} onChange={(e) => { setForm({ ...form, fullName: e.target.value }); setErrors(prev => ({ ...prev, fullName: "" })); }} placeholder="João da Silva" className={errors.fullName ? "border-destructive" : ""} />
          {errors.fullName && <p className="text-destructive text-xs mt-1">{errors.fullName}</p>}
        </div>
        <div>
          <Label className="text-sm">E-mail *</Label>
          <Input type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setErrors(prev => ({ ...prev, email: "" })); }} placeholder="seu@email.com" className={errors.email ? "border-destructive" : ""} />
          {errors.email && <p className="text-destructive text-xs mt-1">{errors.email}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">CPF *</Label>
            <Input value={form.cpf} onChange={(e) => { setForm({ ...form, cpf: formatCPF(e.target.value) }); setErrors(prev => ({ ...prev, cpf: "" })); }} placeholder="000.000.000-00" maxLength={14} className={errors.cpf ? "border-destructive" : ""} />
            {errors.cpf && <p className="text-destructive text-xs mt-1">{errors.cpf}</p>}
          </div>
          <div>
            <Label className="text-sm">WhatsApp *</Label>
            <Input value={form.whatsapp} onChange={(e) => { setForm({ ...form, whatsapp: formatPhone(e.target.value) }); setErrors(prev => ({ ...prev, whatsapp: "" })); }} placeholder="(11) 99999-9999" maxLength={15} className={errors.whatsapp ? "border-destructive" : ""} />
            {errors.whatsapp && <p className="text-destructive text-xs mt-1">{errors.whatsapp}</p>}
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

// ── Step 2 ──────────────────────────────────────────────────────
function StepDelivery({ form, setForm, onNext, onBack, saleData, onShippingSelected }: {
  form: CustomerFormData; setForm: (f: CustomerFormData) => void;
  onNext: () => void; onBack: () => void;
  saleData: SaleData | null;
  onShippingSelected: (option: FreightOption) => void;
}) {
  const [fetchingCep, setFetchingCep] = useState(false);
  const [freightOptions, setFreightOptions] = useState<FreightOption[]>([]);
  const [loadingFreight, setLoadingFreight] = useState(false);
  const [selectedFreight, setSelectedFreight] = useState<string | null>(null);
  const [showAllFreight, setShowAllFreight] = useState(true);
  const freightQuotedCep = useRef<string>("");

  const lookupCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setFetchingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm({ ...form, cep: cepValue, address: data.logradouro || form.address, neighborhood: data.bairro || form.neighborhood, city: data.localidade || form.city, state: data.uf || form.state });
      }
    } catch {}
    setFetchingCep(false);
    quoteFreight(digits);
  };

  const quoteFreight = async (cepDigits: string) => {
    if (cepDigits.length !== 8 || cepDigits === freightQuotedCep.current) return;
    freightQuotedCep.current = cepDigits;
    setLoadingFreight(true);
    setFreightOptions([]);
    setSelectedFreight(null);
    try {
      const subtotal = saleData?.items.reduce((s, i) => s + i.price * i.quantity, 0) || 0;
      const totalQty = saleData?.items.reduce((s, i) => s + i.quantity, 0) || 1;
      // Determine store from saleData store_name
      const storeName = (saleData?.store_name || "").toLowerCase();
      const store = storeName.includes("pérola") || storeName.includes("perola") ? "perola" : "centro";
      const { data, error } = await supabase.functions.invoke("checkout-quote-freight", {
        body: { recipient_cep: cepDigits, store, total_value: subtotal, weight_kg: 0.3, items_count: totalQty },
      });
      if (error) throw error;
      if (data?.quotes) setFreightOptions(data.quotes);
    } catch (err) {
      console.error("Error quoting freight:", err);
      setFreightOptions([{ id: 'pickup', carrier: 'Retirada na Loja', service: 'Grátis', price: 0, delivery_days: 0, type: 'pickup' }]);
    }
    setLoadingFreight(false);
  };

  const handleSelectFreight = (option: FreightOption) => {
    setSelectedFreight(option.id);
    setShowAllFreight(false);
    onShippingSelected(option);
  };

  const handleNext = () => {
    if (!form.cep.trim() || !form.address.trim() || !form.addressNumber.trim() || !form.neighborhood.trim() || !form.city.trim() || !form.state.trim()) {
      toast.error("Preencha todos os campos do endereço");
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
         {/* CEP Field - always visible */}
         <div>
           <Label className="text-sm font-medium">CEP *</Label>
           <div className="relative max-w-[200px]">
             <Input
               value={form.cep}
               onChange={(e) => { const v = formatCEP(e.target.value); setForm({ ...form, cep: v }); lookupCep(v); }}
               placeholder="00000-000"
               maxLength={9}
               autoFocus
               className="text-lg h-12"
             />
             {fetchingCep && <Loader2 className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-muted-foreground" />}
           </div>
         </div>

         {/* Address fields - appear after CEP lookup */}
         {(() => {
           const cepDigits = form.cep.replace(/\D/g, "");
           const addressLoaded = cepDigits.length === 8 && !fetchingCep && (form.address.trim() || form.city.trim());
           if (!addressLoaded) return null;

           const hasMissingStreet = !form.address.trim();
           const hasMissingNeighborhood = !form.neighborhood.trim();

           return (
             <div className="animate-in slide-in-from-top-2 duration-200 space-y-3">
               {/* Address summary card */}
               <div className="bg-secondary/40 rounded-lg p-3 border border-border">
                 <p className="text-xs text-muted-foreground mb-1">Endereço encontrado</p>
                 <p className="text-sm font-medium">
                   {form.address && `${form.address}, `}{form.neighborhood && `${form.neighborhood} - `}{form.city}/{form.state}
                 </p>
               </div>

               {/* Manual fields for generic CEPs */}
               {(hasMissingStreet || hasMissingNeighborhood) && (
                 <div className="grid grid-cols-2 gap-3">
                   {hasMissingStreet && (
                     <div className="col-span-2">
                       <Label className="text-sm">Rua *</Label>
                       <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                     </div>
                   )}
                   {hasMissingNeighborhood && (
                     <div className="col-span-2">
                       <Label className="text-sm">Bairro *</Label>
                       <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
                     </div>
                   )}
                 </div>
               )}

               {/* Number + Complement */}
               <div className="grid grid-cols-2 gap-3">
                 <div>
                   <Label className="text-sm">Número *</Label>
                   <Input value={form.addressNumber} onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} autoFocus />
                 </div>
                 <div>
                   <Label className="text-sm">Complemento</Label>
                   <Input value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} placeholder="Apto" />
                 </div>
               </div>
             </div>
           );
         })()}
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
                    <span className="font-bold text-sm text-green-600">GRÁTIS</span>
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

// ── PIX Payment ─────────────────────────────────────────────────
function PixPaymentForm({ saleId, storeId, amount, form, onPaid }: { saleId: string; storeId: string; amount: number; form: CustomerFormData; onPaid: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pixConfirmedRef = useRef(false);

  useEffect(() => {
    if (!pixPaymentId || paid) return;
    pixConfirmedRef.current = false;
    const check = async () => {
      if (pixConfirmedRef.current) return;
      try {
        const { data } = await supabase.functions.invoke("mercadopago-check-payment", { body: { paymentId: pixPaymentId, orderId: saleId } });
        if (data?.status === "approved" && !pixConfirmedRef.current) {
          pixConfirmedRef.current = true;
          setPaid(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
          // Log PIX success
          await supabase.from("pos_checkout_attempts").insert({
            sale_id: saleId,
            store_id: storeId,
            payment_method: "pix",
            status: "success",
            amount,
            customer_name: form.fullName,
            customer_phone: form.whatsapp,
            customer_email: form.email,
            gateway: "mercadopago",
            transaction_id: pixPaymentId,
            metadata: { cpf: form.cpf, cep: form.cep, address: form.address, address_number: form.addressNumber, complement: form.complement, neighborhood: form.neighborhood, city: form.city, state: form.state },
          } as any).then(() => {});
          onPaid();
        }
      } catch {}
    };
    check();
    pollingRef.current = setInterval(check, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [pixPaymentId, paid, saleId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // Persist customer data to pos_sales BEFORE generating PIX
      // This ensures data is available even if the customer closes the page after paying
      // Fetch existing payment_details to preserve shipping_amount
      const { data: existingSale } = await supabase.from("pos_sales").select("payment_details").eq("id", saleId).maybeSingle();
      const existingPd = (existingSale?.payment_details as Record<string, unknown>) || {};
      
      const customerPayload = {
        customer_name: form.fullName,
        customer_phone: form.whatsapp.replace(/\D/g, ""),
        payment_details: {
          ...existingPd,
          customer_name: form.fullName,
          customer_phone: form.whatsapp.replace(/\D/g, ""),
          customer_email: form.email,
          customer_cpf: form.cpf.replace(/\D/g, ""),
          customer_cep: form.cep.replace(/\D/g, ""),
          customer_address: form.address,
          customer_address_number: form.addressNumber,
          customer_complement: form.complement,
          customer_neighborhood: form.neighborhood,
          customer_city: form.city,
          customer_state: form.state,
          description: "PIX Checkout Loja",
        },
      };
      await supabase.from("pos_sales").update(customerPayload as any).eq("id", saleId);

      const nameParts = form.fullName.split(" ");
      const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
        body: {
          orderId: saleId,
          payer: {
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            email: form.email,
            cpf: form.cpf,
          },
        },
      });
      if (error) throw new Error(String(error));
      if (!data?.qrCode) throw new Error("QR Code não retornado");
      setPixData(data);
      if (data.paymentId) setPixPaymentId(String(data.paymentId));
    } catch (e: any) {
      // Log PIX generation error
      await supabase.from("pos_checkout_attempts").insert({
        sale_id: saleId,
        payment_method: "pix",
        status: "failed",
        error_message: e.message || "Erro ao gerar PIX",
        amount,
        customer_name: form.fullName,
        customer_phone: form.whatsapp,
        customer_email: form.email,
        gateway: "mercadopago",
      } as any).then(() => {});
      toast.error(e.message || "Erro ao gerar PIX");
    } finally {
      setGenerating(false);
    }
  };

  if (paid) return (
    <div className="text-center space-y-4 py-4">
      <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
      <h3 className="text-lg font-bold">PIX Confirmado!</h3>
    </div>
  );

  if (pixData) return (
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
          try { await navigator.clipboard.writeText(pixData.qrCode); setCopied(true); toast.success("Copiado!"); setTimeout(() => setCopied(false), 3000); } catch {}
        }}>
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? "Copiado!" : "Copiar código PIX"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground text-center">Valor: <span className="font-bold text-foreground">R$ {pixData.amount}</span></p>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Clique para gerar o PIX.</p>
      <Button onClick={handleGenerate} disabled={generating} className="w-full h-14 text-lg font-semibold" size="lg">
        {generating ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Gerando PIX...</> : <><QrCode className="h-5 w-5 mr-2" />Gerar PIX - R$ {amount.toFixed(2)}</>}
      </Button>
    </div>
  );
}

// ── Card Payment ────────────────────────────────────────────────
function CardPaymentForm({ saleId, amount, form, installmentConfig, onPaid }: { saleId: string; amount: number; form: CustomerFormData; installmentConfig: InstallmentConfig; onPaid: () => void }) {
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [installments, setInstallments] = useState("1");
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);

  // Restore processing state from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(`checkout_payment_${saleId}`);
    if (stored) {
      attemptIdRef.current = stored;
      setProcessing(true);
      processingRef.current = true;
      pollPaymentResult(stored);
    }
  }, [saleId]);

  const pollPaymentResult = async (attemptId: string) => {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const { data: freshSale } = await supabase.from("pos_sales").select("status, payment_gateway").eq("id", saleId).maybeSingle();
        if (freshSale?.status === "paid" || freshSale?.status === "completed") {
          sessionStorage.removeItem(`checkout_payment_${saleId}`);
          toast.success("Pagamento aprovado!");
          onPaid();
          return;
        }
        const { data: attempt } = await supabase.from("pos_checkout_attempts").select("status, error_message").eq("transaction_id", attemptId).maybeSingle();
        if (attempt && attempt.status === "failed") {
          sessionStorage.removeItem(`checkout_payment_${saleId}`);
          setPaymentError((attempt as any).error_message || "A operadora do seu cartão não aprovou a compra. Revise os dados ou tente com outro cartão.");
          setProcessing(false);
          processingRef.current = false;
          return;
        }
        if (attempt && attempt.status === "success") {
          sessionStorage.removeItem(`checkout_payment_${saleId}`);
          toast.success("Pagamento aprovado!");
          onPaid();
          return;
        }
      } catch {}
    }
    sessionStorage.removeItem(`checkout_payment_${saleId}`);
    setPaymentError("Tempo esgotado. Verifique se o pagamento foi aprovado ou tente novamente.");
    setProcessing(false);
    processingRef.current = false;
  };

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
    if (processingRef.current) return;

    if (!cardNumber.trim() || !cardName.trim() || !expiry.trim() || !cvv.trim()) {
      toast.error("Preencha todos os dados do cartão");
      return;
    }

    processingRef.current = true;
    setProcessing(true);
    setPaymentError(null);

    const attemptId = crypto.randomUUID();
    attemptIdRef.current = attemptId;
    sessionStorage.setItem(`checkout_payment_${saleId}`, attemptId);

    try {
      const customerData = {
        name: form.fullName,
        email: form.email,
        cpf: form.cpf.replace(/\D/g, ""),
        phone: form.whatsapp.replace(/\D/g, ""),
        address: { street: form.address, number: form.addressNumber, neighborhood: form.neighborhood, city: form.city, state: form.state, cep: form.cep.replace(/\D/g, "") },
      };
      const totalCents = Math.round(totalWithInterest * 100);
      const expiryParts = expiry.split("/");
      const { data, error } = await supabase.functions.invoke("pagarme-create-charge", {
        body: {
          orderId: saleId,
          paymentAttemptId: attemptId,
          totalAmountCents: totalCents,
          customer: customerData,
          card: {
            number: cardNumber.replace(/\s/g, ""),
            holderName: cardName,
            expMonth: expiryParts[0],
            expYear: expiryParts[1]?.length === 2 ? `20${expiryParts[1]}` : expiryParts[1],
            cvv,
          },
          installments: selectedInstallments,
          billingAddress: {
            street: form.address,
            number: form.addressNumber || "S/N",
            neighborhood: form.neighborhood,
            city: form.city,
            state: form.state,
            zipCode: form.cep.replace(/\D/g, ""),
            country: "BR",
          },
        },
      });
      console.log("Payment response:", JSON.stringify({ data, error }));

      if (data?.already_paid) {
        sessionStorage.removeItem(`checkout_payment_${saleId}`);
        toast.success("Pagamento já confirmado!");
        onPaid();
        return;
      }

      if (data?.already_processing) {
        pollPaymentResult(attemptId);
        return;
      }

      if (error || !data?.success || !data?.transactionId) {
        const errMsg = data?.error || (error && typeof error === "object" && "message" in error ? String((error as any).message) : null) || "Erro no pagamento";
        await supabase.from("pos_checkout_attempts").insert({
          sale_id: saleId, payment_method: "card", status: "failed", error_message: errMsg,
          amount: totalWithInterest, customer_name: form.fullName, customer_phone: form.whatsapp,
          customer_email: form.email, gateway: data?.gateway || "pagarme",
        } as any).then(() => {});
        throw new Error(errMsg);
      }
      // Log success
      await supabase.from("pos_checkout_attempts").insert({
        sale_id: saleId, payment_method: "card", status: "success", amount: totalWithInterest,
        customer_name: form.fullName, customer_phone: form.whatsapp, customer_email: form.email,
        gateway: data.gateway || "pagarme", transaction_id: data.transactionId || null,
        metadata: { cpf: form.cpf, cep: form.cep, address: form.address, address_number: form.addressNumber, complement: form.complement, neighborhood: form.neighborhood, city: form.city, state: form.state },
      } as any).then(() => {});
      sessionStorage.removeItem(`checkout_payment_${saleId}`);
      const gw = data.gateway || "pagarme";
      const gwLabel = gw === "pagarme" ? "Pagar.me" : gw === "vindi" ? "VINDI" : gw === "appmax" ? "APPMAX" : gw.toUpperCase();
      toast.success(`Pagamento aprovado via ${gwLabel}!`);
      onPaid();
    } catch (e: any) {
      // On timeout/error, poll backend
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const { data: freshSale } = await supabase.from("pos_sales").select("status, payment_gateway").eq("id", saleId).maybeSingle();
          if (freshSale?.status === "paid" || freshSale?.status === "completed") {
            sessionStorage.removeItem(`checkout_payment_${saleId}`);
            toast.success("Pagamento aprovado!");
            onPaid();
            return;
          }
        } catch (_) {}
      }
      sessionStorage.removeItem(`checkout_payment_${saleId}`);
      setPaymentError(e.message || "Erro no pagamento");
      setProcessing(false);
      processingRef.current = false;
    }
  };

  // ── Processing overlay ──
  if (processing) {
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
      <div><Label className="text-sm">Número do Cartão</Label><Input value={cardNumber} onChange={e => setCardNumber(formatCardNumber(e.target.value))} placeholder="0000 0000 0000 0000" maxLength={19} /></div>
      <div><Label className="text-sm">Nome no Cartão</Label><Input value={cardName} onChange={e => setCardName(e.target.value.toUpperCase())} placeholder="NOME COMO NO CARTÃO" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-sm">Validade</Label><Input value={expiry} onChange={e => setExpiry(formatExpiry(e.target.value))} placeholder="MM/AA" maxLength={5} /></div>
        <div><Label className="text-sm">CVV</Label><Input value={cvv} onChange={e => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="123" maxLength={4} type="password" /></div>
      </div>
      <div><Label className="text-sm">Parcelas</Label>
        <Select value={installments} onValueChange={setInstallments}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {installmentOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleSubmit} disabled={processing} className="w-full h-14 text-lg font-semibold" size="lg">
        <Lock className="h-5 w-5 mr-2" />Pagar R$ {totalWithInterest.toFixed(2)}
      </Button>
    </div>
  );
}

// ── Main Store Checkout ─────────────────────────────────────────
export default function StoreCheckout() {
  const { storeId, saleId } = useParams<{ storeId: string; saleId: string }>();
  const [saleData, setSaleData] = useState<SaleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "success">("pending");
  const [currentStep, setCurrentStep] = useState(1);
  const [customerForm, setCustomerForm] = useState<CustomerFormData>({
    fullName: "", email: "", cpf: "", whatsapp: "",
    cep: "", address: "", addressNumber: "", complement: "",
    neighborhood: "", city: "", state: "",
  });
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig>({
    max_installments: 12, interest_free_installments: 6, monthly_interest_rate: 2.49,
  });
   const [selectedMethod, setSelectedMethod] = useState<"pix" | "card" | null>(null);
   const [showAllPayMethods, setShowAllPayMethods] = useState(true);

  useEffect(() => {
    if (!storeId || !saleId) { setLoading(false); return; }
    loadSale();
    loadInstallmentConfig();
    // Mark checkout_step = 0 when the checkout page loads
    supabase.from("pos_sales").update({ checkout_step: 0 } as any).eq("id", saleId).then(() => {});
  }, [storeId, saleId]);

  // Update checkout_step when currentStep changes to 3
  useEffect(() => {
    if (currentStep === 3 && saleId) {
      supabase.from("pos_sales").update({ checkout_step: 3 } as any).eq("id", saleId).then(() => {});
    }
  }, [currentStep, saleId]);

  const loadSale = async () => {
    try {
      const { data: sale, error } = await supabase
        .from("pos_sales")
        .select("*")
        .eq("id", saleId!)
        .eq("store_id", storeId!)
        .maybeSingle();

      if (error || !sale) throw new Error("Venda não encontrada");

      // Load store name
      const { data: store } = await supabase.from("pos_stores").select("name").eq("id", storeId!).maybeSingle();

      // Load sale items
      const { data: items } = await supabase.from("pos_sale_items").select("*").eq("sale_id", saleId!);

      const paymentDetails = ((sale as any).payment_details || {}) as Record<string, any>;

      // Enrich items with compare_at_price from payment_details
      const itemsDetail = (paymentDetails.items_detail || []) as Array<{ title?: string; compare_at_price?: number | null }>;

      const saleItems: SaleItem[] = (items || []).map((i: any, idx: number) => {
        const detail = itemsDetail[idx];
        return {
          sku: i.sku || "",
          name: i.product_name || i.name || "",
          variant: i.variant_name || i.variant || "",
          price: Number(i.unit_price ?? i.price ?? 0),
          quantity: Number(i.quantity ?? 1),
          compare_at_price: detail?.compare_at_price ?? null,
        };
      });
      const customerName = (sale as any).customer_name || paymentDetails.customer_name || "Cliente";
      const customerPhone = (sale as any).customer_phone || paymentDetails.customer_phone || "";

      setSaleData({
        id: sale.id,
        store_id: sale.store_id,
        store_name: store?.name || "Loja",
        total: Number(sale.total || 0),
        discount_amount: Number((sale as any).discount_amount ?? (sale as any).discount ?? 0),
        shipping_amount: Number(paymentDetails.shipping_amount ?? 0),
        customer_name: customerName,
        customer_phone: customerPhone,
        items: saleItems,
        status: sale.status || "",
      });

      // Pre-fill customer name/phone
      if (customerName && customerName !== "Cliente") {
        setCustomerForm(prev => ({
          ...prev,
          fullName: customerName,
          whatsapp: customerPhone ? formatPhone(customerPhone) : "",
        }));
      }

      if (sale.status === "completed") setPaymentStatus("success");
    } catch (e) {
      console.error("Error loading sale:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadInstallmentConfig = async () => {
    try {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "installment_config").maybeSingle();
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

  const paymentConfirmedRef = useRef(false);

  const handlePaymentConfirmed = useCallback(async () => {
    if (paymentConfirmedRef.current) return;
    paymentConfirmedRef.current = true;
    setPaymentStatus("success");

    if (!saleData) return;

    // Upsert customer in pos_customers and link to sale
    let customerId: string | null = null;
    const cpfDigits = customerForm.cpf.replace(/\D/g, "");
    const phoneDigits = customerForm.whatsapp.replace(/\D/g, "");

    // Try to find existing customer by CPF
    if (cpfDigits) {
      const { data: existing } = await supabase
        .from("pos_customers")
        .select("id")
        .eq("cpf", cpfDigits)
        .maybeSingle();
      if (existing) customerId = existing.id;
    }
    // Fallback: find by phone
    if (!customerId && phoneDigits) {
      const { data: existing } = await supabase
        .from("pos_customers")
        .select("id")
        .eq("whatsapp", phoneDigits)
        .maybeSingle();
      if (existing) customerId = existing.id;
    }

    const customerPayload = {
      name: customerForm.fullName,
      cpf: cpfDigits,
      email: customerForm.email,
      whatsapp: phoneDigits,
      address: customerForm.address,
      address_number: customerForm.addressNumber,
      complement: customerForm.complement || null,
      neighborhood: customerForm.neighborhood,
      city: customerForm.city,
      state: customerForm.state,
      cep: customerForm.cep.replace(/\D/g, ""),
    };

    try {
      if (customerId) {
        await supabase.from("pos_customers").update(customerPayload as any).eq("id", customerId);
      } else {
        const { data: newCust } = await supabase
          .from("pos_customers")
          .insert(customerPayload as any)
          .select("id")
          .single();
        customerId = newCust?.id || null;
      }
    } catch (e) {
      console.error("Error upserting customer:", e);
    }

    // Update sale status with customer_id
    await supabase.from("pos_sales").update({
      status: "completed",
      customer_id: customerId,
    } as any).eq("id", saleData.id);

    // Create Tiny order — pass sale_id so it updates existing instead of creating duplicate
    try {
      await supabase.functions.invoke("pos-tiny-create-sale", {
        body: {
          store_id: saleData.store_id,
          sale_id: saleData.id,
          customer: {
            name: customerForm.fullName,
            cpf: customerForm.cpf.replace(/\D/g, ""),
            email: customerForm.email,
            whatsapp: customerForm.whatsapp.replace(/\D/g, ""),
            address: customerForm.address,
            addressNumber: customerForm.addressNumber,
            complement: customerForm.complement,
            neighborhood: customerForm.neighborhood,
            cep: customerForm.cep.replace(/\D/g, ""),
            city: customerForm.city,
            state: customerForm.state,
          },
          items: saleData.items.map(i => ({
            sku: i.sku,
            name: i.name,
            variant: i.variant,
            quantity: i.quantity,
            price: i.price,
          })),
          payment_method_name: "Checkout Online",
          notes: `Checkout Loja - ${saleData.store_name}`,
        },
      });
    } catch (e) {
      console.error("Tiny order creation failed:", e);
    }
  }, [saleData, customerForm]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Carregando pedido...</p>
        </div>
      </div>
    );
  }

  if (!saleData) {
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
    const totalItems = saleData.items.reduce((s, i) => s + i.quantity, 0);
    const fullSubtotal = saleData.items.reduce((s, i) => {
      const full = i.compare_at_price && i.compare_at_price > i.price ? i.compare_at_price : i.price;
      return s + full * i.quantity;
    }, 0);
    const subtotal = saleData.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const itemSavings = fullSubtotal - subtotal;
    const totalSavings = itemSavings + saleData.discount_amount;
    const shippingAmount = saleData.shipping_amount || 0;
    const netProductSubtotal = subtotal - saleData.discount_amount;
    const totalPaid = netProductSubtotal + shippingAmount;
    const displayName = customerForm.fullName || saleData.customer_name;
    const displayPhone = customerForm.whatsapp || saleData.customer_phone;
    const whatsappLink = displayPhone
      ? `https://wa.me/55${displayPhone.replace(/\D/g, "")}`
      : null;

    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background p-4">
        <div className="max-w-lg mx-auto space-y-5 pt-6 pb-10">

          {/* ── Header com animação ── */}
          <div className="text-center space-y-3">
            <div className="relative inline-block">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-28 h-28 rounded-full bg-green-500/10 animate-ping" style={{ animationDuration: '2s' }} />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-green-500/20 animate-pulse" />
              </div>
              <CheckCircle2 className="h-16 w-16 text-green-500 relative" />
            </div>
            <h1 className="text-2xl font-black tracking-tight">Compra Aprovada! 🎉</h1>
            <p className="text-muted-foreground text-sm">
              Obrigado, <span className="font-semibold text-foreground">{displayName}</span>!
            </p>
          </div>

          {/* ── Valor total pago ── */}
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="py-5 text-center space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Valor pago</p>
              <p className="text-4xl font-black text-green-600">R$ {totalPaid.toFixed(2)}</p>
              {totalSavings > 0 && (
                <Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-xs font-semibold">
                  🎁 Você economizou R$ {totalSavings.toFixed(2)}
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* ── Itens do pedido ── */}
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShoppingBag className="h-4 w-4 text-primary" />
                Seus itens ({totalItems} {totalItems === 1 ? 'item' : 'itens'})
              </div>
              <div className="divide-y">
                {saleData.items.map((item, i) => {
                  const hasCompare = item.compare_at_price && item.compare_at_price > item.price;
                  return (
                    <div key={i} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        {item.variant && <p className="text-xs text-muted-foreground">{item.variant}</p>}
                        <p className="text-xs text-muted-foreground">Qtd: {item.quantity}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {hasCompare && (
                          <p className="text-[10px] line-through text-muted-foreground">R$ {(item.compare_at_price! * item.quantity).toFixed(2)}</p>
                        )}
                        <p className="text-sm font-bold">R$ {(item.price * item.quantity).toFixed(2)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detalhamento de valores */}
              <div className="border-t pt-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>R$ {subtotal.toFixed(2)}</span>
                </div>
                {saleData.discount_amount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Desconto</span>
                    <span>-R$ {saleData.discount_amount.toFixed(2)}</span>
                  </div>
                )}
                {shippingAmount > 0 ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Frete</span>
                    <span>R$ {shippingAmount.toFixed(2)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Frete</span>
                    <span>Grátis ✨</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm pt-1 border-t">
                  <span>Total</span>
                  <span className="text-primary">R$ {totalPaid.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Dados do cliente ── */}
          {(customerForm.fullName || customerForm.email || customerForm.address) && (
            <Card>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <User className="h-4 w-4 text-primary" />
                  Dados da compra
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {customerForm.fullName && (
                    <div>
                      <p className="text-muted-foreground">Nome</p>
                      <p className="font-medium">{customerForm.fullName}</p>
                    </div>
                  )}
                  {customerForm.email && (
                    <div>
                      <p className="text-muted-foreground">E-mail</p>
                      <p className="font-medium truncate">{customerForm.email}</p>
                    </div>
                  )}
                  {customerForm.cpf && (
                    <div>
                      <p className="text-muted-foreground">CPF</p>
                      <p className="font-medium">{customerForm.cpf}</p>
                    </div>
                  )}
                  {customerForm.whatsapp && (
                    <div>
                      <p className="text-muted-foreground">WhatsApp</p>
                      <p className="font-medium">{customerForm.whatsapp}</p>
                    </div>
                  )}
                </div>
                {customerForm.address && (
                  <div className="text-xs border-t pt-2">
                    <p className="text-muted-foreground mb-1">Endereço de entrega</p>
                    <p className="font-medium">
                      {customerForm.address}, {customerForm.addressNumber}
                      {customerForm.complement ? ` - ${customerForm.complement}` : ""}
                    </p>
                    <p className="font-medium">
                      {customerForm.neighborhood} · {customerForm.city}/{customerForm.state}
                    </p>
                    {customerForm.cep && <p className="text-muted-foreground">CEP: {customerForm.cep}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Mensagem e contato ── */}
          <Card className="bg-secondary/30">
            <CardContent className="py-4 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Seu pedido foi confirmado e está sendo preparado. Você receberá atualizações pelo WhatsApp.
              </p>
              {whatsappLink && (
                <Button
                  asChild
                  variant="outline"
                  className="w-full gap-2"
                >
                  <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                    💬 Falar com a loja via WhatsApp
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Loja ── */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Store className="h-3 w-3" />
            <span>{saleData.store_name}</span>
            <span>·</span>
            <Lock className="h-3 w-3" />
            <span>Pagamento seguro</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-4">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Lock className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-bold">Checkout Seguro</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Olá, {saleData.customer_name}! · {saleData.store_name}
          </p>
        </div>

        <StepIndicator currentStep={currentStep} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardContent className="p-6">
                {currentStep === 1 && (
                  <StepIdentification form={customerForm} setForm={setCustomerForm} onNext={() => {
                    // Save customer data progressively to pos_sales when advancing to Step 2
                    if (saleData) {
                      supabase.from("pos_sales").update({
                        customer_name: customerForm.fullName,
                        customer_phone: customerForm.whatsapp.replace(/\D/g, ""),
                        checkout_step: 1,
                        payment_details: {
                          customer_name: customerForm.fullName,
                          customer_phone: customerForm.whatsapp.replace(/\D/g, ""),
                          customer_email: customerForm.email,
                          customer_cpf: customerForm.cpf.replace(/\D/g, ""),
                        },
                      } as any).eq("id", saleData.id).then(() => {});
                    }
                    setCurrentStep(2);
                  }} prefilled={!!saleData.customer_name} />
                )}
                {currentStep === 2 && (
                  <StepDelivery form={customerForm} setForm={setCustomerForm} onNext={() => {
                    // Save address data to pos_sales when advancing to Step 3
                    if (saleData) {
                      supabase.from("pos_sales").update({
                        checkout_step: 2,
                        payment_details: {
                          customer_name: customerForm.fullName,
                          customer_phone: customerForm.whatsapp.replace(/\D/g, ""),
                          customer_email: customerForm.email,
                          customer_cpf: customerForm.cpf.replace(/\D/g, ""),
                          customer_cep: customerForm.cep.replace(/\D/g, ""),
                          customer_address: customerForm.address,
                          customer_address_number: customerForm.addressNumber,
                          customer_complement: customerForm.complement,
                          customer_neighborhood: customerForm.neighborhood,
                          customer_city: customerForm.city,
                          customer_state: customerForm.state,
                          shipping_amount: saleData.shipping_amount,
                        },
                        shipping_address: {
                          cep: customerForm.cep.replace(/\D/g, ""),
                          address: customerForm.address,
                          number: customerForm.addressNumber,
                          complement: customerForm.complement,
                          neighborhood: customerForm.neighborhood,
                          city: customerForm.city,
                          state: customerForm.state,
                        },
                      } as any).eq("id", saleData.id).then(() => {});
                    }
                    setCurrentStep(3);
                  }} onBack={() => setCurrentStep(1)}
                  saleData={saleData}
                  onShippingSelected={(option) => {
                    if (saleData) {
                      const newShipping = option.price;
                      // Update local state
                      setSaleData(prev => prev ? { ...prev, shipping_amount: newShipping } : prev);
                      // Update in DB
                      supabase.from("pos_sales").update({
                        payment_details: {
                          ...((saleData as any).payment_details || {}),
                          shipping_amount: newShipping,
                          shipping_carrier: option.carrier,
                          shipping_service: option.service,
                        },
                      } as any).eq("id", saleData.id).then(() => {});
                      // Also update total
                      const subtotal = saleData.items.reduce((s, i) => s + i.price * i.quantity, 0);
                      const netProduct = subtotal - saleData.discount_amount;
                      const newTotal = netProduct + newShipping;
                      supabase.from("pos_sales").update({ total: newTotal } as any).eq("id", saleData.id).then(() => {});
                    }
                  }}
                  />
                )}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Wallet className="h-5 w-5 text-primary" />
                      <h2 className="font-semibold text-lg">Pagamento</h2>
                      <Badge variant="secondary" className="text-[10px]">3 de 3</Badge>
                    </div>
                    {(() => {
                      const subtotal = saleData.items.reduce((s, i) => s + i.price * i.quantity, 0);
                      const netProduct = subtotal - saleData.discount_amount;
                      const totalWithShipping = netProduct + (saleData.shipping_amount || 0);
                      const pixDiscountPercent = 0;
                      const pixAmount = Math.round(totalWithShipping * (1 - pixDiscountPercent / 100) * 100) / 100;
                      return (
                         <div className="space-y-2">
                           {/* Cartão de crédito */}
                           {(showAllPayMethods || selectedMethod === "card") && (
                             <>
                               <button
                                 onClick={() => { setSelectedMethod("card"); setShowAllPayMethods(false); }}
                                 className={`w-full flex items-center gap-3 p-3.5 rounded-lg border transition-all text-left ${
                                   selectedMethod === "card"
                                     ? "border-foreground bg-card shadow-sm"
                                     : "border-border bg-card hover:border-muted-foreground"
                                 }`}
                               >
                                 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                   selectedMethod === "card" ? "border-foreground" : "border-muted-foreground"
                                 }`}>
                                   {selectedMethod === "card" && <div className="w-2.5 h-2.5 rounded-full bg-foreground" />}
                                 </div>
                                 <span className="text-sm font-semibold">Cartão de crédito</span>
                               </button>

                               {selectedMethod === "card" && (
                                 <div className="animate-in slide-in-from-top-2 duration-200 border border-border rounded-lg p-4 bg-card">
                                   <CardPaymentForm saleId={saleData.id} amount={totalWithShipping} form={customerForm} installmentConfig={installmentConfig} onPaid={handlePaymentConfirmed} />
                                 </div>
                               )}
                             </>
                           )}

                           {/* PIX */}
                           {(showAllPayMethods || selectedMethod === "pix") && (
                             <>
                               <button
                                 onClick={() => { setSelectedMethod("pix"); setShowAllPayMethods(false); }}
                                 className={`w-full flex items-center justify-between p-3.5 rounded-lg border transition-all text-left ${
                                   selectedMethod === "pix"
                                     ? "border-foreground bg-card shadow-sm"
                                     : "border-border bg-card hover:border-muted-foreground"
                                 }`}
                               >
                                 <div className="flex items-center gap-3">
                                   <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                     selectedMethod === "pix" ? "border-foreground" : "border-muted-foreground"
                                   }`}>
                                     {selectedMethod === "pix" && <div className="w-2.5 h-2.5 rounded-full bg-foreground" />}
                                   </div>
                                   <div className="flex items-center gap-1.5">
                                     <QrCode className="h-4 w-4 text-muted-foreground" />
                                     <span className="text-sm font-semibold">Pix</span>
                                   </div>
                                 </div>
                                 {pixDiscountPercent > 0 && (
                                   <Badge className="bg-green-600 text-white text-[8px] px-1.5 py-0.5 border-0 font-bold leading-none">
                                     {pixDiscountPercent}% OFF
                                   </Badge>
                                 )}
                               </button>

                               {selectedMethod === "pix" && (
                                 <div className="animate-in slide-in-from-top-2 duration-200 border border-border rounded-lg p-4 bg-card">
                                   {pixDiscountPercent > 0 && (
                                     <p className="text-base font-bold text-green-600 mb-3">
                                       Valor no Pix: R$ {pixAmount.toFixed(2).replace(".", ",")}
                                     </p>
                                   )}
                                   <PixPaymentForm saleId={saleData.id} storeId={saleData.store_id} amount={pixAmount} form={customerForm} onPaid={handlePaymentConfirmed} />
                                 </div>
                               )}
                             </>
                           )}

                           {/* Botão para trocar forma de pagamento */}
                           {selectedMethod && !showAllPayMethods && (
                             <button
                               onClick={() => setShowAllPayMethods(true)}
                               className="w-full text-center text-sm text-primary font-medium py-2 hover:underline transition-all"
                             >
                               Alterar forma de pagamento
                             </button>
                           )}
                         </div>
                      );
                    })()}
                    <Button variant="ghost" onClick={() => setCurrentStep(2)} className="w-full text-sm text-muted-foreground">← Voltar para Entrega</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-4">
              <OrderSummary saleData={saleData} />
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
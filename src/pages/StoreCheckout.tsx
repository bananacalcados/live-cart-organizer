import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ShoppingBag, Lock, CreditCard, QrCode, Copy, Check, User, MapPin, Wallet, ChevronRight, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface SaleItem {
  sku: string;
  name: string;
  variant: string;
  price: number;
  quantity: number;
}

interface SaleData {
  id: string;
  store_id: string;
  store_name: string;
  total: number;
  discount_amount: number;
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
  const totalItems = saleData.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <div className="bg-secondary/30 rounded-xl p-4 space-y-3">
      {/* Discount Prize Banner */}
      {saleData.discount_amount > 0 && (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 p-4 text-white shadow-lg">
          <div className="absolute top-0 right-0 opacity-20 text-6xl">🎁</div>
          <div className="relative z-10 text-center">
            <p className="text-xs font-medium uppercase tracking-wider opacity-90">Você ganhou</p>
            <p className="text-2xl font-black mt-0.5">R$ {saleData.discount_amount.toFixed(2)} OFF</p>
            <p className="text-xs opacity-80 mt-1">de desconto nesta compra! 🎉</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium text-sm">
          <ShoppingBag className="h-4 w-4" />
          Resumo ({totalItems} {totalItems === 1 ? 'item' : 'itens'})
        </div>
        <span className="font-bold text-primary">R$ {saleData.total.toFixed(2)}</span>
      </div>
      {saleData.items.map((item, i) => (
        <div key={i} className="flex items-center justify-between p-2 bg-background/50 rounded-lg">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-xs truncate">{item.name}</p>
            {item.variant && <p className="text-[10px] text-muted-foreground">{item.variant}</p>}
            <p className="text-[10px] text-muted-foreground">Qtd: {item.quantity}</p>
          </div>
          <p className="font-semibold text-xs flex-shrink-0">R$ {(item.price * item.quantity).toFixed(2)}</p>
        </div>
      ))}
      <div className="border-t pt-2 space-y-1">
        {saleData.discount_amount > 0 && (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="line-through text-muted-foreground">R$ {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-green-600 font-medium">🎁 Desconto</span>
              <span className="text-green-600 font-bold">-R$ {saleData.discount_amount.toFixed(2)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between font-bold text-sm pt-1">
          <span>Total</span>
          <span className="text-primary">R$ {saleData.total.toFixed(2)}</span>
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
  const handleNext = () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.cpf.trim() || !form.whatsapp.trim()) {
      toast.error("Preencha todos os campos obrigatórios");
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

// ── Step 2 ──────────────────────────────────────────────────────
function StepDelivery({ form, setForm, onNext, onBack }: { form: CustomerFormData; setForm: (f: CustomerFormData) => void; onNext: () => void; onBack: () => void }) {
  const [fetchingCep, setFetchingCep] = useState(false);
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
  };
  const handleNext = () => {
    if (!form.cep.trim() || !form.address.trim() || !form.addressNumber.trim() || !form.neighborhood.trim() || !form.city.trim() || !form.state.trim()) {
      toast.error("Preencha todos os campos do endereço");
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
          <div><Label className="text-sm">Número *</Label><Input value={form.addressNumber} onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} /></div>
          <div><Label className="text-sm">Complemento</Label><Input value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} placeholder="Apto" /></div>
          <div><Label className="text-sm">Bairro *</Label><Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Label className="text-sm">Cidade *</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><Label className="text-sm">UF *</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} /></div>
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1 h-12">Voltar</Button>
        <Button onClick={handleNext} className="flex-[2] h-12 text-base font-semibold">Ir para Pagamento <ChevronRight className="h-5 w-5 ml-1" /></Button>
      </div>
    </div>
  );
}

// ── PIX Payment ─────────────────────────────────────────────────
function PixPaymentForm({ saleId, amount, form, onPaid }: { saleId: string; amount: number; form: CustomerFormData; onPaid: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!pixPaymentId || paid) return;
    const check = async () => {
      try {
        const { data } = await supabase.functions.invoke("mercadopago-check-payment", { body: { paymentId: pixPaymentId, orderId: saleId } });
        if (data?.status === "approved") {
          setPaid(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
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
    if (!cardNumber.trim() || !cardName.trim() || !expiry.trim() || !cvv.trim()) {
      toast.error("Preencha todos os dados do cartão");
      return;
    }
    setProcessing(true);
    try {
      const customerData = {
        name: form.fullName,
        email: form.email,
        cpf: form.cpf.replace(/\D/g, ""),
        phone: form.whatsapp.replace(/\D/g, ""),
        address: { street: form.address, number: form.addressNumber, neighborhood: form.neighborhood, city: form.city, state: form.state, cep: form.cep.replace(/\D/g, "") },
      };
      const { data, error } = await supabase.functions.invoke("pagarme-create-charge", {
        body: {
          orderId: saleId,
          amount: Math.round(totalWithInterest * 100),
          customer: customerData,
          card: {
            number: cardNumber.replace(/\s/g, ""),
            holderName: cardName,
            expMonth: parseInt(expiry.split("/")[0]),
            expYear: parseInt("20" + expiry.split("/")[1]),
            cvv,
          },
          installments: selectedInstallments,
          items: [],
        },
      });
      if (error || !data?.success) throw new Error(data?.error || "Erro no pagamento");
      toast.success("Pagamento aprovado!");
      onPaid();
    } catch (e: any) {
      toast.error(e.message || "Erro no pagamento");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
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
        {processing ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Processando...</> : <><Lock className="h-5 w-5 mr-2" />Pagar R$ {totalWithInterest.toFixed(2)}</>}
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

  useEffect(() => {
    if (!storeId || !saleId) { setLoading(false); return; }
    loadSale();
    loadInstallmentConfig();
  }, [storeId, saleId]);

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

      const saleItems: SaleItem[] = (items || []).map((i: any) => ({
        sku: i.sku || "",
        name: i.name || "",
        variant: i.variant || "",
        price: i.price || 0,
        quantity: i.quantity || 1,
      }));

      setSaleData({
        id: sale.id,
        store_id: sale.store_id,
        store_name: store?.name || "Loja",
        total: sale.total || 0,
        discount_amount: (sale as any).discount_amount || 0,
        customer_name: (sale as any).customer_name || "Cliente",
        customer_phone: (sale as any).customer_phone || "",
        items: saleItems,
        status: sale.status || "",
      });

      // Pre-fill customer name/phone
      if ((sale as any).customer_name) {
        setCustomerForm(prev => ({
          ...prev,
          fullName: (sale as any).customer_name || "",
          whatsapp: (sale as any).customer_phone ? formatPhone((sale as any).customer_phone) : "",
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

  const handlePaymentConfirmed = useCallback(async () => {
    setPaymentStatus("success");

    if (!saleData) return;

    // Update sale status to completed
    await supabase.from("pos_sales").update({ status: "completed" } as any).eq("id", saleData.id);

    // Create Tiny order
    try {
      await supabase.functions.invoke("pos-tiny-create-sale", {
        body: {
          store_id: saleData.store_id,
          customer: {
            name: customerForm.fullName,
            cpf: customerForm.cpf.replace(/\D/g, ""),
            email: customerForm.email,
            whatsapp: customerForm.whatsapp.replace(/\D/g, ""),
            address: customerForm.address,
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
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
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
                Obrigado, <span className="font-semibold text-foreground">{saleData.customer_name}</span>!
              </p>
              <p className="text-sm text-muted-foreground">Seu pedido foi confirmado e está sendo preparado.</p>
            </div>
            <div className="p-4 bg-secondary/50 rounded-xl space-y-3">
              <p className="text-sm text-muted-foreground">Valor pago</p>
              <p className="text-3xl font-bold text-primary">R$ {saleData.total.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Store className="h-3 w-3" />
              <span>{saleData.store_name}</span>
            </div>
          </CardContent>
        </Card>
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
                  <StepIdentification form={customerForm} setForm={setCustomerForm} onNext={() => setCurrentStep(2)} prefilled={!!saleData.customer_name} />
                )}
                {currentStep === 2 && (
                  <StepDelivery form={customerForm} setForm={setCustomerForm} onNext={() => setCurrentStep(3)} onBack={() => setCurrentStep(1)} />
                )}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Wallet className="h-5 w-5 text-primary" />
                      <h2 className="font-semibold text-lg">Pagamento</h2>
                      <Badge variant="secondary" className="text-[10px]">3 de 3</Badge>
                    </div>
                    <Tabs defaultValue="card" className="w-full">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="card" className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Cartão</TabsTrigger>
                        <TabsTrigger value="pix" className="flex items-center gap-2"><QrCode className="h-4 w-4" /> PIX</TabsTrigger>
                      </TabsList>
                      <TabsContent value="card" className="mt-4">
                        <CardPaymentForm saleId={saleData.id} amount={saleData.total} form={customerForm} installmentConfig={installmentConfig} onPaid={handlePaymentConfirmed} />
                      </TabsContent>
                      <TabsContent value="pix" className="mt-4">
                        <PixPaymentForm saleId={saleData.id} amount={saleData.total} form={customerForm} onPaid={handlePaymentConfirmed} />
                      </TabsContent>
                    </Tabs>
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
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ShoppingBag, Lock, CreditCard, QrCode, Copy, Check, Clock, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

// ── Product List ────────────────────────────────────────────────
function ProductList({ products }: { products: OrderProduct[] }) {
  return (
    <div className="space-y-3">
      <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Itens do Pedido</h3>
      {products.map((product, index) => (
        <div key={index} className="flex items-center gap-3 p-3 bg-secondary/30 rounded-lg">
          {product.image && (
            <img src={product.image} alt={product.title} className="w-14 h-14 rounded-md object-cover flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{product.title}</p>
            {product.variant && <p className="text-xs text-muted-foreground">{product.variant}</p>}
            <p className="text-xs text-muted-foreground">Qtd: {product.quantity}</p>
          </div>
          <p className="font-semibold text-sm flex-shrink-0">R$ {(product.price * product.quantity).toFixed(2)}</p>
        </div>
      ))}
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
      <div className="text-center p-3 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground">⏰ Tempo para participar da roleta expirou</p>
        <p className="text-xs text-muted-foreground mt-1">Você ainda pode pagar normalmente</p>
      </div>
    );
  }

  return (
    <div className={`text-center p-4 rounded-lg border-2 ${isUrgent ? 'border-destructive bg-destructive/10 animate-pulse' : 'border-primary/30 bg-primary/5'}`}>
      <div className="flex items-center justify-center gap-2 mb-1">
        <Trophy className="h-5 w-5 text-yellow-500" />
        <span className="text-sm font-medium">Pague em até 10 min e concorra a prêmios!</span>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Clock className={`h-5 w-5 ${isUrgent ? 'text-destructive' : 'text-primary'}`} />
        <span className={`text-3xl font-bold font-mono ${isUrgent ? 'text-destructive' : 'text-primary'}`}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">Prêmios de até R$ 200,00 na roleta da live! 🎰</p>
    </div>
  );
}

// ── PIX Section ─────────────────────────────────────────────────
function PixPaymentSection({ orderId, amount, onPaymentConfirmed }: { orderId: string; amount: number; onPaymentConfirmed: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [cep, setCep] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pixPaid, setPixPaid] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          onPaymentConfirmed();
        }
      } catch {}
    };
    check();
    pollingRef.current = setInterval(check, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [pixPaymentId, pixPaid, orderId, onPaymentConfirmed]);

  const lookupCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setStreet(data.logradouro || "");
        setNeighborhood(data.bairro || "");
        setCity(data.localidade || "");
        setState(data.uf || "");
      }
    } catch {}
  };

  const handleGeneratePix = async () => {
    if (!firstName.trim() || !cpf.trim() || !email.trim()) {
      toast.error("Preencha nome, CPF e e-mail para continuar");
      return;
    }
    if (cpf.replace(/\D/g, "").length !== 11) {
      toast.error("CPF inválido");
      return;
    }
    setIsGenerating(true);
    try {
      const response = await supabase.functions.invoke("mercadopago-create-pix", {
        body: {
          orderId,
          payer: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            cpf: cpf.trim(),
            address: cep ? { zipCode: cep.trim(), street: street.trim(), number: number.trim(), neighborhood: neighborhood.trim(), city: city.trim(), state: state.trim() } : undefined,
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
      toast.error(msg.includes("CPF") ? "CPF inválido. Verifique e tente novamente." : "Erro ao gerar PIX. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyPix = async () => {
    if (!pixData?.qrCode) return;
    try {
      await navigator.clipboard.writeText(pixData.qrCode);
      setCopied(true);
      toast.success("Código PIX copiado!");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      window.prompt("Copie o código PIX:", pixData.qrCode);
    }
  };

  if (pixPaid) {
    return (
      <div className="text-center space-y-4 py-4">
        <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
        <h3 className="text-lg font-bold">PIX Confirmado!</h3>
        <p className="text-sm text-muted-foreground">Seu pagamento foi processado com sucesso.</p>
      </div>
    );
  }

  if (pixData) {
    return (
      <div className="space-y-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <QrCode className="h-4 w-4" /> Pague com PIX
        </h3>
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 p-3 bg-primary/10 rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-primary">Aguardando pagamento...</span>
          </div>
          {pixData.qrCodeBase64 && (
            <div className="flex justify-center">
              <img src={`data:image/png;base64,${pixData.qrCodeBase64}`} alt="QR Code PIX" className="w-48 h-48 rounded-lg border" />
            </div>
          )}
          <p className="text-sm text-muted-foreground">Escaneie o QR Code acima ou copie o código abaixo:</p>
          <div className="relative">
            <div className="p-3 bg-secondary/50 rounded-lg text-xs font-mono break-all max-h-20 overflow-y-auto">{pixData.qrCode}</div>
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={handleCopyPix}>
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Copiado!" : "Copiar código PIX"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Valor: <span className="font-bold text-foreground">R$ {pixData.amount}</span></p>
          {pixData.expirationDate && <p className="text-xs text-muted-foreground">Válido até: {new Date(pixData.expirationDate).toLocaleString("pt-BR")}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <QrCode className="h-4 w-4" /> Pagar com PIX
      </h3>
      <p className="text-xs text-muted-foreground">Preencha seus dados para gerar o QR Code PIX.</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pix-fn" className="text-sm">Nome *</Label>
            <Input id="pix-fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="João" />
          </div>
          <div>
            <Label htmlFor="pix-ln" className="text-sm">Sobrenome</Label>
            <Input id="pix-ln" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Silva" />
          </div>
        </div>
        <div>
          <Label htmlFor="pix-email" className="text-sm">E-mail *</Label>
          <Input id="pix-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joao@email.com" />
        </div>
        <div>
          <Label htmlFor="pix-cpf" className="text-sm">CPF *</Label>
          <Input id="pix-cpf" value={cpf} onChange={(e) => setCpf(formatCPF(e.target.value))} placeholder="000.000.000-00" maxLength={14} />
        </div>
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground mb-3">Endereço de entrega</p>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <Label htmlFor="pix-cep" className="text-sm">CEP</Label>
                <Input id="pix-cep" value={cep} onChange={(e) => { const v = formatCEP(e.target.value); setCep(v); lookupCep(v); }} placeholder="00000-000" maxLength={9} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="pix-st" className="text-sm">Rua</Label>
                <Input id="pix-st" value={street} onChange={(e) => setStreet(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="pix-num" className="text-sm">Número</Label>
                <Input id="pix-num" value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pix-nb" className="text-sm">Bairro</Label>
                <Input id="pix-nb" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pix-ct" className="text-sm">Cidade</Label>
                <Input id="pix-ct" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
            </div>
            <div className="w-20">
              <Label htmlFor="pix-uf" className="text-sm">UF</Label>
              <Input id="pix-uf" value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
            </div>
          </div>
        </div>
      </div>
      <Button onClick={handleGeneratePix} disabled={isGenerating} className="w-full h-14 text-lg font-semibold" size="lg">
        {isGenerating ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Gerando PIX...</> : <><QrCode className="h-5 w-5 mr-2" />Gerar PIX - R$ {amount.toFixed(2)}</>}
      </Button>
    </div>
  );
}

// ── Credit Card Section ─────────────────────────────────────────
function CreditCardSection({
  orderId,
  amount,
  products,
  installmentConfig,
  onPaymentConfirmed,
}: {
  orderId: string;
  amount: number;
  products: OrderProduct[];
  installmentConfig: InstallmentConfig;
  onPaymentConfirmed: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [installments, setInstallments] = useState("1");
  const [cep, setCep] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const lookupCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setStreet(data.logradouro || "");
        setNeighborhood(data.bairro || "");
        setCity(data.localidade || "");
        setState(data.uf || "");
      }
    } catch {}
  };

  // Build installment options
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
    // Validate
    if (!name.trim() || !email.trim() || !cpf.trim() || !phone.trim()) {
      toast.error("Preencha todos os dados pessoais");
      return;
    }
    if (cpf.replace(/\D/g, "").length !== 11) {
      toast.error("CPF inválido");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Telefone inválido. Mínimo 10 dígitos.");
      return;
    }
    if (!cardNumber.trim() || !cardName.trim() || !expiry.trim() || !cvv.trim()) {
      toast.error("Preencha todos os dados do cartão");
      return;
    }
    if (cardNumber.replace(/\D/g, "").length < 13) {
      toast.error("Número do cartão inválido");
      return;
    }
    if (!cep.trim() || !street.trim() || !number.trim() || !city.trim() || !state.trim()) {
      toast.error("Preencha o endereço de cobrança completo");
      return;
    }

    const expiryParts = expiry.split("/");
    if (expiryParts.length !== 2) {
      toast.error("Validade inválida. Use MM/AA");
      return;
    }

    setIsProcessing(true);
    try {
      const totalCents = Math.round(totalWithInterest * 100);

      const { data, error } = await supabase.functions.invoke("pagarme-create-charge", {
        body: {
          orderId,
          card: {
            number: cardNumber.replace(/\s/g, ""),
            holderName: cardName.trim(),
            expMonth: expiryParts[0],
            expYear: expiryParts[1].length === 2 ? `20${expiryParts[1]}` : expiryParts[1],
            cvv: cvv.trim(),
          },
          installments: selectedInstallments,
          customer: {
            name: name.trim(),
            email: email.trim(),
            cpf: cpf.trim(),
            phone: phone.trim(),
          },
          billingAddress: {
            street: street.trim(),
            number: number.trim(),
            neighborhood: neighborhood.trim(),
            city: city.trim(),
            state: state.trim(),
            zipCode: cep.trim(),
            country: "BR",
          },
          totalAmountCents: totalCents,
        },
      });

      if (error) throw new Error(typeof error === 'object' && error.message ? error.message : String(error));

      if (data?.success) {
        toast.success(`Pagamento aprovado via ${data.gateway === 'pagarme' ? 'Pagar.me' : 'APPMAX'}!`);
        onPaymentConfirmed();
      } else {
        throw new Error(data?.error || "Pagamento recusado. Verifique os dados do cartão.");
      }
    } catch (error) {
      console.error("Card payment error:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao processar pagamento.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <CreditCard className="h-4 w-4" /> Cartão de Crédito
      </h3>

      {/* Personal data */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground font-medium">Dados pessoais</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Nome completo *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="João Silva" />
          </div>
          <div>
            <Label className="text-sm">E-mail *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joao@email.com" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">CPF *</Label>
            <Input value={cpf} onChange={(e) => setCpf(formatCPF(e.target.value))} placeholder="000.000.000-00" maxLength={14} />
          </div>
          <div>
            <Label className="text-sm">Telefone *</Label>
            <Input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(11) 99999-9999" maxLength={15} />
          </div>
        </div>
      </div>

      {/* Card data */}
      <div className="space-y-3 pt-3 border-t">
        <p className="text-xs text-muted-foreground font-medium">Dados do cartão</p>
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

      {/* Installments */}
      <div className="space-y-2 pt-3 border-t">
        <Label className="text-sm">Parcelas</Label>
        <Select value={installments} onValueChange={setInstallments}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {installmentOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Billing address */}
      <div className="space-y-3 pt-3 border-t">
        <p className="text-xs text-muted-foreground font-medium">Endereço de cobrança</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <Label className="text-sm">CEP *</Label>
            <Input value={cep} onChange={(e) => { const v = formatCEP(e.target.value); setCep(v); lookupCep(v); }} placeholder="00000-000" maxLength={9} />
          </div>
          <div className="col-span-2">
            <Label className="text-sm">Rua *</Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-sm">Número *</Label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Bairro</Label>
            <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Cidade *</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>
        <div className="w-20">
          <Label className="text-sm">UF *</Label>
          <Input value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={isProcessing} className="w-full h-14 text-lg font-semibold" size="lg">
        {isProcessing ? (
          <><Loader2 className="h-5 w-5 animate-spin mr-2" />Processando...</>
        ) : (
          <><Lock className="h-5 w-5 mr-2" />Pagar R$ {totalWithInterest.toFixed(2)}</>
        )}
      </Button>
    </div>
  );
}

// ── Main Transparent Checkout ───────────────────────────────────
export default function TransparentCheckout() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "success">("pending");
  const [isEligibleForPrize, setIsEligibleForPrize] = useState(false);
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig>({
    max_installments: 12,
    interest_free_installments: 6,
    monthly_interest_rate: 2.49,
  });

  useEffect(() => {
    // Try live cart data from query params first
    const liveParam = searchParams.get("live");
    if (liveParam && !orderId) {
      try {
        const decoded = JSON.parse(decodeURIComponent(liveParam));
        const products: OrderProduct[] = decoded.items || [];
        const subtotal = products.reduce((s, p) => s + p.price * p.quantity, 0);
        const now = new Date().toISOString();
        setOrderData({
          id: `live-${Date.now()}`,
          customerName: decoded.customer?.name || "Cliente Live",
          products,
          subtotal,
          discountAmount: 0,
          totalAmount: Math.round(subtotal * 100) / 100,
          isPaid: false,
          checkoutStartedAt: now,
          freeShipping: false,
          shippingCost: 0,
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
      const totalAmount = Math.round(Math.max(0, subtotal - discountAmount) * 100) / 100;

      setOrderData({
        id: order.id,
        customerName: (order.customer as any)?.instagram_handle || "Cliente",
        products,
        subtotal,
        discountAmount,
        totalAmount,
        isPaid: order.is_paid,
        checkoutStartedAt: order.checkout_started_at,
        freeShipping: order.free_shipping || false,
        shippingCost: 0,
      });

      if (order.is_paid) {
        setPaymentStatus("success");
      } else if (!order.checkout_started_at) {
        const now = new Date().toISOString();
        await supabase.from("orders").update({ checkout_started_at: now }).eq("id", order.id);
        setOrderData((prev) => prev ? { ...prev, checkoutStartedAt: now } : prev);
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
        .from("app_settings")
        .select("value")
        .eq("key", "installment_config")
        .maybeSingle();
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

  const handlePaymentConfirmed = useCallback(() => {
    setPaymentStatus("success");
    if (orderData?.checkoutStartedAt) {
      const elapsed = (Date.now() - new Date(orderData.checkoutStartedAt).getTime()) / 1000;
      if (elapsed <= 600) {
        setIsEligibleForPrize(true);
        if (orderId) {
          supabase.from("orders").update({ eligible_for_prize: true }).eq("id", orderId);
        }
      }
    }
  }, [orderData?.checkoutStartedAt, orderId]);

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
              {orderData.products.length > 0 && (
                <div className="border-t pt-3 mt-3 space-y-2">
                  {orderData.products.map((product, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {product.image && <img src={product.image} alt={product.title} className="w-8 h-8 rounded object-cover" />}
                      <span className="truncate text-muted-foreground">{product.title}</span>
                      <span className="text-xs text-muted-foreground ml-auto">x{product.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {isEligibleForPrize && (
              <div className="p-4 bg-accent/50 border-2 border-primary/30 rounded-xl">
                <Trophy className="h-10 w-10 text-primary mx-auto mb-2" />
                <p className="font-bold text-lg">🎉 Parabéns!</p>
                <p className="text-sm text-muted-foreground">Você pagou dentro do prazo e está participando da <strong>Roleta de Prêmios</strong>!</p>
                <p className="text-xs text-muted-foreground mt-1">Prêmios de até R$ 200,00! Fique de olho na live! 🎰</p>
              </div>
            )}
            <div className="pt-2 space-y-2">
              <p className="text-xs text-muted-foreground">📦 Acompanhe a entrega pelo WhatsApp</p>
              <p className="text-xs text-muted-foreground">Qualquer dúvida, fale conosco!</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShoppingBag className="h-6 w-6 text-primary" />
            <CardTitle className="text-xl">Checkout</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Olá, {orderData.customerName}! Confira seu pedido abaixo.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <CountdownTimer checkoutStartedAt={orderData.checkoutStartedAt} />
          <ProductList products={orderData.products} />

          {/* Total */}
          <div className="border-t pt-4 space-y-1">
            {orderData.discountAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Desconto</span>
                <span className="text-primary font-medium">-R$ {orderData.discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-lg font-medium">Total</span>
              <span className="text-2xl font-bold text-primary">R$ {orderData.totalAmount.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment tabs */}
          <Tabs defaultValue="card" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="card" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> Cartão de Crédito
              </TabsTrigger>
              <TabsTrigger value="pix" className="flex items-center gap-2">
                <QrCode className="h-4 w-4" /> PIX
              </TabsTrigger>
            </TabsList>

            <TabsContent value="card" className="mt-4">
              <CreditCardSection
                orderId={orderData.id}
                amount={orderData.totalAmount}
                products={orderData.products}
                installmentConfig={installmentConfig}
                onPaymentConfirmed={handlePaymentConfirmed}
              />
            </TabsContent>

            <TabsContent value="pix" className="mt-4">
              <PixPaymentSection
                orderId={orderData.id}
                amount={orderData.totalAmount}
                onPaymentConfirmed={handlePaymentConfirmed}
              />
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>Pagamento processado com segurança</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

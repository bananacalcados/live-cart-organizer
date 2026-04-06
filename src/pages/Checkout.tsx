import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ShoppingBag, Lock, CreditCard, QrCode, Copy, Check, Clock, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface OrderProduct {
  title: string;
  variant: string;
  price: number;
  quantity: number;
  image?: string;
}

interface CheckoutData {
  paypalOrderId: string;
  paypalClientId: string;
  status: string;
  amount: number;
  currency: string;
  orderId: string;
  customerName: string;
  products: OrderProduct[];
}

interface PixData {
  qrCode: string;
  qrCodeBase64: string;
  amount: string;
  expirationDate: string;
}

declare global {
  interface Window {
    paypal?: {
      CardFields: (options: {
        createOrder: () => string;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError: (err: unknown) => void;
        style?: Record<string, unknown>;
      }) => {
        isEligible: () => boolean;
        NameField: () => { render: (selector: string) => Promise<void> };
        NumberField: () => { render: (selector: string) => Promise<void> };
        ExpiryField: () => { render: (selector: string) => Promise<void> };
        CVVField: () => { render: (selector: string) => Promise<void> };
        submit: () => Promise<void>;
      };
      Buttons: (options: {
        createOrder: () => string;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError: (err: unknown) => void;
        style?: Record<string, unknown>;
      }) => {
        render: (selector: string) => Promise<void>;
      };
    };
  }
}

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
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatCEP(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

// ─── Product List ──────────────────────────────────────────────
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

// ─── PIX Form + QR ─────────────────────────────────────────────
function PixPaymentSection({
  orderId,
  amount,
  onPaymentConfirmed,
}: {
  orderId: string;
  amount: number;
  onPaymentConfirmed: () => void;
}) {
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

  // Poll for PIX payment status
  useEffect(() => {
    if (!pixPaymentId || pixPaid) return;

    const checkStatus = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("mercadopago-check-payment", {
          body: { paymentId: pixPaymentId, orderId },
        });
        if (error) return;
        if (data?.status === "approved") {
          setPixPaid(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
          onPaymentConfirmed();
        }
      } catch {
        // ignore polling errors
      }
    };

    // Check immediately, then every 5 seconds
    checkStatus();
    pollingRef.current = setInterval(checkStatus, 5000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
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
    } catch {
      // ignore CEP lookup errors
    }
  };

   const handleGeneratePix = async () => {
     if (!firstName.trim()) {
       toast.error("Preencha o nome para continuar");
       return;
     }
     if (!email.trim() || !isValidEmail(email.trim())) {
       toast.error("E-mail inválido (ex: nome@email.com)");
       return;
     }
     if (!cpf.trim() || !isValidCPF(cpf)) {
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
            address: cep ? {
              zipCode: cep.trim(),
              street: street.trim(),
              number: number.trim(),
              neighborhood: neighborhood.trim(),
              city: city.trim(),
              state: state.trim(),
            } : undefined,
          },
        },
      });
      console.log("PIX response:", JSON.stringify(response));
      const data = response.data;
      const error = response.error;
      if (error) {
        console.error("PIX invoke error:", error);
        throw new Error(typeof error === 'object' && error.message ? error.message : String(error));
      }
      if (!data || !data.qrCode) {
        console.error("PIX data missing qrCode:", data);
        throw new Error("QR Code não retornado");
      }
      setPixData(data);
      if (data.paymentId) {
        setPixPaymentId(String(data.paymentId));
      }
    } catch (error) {
      console.error("PIX error:", error);
      const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
      if (errorMsg.includes("identification") || errorMsg.includes("CPF")) {
        toast.error("CPF inválido. Verifique e tente novamente.");
      } else {
        toast.error("Erro ao gerar PIX. Tente novamente.");
      }
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
          <QrCode className="h-4 w-4" />
          Pague com PIX
        </h3>
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 p-3 bg-primary/10 rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-primary">Aguardando pagamento...</span>
          </div>
          {pixData.qrCodeBase64 && (
            <div className="flex justify-center">
              <img
                src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                alt="QR Code PIX"
                className="w-48 h-48 rounded-lg border"
              />
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Escaneie o QR Code acima ou copie o código abaixo:
          </p>
          <div className="relative">
            <div className="p-3 bg-secondary/50 rounded-lg text-xs font-mono break-all max-h-20 overflow-y-auto">
              {pixData.qrCode}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              onClick={handleCopyPix}
            >
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Copiado!" : "Copiar código PIX"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Valor: <span className="font-bold text-foreground">R$ {pixData.amount}</span>
          </p>
          {pixData.expirationDate && (
            <p className="text-xs text-muted-foreground">
              Válido até: {new Date(pixData.expirationDate).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <QrCode className="h-4 w-4" />
        Pagar com PIX
      </h3>
      <p className="text-xs text-muted-foreground">Preencha seus dados para gerar o QR Code PIX.</p>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pix-firstName" className="text-sm">Nome *</Label>
            <Input id="pix-firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="João" />
          </div>
          <div>
            <Label htmlFor="pix-lastName" className="text-sm">Sobrenome</Label>
            <Input id="pix-lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Silva" />
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
             {/* CEP field - always visible */}
             <div className="max-w-[200px]">
               <Label htmlFor="pix-cep" className="text-sm">CEP</Label>
               <Input
                 id="pix-cep"
                 value={cep}
                 onChange={(e) => {
                   const v = formatCEP(e.target.value);
                   setCep(v);
                   lookupCep(v);
                 }}
                 placeholder="00000-000"
                 maxLength={9}
                 className="text-lg h-12"
               />
             </div>

             {/* Address fields - appear after CEP lookup */}
             {(() => {
               const cepDigits = cep.replace(/\D/g, "");
               const addressLoaded = cepDigits.length === 8 && (street.trim() || city.trim());
               if (!addressLoaded) return null;

               return (
                 <div className="animate-in slide-in-from-top-2 duration-200 space-y-3">
                   <div className="bg-secondary/40 rounded-lg p-3 border border-border">
                     <p className="text-xs text-muted-foreground mb-1">Endereço encontrado</p>
                     <p className="text-sm font-medium">
                       {street && `${street}, `}{neighborhood && `${neighborhood} - `}{city}/{state}
                     </p>
                   </div>

                   {/* Manual fields for generic CEPs */}
                   {(!street.trim() || !neighborhood.trim()) && (
                     <div className="space-y-3">
                       {!street.trim() && (
                         <div>
                           <Label htmlFor="pix-street" className="text-sm">Rua</Label>
                           <Input id="pix-street" value={street} onChange={(e) => setStreet(e.target.value)} />
                         </div>
                       )}
                       {!neighborhood.trim() && (
                         <div>
                           <Label htmlFor="pix-neighborhood" className="text-sm">Bairro</Label>
                           <Input id="pix-neighborhood" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
                         </div>
                       )}
                     </div>
                   )}

                   <div className="grid grid-cols-2 gap-3">
                     <div>
                       <Label htmlFor="pix-number" className="text-sm">Número</Label>
                       <Input id="pix-number" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
                     </div>
                   </div>
                 </div>
               );
             })()}
           </div>
         </div>
      </div>

      <Button onClick={handleGeneratePix} disabled={isGenerating} className="w-full h-14 text-lg font-semibold" size="lg">
        {isGenerating ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Gerando PIX...
          </>
        ) : (
          <>
            <QrCode className="h-5 w-5 mr-2" />
            Gerar PIX - R$ {amount.toFixed(2)}
          </>
        )}
      </Button>
    </div>
  );
}

// ─── Countdown Timer ───────────────────────────────────────────
function CountdownTimer({ checkoutStartedAt }: { checkoutStartedAt: string | null }) {
  const [timeLeft, setTimeLeft] = useState<number>(600); // 10 minutes in seconds

  useEffect(() => {
    if (!checkoutStartedAt) return;
    
    const startTime = new Date(checkoutStartedAt).getTime();
    const endTime = startTime + 10 * 60 * 1000; // 10 minutes
    
    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      setTimeLeft(remaining);
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [checkoutStartedAt]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isUrgent = timeLeft <= 120; // last 2 minutes
  const isExpired = timeLeft <= 0;

  if (isExpired) {
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
      <p className="text-xs text-muted-foreground mt-1">
        Prêmios de até R$ 200,00 na roleta da live! 🎰
      </p>
    </div>
  );
}

// ─── Main Checkout ─────────────────────────────────────────────
export default function Checkout() {
  const { paypalOrderId } = useParams<{ paypalOrderId: string }>();
  const [orderData, setOrderData] = useState<CheckoutData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "success" | "error">("pending");
  const [sdkReady, setSdkReady] = useState(false);
  const [cardFieldsEligible, setCardFieldsEligible] = useState(false);
  const [checkoutStartedAt, setCheckoutStartedAt] = useState<string | null>(null);
  const [isEligibleForPrize, setIsEligibleForPrize] = useState(false);
  const cardFieldsRef = useRef<ReturnType<NonNullable<Window["paypal"]>["CardFields"]> | null>(null);
  const sdkLoadedRef = useRef(false);
  const fieldsRenderedRef = useRef(false);

  useEffect(() => {
    if (!paypalOrderId) return;
    fetchOrderData();
  }, [paypalOrderId]);

  const fetchOrderData = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("paypal-get-order", {
        body: { paypalOrderId },
      });
      if (error) throw error;
      setOrderData(data);
      if (data.status === "captured") {
        setPaymentStatus("success");
      } else if (data.orderId) {
        // Mark checkout started
        markCheckoutStarted(data.orderId);
      }
    } catch (error) {
      console.error("Error fetching order:", error);
      toast.error("Pedido não encontrado");
    } finally {
      setIsLoading(false);
    }
  };

  const markCheckoutStarted = async (orderId: string) => {
    try {
      // Check if already started
      const { data: orderRow } = await supabase
        .from('orders')
        .select('checkout_started_at')
        .eq('id', orderId)
        .single();
      
      if (orderRow?.checkout_started_at) {
        setCheckoutStartedAt(orderRow.checkout_started_at);
      } else {
        const now = new Date().toISOString();
        await supabase
          .from('orders')
          .update({ checkout_started_at: now })
          .eq('id', orderId);
        setCheckoutStartedAt(now);
      }
    } catch (error) {
      console.error('Error marking checkout started:', error);
    }
  };

  const handleApprove = useCallback(async () => {
    if (!paypalOrderId) return;
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("paypal-webhook", {
        body: { paypalOrderId },
      });
      if (error) throw error;
      if (data.success) {
        setPaymentStatus("success");
        toast.success("Pagamento realizado com sucesso!");
        
        // Check if paid within 10 minutes
        if (checkoutStartedAt && orderData?.orderId) {
          const startTime = new Date(checkoutStartedAt).getTime();
          const now = Date.now();
          const elapsed = (now - startTime) / 1000;
          if (elapsed <= 600) { // 10 minutes
            setIsEligibleForPrize(true);
            await supabase
              .from('orders')
              .update({ eligible_for_prize: true })
              .eq('id', orderData.orderId);
          }
        }
      } else {
        throw new Error("Capture failed");
      }
    } catch (error) {
      console.error("Payment error:", error);
      setPaymentStatus("error");
      toast.error("Erro ao processar pagamento.");
    } finally {
      setIsProcessing(false);
    }
  }, [paypalOrderId, checkoutStartedAt, orderData?.orderId]);

  // Store handleApprove in a ref to avoid re-creating PayPal components
  const handleApproveRef = useRef(handleApprove);
  useEffect(() => { handleApproveRef.current = handleApprove; }, [handleApprove]);

  // Load PayPal SDK - only once
  useEffect(() => {
    if (!orderData || !orderData.paypalClientId || !orderData.paypalOrderId || paymentStatus === "success" || sdkLoadedRef.current) return;
    sdkLoadedRef.current = true;

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${orderData.paypalClientId}&currency=BRL&components=buttons,card-fields&intent=capture`;
    script.async = true;
    script.onload = () => setSdkReady(true);
    script.onerror = () => {
      toast.error("Erro ao carregar PayPal SDK");
      sdkLoadedRef.current = false;
    };
    document.body.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderData?.paypalClientId, paymentStatus]);

  // Render card fields + PayPal button - only once after SDK loads
  useEffect(() => {
    if (!sdkReady || !window.paypal || !orderData || paymentStatus === "success" || fieldsRenderedRef.current) return;
    fieldsRenderedRef.current = true;

    try {
      const cardFields = window.paypal.CardFields({
        createOrder: () => orderData.paypalOrderId,
        onApprove: async () => { await handleApproveRef.current(); },
        onError: (err) => {
          console.error("PayPal CardFields error:", err);
          toast.error("Erro no processamento do cartão.");
          setIsProcessing(false);
        },
        style: {
          input: { "font-size": "16px", "font-family": "system-ui, sans-serif", color: "#333", padding: "12px" },
          ".invalid": { color: "#dc2626" },
        },
      });

      if (cardFields.isEligible()) {
        setCardFieldsEligible(true);
        cardFieldsRef.current = cardFields;
        // Delay render slightly to ensure DOM containers exist
        setTimeout(() => {
          cardFields.NameField().render("#card-name-field").catch(console.error);
          cardFields.NumberField().render("#card-number-field").catch(console.error);
          cardFields.ExpiryField().render("#card-expiry-field").catch(console.error);
          cardFields.CVVField().render("#card-cvv-field").catch(console.error);
        }, 100);
      } else {
        console.log("PayPal CardFields not eligible, showing PayPal buttons only");
      }

      window.paypal.Buttons({
        createOrder: () => orderData.paypalOrderId,
        onApprove: async () => { await handleApproveRef.current(); },
        onError: (err) => {
          console.error("PayPal Buttons error:", err);
          toast.error("Erro no PayPal.");
        },
        style: { layout: "vertical", color: "gold", shape: "rect", label: "pay", height: 48 } as Record<string, unknown>,
      }).render("#paypal-button-container");
    } catch (err) {
      console.error("Error rendering PayPal components:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady]);

  const handleCardSubmit = async () => {
    if (!cardFieldsRef.current) return;
    setIsProcessing(true);
    try {
      await cardFieldsRef.current.submit();
    } catch (err) {
      console.error("Card submit error:", err);
      toast.error("Erro ao processar cartão. Verifique os dados.");
      setIsProcessing(false);
    }
  };

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
              <p className="text-sm text-muted-foreground">
                Seu pedido foi confirmado e está sendo preparado com carinho.
              </p>
            </div>
            
            <div className="p-4 bg-secondary/50 rounded-xl space-y-3">
              <p className="text-sm text-muted-foreground">Valor pago</p>
              <p className="text-3xl font-bold text-primary">R$ {Number(orderData.amount).toFixed(2)}</p>
              
              {orderData.products.length > 0 && (
                <div className="border-t pt-3 mt-3 space-y-2">
                  {orderData.products.map((product, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {product.image && (
                        <img src={product.image} alt={product.title} className="w-8 h-8 rounded object-cover" />
                      )}
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
                <p className="text-sm text-muted-foreground">
                  Você pagou dentro do prazo e está participando da <strong>Roleta de Prêmios</strong>!
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Prêmios de até R$ 200,00! Fique de olho na live! 🎰
                </p>
              </div>
            )}

            <div className="pt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                📦 Acompanhe a entrega pelo WhatsApp
              </p>
              <p className="text-xs text-muted-foreground">
                Qualquer dúvida, fale conosco!
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {/* Full-screen processing overlay */}
      {isProcessing && (
        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" style={{ pointerEvents: 'all' }}>
          <div className="bg-card rounded-2xl border-2 border-amber-400 shadow-2xl p-8 max-w-sm w-full text-center space-y-4 animate-in fade-in zoom-in-95 duration-300">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
            <h3 className="font-bold text-lg">Processando pagamento...</h3>
            <p className="text-sm text-muted-foreground">
              Estamos verificando com a operadora do seu cartão.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              ⚠️ Não feche nem recarregue esta página.
            </p>
          </div>
        </div>
      )}
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
          {/* Countdown Timer */}
          <CountdownTimer checkoutStartedAt={checkoutStartedAt} />

          <ProductList products={orderData.products} />

          {/* Total */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-medium">Total</span>
              <span className="text-2xl font-bold text-primary">R$ {Number(orderData.amount).toFixed(2)}</span>
            </div>
          </div>

          {/* Payment Methods Tabs */}
          <Tabs defaultValue="pix" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pix" className="flex items-center gap-2">
                <QrCode className="h-4 w-4" />
                PIX
              </TabsTrigger>
              <TabsTrigger value="card" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Cartão / PayPal
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pix" className="mt-4">
              <PixPaymentSection orderId={orderData.orderId} amount={Number(orderData.amount)} onPaymentConfirmed={() => {
                setPaymentStatus("success");
                toast.success("Pagamento PIX confirmado!");
                // Check prize eligibility
                if (checkoutStartedAt && orderData?.orderId) {
                  const startTime = new Date(checkoutStartedAt).getTime();
                  const elapsed = (Date.now() - startTime) / 1000;
                  if (elapsed <= 600) {
                    setIsEligibleForPrize(true);
                    supabase.from('orders').update({ eligible_for_prize: true }).eq('id', orderData.orderId);
                  }
                }
              }} />
            </TabsContent>

            <TabsContent value="card" forceMount className="mt-4 space-y-4 data-[state=inactive]:hidden">
              {/* Card Fields - always render containers so PayPal SDK can mount */}
              <div className={cardFieldsEligible ? "space-y-4" : "hidden"}>
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Cartão de Crédito ou Débito
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block text-foreground">Nome no cartão</label>
                    <div id="card-name-field" className="border rounded-md bg-background min-h-[44px]" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block text-foreground">Número do cartão</label>
                    <div id="card-number-field" className="border rounded-md bg-background min-h-[44px]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block text-foreground">Validade</label>
                      <div id="card-expiry-field" className="border rounded-md bg-background min-h-[44px]" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block text-foreground">CVV</label>
                      <div id="card-cvv-field" className="border rounded-md bg-background min-h-[44px]" />
                    </div>
                  </div>
                </div>

                <Button onClick={handleCardSubmit} disabled={isProcessing} className="w-full h-14 text-lg font-semibold" size="lg">
                  {isProcessing ? (
                    <><Loader2 className="h-5 w-5 animate-spin mr-2" />Processando...</>
                  ) : (
                    <><Lock className="h-5 w-5 mr-2" />Pagar R$ {Number(orderData.amount).toFixed(2)}</>
                  )}
                </Button>

                <div className="relative py-3">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">ou pague com</span>
                  </div>
                </div>
              </div>

              {/* PayPal Button */}
              <div id="paypal-button-container" className="min-h-[48px]" />

              {/* Loading SDK indicator */}
              {!sdkReady && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Carregando métodos de pagamento...</p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {paymentStatus === "error" && (
            <div className="text-center p-3 bg-destructive/10 rounded-lg">
              <p className="text-sm text-destructive">Houve um erro ao processar o pagamento. Por favor, tente novamente.</p>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>Pagamento processado com segurança</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

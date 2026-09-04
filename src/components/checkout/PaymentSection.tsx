// ── Etapa 3 do Checkout Transparente (extraída para reuso) ──────────────
// Este arquivo contém EXATAMENTE a mesma lógica de pagamento usada no
// checkout transparente (/checkout/:orderId). É reutilizado também pela
// Área de Membros (/minha-area) para pagar sem redirecionar.
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cpGetAttemptStatus, cpUpsertRegistration } from "@/lib/checkoutPublic";
import { trackPixelEvent } from "@/lib/metaPixel";
import { initMercadoPago, tokenizeCardMP, getCardCapabilities, type CardCapabilities, type CardMode } from "@/lib/mercadopago";
import { Loader2, CheckCircle2, XCircle, Lock, QrCode, Copy, Check, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export interface OrderProduct {
  title: string;
  variant?: string;
  price: number;
  quantity: number;
  image?: string;
}

export interface PixData {
  qrCode: string;
  qrCodeBase64: string;
  amount: string;
  expirationDate: string;
}

export interface InstallmentConfig {
  max_installments: number;
  interest_free_installments: number;
  monthly_interest_rate: number;
}

export interface CustomerFormData {
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

export function stripDDI(digits: string): string {
  // Remove Brazilian country code (55) if present, keeping only DDD+number
  if (digits.length >= 12 && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

export function formatCardNumber(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 16);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatExpiry(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

export function calculateInstallmentAmount(total: number, installments: number, config: InstallmentConfig) {
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

export function StepPayment({
  orderId,
  amount,
  products,
  form,
  installmentConfig,
  onPaymentConfirmed,
  onBack,
  onProcessingChange,
  backLabel,
  stepBadge = "3 de 3",
  prizeAppliedCents = 0,
  onStepEvent,
}: {
  orderId: string;
  amount: number;
  products: OrderProduct[];
  form: CustomerFormData;
  installmentConfig: InstallmentConfig;
  onPaymentConfirmed: (info?: { platform: string; method: string; customerData?: any }) => void;
  onBack?: () => void;
  onProcessingChange?: (processing: boolean) => void;
  backLabel?: string;
  stepBadge?: string | null;
  /** Prêmio da roleta (em centavos) já abatido no total exibido — evita abater 2x no servidor. */
  prizeAppliedCents?: number;
  /** Auditoria opcional dos passos de pagamento (abriu PIX, enviou cartão, recusado...). */
  onStepEvent?: (event: string, data?: Record<string, unknown>) => void;
}) {

   const [selectedMethod, setSelectedMethod] = useState<"pix" | "card" | "debit" | null>(null);
   const [showAllMethods, setShowAllMethods] = useState(true);
  const [pixDiscountPercent, setPixDiscountPercent] = useState(0);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "pix_discount_percent")
      .single()
      .then(({ data }) => {
        if (data?.value) setPixDiscountPercent(parseFloat(String(data.value)) || 0);
      });
  }, []);

  const pixDiscountAmount = pixDiscountPercent > 0 ? amount * (pixDiscountPercent / 100) : 0;
  const pixAmount = Math.round((amount - pixDiscountAmount) * 100) / 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-lg">Pagamento</h2>
        {stepBadge && <Badge variant="secondary" className="text-[10px]">{stepBadge}</Badge>}
      </div>

       <div className="space-y-2">
         {/* Cartão de crédito */}
         {(showAllMethods || selectedMethod === "card") && (
           <>
             <button
               onClick={() => { setSelectedMethod("card"); setShowAllMethods(false); onStepEvent?.("opened_card", { method: "credit_card" }); }}
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
                <CardPaymentForm
                    orderId={orderId}
                    amount={amount}
                    prizeAppliedCents={prizeAppliedCents}
                    products={products}
                    form={form}
                    installmentConfig={installmentConfig}
                    onPaymentConfirmed={onPaymentConfirmed}
                    onStepEvent={onStepEvent}
                    onProcessingChange={onProcessingChange}
                    mode="credit"
                    onSwitchMode={(m) => { setSelectedMethod(m === "debit" ? "debit" : "card"); setShowAllMethods(false); }}
                  />
               </div>
             )}
           </>
         )}

         {/* Cartão de débito */}
         {(showAllMethods || selectedMethod === "debit") && (
           <>
             <button
               onClick={() => { setSelectedMethod("debit"); setShowAllMethods(false); onStepEvent?.("opened_debit", { method: "debit_card" }); }}
               className={`w-full flex items-center justify-between p-3.5 rounded-lg border transition-all text-left ${
                 selectedMethod === "debit"
                   ? "border-foreground bg-card shadow-sm"
                   : "border-border bg-card hover:border-muted-foreground"
               }`}
             >
               <div className="flex items-center gap-3">
                 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                   selectedMethod === "debit" ? "border-foreground" : "border-muted-foreground"
                 }`}>
                   {selectedMethod === "debit" && <div className="w-2.5 h-2.5 rounded-full bg-foreground" />}
                 </div>
                 <span className="text-sm font-semibold">Cartão de débito</span>
               </div>
               <span className="text-[10px] text-muted-foreground font-medium">à vista</span>
             </button>

             {selectedMethod === "debit" && (
               <div className="animate-in slide-in-from-top-2 duration-200 border border-border rounded-lg p-4 bg-card">
                 <CardPaymentForm
                   orderId={orderId}
                   amount={amount}
                   prizeAppliedCents={prizeAppliedCents}
                   products={products}
                   form={form}
                   installmentConfig={installmentConfig}
                   onPaymentConfirmed={onPaymentConfirmed}
                   onStepEvent={onStepEvent}
                   onProcessingChange={onProcessingChange}
                   mode="debit"
                   onSwitchMode={(m) => { setSelectedMethod(m === "debit" ? "debit" : "card"); setShowAllMethods(false); }}
                 />
               </div>
             )}
           </>
         )}

         {/* PIX */}
         {(showAllMethods || selectedMethod === "pix") && (
           <>
             <button
               onClick={() => { setSelectedMethod("pix"); setShowAllMethods(false); onStepEvent?.("opened_pix", { method: "pix" }); }}
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
                   <div className="mb-3">
                     <p className="text-sm text-muted-foreground">A confirmação de pagamento é realizada em poucos minutos. Utilize o aplicativo do seu banco para pagar.</p>
                     <p className="text-base font-bold text-green-600 mt-2">
                       Valor no Pix: R$ {pixAmount.toFixed(2).replace(".", ",")}
                     </p>
                   </div>
                 )}
                 <PixPaymentForm
                   orderId={orderId}
                   amount={pixAmount}
                   pixDiscountPercent={pixDiscountPercent}
                   form={form}
                   onPaymentConfirmed={onPaymentConfirmed}
                   onStepEvent={onStepEvent}
                 />
               </div>
             )}
           </>
         )}

         {/* Botão para trocar forma de pagamento */}
         {selectedMethod && !showAllMethods && (
           <button
             type="button"
             onClick={() => setShowAllMethods(true)}
             className="w-full mt-2 rounded-xl border-2 border-primary bg-primary/10 text-primary text-base sm:text-lg font-bold py-3.5 sm:py-4 px-4 shadow-sm hover:bg-primary/20 active:scale-[0.99] transition-all"
           >
             Alterar forma de pagamento
           </button>
         )}
       </div>

      {onBack && (
        <Button variant="ghost" onClick={onBack} className="w-full text-sm text-muted-foreground">
          {backLabel || "← Voltar para Entrega"}
        </Button>
      )}
    </div>
  );
}

// ── PIX Payment Form (step 3) ───────────────────────────────────
function PixPaymentForm({ orderId, amount, pixDiscountPercent = 0, form, onPaymentConfirmed, onStepEvent }: { orderId: string; amount: number; pixDiscountPercent?: number; form: CustomerFormData; onPaymentConfirmed: (info?: { platform: string; method: string; customerData?: any }) => void; onStepEvent?: (event: string, data?: Record<string, unknown>) => void }) {
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
    phone: stripDDI(form.whatsapp.replace(/\D/g, "")),
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
    onStepEvent?.("pix_requested", { method: "pix", amount });
    setIsGenerating(true);
    trackPixelEvent("AddPaymentInfo", { content_category: "pix" });

    // Save customer registration early
    if (orderId && !orderId.startsWith("live-")) {
      try {
        await cpUpsertRegistration({
          order_id: orderId,
          full_name: form.fullName,
          email: form.email,
          cpf: form.cpf.replace(/\D/g, ""),
          whatsapp: stripDDI(form.whatsapp.replace(/\D/g, "")),
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
          pixDiscountPercent,
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
      if (response.error) {
        // Tenta extrair mensagem detalhada (estoque insuficiente, CPF, etc.)
        let detailedMsg = "";
        try {
          const ctx: any = (response.error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error === "stock_unavailable") {
              detailedMsg = body.message || "Alguns itens estão sem estoque.";
            } else if (body?.message) {
              detailedMsg = body.message;
            } else if (body?.error) {
              detailedMsg = body.error;
            }
          }
        } catch {}
        if (!detailedMsg) {
          detailedMsg = typeof response.error === 'object' && response.error.message
            ? response.error.message
            : String(response.error);
        }
        throw new Error(detailedMsg);
      }
      if (!data?.qrCode) throw new Error("QR Code não retornado");
      setPixData(data);
      onStepEvent?.("pix_generated", { method: "pix", gateway: "mercadopago", amount, paymentId: data?.paymentId ?? null });
      if (data.paymentId) setPixPaymentId(String(data.paymentId));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      onStepEvent?.("pix_error", { method: "pix", gateway: "mercadopago", amount, detail: msg });
      if (msg.toLowerCase().includes("estoque") || msg.toLowerCase().includes("sem estoque")) {
        toast.error(msg, { duration: 8000 });
      } else if (msg.includes("CPF")) {
        toast.error("CPF inválido.");
      } else {
        toast.error("Erro ao gerar PIX.");
      }
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
            try { await navigator.clipboard.writeText(pixData.qrCode.trim()); setCopied(true); toast.success("Copiado!"); setTimeout(() => setCopied(false), 3000); } catch { window.prompt("Copie:", pixData.qrCode.trim()); }
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

// ── Card Payment Form (step 3) — crédito e débito ───────────────
function CardPaymentForm({
  orderId, amount, products, form, installmentConfig, onPaymentConfirmed, onProcessingChange,
  mode = "credit", onSwitchMode, prizeAppliedCents = 0, onStepEvent,
}: {
  orderId: string; amount: number; products: OrderProduct[]; form: CustomerFormData;
  installmentConfig: InstallmentConfig; onPaymentConfirmed: (info?: { platform: string; method: string; customerData?: any }) => void;
  onProcessingChange?: (processing: boolean) => void;
  mode?: CardMode;
  onSwitchMode?: (mode: CardMode) => void;
  prizeAppliedCents?: number;
  onStepEvent?: (event: string, data?: Record<string, unknown>) => void;
}) {
  const isDebit = mode === "debit";
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [installments, setInstallments] = useState("1");
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const processingRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);
  const cardNameRef = useRef<HTMLInputElement>(null);
  const cardNumberRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const cvvRef = useRef<HTMLInputElement>(null);

  // ── Validação visível dos campos do cartão ────────────────────────────
  const isCardNameValid = cardName.trim().length >= 2;
  const isCardNumberValid = cardNumber.replace(/\D/g, "").length >= 13;
  const expiryDigits = expiry.replace(/\D/g, "");
  const isExpiryValid =
    expiryDigits.length === 4 && Number(expiryDigits.slice(0, 2)) >= 1 && Number(expiryDigits.slice(0, 2)) <= 12;
  const isCvvValid = cvv.replace(/\D/g, "").length >= 3;
  const missingFields = [
    !isCardNameValid && "nome no cartão",
    !isCardNumberValid && "número do cartão",
    !isExpiryValid && "validade",
    !isCvvValid && "CVV",
  ].filter(Boolean) as string[];
  const formComplete = missingFields.length === 0;
  const errClass = (ok: boolean) =>
    !ok && showFieldErrors ? "border-destructive focus-visible:ring-destructive" : "";

  // Propagate processing state to parent for full-screen overlay
  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  // Pré-carrega o SDK do Mercado Pago (gera device_id antecipadamente). Tolerante a falha.
  useEffect(() => {
    initMercadoPago().catch(() => {});
  }, []);


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
        const { data: statusRaw } = await supabase.rpc("get_order_status", { p_order_id: orderId });
        const freshOrder = statusRaw as any;
        if (freshOrder?.is_paid) {
          sessionStorage.removeItem(`checkout_payment_${orderId}`);
          onPaymentConfirmed({ platform: "gateway", method: isDebit ? "debit_card" : "credit_card", customerData: buildCustomerData() });
          return;
        }
        // Check if attempt finished (failed)
        const attempt = await cpGetAttemptStatus(attemptId);
        if (attempt && attempt.status === "failed") {
          sessionStorage.removeItem(`checkout_payment_${orderId}`);
          setPaymentError((attempt as any).error_message || "A operadora do seu cartão não aprovou a compra. Revise os dados ou tente com outro cartão.");
          setIsProcessing(false);
          processingRef.current = false;
          return;
        }
        if (attempt && attempt.status === "success") {
          sessionStorage.removeItem(`checkout_payment_${orderId}`);
          onPaymentConfirmed({ platform: "gateway", method: isDebit ? "debit_card" : "credit_card", customerData: buildCustomerData() });
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
    name: form.fullName, email: form.email, cpf: form.cpf.replace(/\D/g, ""), phone: stripDDI(form.whatsapp.replace(/\D/g, "")),
    address: { street: form.address, number: form.addressNumber, neighborhood: form.neighborhood, city: form.city, state: form.state, cep: form.cep.replace(/\D/g, "") },
  });

  // ── Condições REAIS de parcelamento do Mercado Pago (gateway #1) ──
  // O MP só absorve juros até onde a conta estiver configurada. Se pedirmos 10x
  // e a conta só cobre 6x, o MP financia e cobra juros do cliente. Aqui buscamos
  // as condições reais (por BIN do cartão) para nunca anunciar "sem juros" mentiroso.
  const [mpOptions, setMpOptions] = useState<Array<{
    installments: number; installmentAmount: number; totalAmount: number; interestFree: boolean;
  }> | null>(null);
  const cardBin = cardNumber.replace(/\D/g, "").slice(0, 8);

  // ── Capacidades reais do cartão (BIN) — roda em silêncio, só para validar ──
  const [cardCaps, setCardCaps] = useState<CardCapabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (cardBin.length < 6) { setCardCaps(null); return; }
    const t = setTimeout(async () => {
      const caps = await getCardCapabilities(cardBin);
      if (!cancelled) setCardCaps(caps);
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cardBin]);

  // Divergência entre a função escolhida e o que o cartão realmente oferece.
  const mismatch: CardMode | null = (() => {
    if (!cardCaps) return null;
    if (!isDebit && !cardCaps.hasCredit && cardCaps.hasDebit) return "debit";
    if (isDebit && !cardCaps.hasDebit && cardCaps.hasCredit) return "credit";
    return null;
  })();

  useEffect(() => {
    if (isDebit || !amount || amount <= 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("mercadopago-installments", {
          body: { amount, bin: cardBin.length >= 6 ? cardBin : undefined, paymentMethodId: "visa" },
        });
        if (cancelled || error || !data?.options?.length) return;
        setMpOptions(data.options);
      } catch { /* mantém fallback local */ }
    }, cardBin.length >= 6 ? 400 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [amount, isDebit, cardBin.length >= 6 ? cardBin : ""]);

  const installmentOptions = [];
  for (let i = 1; i <= installmentConfig.max_installments; i++) {
    const mp = mpOptions?.find((o) => o.installments === i);
    if (mpOptions && !mp) continue; // parcela não oferecida pelo emissor
    const calc = calculateInstallmentAmount(amount, i, installmentConfig);
    const value = mp ? mp.installmentAmount : calc.installmentValue;
    const total = mp ? mp.totalAmount : calc.totalWithInterest;
    const hasInterest = mp ? !mp.interestFree : calc.hasInterest;
    const label = i === 1
      ? `1x de R$ ${amount.toFixed(2)} (à vista)`
      : `${i}x de R$ ${value.toFixed(2)}${hasInterest ? ` (total R$ ${total.toFixed(2)} com juros)` : " sem juros"}`;
    installmentOptions.push({ value: String(i), label });
  }

  const selectedInstallments = isDebit ? 1 : parseInt(installments);
  const selectedMp = mpOptions?.find((o) => o.installments === selectedInstallments);
  // Valor enviado ao gateway = SEMPRE o total do pedido. Quando o parcelamento tem
  // juros, quem soma os juros é o próprio gateway (não podemos inflar o valor,
  // senão o cliente pagaria juros em cima de juros).
  const { totalWithInterest } = calculateInstallmentAmount(amount, selectedInstallments, installmentConfig);
  const chargeAmount = isDebit ? amount : (selectedMp ? amount : totalWithInterest);
  // Valor EXIBIDO no botão = o que o cliente realmente paga. Quando o Mercado Pago
  // devolve as condições reais (ex.: 10x sem juros), o total é o do MP — nunca o
  // total inflado pela tabela de juros local, senão o botão mostra valor errado.
  const displayTotal = isDebit ? amount : (selectedMp ? selectedMp.totalAmount : totalWithInterest);


  const handleSubmit = async () => {
    // Registra SEMPRE o clique, antes de qualquer validação — é isso que revela
    // a cliente que "clicou em Pagar" com o cartão em branco.
    onStepEvent?.("card_pay_clicked", {
      method: isDebit ? "debit_card" : "credit_card",
      amount,
      detail: missingFields.length ? `faltando: ${missingFields.join(", ")}` : "campos completos",
    });

    // Prevent double-click with ref (synchronous check)
    if (processingRef.current) return;

    if (missingFields.length) {
      setShowFieldErrors(true);
      setPaymentError(null);
      const firstInvalid = [
        [!cardName.trim(), cardNameRef],
        [!isCardNumberValid, cardNumberRef],
        [!isExpiryValid, expiryRef],
        [!isCvvValid, cvvRef],
      ].find(([bad]) => bad)?.[1] as React.RefObject<HTMLInputElement> | undefined;
      firstInvalid?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalid?.current?.focus({ preventScroll: true });
      return;
    }
    const expiryParts = expiry.split("/");
    if (expiryParts.length !== 2) {
      setShowFieldErrors(true);
      expiryRef.current?.focus();
      return;
    }


    // Lock immediately
    processingRef.current = true;
    onStepEvent?.("card_submitted", { method: isDebit ? "debit_card" : "credit_card", amount, installments: isDebit ? 1 : Number(installments) });
    setIsProcessing(true);
    setPaymentError(null);

    // Generate attempt ID and persist to sessionStorage
    const attemptId = crypto.randomUUID();
    attemptIdRef.current = attemptId;
    sessionStorage.setItem(`checkout_payment_${orderId}`, attemptId);

    trackPixelEvent("AddPaymentInfo", { content_category: isDebit ? "debit_card" : "credit_card" });
    try {
      const totalCents = Math.round(chargeAmount * 100);
      const baseCents = Math.round(amount * 100);


      // Tokeniza no navegador via MercadoPago.JS V2 (gateway #1). Se falhar, segue no Pagar.me.
      // Teto de 25s: com internet ruim a validação pode ficar girando pra sempre.
      const mpToken = await Promise.race([
        tokenizeCardMP({
          number: cardNumber.replace(/\D/g, ""),
          holderName: cardName.trim(),
          expMonth: expiryParts[0].padStart(2, "0"),
          expYear: expiryParts[1].length === 2 ? `20${expiryParts[1]}` : expiryParts[1],
          cvv: cvv.trim(),
          cpf: form.cpf.replace(/\D/g, ""),
        }, mode),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 25000)),
      ]);

      // Débito só roda pelo Mercado Pago — sem token não há como cobrar.
      if (isDebit && !mpToken) {
        sessionStorage.removeItem(`checkout_payment_${orderId}`);
        processingRef.current = false;
        setIsProcessing(false);
        onStepEvent?.("card_validation_timeout", { method: "debit_card", amount });
        setPaymentError("Não conseguimos conectar para validar seu cartão. Confira a internet e tente de novo, ou pague no Pix.");
        return;
      }

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
          // Campos Mercado Pago (presentes só quando o SDK tokenizou com sucesso)
          ...(mpToken ? {
            mpCardToken: mpToken.mpCardToken,
            mpPaymentMethodId: mpToken.mpPaymentMethodId,
            mpPaymentTypeId: mpToken.mpPaymentTypeId,
            mpIssuerId: mpToken.mpIssuerId,
            mpDeviceId: mpToken.mpDeviceId,
          } : {}),
          paymentMode: mode,
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
          baseAmountCents: baseCents,
          prizeAppliedCents,

        },
      });


      if (error) {
        // Tenta extrair mensagem detalhada (estoque insuficiente, etc.)
        let detailedMsg = "";
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error === "stock_unavailable") {
              detailedMsg = body.message || "Alguns itens estão sem estoque.";
              sessionStorage.removeItem(`checkout_payment_${orderId}`);
              processingRef.current = false;
              setIsProcessing(false);
              setPaymentError(detailedMsg);
              toast.error(detailedMsg, { duration: 8000 });
              return;
            }
            if (body?.message) detailedMsg = body.message;
            else if (body?.error) detailedMsg = body.error;
          }
        } catch {}
        if (!detailedMsg) {
          detailedMsg = typeof error === 'object' && error.message ? error.message : String(error);
        }
        throw new Error(detailedMsg);
      }

      if (data?.already_paid) {
        sessionStorage.removeItem(`checkout_payment_${orderId}`);
        toast.success("Pagamento já confirmado!");
        onPaymentConfirmed({ platform: "cached", method: isDebit ? "debit_card" : "credit_card", customerData: buildCustomerData() });
        return;
      }

      if (data?.already_processing) {
        // Another request is already running — poll for result
        pollPaymentResult(attemptId);
        return;
      }

      // 3DS (débito): o banco exige autenticação. Abrimos o desafio e ficamos no polling.
      if (data?.threeDsUrl) {
        onStepEvent?.("card_3ds_challenge", { method: isDebit ? "debit_card" : "credit_card", amount });
        window.open(data.threeDsUrl, "_blank", "noopener");
        toast.info("Conclua a autenticação do seu banco para finalizar o pagamento.");
        pollPaymentResult(attemptId);
        return;
      }

      if (data?.success) {
        sessionStorage.removeItem(`checkout_payment_${orderId}`);
        onStepEvent?.("card_approved", { method: isDebit ? "debit_card" : "credit_card", amount, gateway: data.gateway || null });
        toast.success(`Pagamento aprovado via ${data.gateway === 'mercadopago' ? 'Mercado Pago' : data.gateway === 'pagarme' ? 'Pagar.me' : data.gateway === 'vindi' ? 'VINDI' : 'APPMAX'}!`);
        onPaymentConfirmed({ platform: data.gateway || "pagarme", method: isDebit ? "debit_card" : "credit_card", customerData: buildCustomerData() });
      } else {
        throw new Error(data?.error || "Pagamento recusado.");
      }
    } catch (error) {
      // On timeout/error, poll backend to check if payment was approved by fallback gateway
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const { data: statusRaw } = await supabase
            .rpc("get_order_status", { p_order_id: orderId });
          const freshOrder = statusRaw as any;
          if (freshOrder?.is_paid) {
            sessionStorage.removeItem(`checkout_payment_${orderId}`);
            toast.success("Pagamento aprovado!");
            onPaymentConfirmed({ platform: "appmax", method: isDebit ? "debit_card" : "credit_card", customerData: buildCustomerData() });
            return;
          }
        } catch (_) { /* ignore poll error */ }
      }
      // All gateways declined — show friendly error and release form
      sessionStorage.removeItem(`checkout_payment_${orderId}`);
      const errMsg = error instanceof Error ? error.message : "Erro ao processar pagamento.";
      onStepEvent?.("card_failed", { method: isDebit ? "debit_card" : "credit_card", amount, detail: errMsg });
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
            Estamos verificando com a operadora do seu cartão de {isDebit ? "débito" : "crédito"}.
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
              <p className="text-xs text-muted-foreground mt-2">{paymentError?.includes("sandbox") ? "Teste do Mercado Pago falhou; confira os dados oficiais de teste." : "Revise os dados ou tente com outro cartão."}</p>
            </div>
          </div>
        </div>
      )}

      {showFieldErrors && !formComplete && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <XCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">Falta preencher os dados do cartão</p>
              <p className="text-xs text-destructive/80 mt-1">
                O pagamento ainda NÃO foi feito. Preencha: {missingFields.join(", ")}.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <Label className="text-sm">Nome no cartão *</Label>
          <Input ref={cardNameRef} className={errClass(isCardNameValid)} value={cardName} onChange={(e) => setCardName(e.target.value.toUpperCase())} placeholder="JOÃO SILVA" />
          {showFieldErrors && !isCardNameValid && (
            <p className="text-xs text-destructive mt-1">Digite o nome impresso no cartão.</p>
          )}
        </div>
        <div>
          <Label className="text-sm">Número do cartão *</Label>
          <Input ref={cardNumberRef} className={errClass(isCardNumberValid)} value={cardNumber} onChange={(e) => setCardNumber(formatCardNumber(e.target.value))} placeholder="0000 0000 0000 0000" maxLength={19} inputMode="numeric" />
          {showFieldErrors && !isCardNumberValid && (
            <p className="text-xs text-destructive mt-1">Digite o número do cartão.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Validade *</Label>
            <Input ref={expiryRef} className={errClass(isExpiryValid)} value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} placeholder="MM/AA" maxLength={5} inputMode="numeric" />
            {showFieldErrors && !isExpiryValid && (
              <p className="text-xs text-destructive mt-1">Use MM/AA.</p>
            )}
          </div>
          <div>
            <Label className="text-sm">CVV *</Label>
            <Input ref={cvvRef} className={errClass(isCvvValid)} value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="123" maxLength={4} type="password" inputMode="numeric" />
            {showFieldErrors && !isCvvValid && (
              <p className="text-xs text-destructive mt-1">Digite o CVV.</p>
            )}
          </div>
        </div>
      </div>

      {!isDebit ? (
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
      ) : (
        <p className="text-xs text-muted-foreground">
          Débito é sempre à vista, em 1x — sem parcelas e sem o desconto do Pix.
        </p>
      )}

      {mismatch && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
          <p className="text-sm font-medium">
            {mismatch === "debit"
              ? "Esse cartão é de débito — quer pagar no débito?"
              : "Esse cartão é de crédito — quer pagar no crédito?"}
          </p>
          <p className="text-xs text-muted-foreground">
            Do jeito que está agora, a operadora provavelmente vai recusar a compra.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => onSwitchMode?.(mismatch)}>
            {mismatch === "debit" ? "Pagar no débito" : "Pagar no crédito"}
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <Button
          onClick={handleSubmit}
          disabled={isProcessing || !!mismatch}
          className={`w-full h-14 text-lg font-semibold ${formComplete ? "" : "bg-muted text-muted-foreground hover:bg-muted"}`}
          size="lg"
        >
          <Lock className="h-5 w-5 mr-2" />Pagar R$ {displayTotal.toFixed(2)}
        </Button>
        <p className={`text-center text-sm font-semibold ${formComplete ? "text-muted-foreground" : "text-destructive"}`}>
          {formComplete ? "CLIQUE PRA PAGAR" : "Preencha os dados do cartão acima"}
        </p>
      </div>
    </div>
  );
}

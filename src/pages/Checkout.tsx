import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ShoppingBag, Lock, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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
  customerName: string;
  products: OrderProduct[];
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

export default function Checkout() {
  const { paypalOrderId } = useParams<{ paypalOrderId: string }>();
  const [orderData, setOrderData] = useState<CheckoutData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "success" | "error">("pending");
  const [sdkReady, setSdkReady] = useState(false);
  const [cardFieldsEligible, setCardFieldsEligible] = useState(false);
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
      }
    } catch (error) {
      console.error("Error fetching order:", error);
      toast.error("Pedido não encontrado");
    } finally {
      setIsLoading(false);
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
  }, [paypalOrderId]);

  // Load PayPal SDK
  useEffect(() => {
    if (!orderData || !orderData.paypalClientId || paymentStatus === "success" || sdkLoadedRef.current) return;
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

    return () => {
      // Don't remove - SDK stays loaded
    };
  }, [orderData, paymentStatus]);

  // Render card fields + PayPal button
  useEffect(() => {
    if (!sdkReady || !window.paypal || !orderData || paymentStatus === "success" || fieldsRenderedRef.current) return;
    fieldsRenderedRef.current = true;

    try {
      const cardFields = window.paypal.CardFields({
        createOrder: () => orderData.paypalOrderId,
        onApprove: async () => {
          await handleApprove();
        },
        onError: (err) => {
          console.error("PayPal CardFields error:", err);
          toast.error("Erro no processamento do cartão.");
          setIsProcessing(false);
        },
        style: {
          input: {
            "font-size": "16px",
            "font-family": "system-ui, sans-serif",
            color: "#333",
            "padding": "12px",
          },
          ".invalid": {
            color: "#dc2626",
          },
        },
      });

      if (cardFields.isEligible()) {
        setCardFieldsEligible(true);
        cardFieldsRef.current = cardFields;

        // Render each field
        cardFields.NameField().render("#card-name-field");
        cardFields.NumberField().render("#card-number-field");
        cardFields.ExpiryField().render("#card-expiry-field");
        cardFields.CVVField().render("#card-cvv-field");
      }

      // Also render PayPal button as alternative
      window.paypal.Buttons({
        createOrder: () => orderData.paypalOrderId,
        onApprove: async () => {
          await handleApprove();
        },
        onError: (err) => {
          console.error("PayPal Buttons error:", err);
          toast.error("Erro no PayPal.");
        },
        style: {
          layout: "vertical",
          color: "gold",
          shape: "rect",
          label: "pay",
          height: 48,
        } as Record<string, unknown>,
      }).render("#paypal-button-container");
    } catch (err) {
      console.error("Error rendering PayPal components:", err);
    }
  }, [sdkReady, orderData, paymentStatus, handleApprove]);

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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-primary mx-auto" />
            <h2 className="text-2xl font-bold">Pagamento Confirmado!</h2>
            <p className="text-muted-foreground">
              Obrigado, {orderData.customerName}! Seu pedido foi confirmado e está sendo processado.
            </p>
            <div className="pt-4 p-4 bg-secondary/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Valor pago</p>
              <p className="text-2xl font-bold text-primary">
                R$ {Number(orderData.amount).toFixed(2)}
              </p>
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
          {/* Products */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Itens do Pedido</h3>
            {orderData.products.map((product, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-secondary/30 rounded-lg">
                {product.image && (
                  <img
                    src={product.image}
                    alt={product.title}
                    className="w-14 h-14 rounded-md object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{product.title}</p>
                  {product.variant && (
                    <p className="text-xs text-muted-foreground">{product.variant}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Qtd: {product.quantity}</p>
                </div>
                <p className="font-semibold text-sm flex-shrink-0">
                  R$ {(product.price * product.quantity).toFixed(2)}
                </p>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-medium">Total</span>
              <span className="text-2xl font-bold text-primary">
                R$ {Number(orderData.amount).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Card Fields */}
          {cardFieldsEligible && (
            <div className="space-y-4">
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

              <Button
                onClick={handleCardSubmit}
                disabled={isProcessing}
                className="w-full h-14 text-lg font-semibold"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Lock className="h-5 w-5 mr-2" />
                    Pagar R$ {Number(orderData.amount).toFixed(2)}
                  </>
                )}
              </Button>

              <div className="relative py-3">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">ou pague com</span>
                </div>
              </div>
            </div>
          )}

          {/* PayPal Button */}
          <div id="paypal-button-container" className="min-h-[48px]" />

          {/* Loading SDK indicator */}
          {!sdkReady && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Carregando métodos de pagamento...</p>
            </div>
          )}

          {paymentStatus === "error" && (
            <div className="text-center p-3 bg-destructive/10 rounded-lg">
              <p className="text-sm text-destructive">
                Houve um erro ao processar o pagamento. Por favor, tente novamente.
              </p>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>Pagamento processado com segurança pelo PayPal</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

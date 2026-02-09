import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, ShoppingBag, CreditCard } from "lucide-react";
import { toast } from "sonner";

interface OrderProduct {
  title: string;
  variant: string;
  price: number;
  quantity: number;
  image?: string;
}

interface CheckoutData {
  paypalOrderId: string;
  status: string;
  amount: number;
  currency: string;
  customerName: string;
  products: OrderProduct[];
}

export default function Checkout() {
  const { paypalOrderId } = useParams<{ paypalOrderId: string }>();
  const navigate = useNavigate();
  const [orderData, setOrderData] = useState<CheckoutData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "success" | "error">("pending");

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

  const handlePayWithPayPal = async () => {
    if (!paypalOrderId) return;

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("paypal-webhook", {
        body: { paypalOrderId, action: "capture" },
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
      toast.error("Erro ao processar pagamento. Por favor, tente novamente.");
    } finally {
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

          {/* Pay Button */}
          <Button
            onClick={handlePayWithPayPal}
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
                <CreditCard className="h-5 w-5 mr-2" />
                Pagar com PayPal - R$ {Number(orderData.amount).toFixed(2)}
              </>
            )}
          </Button>

          {paymentStatus === "error" && (
            <div className="text-center p-3 bg-destructive/10 rounded-lg">
              <p className="text-sm text-destructive">
                Houve um erro ao processar o pagamento. Por favor, tente novamente.
              </p>
            </div>
          )}

          <p className="text-xs text-center text-muted-foreground">
            Pagamento processado com segurança pelo PayPal
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

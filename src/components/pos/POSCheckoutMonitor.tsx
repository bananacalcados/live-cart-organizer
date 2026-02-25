import { useState, useEffect } from "react";
import { CreditCard, AlertTriangle, CheckCircle2, RefreshCw, Loader2, ExternalLink, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface CheckoutAttempt {
  id: string;
  sale_id: string;
  store_id: string | null;
  payment_method: string;
  status: string;
  error_message: string | null;
  amount: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  gateway: string | null;
  transaction_id: string | null;
  created_at: string;
}

interface Props {
  storeId: string;
}

export function POSCheckoutMonitor({ storeId }: Props) {
  const [attempts, setAttempts] = useState<CheckoutAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "failed" | "success">("all");

  const loadAttempts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("pos_checkout_attempts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter === "failed") query = query.eq("status", "failed");
      if (filter === "success") query = query.eq("status", "success");

      const { data } = await query;
      setAttempts((data as any[]) || []);
    } catch (e) {
      console.error("Error loading checkout attempts:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttempts();
  }, [storeId, filter]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("checkout-attempts-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pos_checkout_attempts" }, () => {
        loadAttempts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [filter]);

  const failedCount = attempts.filter(a => a.status === "failed").length;
  const successCount = attempts.filter(a => a.status === "success").length;

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-lg">Monitor de Checkout</h2>
          </div>
          <Button variant="outline" size="sm" onClick={loadAttempts} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {/* Stats */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
            <p className="text-lg font-bold text-red-500">{failedCount}</p>
            <p className="text-[10px] text-muted-foreground">Erros</p>
          </div>
          <div className="flex-1 p-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
            <p className="text-lg font-bold text-green-500">{successCount}</p>
            <p className="text-[10px] text-muted-foreground">Aprovados</p>
          </div>
          <div className="flex-1 p-2.5 rounded-lg bg-muted/50 border border-border text-center">
            <p className="text-lg font-bold">{attempts.length}</p>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-1.5">
          {(["all", "failed", "success"] as const).map(f => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              className="text-xs flex-1"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Todos" : f === "failed" ? "❌ Erros" : "✅ Aprovados"}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {loading && attempts.length === 0 && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          )}

          {!loading && attempts.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CreditCard className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma tentativa de pagamento registrada</p>
            </div>
          )}

          {attempts.map(attempt => (
            <div
              key={attempt.id}
              className={`p-3 rounded-lg border transition-all ${
                attempt.status === "failed"
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-green-500/30 bg-green-500/5"
              }`}
            >
              <div className="flex items-start gap-2">
                {attempt.status === "failed" ? (
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold">
                      {attempt.customer_name || "Cliente desconhecido"}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {attempt.payment_method === "card" ? "💳 Cartão" : "📱 PIX"}
                    </Badge>
                    {attempt.gateway && (
                      <Badge variant="secondary" className="text-[10px]">
                        {attempt.gateway}
                      </Badge>
                    )}
                  </div>

                  {attempt.amount && (
                    <p className="text-xs text-muted-foreground mb-1">
                      Valor: <span className="font-medium text-foreground">{fmt(attempt.amount)}</span>
                    </p>
                  )}

                  {attempt.status === "failed" && attempt.error_message && (
                    <div className="mt-1 p-2 rounded bg-red-500/10 border border-red-500/20">
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                        ❌ {attempt.error_message}
                      </p>
                    </div>
                  )}

                  {attempt.status === "success" && attempt.transaction_id && (
                    <p className="text-[10px] text-muted-foreground">
                      ID Transação: {attempt.transaction_id}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(attempt.created_at), "dd/MM HH:mm:ss")}
                    </div>
                    {attempt.customer_phone && (
                      <span className="text-[10px] text-muted-foreground">
                        📱 {attempt.customer_phone}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground truncate">
                      🔗 ...{attempt.sale_id.slice(-8)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

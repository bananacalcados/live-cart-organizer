import { useState } from "react";
import { Search, Loader2, Instagram, Package, CheckCircle2, Clock, ClipboardList, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { DbOrder } from "@/types/database";
import { getOrderFinalValue } from "@/lib/orderTotal";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";
import { OrderDetailsDialog } from "@/components/OrderDetailsDialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type OrderWithEvent = DbOrder & { event?: { name: string } | null };

const fmtMoney = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function EventCustomerOrderSearch() {
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<OrderWithEvent[] | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const runSearch = async () => {
    const handle = term.trim().replace(/^@+/, "");
    if (!handle) {
      toast.error("Digite o @ do Instagram do cliente.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "*, customer:customers!inner(instagram_handle, whatsapp), event:events(name)",
        )
        .ilike("customer.instagram_handle", `%${handle}%`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setResults((data || []) as unknown as OrderWithEvent[]);
    } catch (e: any) {
      console.error("[EventCustomerOrderSearch] error:", e);
      toast.error("Erro ao buscar pedidos.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const paidCount = results?.filter((o) => isOrderMarkedPaid(o)).length ?? 0;
  const total = results?.reduce((s, o) => s + getOrderFinalValue(o), 0) ?? 0;

  return (
    <Card className="mb-6 border-primary/20">
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Instagram className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Buscar pedidos por @ do Instagram</h3>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Ex: @mariaconceicaobar"
              className="pl-9"
            />
          </div>
          <Button onClick={runSearch} disabled={loading} className="btn-accent">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>

        {results !== null && (
          <div className="mt-4">
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhum pedido encontrado para esse cliente.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
                  <span className="text-muted-foreground">
                    <strong className="text-foreground">{results.length}</strong> pedido(s)
                  </span>
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="h-3 w-3 text-stage-paid" /> {paidCount} pago(s)
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Clock className="h-3 w-3 text-stage-awaiting" /> {results.length - paidCount} não pago(s)
                  </Badge>
                  <span className="ml-auto font-bold text-primary">{fmtMoney(total)}</span>
                </div>

                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {results.map((o) => {
                    const paid = isOrderMarkedPaid(o);
                    const productCount = (o.products || []).reduce(
                      (s, p: any) => s + (Number(p.quantity) || 1),
                      0,
                    );
                    return (
                      <div
                        key={o.id}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-sm font-semibold">{fmtMoney(getOrderFinalValue(o))}</span>
                            <span className="text-xs text-muted-foreground">
                              · {productCount} {productCount === 1 ? "item" : "itens"}
                            </span>
                            {paid ? (
                              <Badge className="bg-stage-paid/20 text-stage-paid border-stage-paid/40 gap-1 text-[10px]">
                                <CheckCircle2 className="h-3 w-3" /> Pago
                              </Badge>
                            ) : (
                              <Badge className="bg-stage-awaiting/20 text-stage-awaiting border-stage-awaiting/40 gap-1 text-[10px]">
                                <Clock className="h-3 w-3" /> Não pago
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <Instagram className="h-3 w-3" />@{o.customer?.instagram_handle?.replace(/^@/, "")}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {o.event?.name || "Sem evento"}
                            </span>
                            <span>
                              {format(new Date(o.paid_at || o.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDetailsId(o.id)}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted transition-colors shrink-0"
                        >
                          <ClipboardList className="h-3 w-3" /> Ver pedido
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>

      {detailsId && (
        <OrderDetailsDialog
          open={!!detailsId}
          onOpenChange={(v) => !v && setDetailsId(null)}
          orderId={detailsId}
        />
      )}
    </Card>
  );
}

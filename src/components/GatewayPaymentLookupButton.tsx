import { useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GatewayPaymentLookupButtonProps {
  orderId: string;
  className?: string;
  compact?: boolean;
}

export function GatewayPaymentLookupButton({ orderId, className, compact }: GatewayPaymentLookupButtonProps) {
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookup, setLookup] = useState<any | null>(null);

  const runGatewayLookup = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!orderId) return;
    setLookupLoading(true);
    setLookup(null);
    try {
      const { data, error } = await supabase.functions.invoke("gateway-payment-lookup", {
        body: { orderId },
      });
      if (error) throw error;
      setLookup(data);
      if (data?.warning) toast.info(data.warning);
    } catch (err: any) {
      toast.error(`Falha ao consultar gateway: ${err.message || err}`);
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={compact ? "w-full text-xs gap-1" : "w-full"}
        onClick={runGatewayLookup}
        disabled={lookupLoading}
      >
        {lookupLoading ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
        )}
        Verificar pagamento no gateway
      </Button>
      {lookup && (
        <div className="rounded-md bg-muted/40 p-2 text-xs space-y-2">
          {lookup.warning && (
            <p className="text-amber-600 flex items-start gap-1">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {lookup.warning}
            </p>
          )}
          {(lookup.gateways || []).map((g: any, i: number) => (
            <div key={i} className="space-y-1 border rounded p-2 bg-background">
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase text-[10px] tracking-wide">
                  {g.gateway} {g.account ? `· ${g.account}` : ""}
                </span>
                {g.status && (
                  <Badge
                    variant={
                      g.status === "approved"
                        ? "default"
                        : g.status === "not_found"
                          ? "destructive"
                          : "secondary"
                    }
                    className="text-[10px]"
                  >
                    {g.status}
                  </Badge>
                )}
              </div>
              {g.error && (
                <p className="text-destructive flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {g.error}
                </p>
              )}
              {typeof g.amount === "number" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor no gateway</span>
                  <span className={g.amountMatches ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                    R$ {Number(g.amount).toFixed(2).replace(".", ",")} {g.amountMatches ? "✓" : `≠ R$ ${Number(lookup.expectedTotal || 0).toFixed(2).replace(".", ",")}`}
                  </span>
                </div>
              )}
              {g.externalReference !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ref. externa</span>
                  <span className={g.referenceMatches ? "text-emerald-600" : "text-destructive"}>
                    {g.externalReference || "—"} {g.referenceMatches ? "✓" : "≠ order.id"}
                  </span>
                </div>
              )}
              {g.dateApproved && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Aprovado em</span>
                  <span>{new Date(g.dateApproved).toLocaleString("pt-BR")}</span>
                </div>
              )}
              {g.payer?.email && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pagador</span>
                  <span className="truncate max-w-[60%] text-right">{g.payer.email}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono">{g.paymentId}</span>
              </div>
              {g.receiptUrl && (
                <a
                  href={g.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  Abrir no {g.gateway}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

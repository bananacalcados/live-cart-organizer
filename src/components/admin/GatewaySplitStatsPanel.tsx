import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const GATEWAY_LABELS: Record<string, string> = {
  mercadopago: "Mercado Pago",
  pagarme: "Pagar.me",
  appmax: "AppMax",
  vindi: "Vindi",
  austpay: "AustPay",
  member_area: "Área de membros",
};

type Row = {
  gateway: string;
  attempts: number;
  approved: number;
  approval_rate: number | null;
  approved_amount: number;
  plano_b_approved: number;
};

const PERIODS = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function GatewaySplitStatsPanel() {
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("gateway_split_stats", { p_days: days });
      if (cancelled) return;
      if (error) {
        toast({ title: "Erro ao carregar números", description: error.message, variant: "destructive" });
      } else {
        setRows((data as Row[]) || []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [days, toast]);

  const totalApproved = rows.reduce((s, r) => s + Number(r.approved_amount || 0), 0);
  const totalPlanoB = rows.reduce((s, r) => s + Number(r.plano_b_approved || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          Resultado por gateway (cartão)
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.days}
                size="sm"
                variant={days === p.days ? "default" : "outline"}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Quanto foi aprovado em cada gateway, a taxa de aprovação e quantas vendas só passaram pelo plano B
          (o gateway sorteado recusou e outro aprovou).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma cobrança no cartão neste período.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {rows.map((r) => (
                <div key={r.gateway} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{GATEWAY_LABELS[r.gateway] || r.gateway}</span>
                    <Badge variant="secondary">{r.approval_rate ?? 0}% aprovação</Badge>
                  </div>
                  <p className="text-lg font-semibold">{brl(Number(r.approved_amount || 0))}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.approved} aprovadas de {r.attempts} tentativas
                  </p>
                  {Number(r.plano_b_approved) > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {r.plano_b_approved} vieram do plano B
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="rounded-md border p-3 text-sm text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <strong className="text-foreground">Total aprovado no cartão:</strong> {brl(totalApproved)}
              </span>
              <span>
                <strong className="text-foreground">Vendas salvas pelo plano B:</strong> {totalPlanoB}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

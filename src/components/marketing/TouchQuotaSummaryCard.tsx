import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle2, DollarSign, Eye, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type QuotaCandidate = { unified_id: string; phone: string | null; name?: string | null };

type Summary = {
  total: number;
  eligible: number;
  excluded_total: number;
  excluded_by_reason: Record<string, number>;
  sample_excluded: Array<{
    unified_id: string;
    phone: string | null;
    name: string | null;
    classificacao: string | null;
    reason: string;
    toques_no_mes: number;
    last_touch_at: string | null;
  }>;
  provider: string | null;
  cost_per_message_brl: number;
  estimated_cost_brl: number;
  tipo_comunicacao: string;
  checked_at: string;
};

const REASON_LABELS: Record<string, string> = {
  cota_mensal_atingida: "Cota mensal atingida",
  min_dias_entre_toques: "Espaçamento mínimo entre toques",
  tipo_incompativel: "Tipo incompatível com a classe",
  silencio_reativavel: "Silêncio reativável (histórico de compra)",
  silencio_puro: "Silêncio puro (nunca comprou / ignorado)",
  silencio_legado: "Silêncio (legado)",
  sem_classificacao: "Sem classificação de disparo",
  cota_zero: "Classe com cota zero",
  merged: "Contato mesclado",
  sem_telefone: "Sem telefone",
  bloqueado: "Bloqueado",
  opt_out: "Opt-out de disparos",
  customer_nao_encontrado: "Cliente não encontrado",
};

const CURRENCY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4 });
const CURRENCY_TOTAL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  candidates: QuotaCandidate[];
  tipoComunicacao: string | null;
  provider: string | null;
  excludeDispatchId?: string | null;
  onSummary?: (s: Summary | null) => void;
}

export function TouchQuotaSummaryCard({ candidates, tipoComunicacao, provider, excludeDispatchId, onSummary }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);

  const payload = useMemo(
    () => candidates.filter((c) => c.unified_id && c.phone).map((c) => ({ unified_id: c.unified_id, phone: c.phone, name: c.name ?? null })),
    [candidates],
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!tipoComunicacao || payload.length === 0) {
        setSummary(null);
        onSummary?.(null);
        return;
      }
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc("dispatch_quota_summary", {
        p_candidates: payload as any,
        p_tipo_comunicacao: tipoComunicacao,
        p_provider: provider ?? null,
        p_exclude_dispatch_id: excludeDispatchId ?? null,
        p_sample_size: 20,
      });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setSummary(null);
        onSummary?.(null);
      } else {
        const s = data as unknown as Summary;
        setSummary(s);
        onSummary?.(s);
      }
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [payload, tipoComunicacao, provider, excludeDispatchId, onSummary]);

  if (!tipoComunicacao) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex items-center gap-2 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          Selecione um <strong>tipo de comunicação</strong> para checar a cota antes de disparar.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checando cotas ({payload.length} candidatos)...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> {error}
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  const reasons = Object.entries(summary.excluded_by_reason).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Check de cota ({summary.tipo_comunicacao})
            </span>
            <Badge variant="outline" className="font-mono">
              {summary.eligible} de {summary.total} elegíveis
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="Total" value={summary.total} />
            <StatBox label="Elegíveis" value={summary.eligible} tone="pos" />
            <StatBox label="Excluídos" value={summary.excluded_total} tone={summary.excluded_total > 0 ? "warn" : "neutral"} />
            <StatBox
              label={`Custo (${summary.provider ?? "—"})`}
              value={CURRENCY_TOTAL.format(summary.estimated_cost_brl)}
              subtitle={`${CURRENCY.format(summary.cost_per_message_brl)}/msg`}
              icon={<DollarSign className="h-3 w-3" />}
            />
          </div>

          {reasons.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Exclusões por motivo</div>
              <div className="flex flex-wrap gap-1.5">
                {reasons.map(([reason, count]) => (
                  <Badge key={reason} variant="secondary" className="text-xs">
                    {REASON_LABELS[reason] ?? reason}: <span className="ml-1 font-mono">{count}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {summary.sample_excluded.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSampleOpen(true)}>
              <Eye className="mr-1 h-3 w-3" /> Ver amostra dos excluídos ({summary.sample_excluded.length})
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={sampleOpen} onOpenChange={setSampleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Amostra de contatos excluídos</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-2">
              {summary.sample_excluded.map((item) => (
                <div key={item.unified_id + item.reason} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.name || "(sem nome)"}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {REASON_LABELS[item.reason] ?? item.reason}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                    <span>📞 {item.phone || "—"}</span>
                    <span>🏷️ {item.classificacao || "—"}</span>
                    <span>Toques no mês: {item.toques_no_mes}</span>
                    {item.last_touch_at && <span>Último: {new Date(item.last_touch_at).toLocaleDateString("pt-BR")}</span>}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatBox({
  label,
  value,
  subtitle,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  tone?: "neutral" | "pos" | "warn";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "pos" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      {subtitle && <div className="text-[10px] text-muted-foreground">{subtitle}</div>}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Undo2, Check, X } from "lucide-react";
import { refundApi, REFUND_REASONS, REFUND_STATUS_LABELS, type RefundConfig, type RefundRow } from "@/lib/refunds";
import { useToast } from "@/hooks/use-toast";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const reasonLabel = (v: string) => REFUND_REASONS.find((r) => r.value === v)?.label || v;

/**
 * Admin > Pagamentos: interruptor geral de estornos, teto de aprovação e
 * lista de estornos aguardando aprovação (aprovar/recusar).
 */
export function RefundApprovalsPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<RefundConfig | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pending, setPending] = useState<RefundRow[]>([]);
  const [recent, setRecent] = useState<RefundRow[]>([]);
  const [threshold, setThreshold] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([refundApi.getConfig(), refundApi.list()]);
      setConfig(cfg.config);
      setIsAdmin(cfg.isAdmin);
      setThreshold(cfg.config.approval_threshold == null ? "" : String(cfg.config.approval_threshold).replace(".", ","));
      setPending(list.pending);
      setRecent(list.recent);
    } catch (e: any) {
      toast({ title: "Erro ao carregar estornos", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (enabled: boolean) => {
    try {
      const res = await refundApi.setConfig({ enabled });
      setConfig(res.config);
      toast({ title: enabled ? "Estornos habilitados" : "Estornos desligados" });
    } catch (e: any) {
      toast({ title: "Não consegui alterar", description: e?.message, variant: "destructive" });
    }
  };

  const saveThreshold = async () => {
    const value = threshold.trim() === "" ? null : Number(threshold.replace(",", "."));
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      toast({ title: "Teto inválido", variant: "destructive" });
      return;
    }
    try {
      const res = await refundApi.setConfig({ approval_threshold: value });
      setConfig(res.config);
      toast({ title: "Teto de aprovação salvo" });
    } catch (e: any) {
      toast({ title: "Não consegui salvar", description: e?.message, variant: "destructive" });
    }
  };

  const act = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      const res = action === "approve" ? await refundApi.approve(id) : await refundApi.reject(id);
      toast({ title: res.message || (action === "approve" ? "Estorno aprovado" : "Estorno recusado") });
      await load();
    } catch (e: any) {
      toast({ title: "Falha na operação", description: e?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <Card><CardContent className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  const rowInfo = (r: RefundRow) => (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">
        {brl(r.amount)} <span className="text-muted-foreground">({r.refund_type})</span> · {r.source === "order" ? "Live" : "PDV"}
      </p>
      <p className="text-xs text-muted-foreground truncate">
        {reasonLabel(r.reason)}{r.reason_text ? ` — ${r.reason_text}` : ""} · pagamento {r.payment_id}
        {r.card_last4 ? ` · cartão •••• ${r.card_last4}${r.installments && r.installments > 1 ? ` ${r.installments}x` : ""}` : ""}
      </p>
      <p className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</p>
      {r.error_message && <p className="text-[11px] text-destructive">{r.error_message}</p>}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Undo2 className="h-4 w-4" /> Estornos Mercado Pago</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isAdmin && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span><b>Estornos habilitados</b><br /><span className="text-xs text-muted-foreground">Desligado, nenhum estorno é executado (padrão).</span></span>
              <input type="checkbox" checked={!!config?.enabled} onChange={(e) => void toggle(e.target.checked)} className="h-4 w-4" />
            </label>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Teto de aprovação (R$) — vazio: todo estorno de não-admin aguarda aprovação</label>
                <input
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ex.: 200,00"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <button onClick={() => void saveThreshold()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Salvar</button>
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-semibold text-foreground mb-2">Aguardando aprovação ({pending.length})</p>
          {pending.length === 0 && <p className="text-xs text-muted-foreground">Nenhum estorno aguardando aprovação.</p>}
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                {rowInfo(r)}
                {isAdmin && (
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => void act(r.id, "approve")}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Aprovar
                    </button>
                    <button
                      onClick={() => void act(r.id, "reject")}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1.5 text-xs font-bold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" /> Recusar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground mb-2">Últimos estornos</p>
          {recent.length === 0 && <p className="text-xs text-muted-foreground">Nenhum estorno registrado ainda.</p>}
          <div className="space-y-2">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                {rowInfo(r)}
                <span className="text-xs font-semibold text-muted-foreground shrink-0">{REFUND_STATUS_LABELS[r.status] || r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

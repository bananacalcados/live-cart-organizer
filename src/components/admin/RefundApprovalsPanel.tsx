import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Undo2, ExternalLink } from "lucide-react";
import { refundApi, type RefundConfig } from "@/lib/refunds";
import { useToast } from "@/hooks/use-toast";
import { SendRefundReceiptButton } from "@/components/refunds/SendRefundReceiptButton";
import { DEFAULT_RECEIPT_MESSAGE } from "@/lib/refundReceiptMessage";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Admin > Pagamentos: interruptor geral de estornos, teto de aprovação e
 * lista de estornos aguardando aprovação (aprovar/recusar).
 */
export function RefundApprovalsPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<RefundConfig | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [footer, setFooter] = useState("");
  const [msgTpl, setMsgTpl] = useState("");
  const [ready, setReady] = useState<{ id: string; amount: number; customer_name: string | null }[]>([]);

  const load = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([refundApi.getConfig(), refundApi.list()]);
      setConfig(cfg.config);
      setIsAdmin(cfg.isAdmin);
      setThreshold(cfg.config.approval_threshold == null ? "" : String(cfg.config.approval_threshold).replace(".", ","));
      setFooter(cfg.config.receipt_footer_contact || "");
      setMsgTpl(cfg.config.receipt_message_template || DEFAULT_RECEIPT_MESSAGE);
      setReady(list.readyToSend || []);
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

  const saveFooter = async () => {
    try {
      const res = await refundApi.setConfig({ receipt_footer_contact: footer.trim() });
      setConfig(res.config);
      toast({ title: "Contato do comprovante salvo" });
    } catch (e: any) {
      toast({ title: "Não consegui salvar", description: e?.message, variant: "destructive" });
    }
  };

  const saveMsgTpl = async () => {
    try {
      const res = await refundApi.setConfig({ receipt_message_template: msgTpl.trim() });
      setConfig(res.config);
      toast({ title: "Mensagem padrão salva" });
    } catch (e: any) {
      toast({ title: "Não consegui salvar", description: e?.message, variant: "destructive" });
    }
  };

  if (loading) {
    return <Card><CardContent className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Undo2 className="h-4 w-4" /> Estornos Mercado Pago</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {ready.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
            <span>Estorno Pix concluído — comprovante pronto para enviar à cliente <b>{r.customer_name || ""}</b> ({brl(r.amount)})</span>
            <SendRefundReceiptButton refundId={r.id} onSent={() => void load()} />
          </div>
        ))}
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
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Contato no rodapé do comprovante de estorno (ex.: WhatsApp, e-mail, endereço)</label>
                <input
                  value={footer}
                  onChange={(e) => setFooter(e.target.value)}
                  maxLength={300}
                  placeholder="Ex.: WhatsApp (33) 9 0000-0000 · contato@bananacalcados.com.br"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <button onClick={() => void saveFooter()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Salvar</button>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Mensagem padrão ao enviar o comprovante — variáveis: {"{nome} {valor} {data_compra} {codigo} {aviso_prazo}"}</label>
              <textarea
                value={msgTpl}
                onChange={(e) => setMsgTpl(e.target.value)}
                maxLength={1000}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex justify-end">
                <button onClick={() => void saveMsgTpl()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Salvar mensagem</button>
              </div>
            </div>
          </div>
        )}

        <a href="/pos?section=expedition&tab=estornos" className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-bold text-primary hover:bg-primary/20">
          Ver estornos na Expedição <ExternalLink className="h-4 w-4" />
        </a>
      </CardContent>
    </Card>
  );
}

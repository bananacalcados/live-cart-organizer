import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Undo2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { RefundReceiptButton } from "./RefundReceiptButton";
import { SendRefundReceiptButton } from "./SendRefundReceiptButton";
import { refundApi, REFUND_REASONS, type RefundPreview, type RefundSource } from "@/lib/refunds";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { confirmationAmountMatches, isWithinRefundWindow, needsApproval, parseBrlAmount, validateRefundAmount } from "@/lib/refundRules";
import { useToast } from "@/hooks/use-toast";

interface Props {
  source: RefundSource;
  sourceId: string;
  /** Rótulo exibido na confirmação (ex.: "Live #123" / "Pedido da Live"). */
  label: string;
  customerName?: string | null;
  onDone?: () => void;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Step = "loading" | "error" | "form" | "confirm" | "done";

/**
 * Botão ESTORNO + fluxo completo de confirmação (Fase 1: só Mercado Pago).
 * A permissão é validada no servidor; aqui o botão só é renderizado por quem
 * já passou no useCanRefund.
 */
export function RefundDialog({ source, sourceId, label, customerName, onDone }: Props) {
  const { toast } = useToast();
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<string>("");
  const [reasonText, setReasonText] = useState("");
  const [cancelOrder, setCancelOrder] = useState(false);

  const [typedAmount, setTypedAmount] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [doneRefund, setDoneRefund] = useState<{ id: string; status?: string } | null>(null);

  const parsedAmount = useMemo(() => parseBrlAmount(amount), [amount]);
  const remaining = preview?.remaining ?? 0;
  const isFull = remaining > 0 && Math.abs(parsedAmount - remaining) < 0.005;
  const canSuggestCancel = source === "order" && isFull && preview?.source && !preview.source.shipped;

  const load = async () => {
    setStep("loading");
    setError(null);
    try {
      const p = await refundApi.preview(source, sourceId);
      setPreview(p);
      if (!p.ok) {
        setError(p.error || "Não foi possível carregar o pagamento.");
        setStep("error");
        return;
      }
      if (p.remaining != null) setAmount(String(p.remaining.toFixed(2)).replace(".", ","));
      setStep("form");
    } catch (e: any) {
      setError(e?.message || "Falha ao consultar o pagamento.");
      setStep("error");
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const paymentLabel = useMemo(() => {
    const p = preview?.payment;
    if (!p) return "";
    if (p.method === "pix" || p.type === "bank_transfer") return "Pix";
    const brand = p.method ? String(p.method).toUpperCase() : "Cartão";
    const last4 = p.cardLast4 ? ` •••• ${p.cardLast4}` : "";
    const inst = p.installments && p.installments > 1 ? ` em ${p.installments}x` : "";
    return `Cartão ${brand}${last4}${inst}`;
  }, [preview]);

  const goConfirm = () => {
    const err = validateRefundAmount(parsedAmount, remaining);
    if (err) { setError(err); return; }
    if (!reason) { setError("Escolha o motivo do estorno."); return; }
    if (reason === "outro" && !reasonText.trim()) { setError("Descreva o motivo em \"outro\"."); return; }
    setError(null);
    setTypedAmount("");
    setPassword("");
    setStep("confirm");
  };

  const submit = async () => {
    if (isAdmin) {
      const typed = parseBrlAmount(typedAmount);
      if (!confirmationAmountMatches(typed, parsedAmount)) {
        setError("O valor digitado não confere com o valor do estorno.");
        return;
      }
      if (!password) {
        setError("Digite sua senha do sistema para confirmar.");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isAdmin) {
        const { data: userData } = await supabase.auth.getUser();
        const email = userData?.user?.email;
        if (!email) throw new Error("Sessão inválida. Entre de novo no sistema.");
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw new Error("Senha incorreta. O estorno não foi feito.");
      }

      const res = await refundApi.execute({
        source,
        id: sourceId,
        amount: parsedAmount,
        reason,
        reason_text: reason === "outro" ? reasonText.trim() : null,
        cancel_order: canSuggestCancel ? cancelOrder : false,
      });
      setResultMessage(
        res.pending_approval
          ? "Solicitação enviada. Um administrador vai revisar e aprovar na aba ESTORNOS. Nenhum valor foi movido ainda."
          : res.message || "Estorno enviado."
      );
      setDoneRefund(res.refund_id ? { id: res.refund_id, status: res.status } : null);
      setStep("done");
      onDone?.();
    } catch (e: any) {
      setError(e?.message || "Falha ao executar o estorno.");
    } finally {
      setSubmitting(false);
    }
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-500/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 hover:bg-amber-500/20 transition-colors dark:text-amber-300"
        title="Solicitar estorno do pagamento desta venda"
      >
        <Undo2 className="h-3 w-3" /> Estorno
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-pos-black border-amber-500/40 max-w-lg" onClick={stop}>
          <DialogHeader>
            <DialogTitle className="text-pos-white text-xl flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-amber-400" /> Estorno{preview?.gateway ? ` · ${preview.gateway}` : ""}
            </DialogTitle>
          </DialogHeader>

          {step === "loading" && (
            <div className="flex items-center justify-center py-10 text-pos-white/70 gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Consultando o pagamento…
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-pos-white flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                <span>{error}</span>
              </div>
              <div className="flex justify-end gap-2">
                {doneRefund?.status === "concluido" && <RefundReceiptButton refundId={doneRefund.id} />}
                {doneRefund?.status === "concluido" && <SendRefundReceiptButton refundId={doneRefund.id} />}
                <button onClick={() => setOpen(false)} className="rounded-md border border-pos-white/20 px-4 py-2 text-sm text-pos-white hover:bg-pos-white/10">Fechar</button>
              </div>
            </div>
          )}

          {step === "form" && preview?.payment && preview.source && (
            <div className="space-y-4 text-sm text-pos-white">
              <div className="rounded-lg border border-pos-white/15 bg-pos-white/5 p-3 space-y-1">
                <p><span className="text-pos-white/60">Cliente:</span> <b>{customerName || preview.source.customerName || "—"}</b></p>
                <p><span className="text-pos-white/60">Pedido/venda:</span> <b>{label}</b> <span className="text-pos-white/50">({preview.source.channel === "live" ? "Live" : "PDV"})</span></p>
                <p><span className="text-pos-white/60">Forma de pagamento:</span> <b>{paymentLabel}</b></p>
                <p><span className="text-pos-white/60">Valor original:</span> <b>{brl(preview.payment.amount)}</b></p>
                <p><span className="text-pos-white/60">Já estornado:</span> <b>{brl(preview.refundedSoFar ?? 0)}</b></p>
                <p><span className="text-pos-white/60">Disponível para estorno:</span> <b className="text-amber-300">{brl(remaining)}</b></p>
                {preview.gateway === "Mercado Pago" && preview.payment.dateApproved && !isWithinRefundWindow(preview.payment.dateApproved) && (
                  <p className="text-destructive text-xs">Pagamento aprovado há mais de 180 dias — o Mercado Pago não permite mais estorno.</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-pos-white/60">{preview.fullOnly ? "Valor a estornar (integral)" : "Valor a estornar (integral ou parcial)"}</label>
                {preview.fullOnly && <p className="text-xs text-amber-300">{preview.fullOnlyNotice || "Este gateway só permite estorno integral pelo sistema."}</p>}
                <div className="flex gap-2">
                  <input
                    value={amount}
                    disabled={!!preview.fullOnly}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    className="flex-1 rounded-md border border-pos-white/20 bg-pos-white/5 px-3 py-2 text-pos-white"
                    placeholder="0,00"
                  />
                  <button
                    type="button"
                    onClick={() => setAmount(String(remaining.toFixed(2)).replace(".", ","))}
                    className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-300 hover:bg-amber-500/20"
                  >
                    Integral
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-pos-white/60">Motivo (obrigatório)</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-md border border-pos-white/20 bg-pos-white/5 px-3 py-2 text-pos-white"
                >
                  <option value="">Selecione…</option>
                  {REFUND_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {reason === "outro" && (
                <div className="space-y-1">
                  <label className="text-xs text-pos-white/60">Descreva o motivo</label>
                  <input
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    className="w-full rounded-md border border-pos-white/20 bg-pos-white/5 px-3 py-2 text-pos-white"
                    placeholder="Ex.: cliente desistiu na loja"
                  />
                </div>
              )}

              {canSuggestCancel && (
                <label className="flex items-start gap-2 rounded-md border border-pos-white/15 bg-pos-white/5 p-3 text-xs cursor-pointer">
                  <input type="checkbox" checked={cancelOrder} onChange={(e) => setCancelOrder(e.target.checked)} className="mt-0.5" />
                  <span>Também mover este pedido da live para <b>cancelado</b> após o estorno integral (ele ainda não foi enviado).</span>
                </label>
              )}

              {error && <p className="text-destructive text-xs">{error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="rounded-md border border-pos-white/20 px-4 py-2 text-sm text-pos-white hover:bg-pos-white/10">Cancelar</button>
                <button
                  onClick={goConfirm}
                  className="rounded-md bg-amber-500 px-4 py-2 text-sm font-bold text-black hover:bg-amber-400"
                >
                  Revisar e confirmar
                </button>
              </div>
            </div>
          )}

          {step === "confirm" && preview?.payment && (
            <div className="space-y-4 text-sm text-pos-white">
              <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 space-y-1">
                <p className="font-bold text-amber-300">Confirme o estorno de {brl(parsedAmount)}</p>
                <p className="text-xs text-pos-white/70">
                  {customerName || preview.source?.customerName || "Cliente"} · {label} · {paymentLabel}
                  {canSuggestCancel && cancelOrder ? " · o pedido será movido para cancelado" : ""}
                </p>
                <p className="text-xs text-pos-white/60">Motivo: {REFUND_REASONS.find((r) => r.value === reason)?.label}{reason === "outro" ? ` — ${reasonText}` : ""}</p>
              </div>

              {isAdmin && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-pos-white/60">Digite o valor do estorno para confirmar ({brl(parsedAmount)})</label>
                    <input
                      value={typedAmount}
                      onChange={(e) => setTypedAmount(e.target.value)}
                      inputMode="decimal"
                      className="w-full rounded-md border border-pos-white/20 bg-pos-white/5 px-3 py-2 text-pos-white"
                      placeholder="0,00"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-pos-white/60">Sua senha do sistema</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-md border border-pos-white/20 bg-pos-white/5 px-3 py-2 text-pos-white"
                      placeholder="••••••••"
                    />
                  </div>
                </>
              )}
              {!isAdmin && (
                <p className="text-xs text-pos-white/60">Sua solicitação vai para um administrador aprovar na aba ESTORNOS. Nenhum valor é movido agora.</p>
              )}

              {error && <p className="text-destructive text-xs">{error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={() => setStep("form")} disabled={submitting} className="rounded-md border border-pos-white/20 px-4 py-2 text-sm text-pos-white hover:bg-pos-white/10">Voltar</button>
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="rounded-md bg-amber-500 px-4 py-2 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {isAdmin ? "Confirmar estorno" : "Enviar solicitação de estorno"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-pos-white">
                {resultMessage}
              </div>
              <div className="flex justify-end">
                <button onClick={() => setOpen(false)} className="rounded-md border border-pos-white/20 px-4 py-2 text-sm text-pos-white hover:bg-pos-white/10">Fechar</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

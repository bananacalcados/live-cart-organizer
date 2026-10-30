import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { MANUAL_PAYMENT_METHODS, PAID_ON_SITE_METHOD } from "@/components/MarkOrderPaidDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string;
  customerLabel?: string | null;
  total?: number;
  onDone?: () => void;
}

/** Formas aceitas para quitar manualmente um link do chat (sem "comprou no site", que é da Live). */
const METHODS = MANUAL_PAYMENT_METHODS.filter((m) => m.value !== PAID_ON_SITE_METHOD);

/**
 * Marca manualmente como PAGO um link de checkout gerado no chat do PDV
 * (ex.: cliente pagou direto na chave PIX da loja). Segue o mesmo fluxo da
 * Live: pergunta a forma de pagamento e, se PIX, em qual chave caiu.
 * Ao confirmar, a venda vira `paid` e entra na Expedição com os dados do link.
 */
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const METHOD_LABEL: Record<string, string> = { vps: "VPS", pix: "Pix", credit: "Cartão de crédito", debit: "Cartão de débito" };
const GATEWAY_LABEL: Record<string, string> = { mercadopago: "Mercado Pago", pagarme: "Pagar.me", appmax: "AppMax", austpay: "AustPay", vindi: "Vindi", vps: "VPS (conferido pela equipe)" };

async function splitCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("split-payment", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Link com pagamento em partes: mostra cada parte (paga/pendente, gateway, transação) e confere só o VPS. */
function SplitPartsReview({ saleId, parts, onChanged }: { saleId: string; parts: any[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});

  const confirmVps = async (p: any) => {
    setBusy(p.id);
    try {
      await splitCall({ action: "confirm_vps", splitId: p.id, reference: (refs[p.id] ?? p.vps_reference ?? "").trim() });
      toast.success(`VPS de ${BRL(Number(p.amount))} conferido`);
      await onChanged();
    } catch (e: any) { toast.error(e.message); }
    setBusy(null);
  };
  const check = async (p: any) => {
    setBusy(p.id);
    try {
      const r = await splitCall({ action: "check", splitId: p.id });
      toast[r.status === "approved" ? "success" : "info"](r.status === "approved" ? "Pagamento confirmado no gateway" : "Ainda não consta pago no gateway");
      await onChanged();
    } catch (e: any) { toast.error(e.message); }
    setBusy(null);
  };

  const paid = parts.filter((p) => p.status === "approved").length;
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm">Pagamento em {parts.length} partes · <b>{paid}/{parts.length} pagas</b>. O pedido só vira pago quando todas estiverem confirmadas.</p>
      {parts.map((p) => {
        const ok = p.status === "approved";
        return (
          <div key={p.id} className="rounded-lg border p-3 space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{p.seq}. {METHOD_LABEL[p.method] || p.method}{p.installments > 1 ? ` (até ${p.installments}x)` : ""}</span>
              <span className="font-semibold">{BRL(Number(p.charge_amount ?? p.amount))}</span>
            </div>
            {ok ? (
              <div className="text-xs space-y-0.5">
                <div className="flex items-center gap-1 font-semibold text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> Pago{p.paid_at ? ` em ${new Date(p.paid_at).toLocaleString("pt-BR")}` : ""}</div>
                {p.method !== "vps" && <div>Gateway: <b>{GATEWAY_LABEL[p.gateway] || p.gateway || "—"}</b>{p.gateway_tx_id ? ` · transação ${p.gateway_tx_id}` : ""}</div>}
                {p.method === "vps" && p.vps_reference && <div>Voucher: {p.vps_reference}</div>}
              </div>
            ) : p.method === "vps" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Aguardando a equipe conferir o voucher na plataforma VPS</div>
                <Input placeholder="Código/referência do voucher (opcional)" value={refs[p.id] ?? p.vps_reference ?? ""} onChange={(e) => setRefs((r) => ({ ...r, [p.id]: e.target.value }))} />
                <Button size="sm" className="w-full gap-1.5" disabled={busy === p.id}
                  onClick={() => window.confirm(`Confirmar que o VPS de ${BRL(Number(p.amount))} foi recebido e conferido?`) && confirmVps(p)}>
                  {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar VPS de {BRL(Number(p.amount))}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Ainda não pago pela cliente</span>
                {p.gateway_tx_id && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy === p.id} onClick={() => check(p)}>
                    <RefreshCw className="h-3 w-3" /> Conferir no gateway
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MarkCheckoutPaidDialog({ open, onOpenChange, saleId, customerLabel, total, onDone }: Props) {
  const [splitParts, setSplitParts] = useState<any[] | null>(null);
  const loadSplits = async () => {
    try {
      const d = await splitCall({ action: "get", saleId });
      setSplitParts((d.parts || []).filter((p: any) => !["refunded", "canceled"].includes(p.status)));
    } catch { setSplitParts([]); }
  };
  useEffect(() => { if (open) { setSplitParts(null); void loadSplits(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, saleId]);
  const hasSplit = !!splitParts && splitParts.length > 0;
  const [method, setMethod] = useState<string>("PIX");
  const [installments, setInstallments] = useState<string>("2");
  const [pixKey, setPixKey] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const selected = METHODS.find((m) => m.value === method);
  const needsInstallments = !!selected?.installments;
  const isPix = method === "PIX";
  const pixKeyClean = pixKey.trim();

  const handleConfirm = async () => {
    if (isPix && !pixKeyClean) {
      toast.error("Informe em qual chave PIX o pagamento caiu.");
      return;
    }
    setSaving(true);
    try {
      const inst = needsInstallments ? Math.max(2, Number(installments) || 2) : 1;
      const label = needsInstallments ? `${method} ${inst}x` : method;
      const now = new Date().toISOString();

      const { data: current, error: readErr } = await supabase
        .from("pos_sales")
        .select("id, status, payment_details, notes")
        .eq("id", saleId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!current) throw new Error("Venda não encontrada");
      if (current.status === "paid" || current.status === "completed") {
        toast.info("Este pedido já está marcado como pago.");
        onOpenChange(false);
        onDone?.();
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const pd = ((current as any).payment_details || {}) as Record<string, any>;
      const manual = {
        method: label,
        pix_key: isPix ? pixKeyClean : null,
        installments: inst,
        confirmed_at: now,
        confirmed_by: auth?.user?.id || null,
        confirmed_by_email: auth?.user?.email || null,
      };
      const noteLine = `✅ Pagamento confirmado manualmente (${label}${isPix ? ` · chave ${pixKeyClean}` : ""}) em ${new Date(now).toLocaleString("pt-BR")}`;
      const notes = [(current as any).notes, noteLine].filter(Boolean).join("\n");

      const { error } = await supabase
        .from("pos_sales")
        .update({
          status: "paid",
          paid_at: now,
          payment_method: label,
          payment_gateway: "manual",
          payment_details: { ...pd, manual_payment: manual, payment_method: isPix ? "pix" : pd.payment_method },
          notes,
        } as any)
        .eq("id", saleId)
        .eq("status", (current as any).status);
      if (error) throw error;

      // Tira o link das filas de "aguardando pagamento"/lembretes.
      await Promise.all([
        supabase.from("chat_awaiting_payment").delete().eq("sale_id", saleId),
        supabase
          .from("chat_payment_followups")
          .update({ is_active: false, completed_at: now } as any)
          .eq("sale_id", saleId)
          .eq("is_active", true),
      ]);

      toast.success(`Pedido marcado como PAGO (${label}) — enviado à Expedição.`);
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Não foi possível marcar como pago.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {hasSplit ? "Conferir pagamento em partes" : "Marcar link como PAGO"}
          </DialogTitle>
          <DialogDescription>
            {customerLabel ? `${customerLabel} · ` : ""}
            {typeof total === "number"
              ? total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : "Informe como o pagamento foi recebido."}
          </DialogDescription>
        </DialogHeader>

        {splitParts === null ? (
          <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : hasSplit ? (
          <SplitPartsReview saleId={saleId} parts={splitParts} onChanged={async () => { await loadSplits(); onDone?.(); }} />
        ) : (<>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Forma de pagamento</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPix && (
            <div className="space-y-2">
              <Label>Em qual chave PIX o pagamento caiu?</Label>
              <Input
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                placeholder="Ex.: CNPJ da loja Centro, CPF ..., e-mail ..."
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Obrigatório para PIX manual — fica registrado na venda para conferência.
              </p>
            </div>
          )}

          {needsInstallments && (
            <div className="space-y-2">
              <Label>Parcelas</Label>
              <Select value={installments} onValueChange={setInstallments}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            O pedido vai para a Expedição com os dados preenchidos no link (cliente, endereço, frete e itens),
            e a forma de pagamento é usada na emissão da NF-e.
          </p>
        </div>

        </>)}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {hasSplit ? "Fechar" : "Cancelar"}
          </Button>
          {!hasSplit && splitParts !== null && (
          <Button onClick={handleConfirm} disabled={saving || (isPix && !pixKeyClean)} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirmar pagamento
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

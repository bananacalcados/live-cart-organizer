import { useState } from "react";
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
import { CheckCircle2, Loader2 } from "lucide-react";
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
export function MarkCheckoutPaidDialog({ open, onOpenChange, saleId, customerLabel, total, onDone }: Props) {
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
            Marcar link como PAGO
          </DialogTitle>
          <DialogDescription>
            {customerLabel ? `${customerLabel} · ` : ""}
            {typeof total === "number"
              ? total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : "Informe como o pagamento foi recebido."}
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={saving || (isPix && !pixKeyClean)} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

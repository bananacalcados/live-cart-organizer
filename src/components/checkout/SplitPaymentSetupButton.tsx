import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Split, X } from "lucide-react";
import { toast } from "sonner";
import { SplitEditor } from "./SplitPaymentPanel";
import { buildSplitParts, describeSplit, splitCustomerTotal, type SplitPartInput } from "@/lib/splitPayment";

interface Props {
  orderId?: string;
  saleId?: string;
  /** Total do pedido; se ausente, busca o total da venda. */
  total?: number;
  maxInstallments?: number;
  /** Texto da divisão para anexar à mensagem ("" quando removida). */
  onChange?: (description: string) => void;
  /** Permite montar a divisão antes de o pedido/link ser criado. */
  onPartsChange?: (parts: SplitPartInput[]) => void;
  className?: string;
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("split-payment", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Vendedor monta a divisão do pagamento antes de enviar o link (PDV Online, WhatsApp, Live). */
export function SplitPaymentSetupButton({ orderId, saleId, total: totalProp, maxInstallments = 6, onChange, onPartsChange, className }: Props) {
  const target = orderId ? { orderId } : { saleId };
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState<number | null>(totalProp ?? null);
  const [pixPct, setPixPct] = useState(0);
  const [parts, setParts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (totalProp != null) setTotal(totalProp); }, [totalProp]);

  useEffect(() => {
    if (!orderId && !saleId) return;
    (async () => {
      try {
        const d = await call({ action: "get", ...target });
        setParts(d.parts || []);
        setPixPct(Number(d.pix_discount_pct) || 0);
      } catch { /* */ }
      if (totalProp == null && saleId) {
        const { data } = await supabase.from("pos_sales").select("total").eq("id", saleId).maybeSingle();
        if (data) setTotal(Number((data as any).total) || 0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, saleId]);

  const desc = (list: any[]) => {
    if (!list.length) return "";
    const built = buildSplitParts(list.map((p) => ({ method: p.method, amount: Number(p.amount), installments: p.installments })), pixPct);
    return `💳 Pagamento dividido: ${describeSplit(built)} = ${BRL(splitCustomerTotal(built))}`;
  };

  const anyPaid = parts.some((p) => p.status === "approved");

  const save = async (list: SplitPartInput[]) => {
    if (!orderId && !saleId) {
      const localParts = buildSplitParts(list, pixPct);
      setParts(localParts);
      onPartsChange?.(list);
      onChange?.(desc(localParts));
      setOpen(false);
      toast.success("Divisão preparada");
      return;
    }
    const d = await call({ action: "setup", ...target, total, parts: list });
    setParts(d.parts || []);
    onChange?.(desc(d.parts || []));
    setOpen(false);
    toast.success("Divisão salva no link");
  };

  const remove = async () => {
    setLoading(true);
    try {
      if (orderId || saleId) await call({ action: "clear", ...target });
      onPartsChange?.([]);
      setParts([]); onChange?.(""); toast.success("Divisão removida");
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  if (!orderId && !saleId && total == null) return null;

  return (
    <div className={className}>
      {parts.length > 0 ? (
        <div className="rounded-lg border border-border p-2 text-left text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold flex items-center gap-1"><Split className="h-3.5 w-3.5" /> Pagamento em {parts.length} partes</span>
            {!anyPaid && (
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>Alterar</Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={loading} onClick={remove}><X className="h-3 w-3" /></Button>
              </span>
            )}
          </div>
          <p className="text-muted-foreground">{desc(parts).replace("💳 Pagamento dividido: ", "")}</p>
          {anyPaid && <p className="font-semibold">{parts.filter((p) => p.status === "approved").length}/{parts.length} partes pagas</p>}
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="w-full gap-2" disabled={total == null} onClick={() => setOpen(true)}>
          {total == null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Split className="h-4 w-4" />} Dividir pagamento
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dividir pagamento</DialogTitle>
            <DialogDescription>A cliente recebe o mesmo link e paga uma parte de cada vez.</DialogDescription>
          </DialogHeader>
          {total != null && (
            <SplitEditor
              total={total}
              pixPct={pixPct}
              maxInstallments={maxInstallments}
              initial={parts.length ? parts.map((p) => ({ method: p.method, amount: Number(p.amount), installments: p.installments })) : undefined}
              onSave={save}
              onCancel={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { getCompletedRefunds, openRefundReceipt, type CompletedRefund } from "@/lib/refunds";
import { useToast } from "@/hooks/use-toast";

/** Botão "Baixar comprovante" para um estorno concluído (PDF gerado no servidor). */
export function RefundReceiptButton({ refundId, label = "Baixar comprovante" }: { refundId: string; label?: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try { await openRefundReceipt(refundId); }
        catch (err: any) { toast({ title: "Não consegui abrir o comprovante", description: err?.message, variant: "destructive" }); }
        finally { setBusy(false); }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-primary hover:bg-primary/20 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />} {label}
    </button>
  );
}

/** Mostra um botão por estorno concluído da venda/pedido (consulta agrupada). */
export function SourceRefundReceipts({ sourceId }: { sourceId: string }) {
  const [rows, setRows] = useState<CompletedRefund[]>([]);
  useEffect(() => {
    let alive = true;
    void getCompletedRefunds(sourceId).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [sourceId]);
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((r) => (
        <RefundReceiptButton
          key={r.id}
          refundId={r.id}
          label={`Comprovante estorno ${Number(r.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
        />
      ))}
    </>
  );
}

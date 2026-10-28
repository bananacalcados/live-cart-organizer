import type { RefundBadge } from "@/lib/refunds";
import { RefundReceiptButton } from "./RefundReceiptButton";
import { SendRefundReceiptButton } from "./SendRefundReceiptButton";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dm = (d?: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");

const OTHER: Record<string, string> = {
  aguardando_aprovacao: "Estorno aguardando aprovação",
  processando: "Estorno em processamento",
  verificar: "Estorno em verificação — não refaça",
  recusado: "Estorno recusado",
  concluido_manual: "Estornado · Manual",
};

/** Selo de estorno no cartão da venda/pedido. Botões só para quem tem permissão (o servidor valida de novo). */
export function RefundSourceBadges({ badges, canRefund }: { badges: RefundBadge[]; canRefund: boolean }) {
  const shown = badges.filter((b) => b.status !== "falhou");
  if (!shown.length) return null;
  return (
    <div className="mt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
      {shown.map((b) => (
        <div
          key={b.id}
          className={`flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold ${
            ["concluido","concluido_manual"].includes(b.status) ? "border-primary/40 bg-primary/10 text-primary"
              : b.status === "recusado" ? "border-border bg-muted text-muted-foreground"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          <span>
            {["concluido","concluido_manual"].includes(b.status)
              ? `Estornado ${brl(b.amount)} em ${dm(b.completed_at || b.created_at)} (${b.refund_type})${b.status==='concluido_manual'?' · Manual':''}`
              : OTHER[b.status] || b.status}
          </span>
          {["concluido","concluido_manual"].includes(b.status) && canRefund && <RefundReceiptButton refundId={b.id} />}
          {["concluido","concluido_manual"].includes(b.status) && canRefund && b.has_receipt && <SendRefundReceiptButton refundId={b.id} sentAt={b.receipt_sent_at} />}
        </div>
      ))}
    </div>
  );
}

import { executeReceiptSend, planReceiptSend } from "./refund-receipt-send.ts";

export type SupportRefundConsult = {
  status: "concluido" | "pendente" | "falhou" | "sem_estorno" | "erro";
  amount?: number;
  completedAt?: string | null;
  receiptSent?: boolean;
  error?: string;
};

export function refundConsultNeedsHuman(result: SupportRefundConsult): boolean {
  return result.status !== "concluido" || result.receiptSent === false;
}

export function completedRefundText(name: string | null, result: SupportRefundConsult): string {
  const first = name ? `${name}, ` : "";
  const amount = Number(result.amount || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const date = result.completedAt ? new Date(result.completedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "data não informada";
  return result.receiptSent
    ? `${first}seu estorno de ${amount} foi realizado em ${date}. Reenviei o comprovante aqui 😊`
    : `${first}seu estorno de ${amount} foi realizado em ${date}. O comprovante está disponível no atendimento.`;
}

/** Consulta fatos no banco; o envio só é permitido no atendimento real, nunca no treino. */
export async function consultSupportRefund(supabase: any, saleId: string, allowSend: boolean): Promise<SupportRefundConsult> {
  const { data, error } = await supabase.from("gateway_refunds")
    .select("id,amount,status,completed_at,created_at,receipt_path,receipt_sent_at")
    .eq("source", "pos_sale").eq("source_id", saleId)
    .order("created_at", { ascending: false }).limit(5);
  if (error) return { status: "erro", error: "consulta_indisponivel" };
  const row = data?.[0];
  if (!row) return { status: "sem_estorno" };
  if (row.status === "falhou" || row.status === "verificar") return { status: "falhou", amount: Number(row.amount), completedAt: row.completed_at };
  if (row.status !== "concluido") return { status: "pendente", amount: Number(row.amount), completedAt: row.completed_at };
  if (!allowSend) return { status: "concluido", amount: Number(row.amount), completedAt: row.completed_at, receiptSent: false };
  const plan = await planReceiptSend(supabase, row.id);
  if (!plan.ok || plan.blocked || !plan.instance || !plan.message) {
    return { status: "erro", amount: Number(row.amount), completedAt: row.completed_at, error: plan.error || plan.blocked || "comprovante_indisponivel" };
  }
  // A pergunta da cliente autoriza o reenvio; o claim continua impedindo chamadas paralelas.
  const sent = await executeReceiptSend(supabase, plan, plan.message, null, "Atendimento automático", { allowResend: true });
  if (!sent.ok) return { status: "erro", amount: Number(row.amount), completedAt: row.completed_at, error: sent.error };
  return { status: "concluido", amount: Number(row.amount), completedAt: row.completed_at, receiptSent: true };
}

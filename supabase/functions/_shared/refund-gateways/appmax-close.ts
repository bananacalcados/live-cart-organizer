// Fecha estornos Appmax em processando/verificar. Usado pelo appmax-webhook e
// pelo worker mercadopago-poll-pending. NUNCA confia só no aviso recebido:
// re-consulta o pedido na API da Appmax e só conclui se constar estornado.
import { appmaxCheckRefund } from "./appmax.ts";
import { runRefundPostActions } from "../refund-post-actions.ts";

const VERIFY_GIVE_UP_MS = 6 * 60 * 60 * 1000;

export async function closeAppmaxRefund(supabase: any, refund: any, rawEvent: any = null): Promise<"done" | "pending" | "failed" | "retry"> {
  const r = await appmaxCheckRefund(supabase, String(refund.payment_id), Number(refund.amount));
  const now = new Date().toISOString();
  if (r === "done") {
    const { data: upd } = await supabase.from("gateway_refunds").update({
      status: "concluido", completed_at: now, updated_at: now, error_message: null,
      ...(rawEvent ? { mp_response: { webhook: rawEvent, previous: refund.mp_response ?? null } } : {}),
    }).eq("id", refund.id).in("status", ["processando", "verificar"]).select("id");
    if (upd && upd.length) await runRefundPostActions(supabase, refund, null);
    return "done";
  }
  // "verificar" sem estorno depois de 6h: a chamada não chegou à Appmax — libera nova tentativa.
  if (r === "not_refunded" && refund.status === "verificar" && Date.now() - new Date(refund.created_at).getTime() > VERIFY_GIVE_UP_MS) {
    await supabase.from("gateway_refunds").update({
      status: "falhou", updated_at: now,
      error_message: "A Appmax não processou este estorno (conferido após 6 h). Pode solicitar novamente.",
    }).eq("id", refund.id).eq("status", "verificar");
    return "failed";
  }
  return r === "retry" ? "retry" : "pending";
}

export async function closeAppmaxRefundsForOrder(supabase: any, appmaxOrderId: string, rawEvent: any) {
  const { data } = await supabase.from("gateway_refunds").select("*")
    .eq("gateway", "appmax").eq("payment_id", String(appmaxOrderId))
    .in("status", ["processando", "verificar"]).limit(5);
  for (const row of data || []) {
    try { await closeAppmaxRefund(supabase, row, rawEvent); } catch (e: any) { console.warn("[appmax-refund-close]", e?.message); }
  }
}

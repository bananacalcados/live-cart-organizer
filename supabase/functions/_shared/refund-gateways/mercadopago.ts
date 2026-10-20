// Adaptador de estorno Mercado Pago — extraído de mp-refund sem mudança funcional.
import { getMpAccountForOrder, getMpAccountForSale } from "../mp-account.ts";
import { buildMpHeaders, mpGetPayment } from "../mp-http.ts";
import { runRefundPostActions } from "../refund-post-actions.ts";

export const MAX_REFUND_AGE_DAYS = 180;

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export interface SourceRow {
  appmaxOrderId?: string | null;
  id: string;
  paymentOrderId?: string | null;
  paymentError?: string | null;
  paymentId: string | null;
  mpAccountId: string | null;
  total: number;
  label: string;
  channel: "live" | "pdv";
  customerName: string | null;
  isPaid: boolean;
  stageOrStatus: string | null;
  shipped: boolean;
  createdAt: string | null;
}

function extractUuid(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

export interface MpCheck {
  ok: boolean;
  error?: string;
  payment?: any;
  account?: any;
  remaining?: number;
  refundedSoFar?: number;
}

export async function checkPayment(
  supabase: any,
  src: SourceRow,
  requestedAmount: number | null,
): Promise<MpCheck> {
  if (src.paymentError) return { ok: false, error: src.paymentError };
  if (!src.paymentId) return { ok: false, error: "Esta venda/pedido não tem pagamento do Mercado Pago vinculado." };

  const account = src.channel === "live" || src.paymentOrderId
    ? await getMpAccountForOrder(supabase, src.paymentOrderId || src.id)
    : await getMpAccountForSale(supabase, src.id);
  if (!account) return { ok: false, error: "Conta do Mercado Pago não encontrada para esta venda." };

  const resp = await mpGetPayment(account.access_token, src.paymentId);
  if (!resp.ok) {
    return { ok: false, error: `Não consegui consultar o pagamento no Mercado Pago (HTTP ${resp.status}).` };
  }
  const payment = await resp.json();

  if (!["approved", "partially_refunded"].includes(payment.status)) {
    return { ok: false, error: `O pagamento está com status "${payment.status}" no Mercado Pago — só é possível estornar pagamentos aprovados.`, payment, account };
  }

  // Coerência: se o external_reference tem um UUID e ele pertence a OUTRA
  // venda/pedido do sistema, bloqueia. (Links de pagamento usam referências
  // próprias — UUID desconhecido não bloqueia.)
  const refUuid = extractUuid(payment.external_reference);
  if (refUuid && refUuid !== src.id.toLowerCase()) {
    const [otherSale, otherOrder] = await Promise.all([
      supabase.from("pos_sales").select("id").eq("id", refUuid).maybeSingle(),
      supabase.from("orders").select("id, pos_sale_id").eq("id", refUuid).maybeSingle(),
    ]);
    // Pedido da live convertido em venda do PDV é a MESMA compra — libera.
    const samePurchase = otherOrder.data && otherOrder.data.pos_sale_id === src.id;
    if ((otherSale.data || otherOrder.data) && !samePurchase) {
      return { ok: false, error: "A referência do pagamento no Mercado Pago pertence a outra venda/pedido. Estorno bloqueado por segurança.", payment, account };
    }
  }

  const approvedAt = payment.date_approved ? new Date(payment.date_approved) : null;
  if (approvedAt && (Date.now() - approvedAt.getTime()) > MAX_REFUND_AGE_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, error: `Pagamento aprovado há mais de ${MAX_REFUND_AGE_DAYS} dias — o Mercado Pago não permite mais estorno.`, payment, account };
  }

  const txAmount = Number(payment.transaction_amount || 0);
  const refundedSoFar = Number(payment.transaction_details?.total_refunded_amount || 0);
  const remaining = Math.max(0, Math.round((txAmount - refundedSoFar) * 100) / 100);

  if (remaining <= 0) {
    return { ok: false, error: "Este pagamento já foi totalmente estornado.", payment, account, remaining, refundedSoFar };
  }
  if (requestedAmount != null) {
    if (!(requestedAmount > 0)) return { ok: false, error: "Informe um valor de estorno maior que zero.", payment, account, remaining, refundedSoFar };
    if (requestedAmount > remaining + 0.009) {
      return { ok: false, error: `Valor solicitado (${brl(requestedAmount)}) maior que o valor ainda não estornado (${brl(remaining)}).`, payment, account, remaining, refundedSoFar };
    }
  }
  return { ok: true, payment, account, remaining, refundedSoFar };
}


export async function executeMpRefund(supabase: any, row: any, account: any, payment: any, userEmail: string | null) {
  const isPix = payment.payment_method_id === "pix" || payment.payment_type_id === "bank_transfer";
  const headers = buildMpHeaders({ accessToken: account.access_token, idempotencyKey: row.idempotency_key });
  if (isPix) headers["X-Render-In-Process-Refunds"] = "true";

  const isFull = Math.abs(Number(row.amount) - Number(payment.transaction_amount)) < 0.01
    || Math.abs(Number(row.amount) - (Number(payment.transaction_amount) - Number(payment.transaction_details?.total_refunded_amount || 0))) < 0.01;
  const body = isFull ? {} : { amount: Number(row.amount) };

  let resp: Response;
  try {
    resp = await fetch(`https://api.mercadopago.com/v1/payments/${row.payment_id}/refunds`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    // Falha de rede/timeout: o MP PODE ter processado e só a resposta se perdeu.
    // Marca "verificar" (mantém a idempotency_key) — o worker confere antes de
    // permitir qualquer nova tentativa. NUNCA marcar "falhou" aqui.
    await supabase.from("gateway_refunds").update({ status: "verificar", error_message: `Falha de rede ao chamar o Mercado Pago: ${e?.message}`, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, verificar: true, error: "Falha de comunicação com o Mercado Pago. O estorno ficou em verificação — NÃO refaça o estorno; o sistema confere sozinho se ele foi processado." };
  }

  const respBody = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    // 5xx do MP: mesma incerteza da falha de rede — pode ter processado.
    if (resp.status >= 500) {
      await supabase.from("gateway_refunds").update({ status: "verificar", error_message: `Mercado Pago instável (HTTP ${resp.status}) — verificando se o estorno foi processado.`, mp_response: respBody, updated_at: new Date().toISOString() }).eq("id", row.id);
      return { ok: false, verificar: true, error: "O Mercado Pago está instável. O estorno ficou em verificação — NÃO refaça o estorno; o sistema confere sozinho se ele foi processado." };
    }
    const rawMsg = String(respBody?.message || respBody?.error || `HTTP ${resp.status}`);
    const insufficient = /insufficient|saldo|balance/i.test(rawMsg) || respBody?.causes?.some?.((c: any) => /insufficient|balance/i.test(String(c?.code || c?.description || "")));
    const friendly = insufficient
      ? `Saldo insuficiente na conta ${account.account_name} do Mercado Pago para este estorno.`
      : `Mercado Pago recusou o estorno: ${rawMsg}`;
    await supabase.from("gateway_refunds").update({ status: "falhou", error_message: friendly, mp_response: respBody, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, error: friendly };
  }

  const mpStatus = String(respBody?.status || "");
  const done = mpStatus === "approved";
  const processing = !done && ["in_process", "pending"].includes(mpStatus);
  const newStatus = done ? "concluido" : processing ? "processando" : "falhou";

  await supabase.from("gateway_refunds").update({
    status: newStatus,
    refund_id: respBody?.id != null ? String(respBody.id) : null,
    e2e_id: respBody?.e2e_id || null,
    mp_response: respBody,
    error_message: newStatus === "falhou" ? `Status inesperado do Mercado Pago: ${mpStatus || "desconhecido"}` : null,
    completed_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);

  if (done) await runRefundPostActions(supabase, row, userEmail);

  return {
    ok: true,
    status: newStatus,
    message: done
      ? "Estorno concluído no Mercado Pago."
      : processing
        ? "Estorno em processamento no Mercado Pago (Pix pode levar alguns minutos). O sistema acompanha e atualiza sozinho."
        : "O Mercado Pago retornou um status inesperado — verifique a lista de estornos.",
  };
}


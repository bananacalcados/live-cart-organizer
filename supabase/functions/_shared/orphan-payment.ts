import { expectedOrderAmounts, orderAmountOk } from "./webhook-verification.ts";
import { applyMercadoPagoOrderPayment } from "./mercadopago-order-payment.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
export const orphanPhoneKey = (value: unknown) => {
  const d = digits(value);
  const withoutCountry = d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
  const local = withoutCountry.slice(-11);
  return local.length >= 10 ? `${local.slice(0, 2)}${local.slice(-8)}` : "";
};
const last4 = (value: unknown) => digits(value).slice(-4);
const handle = (value: unknown) => String(value || "").trim().replace(/^@+/, "").toLowerCase();

export interface OrphanCandidate {
  id: string;
  customer_id?: string | null;
  phone_last4?: string | null;
  customer?: { instagram_handle?: string | null; whatsapp?: string | null } | null;
  [key: string]: any;
}

export function deletedPaymentCandidates(orders: OrphanCandidate[], deleted: any, oldCustomer: any) {
  const oldPhone = orphanPhoneKey(oldCustomer?.whatsapp);
  const oldHandle = handle(oldCustomer?.instagram_handle);
  const oldLast4 = String(deleted?.phone_last4 || last4(oldCustomer?.whatsapp) || "");
  return orders.filter((order) => {
    if (order.is_paid || order.stage === "cancelled" || order.merged_into_order_id) return false;
    if (deleted?.customer_id && order.customer_id === deleted.customer_id) return true;
    if (oldPhone && orphanPhoneKey(order.customer?.whatsapp) === oldPhone) return true;
    return !!oldHandle && !!oldLast4 && handle(order.customer?.instagram_handle) === oldHandle
      && String(order.phone_last4 || last4(order.customer?.whatsapp)) === oldLast4;
  });
}

export function decideDeletedPayment(
  existingOrphanStatus: string | null,
  candidates: OrphanCandidate[],
  amount: number,
  expected: { base: number; min: number } | null,
): "skip" | "reconcile" | "orphan" {
  if (existingOrphanStatus === "resolved") return "skip";
  if (candidates.length !== 1 || !expected || !orderAmountOk(amount, expected)) return "orphan";
  return "reconcile";
}

function payerOf(mpPayment: any) {
  const payer = mpPayment?.payer || {};
  return {
    payer_name: [payer.first_name, payer.last_name].filter(Boolean).join(" ") || null,
    payer_email: payer.email || null,
    payer_phone: payer.phone?.number || null,
  };
}

async function notifyOrphan(supabase: any, mpPayment: any, deleted: any) {
  try {
    await supabase.functions.invoke("blocked-buyer-sale-alert", {
      body: {
        adminPhone: "5533991955003",
        message: `⚠️ Pagamento recebido sem pedido\nValor: R$ ${Number(mpPayment.transaction_amount || 0).toFixed(2).replace(".", ",")}\nReferência: ${mpPayment.external_reference || "-"}\nPedido excluído: ${deleted?.order_id || "não identificado"}\nAbra Erros de Pagamento na live para vincular.`,
      },
    });
  } catch (error) {
    console.error("[orphan-payment] admin alert failed", error);
  }
}

export async function processDeletedMercadoPagoPayment(
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  mpPayment: any,
): Promise<{ reconciled: boolean; orderId?: string | null; orphanId?: string | null; reason?: string }> {
  const paymentId = String(mpPayment.id);
  const externalReference = String(mpPayment.external_reference || "");
  const { data: existing } = await supabase.from("orphan_payments").select("*")
    .eq("gateway", "mercadopago").eq("payment_id", paymentId).maybeSingle();
  if (existing?.status === "resolved") return { reconciled: true, orderId: existing.resolved_order_id, orphanId: existing.id };

  let deleted: any = null;
  if (UUID_RE.test(externalReference)) {
    const { data } = await supabase.from("orders_deleted_log").select("*").eq("order_id", externalReference).maybeSingle();
    deleted = data || null;
  }

  let candidate: OrphanCandidate | null = null;
  let candidates: OrphanCandidate[] = [];
  let expected: { base: number; min: number } | null = null;
  if (deleted) {
    let oldCustomer: any = null;
    if (deleted.customer_id) {
      const { data } = await supabase.from("customers").select("instagram_handle,whatsapp").eq("id", deleted.customer_id).maybeSingle();
      oldCustomer = data || null;
    }
    const snapshot = { ...((deleted.snapshot || {}) as Record<string, unknown>), customer_id: deleted.customer_id, event_id: deleted.event_id };
    const { data: openOrders } = await supabase.from("orders")
      .select("id,event_id,customer_id,is_paid,stage,merged_into_order_id,phone_last4,pickup_store_id,customer:customers(instagram_handle,whatsapp)")
      .eq("event_id", deleted.event_id).eq("is_paid", false).is("merged_into_order_id", null)
      .neq("stage", "cancelled").order("created_at", { ascending: false }).limit(200);
    candidates = deletedPaymentCandidates((openOrders || []) as OrphanCandidate[], snapshot, oldCustomer);
    if (candidates.length === 1) expected = await expectedOrderAmounts(supabase, candidates[0].id);
  }

  const decision = decideDeletedPayment(existing?.status || null, candidates, Number(mpPayment.transaction_amount || 0), expected);
  if (decision === "reconcile") {
    candidate = candidates[0];
    const applied = await applyMercadoPagoOrderPayment(supabase, supabaseUrl, supabaseKey, candidate, mpPayment, {
      note: `Pix pago no pedido ${externalReference} (excluído/mesclado) — conciliado automaticamente`,
      source: "mercadopago-webhook-deleted-order",
    });
    if (applied.updated) {
      if (existing?.id) {
        await supabase.from("orphan_payments").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_order_id: candidate.id, resolved_by: null }).eq("id", existing.id).eq("status", "open");
      }
      return { reconciled: true, orderId: candidate.id, orphanId: existing?.id || null };
    }
  }

  const snapshot = deleted?.snapshot || null;
  const payload = {
    gateway: "mercadopago",
    payment_id: paymentId,
    external_reference: externalReference || null,
    event_id: deleted?.event_id || snapshot?.event_id || null,
    amount: Number(mpPayment.transaction_amount || 0),
    ...payerOf(mpPayment),
    deleted_order_snapshot: snapshot,
    status: "open",
    resolved_at: null,
    resolved_order_id: null,
    resolved_by: null,
  };
  const { data: orphan, error } = await supabase.from("orphan_payments").upsert(payload, { onConflict: "gateway,payment_id" }).select("id").single();
  if (error) throw error;
  if (!existing) await notifyOrphan(supabase, mpPayment, deleted);
  return { reconciled: false, orphanId: orphan.id, reason: candidates.length === 1 ? "amount_mismatch_or_update_failed" : candidates.length > 1 ? "multiple_candidates" : "no_unique_candidate" };
}

export async function resolveOrphanPaymentForStaff(
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  orphanId: string,
  orderId: string,
  userId: string,
) {
  const { data: orphan, error: orphanError } = await supabase.from("orphan_payments").select("*").eq("id", orphanId).single();
  if (orphanError || !orphan) throw new Error("Pagamento não encontrado");
  if (orphan.status === "resolved") {
    if (orphan.resolved_order_id !== orderId) throw new Error("Este pagamento já foi vinculado a outro pedido");
    return { orderId, alreadyResolved: true };
  }
  if (orphan.gateway !== "mercadopago") throw new Error("Este gateway ainda não permite vinculação pela tela");

  const { data: order, error: orderError } = await supabase.from("orders").select("id,event_id,customer_id,is_paid,stage,merged_into_order_id,pickup_store_id,customer:customers(instagram_handle,whatsapp)").eq("id", orderId).single();
  if (orderError || !order) throw new Error("Pedido não encontrado");
  if (order.is_paid || order.stage === "cancelled" || order.merged_into_order_id) throw new Error("Escolha um pedido aberto e não pago");
  if (orphan.event_id && order.event_id !== orphan.event_id) throw new Error("O pedido precisa ser da mesma live");

  const { data: alreadyUsed } = await supabase.from("orders").select("id").eq("mercadopago_payment_id", String(orphan.payment_id)).neq("id", orderId).limit(1);
  if (alreadyUsed?.length) throw new Error("Este pagamento já está vinculado a outro pedido");
  const expected = await expectedOrderAmounts(supabase, orderId);
  if (!expected || !orderAmountOk(Number(orphan.amount), expected)) throw new Error("O valor pago não confere com este pedido");

  const mpPayment = {
    id: orphan.payment_id,
    transaction_amount: Number(orphan.amount),
    payment_type_id: "bank_transfer",
    payment_method_id: "pix",
    installments: 1,
    payer: { first_name: orphan.payer_name, email: orphan.payer_email, phone: { number: orphan.payer_phone } },
  };
  const applied = await applyMercadoPagoOrderPayment(supabase, supabaseUrl, supabaseKey, order, mpPayment, {
    note: `🔔 Pagamento ${orphan.payment_id} conciliado manualmente pela equipe`,
    source: "mercadopago-orphan-manual-resolution",
  });
  if (!applied.updated) throw new Error(applied.error || "Não foi possível confirmar o pedido");
  const { error: resolveError } = await supabase.from("orphan_payments").update({
    status: "resolved", resolved_at: new Date().toISOString(), resolved_order_id: orderId, resolved_by: userId,
  }).eq("id", orphanId).eq("status", "open");
  if (resolveError) throw resolveError;
  return { orderId, alreadyResolved: false };
}

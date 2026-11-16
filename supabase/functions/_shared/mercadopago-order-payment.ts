import { notifyPaymentConfirmed } from "./payment-confirmed.ts";
import { normalizeGatewayPaymentLabel, syncOrderPaymentToPosSale } from "./payment-method-sync.ts";

/** Mesma baixa usada pelo webhook normal, pela conciliação automática e pela ação da equipe. */
export async function applyMercadoPagoOrderPayment(
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  order: any,
  mpPayment: any,
  options: { note?: string; source?: string } = {},
): Promise<{ updated: boolean; error?: string }> {
  const mpIdStr = String(mpPayment.id);
  const mpTypeId = String(mpPayment.payment_type_id || "");
  const mpMethodId = String(mpPayment.payment_method_id || "");
  const inst = Number(mpPayment.installments || 1);
  const payLabel = normalizeGatewayPaymentLabel({
    gateway: "mercadopago",
    paymentTypeId: mpTypeId,
    paymentMethodId: mpMethodId,
    installments: inst,
  }) || "PIX";
  const paidAt = new Date().toISOString();

  const { error } = await supabase.from("orders").update({
    is_paid: true,
    payment_confirmed_source: "gateway_webhook",
    paid_at: paidAt,
    stage: "paid",
    payment_method_label: payLabel,
    installments: inst,
    mercadopago_payment_id: mpIdStr,
    notes: options.note || `🔔 Webhook MercadoPago: PIX aprovado (${mpIdStr})`,
  }).eq("id", order.id);

  if (error) {
    console.error("Error updating order:", error);
    return { updated: false, error: error.message };
  }

  console.log(`[mercadopago] Order ${order.id} marked as paid via webhook`);
  await syncOrderPaymentToPosSale(supabase, {
    orderId: order.id,
    paymentMethodLabel: payLabel,
    installments: inst,
    paymentGateway: "mercadopago",
    transactionField: "mercadopago_payment_id",
    transactionValue: mpIdStr,
    paidAt,
  });

  try {
    const { data: sessions } = await supabase.from("automation_ai_sessions")
      .select("phone, whatsapp_number_id")
      .eq("is_active", true)
      .like("prompt", `livete_checkout:${order.id}`);
    if (sessions && sessions.length > 0) {
      const sess = sessions[0];
      await supabase.from("automation_ai_sessions")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("is_active", true)
        .like("prompt", `livete_checkout:${order.id}`);
      if (sess.phone && sess.whatsapp_number_id) {
        const confirmMsg = `✅ *Pagamento confirmado!* 🎉\n\nRecebemos seu pagamento com sucesso! Seu pedido já está sendo preparado.\n\nMuito obrigada pela compra! 💛🍌`;
        const { data: wnData } = await supabase.from("whatsapp_numbers")
          .select("provider, phone_number_id").eq("id", sess.whatsapp_number_id).single();
        if (wnData?.provider === "meta" && wnData?.phone_number_id) {
          await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ phone: sess.phone, message: confirmMsg, whatsappNumberId: sess.whatsapp_number_id }),
          });
        } else {
          await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
            method: "POST",
            headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ phone: sess.phone, message: confirmMsg, whatsapp_number_id: sess.whatsapp_number_id }),
          });
        }
        await supabase.from("whatsapp_messages").insert({
          phone: sess.phone,
          message: confirmMsg,
          direction: "outgoing",
          status: "sent",
          whatsapp_number_id: sess.whatsapp_number_id,
        });
        console.log(`[mercadopago] Payment confirmation sent to ${sess.phone}`);
      }
    }
  } catch (aiErr) {
    console.error("[mercadopago] AI session cleanup error (non-blocking):", aiErr);
  }

  let lojaName = "centro";
  if (order.pickup_store_id) {
    const { data: storeData } = await supabase.from("pos_stores").select("name").eq("id", order.pickup_store_id).single();
    if (storeData?.name) lojaName = storeData.name.toLowerCase();
  }
  await notifyPaymentConfirmed({
    pedido_id: order.id,
    loja: lojaName,
    gateway: "mercadopago",
    transaction_id: mpIdStr,
    source: options.source || "mercadopago-webhook",
  });
  return { updated: true };
}

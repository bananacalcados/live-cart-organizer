import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const payload = await req.json();
    console.log("Pagar.me webhook received:", JSON.stringify(payload).substring(0, 1000));

    // Extract event type and order data
    const eventType = payload.type || payload.event;
    const orderData = payload.data;
    if (!orderData) {
      console.log("No data in payload, ignoring");
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Extract our internal orderId from the `code` field we set during charge creation
    const ourOrderId = orderData.code || orderData.metadata?.our_order_id;
    const pagarmeOrderId = orderData.id;
    const status = orderData.status; // paid, failed, canceled, pending
    const chargeObj = orderData.charges?.[0];
    const transactionId = chargeObj?.last_transaction?.id || pagarmeOrderId;

    console.log(`Event: ${eventType}, Status: ${status}, OurOrderId: ${ourOrderId}, PagarmeId: ${pagarmeOrderId}`);

    if (!ourOrderId) {
      console.log("No order code/metadata found, cannot map to internal order. Skipping.");
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Determine if paid or failed
    const isPaid = status === "paid" || eventType === "order.paid" || eventType === "charge.paid";
    const isFailed = status === "failed" || status === "canceled" || eventType === "order.payment_failed" || eventType === "order.canceled";

    if (!isPaid && !isFailed) {
      console.log(`Status "${status}" / event "${eventType}" is not actionable, skipping.`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Try to find and update in orders first
    const { data: order } = await supabase
      .from("orders")
      .select("id, is_paid, notes")
      .eq("id", ourOrderId)
      .maybeSingle();

    let updated = false;

    if (order) {
      if (isPaid && !order.is_paid) {
        const { error } = await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
            notes: `${order.notes || ""}\n🔔 Webhook Pagar.me: pago (${transactionId})`.trim(),
          })
          .eq("id", ourOrderId);
        if (error) console.error("Error updating orders:", error);
        else { updated = true; console.log(`orders ${ourOrderId} marked as paid via webhook`); }
      }
    } else {
      // Try pos_sales
      const { data: sale } = await supabase
        .from("pos_sales")
        .select("id, status")
        .eq("id", ourOrderId)
        .maybeSingle();

      if (sale) {
        if (isPaid && sale.status !== "paid" && sale.status !== "completed") {
          const { error } = await supabase
            .from("pos_sales")
            .update({
              status: "paid",
              payment_gateway: "pagarme",
              notes: `🔔 Webhook Pagar.me: pago (${transactionId})`,
            })
            .eq("id", ourOrderId);
          if (error) console.error("Error updating pos_sales:", error);
          else { updated = true; console.log(`pos_sales ${ourOrderId} marked as paid via webhook`); }
        } else if (isFailed && sale.status === "online_pending") {
          const { error } = await supabase
            .from("pos_sales")
            .update({
              status: "payment_failed",
              payment_gateway: "pagarme",
              notes: `🔔 Webhook Pagar.me: ${status} (${chargeObj?.last_transaction?.acquirer_message || eventType})`,
            })
            .eq("id", ourOrderId);
          if (error) console.error("Error updating pos_sales to payment_failed:", error);
          else { updated = true; console.log(`pos_sales ${ourOrderId} marked as payment_failed via webhook`); }
        }
      } else {
        console.log(`Order ${ourOrderId} not found in orders or pos_sales`);
      }
    }

    // Log to pos_checkout_attempts
    const logStatus = isPaid ? "success" : "error";
    const logMessage = isPaid
      ? `Webhook: pagamento confirmado (${transactionId})`
      : `Webhook: pagamento ${status} - ${chargeObj?.last_transaction?.acquirer_message || eventType}`;

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: ourOrderId,
      payment_method: "credit_card",
      status: logStatus,
      error_message: logMessage,
      gateway: "pagarme",
      transaction_id: String(transactionId),
      metadata: { source: "webhook", event: eventType, pagarme_status: status },
    });

    return new Response(
      JSON.stringify({ ok: true, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("pagarme-webhook error:", error);
    // Always return 200 to avoid retries from gateway
    return new Response(
      JSON.stringify({ ok: true, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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
    console.log("AppMax webhook received:", JSON.stringify(payload).substring(0, 1000));

    // AppMax sends different payload structures depending on the event
    // Common fields: event, data.id, data.status, data.order_id
    const event = payload.event || payload.type;
    const data = payload.data || payload;
    const appmaxOrderId = data.order_id || data.id;
    const status = data.status; // approved, declined, canceled, refunded, etc.

    // Our internal orderId stored in metadata or custom_reference during order creation
    const ourOrderId = data.metadata?.our_order_id || data.custom_reference || data.external_reference;
    const transactionId = data.transaction_id || data.id || appmaxOrderId;

    console.log(`AppMax Event: ${event}, Status: ${status}, OurOrderId: ${ourOrderId}, AppmaxOrderId: ${appmaxOrderId}`);

    if (!ourOrderId) {
      console.log("No internal order reference found in AppMax payload. Skipping.");
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isPaid = status === "approved" || status === "paid" || event === "payment.approved";
    const isFailed = status === "declined" || status === "canceled" || status === "refunded" || event === "payment.declined";

    if (!isPaid && !isFailed) {
      console.log(`AppMax status "${status}" / event "${event}" not actionable, skipping.`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Try orders first, then pos_sales
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
            notes: `${order.notes || ""}\n🔔 Webhook AppMax: pago (${transactionId})`.trim(),
          })
          .eq("id", ourOrderId);
        if (error) console.error("Error updating orders:", error);
        else { updated = true; console.log(`orders ${ourOrderId} marked as paid via AppMax webhook`); }
      }
    } else {
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
              payment_gateway: "appmax",
              notes: `🔔 Webhook AppMax: pago (${transactionId})`,
            })
            .eq("id", ourOrderId);
          if (error) console.error("Error updating pos_sales:", error);
          else { updated = true; console.log(`pos_sales ${ourOrderId} marked as paid via AppMax webhook`); }
        }
      } else {
        console.log(`Order ${ourOrderId} not found in orders or pos_sales`);
      }
    }

    // Log to pos_checkout_attempts
    const logStatus = isPaid ? "success" : "error";
    const logMessage = isPaid
      ? `Webhook AppMax: pagamento confirmado (${transactionId})`
      : `Webhook AppMax: pagamento ${status} - ${event || "unknown"}`;

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: ourOrderId,
      payment_method: "credit_card",
      status: logStatus,
      error_message: logMessage,
      gateway: "appmax",
      transaction_id: String(transactionId),
      metadata: { source: "webhook", event, appmax_status: status },
    });

    return new Response(
      JSON.stringify({ ok: true, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("appmax-webhook error:", error);
    return new Response(
      JSON.stringify({ ok: true, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

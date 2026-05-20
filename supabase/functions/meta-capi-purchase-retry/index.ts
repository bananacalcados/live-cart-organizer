// Meta CAPI — Retry / Reconcile Purchase events for Live orders.
//
// Two modes:
//   - { order_id: "uuid" }     → reenvia/resync 1 order específica
//   - { reconcile: true, limit?: number, days?: number }
//                              → procura orders pagas SEM registro em meta_capi_purchase_log
//                                e dispara Purchase para cada uma (rate-limited)
//
// Requer SERVICE ROLE (verify_jwt=true). Idempotência via event_id determinístico
// (purchase_order_<order_id>) — Meta deduplica do lado deles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function computeOrderValue(order: any): number {
  const products = Array.isArray(order?.products) ? order.products : [];
  let subtotal = 0;
  for (const p of products) {
    const price = Number(p?.price) || 0;
    const qty = Number(p?.quantity) || 0;
    subtotal += price * qty;
  }
  let total = subtotal;
  if (order?.discount_type === "fixed") {
    total -= Number(order?.discount_value) || 0;
  } else if (order?.discount_type === "percentage") {
    total -= subtotal * ((Number(order?.discount_value) || 0) / 100);
  }
  if (!order?.free_shipping) {
    total += Number(order?.shipping_cost) || 0;
  }
  return Math.max(0, Math.round(total * 100) / 100);
}

async function dispatchOne(supabase: any, supabaseUrl: string, serviceKey: string, order: any) {
  const value = computeOrderValue(order);
  if (value <= 0) {
    await supabase.from("meta_capi_purchase_log").upsert({
      order_id: order.id,
      event_name: "Purchase",
      event_id: `purchase_order_${order.id}`,
      status: "skipped",
      error_message: "order value <= 0",
      sent_at: new Date().toISOString(),
    }, { onConflict: "order_id,event_name" });
    return { order_id: order.id, status: "skipped", reason: "value<=0" };
  }

  const content_ids = (order.products || [])
    .map((p: any) => p?.sku || p?.id || p?.title)
    .filter(Boolean);

  const num_items = (order.products || [])
    .reduce((s: number, p: any) => s + (Number(p?.quantity) || 0), 0);

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/meta-capi-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        event_name: "Purchase",
        event_id: `purchase_order_${order.id}`,
        order_id: order.id,
        value,
        currency: "BRL",
        content_ids,
        content_type: "product",
        num_items,
        action_source: "website",
      }),
    });
    const json = await resp.json().catch(() => ({}));
    return { order_id: order.id, http_status: resp.status, ok: resp.ok, response: json };
  } catch (e: any) {
    await supabase.from("meta_capi_purchase_log").upsert({
      order_id: order.id,
      event_name: "Purchase",
      event_id: `purchase_order_${order.id}`,
      status: "error",
      error_message: String(e?.message || e),
    }, { onConflict: "order_id,event_name" });
    return { order_id: order.id, ok: false, error: String(e?.message || e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Mode 1: single order retry
    if (body?.order_id) {
      const { data: order, error } = await supabase
        .from("orders")
        .select("id, products, discount_type, discount_value, free_shipping, shipping_cost")
        .eq("id", body.order_id)
        .maybeSingle();
      if (error || !order) {
        return new Response(JSON.stringify({ ok: false, error: "order not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await dispatchOne(supabase, supabaseUrl, serviceKey, order);
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mode 2: reconcile — orders pagos sem log
    if (body?.reconcile) {
      const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 500);
      const days = Math.min(Math.max(Number(body?.days) || 30, 1), 365);
      const since = new Date(Date.now() - days * 86400000).toISOString();

      // Find paid orders not yet logged
      const { data: logged } = await supabase
        .from("meta_capi_purchase_log")
        .select("order_id");
      const loggedIds = new Set((logged || []).map((r: any) => r.order_id));

      const { data: candidates } = await supabase
        .from("orders")
        .select("id, products, discount_type, discount_value, free_shipping, shipping_cost, stage, is_paid, paid_externally, created_at")
        .gte("created_at", since)
        .or("stage.eq.paid,is_paid.eq.true,paid_externally.eq.true")
        .order("created_at", { ascending: false })
        .limit(limit * 2);

      const toProcess = (candidates || [])
        .filter((o: any) => !loggedIds.has(o.id))
        .slice(0, limit);

      const results: any[] = [];
      for (const order of toProcess) {
        const r = await dispatchOne(supabase, supabaseUrl, serviceKey, order);
        results.push(r);
        await new Promise((r) => setTimeout(r, 200)); // rate limit
      }

      return new Response(JSON.stringify({
        ok: true,
        scanned: candidates?.length || 0,
        processed: results.length,
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "provide order_id or reconcile=true" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta-capi-purchase-retry] error:", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

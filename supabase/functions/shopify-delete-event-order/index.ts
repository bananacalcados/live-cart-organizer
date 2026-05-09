import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN")!;
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;

    const anon = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await anon.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);

    const userId = claims.claims.sub;
    const service = createClient(supabaseUrl, serviceKey);
    const [{ data: isAdmin }, { data: isManager }] = await Promise.all([
      service.rpc("has_role", { _user_id: userId, _role: "admin" }),
      service.rpc("has_role", { _user_id: userId, _role: "manager" }),
    ]);
    if (!isAdmin && !isManager) return json({ error: "Forbidden" }, 403);

    const { orderId, mode = "delete" } = await req.json();
    if (!orderId) return json({ error: "orderId is required" }, 400);
    // mode: "unlink" | "delete"

    const { data: order, error: orderErr } = await service
      .from("orders")
      .select("id, shopify_order_id, shopify_order_name")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) return json({ error: "Order not found" }, 404);

    if (mode === "unlink") {
      await service
        .from("orders")
        .update({ shopify_order_id: null, shopify_order_name: null })
        .eq("id", orderId);
      return json({ success: true, mode: "unlink" });
    }

    let shopifyOrderId = order.shopify_order_id;

    // Backfill: if we only have the name, try to resolve the numeric id
    if (!shopifyOrderId && order.shopify_order_name) {
      const nameQuery = order.shopify_order_name.replace(/^#/, "");
      const r = await fetch(
        `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&name=${encodeURIComponent(nameQuery)}`,
        { headers: { "X-Shopify-Access-Token": shopifyToken } },
      );
      if (r.ok) {
        const data = await r.json();
        const found = data?.orders?.[0];
        if (found?.id) shopifyOrderId = String(found.id);
      }
    }

    if (!shopifyOrderId) {
      // Nothing to delete on Shopify, just unlink
      await service
        .from("orders")
        .update({ shopify_order_id: null, shopify_order_name: null })
        .eq("id", orderId);
      return json({ success: true, mode: "delete", note: "no_shopify_id_found_unlinked_only" });
    }

    // Step 1: cancel
    const cancelRes = await fetch(
      `https://${shopifyDomain}/admin/api/2025-01/orders/${shopifyOrderId}/cancel.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify({ email: false, restock: false, reason: "other" }),
      },
    );

    if (!cancelRes.ok) {
      const errBody = await cancelRes.text();
      const lower = errBody.toLowerCase();
      // 422 with "cancel" usually means already cancelled — ok to proceed to delete
      if (!(cancelRes.status === 422 && lower.includes("cancel"))) {
        console.warn("Cancel failed:", cancelRes.status, errBody);
        // not fatal — try delete anyway
      }
    } else {
      await cancelRes.text();
    }

    // Step 2: delete
    const delRes = await fetch(
      `https://${shopifyDomain}/admin/api/2025-01/orders/${shopifyOrderId}.json`,
      {
        method: "DELETE",
        headers: { "X-Shopify-Access-Token": shopifyToken },
      },
    );

    let deleted = delRes.ok;
    if (!delRes.ok) {
      const txt = await delRes.text();
      console.warn("Delete failed:", delRes.status, txt);
      // If 404, treat as already deleted
      if (delRes.status === 404) deleted = true;
    } else {
      await delRes.text();
    }

    // Always unlink from our side
    await service
      .from("orders")
      .update({ shopify_order_id: null, shopify_order_name: null })
      .eq("id", orderId);

    return json({ success: true, mode: "delete", deleted, shopifyOrderId });
  } catch (e) {
    console.error("shopify-delete-event-order error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

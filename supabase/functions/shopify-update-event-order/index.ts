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

/**
 * Estratégia: cancel + recreate.
 * 1. Chama shopify-delete-event-order (mode=delete) — cancela e apaga o pedido atual na Shopify.
 * 2. Chama shopify-create-order — recria com os dados atuais do nosso banco.
 * O número (#XXXX) muda, é inevitável nessa estratégia.
 */
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

    const { orderId, reason } = await req.json();
    if (!orderId) return json({ error: "orderId is required" }, 400);

    // Snapshot do pedido atual antes de apagar
    const { data: snapBefore } = await service
      .from("orders")
      .select("shopify_order_id, shopify_order_name")
      .eq("id", orderId)
      .single();

    // Step 1: delete existing Shopify order (cancel + delete + unlink)
    const delRes = await fetch(`${supabaseUrl}/functions/v1/shopify-delete-event-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: anonKey,
      },
      body: JSON.stringify({ orderId, mode: "delete" }),
    });
    const delData = await delRes.json();
    if (!delRes.ok) {
      return json({ error: "Failed to delete previous Shopify order", details: delData }, 500);
    }

    // Step 2: recreate
    const createRes = await fetch(`${supabaseUrl}/functions/v1/shopify-create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: anonKey,
      },
      body: JSON.stringify({ orderId }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      return json({ error: "Failed to recreate Shopify order", details: createData }, 500);
    }

    // Step 3: registra histórico
    await service.from("order_shopify_history").insert({
      order_id: orderId,
      previous_shopify_order_id: snapBefore?.shopify_order_id || null,
      previous_shopify_order_name: snapBefore?.shopify_order_name || null,
      new_shopify_order_id: createData?.shopifyOrderId ? String(createData.shopifyOrderId) : null,
      new_shopify_order_name: createData?.shopifyOrderName || null,
      action: "exchange",
      reason: reason || "Troca de produto/tamanho",
      performed_by: userId,
    });

    return json({
      success: true,
      previous: {
        shopifyOrderId: snapBefore?.shopify_order_id || null,
        shopifyOrderName: snapBefore?.shopify_order_name || null,
      },
      current: {
        shopifyOrderId: createData.shopifyOrderId,
        shopifyOrderName: createData.shopifyOrderName,
      },
    });
  } catch (e) {
    console.error("shopify-update-event-order error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

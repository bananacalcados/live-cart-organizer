import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    if (!supabaseUrl || !anonKey || !serviceKey || !shopifyDomain || !shopifyToken) {
      throw new Error("Missing backend configuration");
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );

    if (claimsError || !claimsData?.claims?.sub) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const callerId = claimsData.claims.sub;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const [{ data: isAdmin }, { data: isManager }] = await Promise.all([
      serviceClient.rpc("has_role", { _user_id: callerId, _role: "admin" }),
      serviceClient.rpc("has_role", { _user_id: callerId, _role: "manager" }),
    ]);

    if (!isAdmin && !isManager) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const {
      sessionId,
      shopifyOrderId,
      shopifyOrderName,
      duplicateGroupKey,
      customerName,
      customerPhoneNormalized,
      customerEmailNormalized,
      customerCpfNormalized,
      lineSignature,
      lineItems,
      resolutionNotes,
    } = await req.json();

    if (!shopifyOrderId) {
      return jsonResponse({ error: "shopifyOrderId is required" }, 400);
    }

    const cancelResponse = await fetch(`https://${shopifyDomain}/admin/api/2025-01/orders/${shopifyOrderId}/cancel.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken,
      },
      body: JSON.stringify({
        email: false,
        restock: false,
        reason: "other",
      }),
    });

    let status: "cancelled" | "already_cancelled" = "cancelled";

    if (!cancelResponse.ok) {
      const errorBody = await cancelResponse.text();
      const normalizedError = errorBody.toLowerCase();
      if (cancelResponse.status === 422 && normalizedError.includes("cancel")) {
        status = "already_cancelled";
      } else {
        throw new Error(`Shopify API error ${cancelResponse.status}: ${errorBody}`);
      }
    }

    const now = new Date().toISOString();
    const { data: existingRows, error: existingRowsError } = await serviceClient
      .from("shopify_live_order_syncs")
      .select("id")
      .eq("shopify_order_id", String(shopifyOrderId));

    if (existingRowsError) throw existingRowsError;

    if (existingRows && existingRows.length > 0) {
      await Promise.all(existingRows.map((row) =>
        serviceClient
          .from("shopify_live_order_syncs")
          .update({
            sync_status: "cancelled",
            duplicate_group_key: duplicateGroupKey || null,
            reviewed_at: now,
            reviewed_by: callerId,
            review_status: "resolved",
            resolution_action: "cancelled",
            resolution_notes: resolutionNotes || "Cancelado manualmente na revisão de duplicados.",
            cancelled_at: now,
            cancelled_by: callerId,
          })
          .eq("id", row.id)
      ));
    } else {
      const { error: insertError } = await serviceClient.from("shopify_live_order_syncs").insert({
        dedupe_key: `manual-cancel:${shopifyOrderId}`,
        session_id: sessionId || null,
        source: "live-duplicate-review",
        customer_name: customerName || null,
        customer_phone_normalized: customerPhoneNormalized || null,
        customer_email_normalized: customerEmailNormalized || null,
        customer_cpf_normalized: customerCpfNormalized || null,
        line_signature: lineSignature || `shopify:${shopifyOrderId}`,
        line_items: Array.isArray(lineItems) ? lineItems : [],
        shopify_order_id: String(shopifyOrderId),
        shopify_order_name: shopifyOrderName || null,
        sync_status: "cancelled",
        is_duplicate_candidate: true,
        duplicate_group_key: duplicateGroupKey || null,
        duplicate_reason: "Cancelado manualmente na revisão de duplicados.",
        reviewed_at: now,
        reviewed_by: callerId,
        review_status: "resolved",
        resolution_action: "cancelled",
        resolution_notes: resolutionNotes || "Cancelado manualmente na revisão de duplicados.",
        cancelled_at: now,
        cancelled_by: callerId,
      });

      if (insertError) throw insertError;
    }

    await serviceClient
      .from("shopify_live_order_locks")
      .update({ status: "cancelled", updated_at: now, last_seen_at: now })
      .eq("shopify_order_id", String(shopifyOrderId));

    return jsonResponse({
      success: true,
      status,
      shopifyOrderId: String(shopifyOrderId),
      shopifyOrderName: shopifyOrderName || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error cancelling live Shopify order:", message);
    return jsonResponse({ error: message }, 500);
  }
});
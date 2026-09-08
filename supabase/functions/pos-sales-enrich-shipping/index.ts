import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * Preenche a forma de envio (e a marcação de retirada na loja) das vendas
 * vindas da Shopify que estão em aberto na Expedição e ficaram sem essa
 * informação. Best-effort: qualquer pedido que falhe é apenas ignorado.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN") || Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) return json({ error: "Shopify não configurado" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: sales } = await supabase
      .from("pos_sales")
      .select("id, external_order_id")
      .eq("external_source", "shopify")
      .is("shipping_carrier", null)
      .in("expedition_stage", ["novo", "preparacao", "separacao", "conferencia"])
      .limit(100);

    let updated = 0;
    let pickups = 0;
    for (const s of (sales || []) as any[]) {
      if (!s.external_order_id) continue;
      try {
        await new Promise((r) => setTimeout(r, 300));
        const r = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${s.external_order_id}.json?fields=id,shipping_lines`,
          { headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" } },
        );
        if (!r.ok) continue;
        const body = await r.json();
        const title = String(body?.order?.shipping_lines?.[0]?.title || "").trim();
        if (!title) continue;
        const isPickup = /retirad|retirar|pickup/i.test(title);
        await supabase
          .from("pos_sales")
          .update({
            shipping_carrier: isPickup ? "Retirada na loja" : title,
            is_store_pickup: isPickup,
          })
          .eq("id", s.id);
        updated++;
        if (isPickup) pickups++;
      } catch {
        /* best-effort */
      }
    }

    return json({ checked: (sales || []).length, updated, pickups });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

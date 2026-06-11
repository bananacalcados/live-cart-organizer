// Registra clique em um botão da Link Page (server-side, service role).
// Incrementa contador do item e da página, vincula vendedora/lead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { pageId, itemId, sellerId, leadId, utm_source, referrer } = await req.json();
    if (!pageId) {
      return new Response(JSON.stringify({ error: "pageId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await supabase.from("link_page_visits").insert({
      page_id: pageId,
      item_id: itemId || null,
      event_type: "click",
      seller_id: sellerId || null,
      lead_id: leadId || null,
      utm_source: utm_source || null,
      referrer: referrer || null,
    });

    if (itemId) {
      const { data: item } = await supabase.from("link_page_items").select("clicks").eq("id", itemId).maybeSingle();
      await supabase.from("link_page_items").update({ clicks: (item?.clicks || 0) + 1 }).eq("id", itemId);
    }
    const { data: page } = await supabase.from("link_pages").select("total_clicks").eq("id", pageId).maybeSingle();
    await supabase.from("link_pages").update({ total_clicks: (page?.total_clicks || 0) + 1 }).eq("id", pageId);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[link-page-track-click]", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

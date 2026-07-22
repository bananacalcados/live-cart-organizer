// Live IG redirect — resolves the active broadcasting event and returns the target IG url.
// Logs each click (non-blocking) for analytics.
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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();
    const phone = url.searchParams.get("lead") || url.searchParams.get("phone") || null;
    const utmSource = url.searchParams.get("utm_source") || null;

    if (!slug) {
      return json({ error: "slug is required" }, 400);
    }

    const { data: link } = await supabase
      .from("live_redirect_links")
      .select("id, is_active, click_count")
      .eq("slug", slug)
      .maybeSingle();

    if (!link) {
      return json({ error: "not_found", is_live: false, target_url: null }, 404);
    }
    if (!link.is_active) {
      return json({ error: "paused", is_live: false, target_url: null }, 200);
    }

    const { data: activeEvent } = await supabase
      .from("events")
      .select("id, name, instagram_live_url")
      .eq("is_live_broadcasting", true)
      .not("instagram_live_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const targetUrl = activeEvent?.instagram_live_url || null;

    // Fire-and-forget: increment counter + log click
    supabase
      .from("live_redirect_links")
      .update({ click_count: (link.click_count || 0) + 1 })
      .eq("id", link.id)
      .then(() => {});

    supabase
      .from("live_redirect_clicks")
      .insert({
        redirect_id: link.id,
        event_id: activeEvent?.id ?? null,
        phone,
        utm_source: utmSource,
        user_agent: req.headers.get("user-agent") ?? null,
        target_url: targetUrl,
      })
      .then(() => {});

    return json({
      is_live: Boolean(targetUrl),
      target_url: targetUrl,
      event_name: activeEvent?.name ?? null,
    });
  } catch (err) {
    console.error("[live-redirect] error:", err);
    return json({ error: String((err as Error).message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

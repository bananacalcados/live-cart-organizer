// Live IG redirect — resolves the active broadcasting event and returns the target IG url.
// Enforces a TTL on the broadcast (3h since it was activated OR since the IG url was last
// refreshed) to prevent an old/stale link from being served. Auto-deactivates on TTL expiry.
// Also runs a lightweight HEAD validation on the IG url (cached ~30s in memory).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// TTL: how long a broadcast is considered "fresh" after activation OR last URL refresh.
const BROADCAST_TTL_HOURS = 3;
const HEAD_CACHE_TTL_MS = 30_000;

// In-memory HEAD cache (per isolate). Small and fine for our traffic.
const headCache = new Map<string, { ok: boolean; at: number }>();

async function validateInstagramUrl(url: string): Promise<boolean> {
  const cached = headCache.get(url);
  if (cached && Date.now() - cached.at < HEAD_CACHE_TTL_MS) return cached.ok;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    // Instagram often returns 200/302 for live; treat <500 as reachable.
    const ok = res.status < 500;
    headCache.set(url, { ok, at: Date.now() });
    return ok;
  } catch {
    headCache.set(url, { ok: false, at: Date.now() });
    return false;
  }
}

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

    if (!slug) return json({ error: "slug is required" }, 400);

    const { data: link } = await supabase
      .from("live_redirect_links")
      .select("id, is_active, click_count")
      .eq("slug", slug)
      .maybeSingle();

    if (!link) return json({ error: "not_found", is_live: false, target_url: null }, 404);
    if (!link.is_active) return json({ error: "paused", is_live: false, target_url: null }, 200);

    const { data: activeEvent } = await supabase
      .from("events")
      .select("id, name, instagram_live_url, live_broadcast_started_at, live_url_updated_at")
      .eq("is_live_broadcasting", true)
      .not("instagram_live_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let targetUrl: string | null = activeEvent?.instagram_live_url || null;
    let reason: string | null = null;

    if (activeEvent && targetUrl) {
      const startedAt = activeEvent.live_broadcast_started_at
        ? new Date(activeEvent.live_broadcast_started_at).getTime()
        : 0;
      const urlAt = activeEvent.live_url_updated_at
        ? new Date(activeEvent.live_url_updated_at).getTime()
        : startedAt;
      const freshestAt = Math.max(startedAt, urlAt);
      const ageMs = Date.now() - freshestAt;
      const ttlMs = BROADCAST_TTL_HOURS * 60 * 60 * 1000;

      if (freshestAt > 0 && ageMs > ttlMs) {
        // Auto-deactivate stale broadcast.
        targetUrl = null;
        reason = "ttl_expired";
        supabase
          .from("events")
          .update({ is_live_broadcasting: false })
          .eq("id", activeEvent.id)
          .then(() => {});
      } else {
        const ok = await validateInstagramUrl(targetUrl);
        if (!ok) {
          targetUrl = null;
          reason = "url_unreachable";
        }
      }
    }

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
      reason,
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

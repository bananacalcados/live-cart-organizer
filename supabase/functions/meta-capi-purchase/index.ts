// Meta Conversions API — Purchase event
// Sends a Purchase event to Meta Pixel via server-side API after a sale is concluded.
//
// Required env:
//   - VITE_META_PIXEL_ID                  (Pixel id, also used by browser pixel)
//   - META_CAPI_ACCESS_TOKEN              (Pixel system user token, preferred)
//     fallback: META_PAGE_ACCESS_TOKEN    (may work if it carries ads_management)
//   - META_TEST_EVENT_CODE (optional)     (for Meta Events Manager test mode)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      conversion_id,
      phone,
      value,
      currency = "BRL",
      trigger_id = null,
      event_id: eventIdFromClient,
    } = body || {};

    if (!phone || !value || value <= 0) {
      return new Response(
        JSON.stringify({ error: "phone and positive value are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const PIXEL_ID = Deno.env.get("VITE_META_PIXEL_ID");
    const TOKEN =
      Deno.env.get("META_CAPI_ACCESS_TOKEN") ??
      Deno.env.get("META_PAGE_ACCESS_TOKEN");
    const TEST_CODE = Deno.env.get("META_TEST_EVENT_CODE");

    if (!PIXEL_ID || !TOKEN) {
      return new Response(
        JSON.stringify({
          ok: false,
          skipped: true,
          reason: "missing META pixel id or access token",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const eventId =
      eventIdFromClient ||
      (conversion_id ? `conv_${conversion_id}` : `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    const phoneDigits = normalizePhone(phone);
    const ph = phoneDigits ? await sha256Hex(phoneDigits) : undefined;

    const eventTime = Math.floor(Date.now() / 1000);

    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime,
          event_id: eventId,
          action_source: "system_generated",
          user_data: {
            ph: ph ? [ph] : undefined,
            client_user_agent: req.headers.get("user-agent") || undefined,
          },
          custom_data: {
            currency,
            value: Number(value),
            content_ids: trigger_id ? [trigger_id] : undefined,
            content_type: trigger_id ? "trigger" : undefined,
          },
        },
      ],
    };

    if (TEST_CODE) (payload as any).test_event_code = TEST_CODE;

    const url = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const respJson = await resp.json().catch(() => ({}));

    // Update conversion record with CAPI result
    if (conversion_id) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase
        .from("trigger_conversions")
        .update({
          meta_capi_event_id: eventId,
          meta_capi_sent_at: new Date().toISOString(),
          meta_capi_response: respJson,
        })
        .eq("id", conversion_id);
    }

    return new Response(
      JSON.stringify({
        ok: resp.ok,
        status: resp.status,
        event_id: eventId,
        meta_response: respJson,
      }),
      {
        status: resp.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Meta Conversions API — Lead & CompleteRegistration events
// Dispara eventos de Lead (entrada no WhatsApp) ou CompleteRegistration
// (final da sequência de mensagens automáticas) para o Pixel da Meta via CAPI.
//
// Required env:
//   - VITE_META_PIXEL_ID         (Pixel/Dataset ID)
//   - META_CAPI_ACCESS_TOKEN     (Token CAPI)
//
// Body:
//   - phone (string, obrigatório) — telefone E.164 (com ou sem +)
//   - event_name ('Lead' | 'CompleteRegistration', default 'Lead')
//   - campaign_id (uuid, opcional)
//   - campaign_slug (string, opcional)
//   - campaign_name (string, opcional)
//   - full_name (string, opcional)
//   - source_url (string, opcional)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

function normalizeName(raw: string): string {
  return stripAccents((raw || "").trim().toLowerCase());
}

function splitName(full: string | null | undefined): { first?: string; last?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      phone,
      event_name = "Lead",
      campaign_id = null,
      campaign_slug = null,
      campaign_name = null,
      full_name = null,
      source_url = null,
      event_time = null, // optional UNIX seconds (for backfill up to 7 days)
    } = body || {};

    if (!phone) {
      return new Response(
        JSON.stringify({ error: "phone is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!["Lead", "CompleteRegistration"].includes(event_name)) {
      return new Response(
        JSON.stringify({ error: "event_name must be Lead or CompleteRegistration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const PIXEL_ID = Deno.env.get("VITE_META_PIXEL_ID");
    const TOKEN =
      Deno.env.get("META_CAPI_ACCESS_TOKEN") ??
      Deno.env.get("META_PAGE_ACCESS_TOKEN");

    if (!PIXEL_ID || !TOKEN) {
      return new Response(
        JSON.stringify({ ok: false, skipped: true, reason: "missing pixel id or access token" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const phoneDigits = normalizePhone(phone);

    // Idempotência: 1 evento por (phone, event_name, campaign_id) por dia (do evento)
    const eventTimeSec = event_time && Number.isFinite(event_time) ? Math.floor(event_time) : Math.floor(Date.now() / 1000);
    const dayKey = new Date(eventTimeSec * 1000).toISOString().slice(0, 10);
    const eventId = `${event_name.toLowerCase()}_${phoneDigits}_${campaign_id || "noc"}_${dayKey}`;

    // Verifica duplicação
    const { data: existing } = await supabase
      .from("meta_capi_lead_events")
      .select("id, status")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing?.status === "sent") {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "already_sent", event_id: eventId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cria registro pending
    if (!existing) {
      await supabase.from("meta_capi_lead_events").insert({
        phone: phoneDigits,
        event_name,
        event_id: eventId,
        campaign_id,
        campaign_slug,
        pixel_id: PIXEL_ID,
        status: "pending",
      });
    }

    // Enriquecer com CRM (best-effort) se nome não veio
    let resolvedName = full_name as string | null;
    if (!resolvedName) {
      try {
        const phoneSuffix = phoneDigits.slice(-8);
        const { data: zc } = await supabase
          .from("crm_customers_v")
          .select("first_name, last_name")
          .or(`phone.ilike.%${phoneSuffix}`)
          .limit(1)
          .maybeSingle();
        if (zc) {
          const composed = [zc.first_name, zc.last_name].filter(Boolean).join(" ").trim();
          if (composed) resolvedName = composed;
        }
      } catch {}
    }

    const ph = phoneDigits ? await sha256Hex(phoneDigits) : undefined;
    const { first: firstRaw, last: lastRaw } = splitName(resolvedName);
    const fn = firstRaw ? await sha256Hex(normalizeName(firstRaw)) : undefined;
    const ln = lastRaw ? await sha256Hex(normalizeName(lastRaw)) : undefined;
    const co = await sha256Hex("br");

    const userData: Record<string, unknown> = {
      ph: ph ? [ph] : undefined,
      fn: fn ? [fn] : undefined,
      ln: ln ? [ln] : undefined,
      country: [co],
    };
    Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

    const payload = {
      data: [
        {
          event_name,
          event_time: eventTimeSec,
          event_id: eventId,
          action_source: "chat",
          event_source_url: source_url || undefined,
          user_data: userData,
          custom_data: {
            content_name: campaign_name || campaign_slug || "live_campaign",
            content_category: "whatsapp_lead",
            ...(campaign_slug ? { content_ids: [campaign_slug] } : {}),
          },
        },
      ],
    };

    const url = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const respJson = await resp.json().catch(() => ({}));

    await supabase
      .from("meta_capi_lead_events")
      .update({
        status: resp.ok ? "sent" : "error",
        meta_response: respJson,
        error_message: resp.ok ? null : `HTTP ${resp.status}`,
        sent_at: new Date().toISOString(),
      })
      .eq("event_id", eventId);

    return new Response(
      JSON.stringify({
        ok: resp.ok,
        status: resp.status,
        event_id: eventId,
        event_name,
        meta_response: respJson,
      }),
      {
        status: resp.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta-capi-lead] error:", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

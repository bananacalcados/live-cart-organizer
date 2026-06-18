// Meta Conversions API — Generic event dispatcher
// Sends standard events (InitiateCheckout, AddPaymentInfo, AddShippingInfo, Purchase, Lead, etc.)
// to the ONLINE Meta Pixel via server-side API.
//
// Required env:
//   - VITE_META_PIXEL_ID                  (Online pixel id, e.g. 722468550447865)
//   - META_CAPI_ACCESS_TOKEN              (Pixel system user token, preferred)
//     fallback: META_PAGE_ACCESS_TOKEN
//   - META_TEST_EVENT_CODE (optional)     (for Meta Events Manager test mode)
//
// All PII is hashed SHA-256 (lowercased, trimmed). fbc/fbp/UA/IP are sent in plain text.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

// ============ Hashing & normalization helpers ============
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
function normalizeEmail(raw: string): string {
  return (raw || "").trim().toLowerCase();
}
function normalizeName(raw: string): string {
  return stripAccents((raw || "").trim().toLowerCase());
}
function normalizeCity(raw: string): string {
  return stripAccents((raw || "").toLowerCase()).replace(/[^a-z0-9]/g, "");
}
function normalizeState(raw: string): string {
  return stripAccents((raw || "").trim().toLowerCase()).replace(/[^a-z]/g, "");
}
function normalizeCountry(raw: string): string {
  const c = (raw || "br").trim().toLowerCase();
  return c.length === 2 ? c : "br";
}
function normalizeZip(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}
async function hashIfPresent(raw: string | null | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return await sha256Hex(trimmed);
}
function splitName(full: string | null | undefined): { first?: string; last?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
function extractClientIp(req: Request): string | undefined {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xreal = req.headers.get("x-real-ip");
  if (xreal) return xreal.trim();
  return undefined;
}

// Meta standard events we explicitly support
const STANDARD_EVENTS = new Set([
  "InitiateCheckout",
  "AddPaymentInfo",
  "AddShippingInfo",
  "Purchase",
  "Lead",
  "CompleteRegistration",
  "AddToCart",
  "ViewContent",
  "Search",
  "Contact",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      event_name,
      event_id: eventIdFromClient,
      order_id,
      value,
      currency = "BRL",
      content_ids,
      content_type,
      num_items,
      // PII (raw — will be hashed)
      phone,
      email,
      full_name,
      cpf, // optional external_id
      city,
      state,
      zip,
      country,
      // Browser cookies / client signals (raw — sent as-is)
      fbc,
      fbp,
      client_user_agent,
      client_ip_address,
      // Meta config
      action_source: actionSourceFromClient,
      event_source_url,
      test_event_code: testCodeFromClient,
    } = body || {};

    if (!event_name || typeof event_name !== "string") {
      return new Response(
        JSON.stringify({ error: "event_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Purchase REQUIRES value
    if (event_name === "Purchase" && (!value || Number(value) <= 0)) {
      return new Response(
        JSON.stringify({ error: "Purchase requires a positive value" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const PIXEL_ID = Deno.env.get("VITE_META_PIXEL_ID");
    const TOKEN =
      Deno.env.get("META_CAPI_ACCESS_TOKEN") ??
      Deno.env.get("META_PAGE_ACCESS_TOKEN");
    const TEST_CODE =
      (typeof testCodeFromClient === "string" && testCodeFromClient.trim())
        ? testCodeFromClient.trim()
        : Deno.env.get("META_TEST_EVENT_CODE");

    if (!PIXEL_ID || !TOKEN) {
      return new Response(
        JSON.stringify({ ok: false, skipped: true, reason: "missing pixel id or access token" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============ Optional enrichment from CRM (best-effort, only when phone is present) ============
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let _email = email as string | undefined;
    let _fullName = full_name as string | undefined;
    let _city = city as string | undefined;
    let _state = state as string | undefined;
    let _zip = zip as string | undefined;
    let _phone = phone as string | undefined;
    let _cpf = cpf as string | undefined;
    let _fbp = fbp as string | undefined;
    let _fbc = fbc as string | undefined;

    // If order_id is provided, enrich PII from customer_registrations (gold source for checkout)
    if (order_id) {
      try {
        const { data: cr } = await supabase
          .from("customer_registrations")
          .select("full_name, email, whatsapp, city, state, cep, cpf, fbp, fbc")
          .eq("order_id", order_id)
          .maybeSingle();
        if (cr) {
          _phone = _phone ?? (cr.whatsapp as string | undefined) ?? undefined;
          _email = _email ?? (cr.email as string | undefined) ?? undefined;
          _fullName = _fullName ?? (cr.full_name as string | undefined) ?? undefined;
          _city = _city ?? (cr.city as string | undefined) ?? undefined;
          _state = _state ?? (cr.state as string | undefined) ?? undefined;
          _zip = _zip ?? (cr.cep as string | undefined) ?? undefined;
          _cpf = _cpf ?? (cr.cpf as string | undefined) ?? undefined;
          _fbp = _fbp ?? (cr.fbp as string | undefined) ?? undefined;
          _fbc = _fbc ?? (cr.fbc as string | undefined) ?? undefined;
        }
      } catch (e) {
        console.warn("[meta-capi-event] order enrichment failed:", e);
      }
    }

    const phoneDigits = _phone ? normalizePhone(_phone) : "";
    const phoneSuffix = phoneDigits.slice(-8);

    // Fallback enrichment via phone suffix if still missing
    if (phoneSuffix && (!_email || !_fullName || !_city || !_state)) {
      try {
        const { data: zc } = await supabase
          .from("crm_customers_v")
          .select("first_name, last_name, email, city, state")
          .or(`phone.ilike.%${phoneSuffix}`)
          .limit(1)
          .maybeSingle();
        if (zc) {
          _email = _email ?? (zc.email as string | undefined) ?? undefined;
          if (!_fullName) {
            const composed = [zc.first_name, zc.last_name].filter(Boolean).join(" ").trim();
            if (composed) _fullName = composed;
          }
          _city = _city ?? (zc.city as string | undefined) ?? undefined;
          _state = _state ?? (zc.state as string | undefined) ?? undefined;
        }
      } catch (e) {
        console.warn("[meta-capi-event] phone enrichment failed:", e);
      }
    }

    // ============ Build hashed user_data ============
    const ph = phoneDigits ? await sha256Hex(phoneDigits) : undefined;
    const em = _email ? await hashIfPresent(normalizeEmail(_email)) : undefined;

    const { first: firstRaw, last: lastRaw } = splitName(_fullName);
    const fn = firstRaw ? await hashIfPresent(normalizeName(firstRaw)) : undefined;
    const ln = lastRaw ? await hashIfPresent(normalizeName(lastRaw)) : undefined;

    const ct = _city ? await hashIfPresent(normalizeCity(_city)) : undefined;
    const st = _state ? await hashIfPresent(normalizeState(_state)) : undefined;
    const zp = _zip ? await hashIfPresent(normalizeZip(_zip)) : undefined;
    const co = await hashIfPresent(normalizeCountry(country || "BR"));

    // Optional external_id from CPF (digits only)
    let externalId: string | undefined;
    if (_cpf) {
      const cpfDigits = (_cpf as string).replace(/\D/g, "");
      if (cpfDigits.length >= 11) externalId = await sha256Hex(cpfDigits);
    }

    const clientIp = client_ip_address || extractClientIp(req);
    const clientUa = client_user_agent || req.headers.get("user-agent") || undefined;

    const userData: Record<string, unknown> = {
      ph: ph ? [ph] : undefined,
      em: em ? [em] : undefined,
      fn: fn ? [fn] : undefined,
      ln: ln ? [ln] : undefined,
      ct: ct ? [ct] : undefined,
      st: st ? [st] : undefined,
      zp: zp ? [zp] : undefined,
      country: co ? [co] : undefined,
      external_id: externalId ? [externalId] : undefined,
      fbc: _fbc || undefined,
      fbp: _fbp || undefined,
      client_user_agent: clientUa,
      client_ip_address: clientIp,
    };
    Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

    // event_id: prefer client-provided (browser dedupe). Otherwise build deterministic for Purchase.
    const eventId =
      eventIdFromClient ||
      (event_name === "Purchase" && order_id
        ? `purchase_order_${order_id}`
        : `${event_name.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    const eventTime = Math.floor(Date.now() / 1000);
    const actionSource = (actionSourceFromClient as string) || "website";

    const customData: Record<string, unknown> = {
      currency,
    };
    if (value !== undefined && value !== null) customData.value = Number(value);
    if (Array.isArray(content_ids) && content_ids.length > 0) {
      customData.content_ids = content_ids;
      customData.content_type = content_type || "product";
    }
    if (typeof num_items === "number") customData.num_items = num_items;
    if (order_id) customData.order_id = String(order_id);

    const eventData: Record<string, unknown> = {
      event_name,
      event_time: eventTime,
      event_id: eventId,
      action_source: actionSource,
      user_data: userData,
      custom_data: customData,
    };
    if (event_source_url) eventData.event_source_url = event_source_url;

    const payload: Record<string, unknown> = { data: [eventData] };
    if (TEST_CODE) (payload as any).test_event_code = TEST_CODE;

    // Pre-log: insert pending row for Purchase events tied to an order_id (idempotent)
    const shouldLog = event_name === "Purchase" && !!order_id;
    if (shouldLog) {
      try {
        await supabase.from("meta_capi_purchase_log").upsert({
          order_id: String(order_id),
          event_name: "Purchase",
          event_id: eventId,
          pixel_id: PIXEL_ID,
          test_event_code: TEST_CODE || null,
          status: "pending",
          payload_summary: {
            value: Number(value),
            currency,
            num_items: typeof num_items === "number" ? num_items : null,
            content_ids: Array.isArray(content_ids) ? content_ids : null,
            enriched: {
              has_phone: !!ph, has_email: !!em, has_name: !!fn,
              has_city: !!ct, has_state: !!st, has_zip: !!zp,
              has_external_id: !!externalId, has_fbc: !!_fbc, has_fbp: !!_fbp,
              has_ip: !!clientIp,
            },
            action_source: actionSource,
          },
        }, { onConflict: "order_id,event_name" });
      } catch (e) {
        console.warn("[meta-capi-event] pre-log failed:", e);
      }
    }

    const url = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const respJson = await resp.json().catch(() => ({}));

    // Post-log: update result for Purchase events
    if (shouldLog) {
      try {
        await supabase
          .from("meta_capi_purchase_log")
          .update({
            status: resp.ok ? "sent" : "error",
            http_status: resp.status,
            meta_response: respJson,
            error_message: resp.ok ? null : (respJson?.error?.message || `HTTP ${resp.status}`),
            sent_at: new Date().toISOString(),
          })
          .eq("order_id", String(order_id))
          .eq("event_name", "Purchase");
      } catch (e) {
        console.warn("[meta-capi-event] post-log failed:", e);
      }
    }

    // Best-effort: persist Purchase send timestamp on the order
    if (event_name === "Purchase" && order_id && resp.ok) {
      try {
        await supabase
          .from("orders")
          .update({ meta_capi_purchase_sent_at: new Date().toISOString() })
          .eq("id", order_id);
      } catch (e) {
        console.warn("[meta-capi-event] failed to mark order as sent:", e);
      }
    }


    return new Response(
      JSON.stringify({
        ok: resp.ok,
        status: resp.status,
        event_name,
        event_id: eventId,
        standard_event: STANDARD_EVENTS.has(event_name),
        test_event_code_applied: !!TEST_CODE,
        enriched: {
          has_phone: !!ph,
          has_email: !!em,
          has_name: !!fn,
          has_city: !!ct,
          has_state: !!st,
          has_zip: !!zp,
          has_external_id: !!externalId,
          has_fbc: !!_fbc,
          has_fbp: !!_fbp,
          has_ip: !!clientIp,
        },
        meta_response: respJson,
      }),
      {
        status: resp.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta-capi-event] error:", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

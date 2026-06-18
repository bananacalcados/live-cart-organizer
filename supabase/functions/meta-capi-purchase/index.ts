// Meta Conversions API — Purchase event
// Sends a Purchase event to Meta Pixel via server-side API after a sale is concluded.
//
// Required env:
//   - VITE_META_PIXEL_ID                  (Pixel id, also used by browser pixel)
//   - META_CAPI_ACCESS_TOKEN              (Pixel system user token, preferred)
//     fallback: META_PAGE_ACCESS_TOKEN    (may work if it carries ads_management)
//   - META_TEST_EVENT_CODE (optional)     (for Meta Events Manager test mode)
//
// PII Hashing strategy (SHA-256, lowercase, trimmed) per Meta CAPI spec:
//   - ph (phone)        : digits only, country code included if present
//   - em (email)        : lowercase + trim
//   - fn (first name)   : lowercase + trim, accents removed
//   - ln (last name)    : lowercase + trim, accents removed
//   - ct (city)         : lowercase, alphanumeric only
//   - st (state)        : lowercase, 2-letter code preferred
//   - country           : lowercase 2-letter ISO (br)
//   - fbc / fbp         : sent in PLAIN TEXT (Meta requires raw cookies, not hashed)
//   - client_user_agent : raw user-agent string (not hashed)
//   - client_ip_address : raw IPv4/IPv6 (not hashed)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============ Hashing & normalization helpers ============

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Remove accents (NFD decomposition + strip combining marks). */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Phone: digits only. Meta accepts with country code (no +). */
function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

/** Email: trim + lowercase. */
function normalizeEmail(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

/** Name: trim + lowercase + strip accents (first/last name). */
function normalizeName(raw: string): string {
  return stripAccents((raw || "").trim().toLowerCase());
}

/** City: lowercase + alphanumeric only (no spaces, no punctuation). */
function normalizeCity(raw: string): string {
  return stripAccents((raw || "").toLowerCase()).replace(/[^a-z0-9]/g, "");
}

/** State: lowercase, prefer 2-letter UF code. */
function normalizeState(raw: string): string {
  return stripAccents((raw || "").trim().toLowerCase()).replace(/[^a-z]/g, "");
}

/** Country: 2-letter ISO lowercase. */
function normalizeCountry(raw: string): string {
  const c = (raw || "br").trim().toLowerCase();
  return c.length === 2 ? c : "br";
}

/** Hash a value, returning undefined if input is empty. */
async function hashIfPresent(raw: string | null | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return await sha256Hex(trimmed);
}

/** Split a full name into first / last. */
function splitName(full: string | null | undefined): { first?: string; last?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Extract client IP from common Cloudflare / Supabase headers. */
function extractClientIp(req: Request): string | undefined {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xreal = req.headers.get("x-real-ip");
  if (xreal) return xreal.trim();
  return undefined;
}

// ============ Handler ============

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
      test_event_code: testEventCodeFromClient,
      // Optional enrichment passed from client
      email: emailFromClient,
      full_name: fullNameFromClient,
      city: cityFromClient,
      state: stateFromClient,
      country: countryFromClient,
      fbc: fbcFromClient,
      fbp: fbpFromClient,
      client_user_agent: uaFromClient,
      action_source: actionSourceFromClient,
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
    const TEST_CODE =
      (typeof testEventCodeFromClient === "string" && testEventCodeFromClient.trim())
        ? testEventCodeFromClient.trim()
        : Deno.env.get("META_TEST_EVENT_CODE");

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

    // ============ Enrich PII from CRM (best-effort) ============
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let email = emailFromClient as string | undefined;
    let fullName = fullNameFromClient as string | undefined;
    let city = cityFromClient as string | undefined;
    let state = stateFromClient as string | undefined;
    const country = countryFromClient || "BR";

    const phoneDigits = normalizePhone(phone);
    const phoneSuffix = phoneDigits.slice(-8);

    if (phoneSuffix && (!email || !fullName || !city || !state)) {
      try {
        // 1) zoppy_customers (primary CRM)
        const { data: zc } = await supabase
          .from("crm_customers_v")
          .select("first_name, last_name, email, city, state")
          .or(`phone.ilike.%${phoneSuffix}`)
          .limit(1)
          .maybeSingle();
        if (zc) {
          email = email ?? (zc.email as string | undefined) ?? undefined;
          if (!fullName) {
            const composed = [zc.first_name, zc.last_name].filter(Boolean).join(" ").trim();
            if (composed) fullName = composed;
          }
          city = city ?? (zc.city as string | undefined) ?? undefined;
          state = state ?? (zc.state as string | undefined) ?? undefined;
        }

        // 2) pos_customers fallback
        if (!email || !fullName) {
          const { data: pc } = await supabase
            .from("pos_customers")
            .select("name, email")
            .ilike("whatsapp", `%${phoneSuffix}`)
            .limit(1)
            .maybeSingle();
          if (pc) {
            email = email ?? (pc.email as string | undefined) ?? undefined;
            fullName = fullName ?? (pc.name as string | undefined) ?? undefined;
          }
        }

        // 3) customer_registrations fallback (latest known address)
        if (!city || !state) {
          const { data: cr } = await supabase
            .from("customer_registrations")
            .select("city, state, full_name, email")
            .ilike("whatsapp", `%${phoneSuffix}`)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cr) {
            city = city ?? (cr.city as string | undefined) ?? undefined;
            state = state ?? (cr.state as string | undefined) ?? undefined;
            email = email ?? (cr.email as string | undefined) ?? undefined;
            fullName = fullName ?? (cr.full_name as string | undefined) ?? undefined;
          }
        }
      } catch (enrichErr) {
        console.warn("[meta-capi-purchase] enrichment failed:", enrichErr);
      }
    }

    // ============ Build hashed user_data ============
    const ph = phoneDigits ? await sha256Hex(phoneDigits) : undefined;
    const em = email ? await hashIfPresent(normalizeEmail(email)) : undefined;

    const { first: firstRaw, last: lastRaw } = splitName(fullName);
    const fn = firstRaw ? await hashIfPresent(normalizeName(firstRaw)) : undefined;
    const ln = lastRaw ? await hashIfPresent(normalizeName(lastRaw)) : undefined;

    const ct = city ? await hashIfPresent(normalizeCity(city)) : undefined;
    const st = state ? await hashIfPresent(normalizeState(state)) : undefined;
    const co = await hashIfPresent(normalizeCountry(country));

    const clientIp = extractClientIp(req);
    const clientUa = uaFromClient || req.headers.get("user-agent") || undefined;

    const userData: Record<string, unknown> = {
      ph: ph ? [ph] : undefined,
      em: em ? [em] : undefined,
      fn: fn ? [fn] : undefined,
      ln: ln ? [ln] : undefined,
      ct: ct ? [ct] : undefined,
      st: st ? [st] : undefined,
      country: co ? [co] : undefined,
      // Raw (non-hashed) signals — Meta requires plain text for these:
      fbc: fbcFromClient || undefined,
      fbp: fbpFromClient || undefined,
      client_user_agent: clientUa,
      client_ip_address: clientIp,
    };

    // Strip undefined to keep payload clean
    Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

    const eventId =
      eventIdFromClient ||
      (conversion_id
        ? `conv_${conversion_id}`
        : `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    const eventTime = Math.floor(Date.now() / 1000);
    const actionSource = (actionSourceFromClient as string) || "chat";

    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime,
          event_id: eventId,
          action_source: actionSource,
          user_data: userData,
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

    // Persist CAPI result on the conversion record
    if (conversion_id) {
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
        test_event_code_applied: !!TEST_CODE,
        enriched: {
          has_email: !!em,
          has_name: !!fn,
          has_city: !!ct,
          has_state: !!st,
          has_fbc: !!fbcFromClient,
          has_fbp: !!fbpFromClient,
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
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

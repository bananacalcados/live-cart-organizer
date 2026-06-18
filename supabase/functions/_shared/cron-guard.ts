// Shared authentication guard for cron / background edge functions.
//
// These functions are invoked by pg_cron (and occasionally by other internal
// edge functions). They must NOT be callable by arbitrary internet actors,
// otherwise they could drain AI credits or trigger premature WhatsApp sends.
//
// Authentication accepts EITHER of:
//   1. The Supabase service role key (internal function-to-function calls).
//   2. A dedicated cron secret sent in the `x-cron-secret` header by pg_cron.
//
// The cron secret is stored in the server-side-only table
// `public.internal_function_secrets` (no anon/authenticated grants) and is read
// here with the service role key. The value is cached per cold start.
//
// NOTE: the public anon key is intentionally NOT accepted, because it is shipped
// in the frontend and therefore not a secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let cachedSecret: string | null = null;

async function getCronSecret(): Promise<string | null> {
  if (cachedSecret) return cachedSecret;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  try {
    const sb = createClient(url, serviceKey);
    const { data } = await sb
      .from("internal_function_secrets")
      .select("value")
      .eq("key", "cron_secret")
      .maybeSingle();
    cachedSecret = data?.value ?? null;
  } catch (_e) {
    cachedSecret = null;
  }
  return cachedSecret;
}

/**
 * Returns true if the request is an authorized internal/cron call.
 */
export async function isAuthorizedCron(req: Request): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const apiKey = req.headers.get("apikey") || "";

  // 1. Internal function-to-function calls carry the service role key.
  if (serviceKey && (authHeader === `Bearer ${serviceKey}` || apiKey === serviceKey)) {
    return true;
  }

  // 2. pg_cron jobs carry the dedicated cron secret.
  const provided = req.headers.get("x-cron-secret") || "";
  if (!provided) return false;
  const secret = await getCronSecret();
  return !!secret && provided === secret;
}

/**
 * Standard 401 response with CORS headers.
 */
export function unauthorizedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

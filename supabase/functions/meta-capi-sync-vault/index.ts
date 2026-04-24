// Sync META_CAPI_INTERNAL_SECRET from edge env into DB Vault.
// Call once after configuring/rotating the secret to keep DB triggers working.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const envSecret = Deno.env.get("META_CAPI_INTERNAL_SECRET");
    if (!envSecret || envSecret.length < 8) {
      return new Response(
        JSON.stringify({
          error:
            "META_CAPI_INTERNAL_SECRET não está configurado nas envs da Edge Function (mín 8 chars).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Read current vault state via RPC (avoids ts schema issues)
    const { data: current, error: readErr } = await admin.rpc(
      "get_meta_capi_vault_state",
    );
    if (readErr) throw readErr;

    const row = (current as any)?.[0] ?? current;
    const existingId: string | null = row?.id ?? null;
    const currentValue: string | null = row?.value ?? null;
    const isPlaceholder =
      !currentValue ||
      currentValue === "PLACEHOLDER_REPLACE_ME" ||
      currentValue.length < 8;

    // If vault already has a real secret, require caller to prove they know it
    if (!isPlaceholder) {
      const provided = req.headers.get("x-internal-secret");
      if (provided !== currentValue && provided !== envSecret) {
        return new Response(
          JSON.stringify({
            error:
              "Vault já tem um secret válido. Envie o valor atual em X-Internal-Secret para autorizar a rotação.",
          }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (existingId) {
      const { error } = await admin.rpc("update_meta_capi_vault_secret", {
        p_id: existingId,
        p_secret: envSecret,
      });
      if (error) throw error;
    } else {
      const { error } = await admin.rpc("create_meta_capi_vault_secret", {
        p_secret: envSecret,
      });
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        success: true,
        action: existingId ? "updated" : "created",
        message:
          "Vault sincronizado com a env da Edge Function. Triggers do banco voltam a funcionar.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

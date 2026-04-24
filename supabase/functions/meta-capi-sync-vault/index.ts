// Edge function that reads META_CAPI_INTERNAL_SECRET from env and writes it to Vault.
// Call this once after setting/rotating the secret to keep DB triggers in sync.
//
// Auth: requires the caller to send the same secret in X-Internal-Secret header
// (proves they know the current value before allowing a sync).
// Alternatively, if Vault is empty/placeholder, allows first-time sync from any authed admin.

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
            "META_CAPI_INTERNAL_SECRET não está configurado nas envs da Edge Function (ou tem menos de 8 chars).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Check current vault value
    const { data: existing } = await admin
      .schema("vault" as any)
      .from("decrypted_secrets")
      .select("id, decrypted_secret")
      .eq("name", "meta_capi_internal_secret")
      .maybeSingle();

    const currentVaultValue = existing?.decrypted_secret ?? null;
    const isPlaceholder =
      !currentVaultValue ||
      currentVaultValue === "PLACEHOLDER_REPLACE_ME" ||
      currentVaultValue.length < 8;

    // Auth: if vault already has a real value, caller must provide it via header
    // to authorize a rotation. If vault is empty/placeholder, allow sync (bootstrap).
    if (!isPlaceholder) {
      const provided = req.headers.get("x-internal-secret");
      if (provided !== currentVaultValue && provided !== envSecret) {
        return new Response(
          JSON.stringify({
            error:
              "Vault já tem um secret configurado. Envie o valor atual em X-Internal-Secret para autorizar a rotação.",
          }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Upsert via SQL (vault.create_secret / vault.update_secret)
    if (existing?.id) {
      const { error } = await admin.rpc("update_meta_capi_vault_secret", {
        p_id: existing.id,
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
        action: existing?.id ? "updated" : "created",
        message:
          "Vault sincronizado com a env da Edge Function. Triggers do banco voltam a funcionar.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// deno-lint-ignore-file no-explicit-any
// TEMPORÁRIA: valida tokens de IG sem expô-los. Apagar após o diagnóstico.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: rows } = await supabase
    .from("whatsapp_numbers")
    .select("id, instagram_username, access_token, updated_at")
    .eq("provider", "instagram");

  const results: any[] = [];
  for (const row of rows || []) {
    if (!row.access_token) {
      results.push({ account: row.instagram_username, status: "no_token" });
      continue;
    }
    const meRes = await fetch(
      `https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=${encodeURIComponent(row.access_token)}`,
    );
    const me = await meRes.json().catch(() => ({}));
    results.push({
      account: row.instagram_username,
      http: meRes.status,
      valid: meRes.ok,
      error: me?.error?.message ?? null,
      code: me?.error?.code ?? null,
      token_updated_at: row.updated_at,
    });
  }
  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});

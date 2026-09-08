// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Verifica e renova os tokens de longa duração das contas de Instagram.
 *
 * Tokens do "Instagram Login" duram 60 dias e podem ser renovados via
 * GET https://graph.instagram.com/refresh_access_token — desde que ainda
 * estejam válidos e tenham mais de 24h de vida. Rodando diariamente, o token
 * nunca chega a expirar. Se já estiver expirado, marcamos a instância com o
 * erro para o admin reconectar.
 *
 * Pode ser chamada por cron (x-cron-secret), pelo service role, ou por um
 * usuário autenticado (botão "Renovar" no admin).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Auth: cron/service OU usuário logado
  let authorized = await isAuthorizedCron(req);
  if (!authorized) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (jwt) {
      const { data } = await supabase.auth.getUser(jwt);
      authorized = !!data?.user;
    }
  }
  if (!authorized) return unauthorizedResponse(corsHeaders);

  let onlyId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    onlyId = body?.id ? String(body.id) : null;
  } catch { /* ignore */ }

  const globalToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";

  let q = supabase
    .from("whatsapp_numbers")
    .select("id, label, instagram_username, instagram_account_id, access_token, is_active")
    .eq("provider", "instagram");
  if (onlyId) q = q.eq("id", onlyId);
  const { data: rows, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  for (const row of rows || []) {
    const token: string = row.access_token || globalToken;
    const usingGlobal = !row.access_token;
    const label = row.instagram_username ? `@${row.instagram_username}` : (row.label || row.id);
    if (!token) {
      results.push({ id: row.id, account: label, status: "no_token" });
      continue;
    }

    // 1) Valida token atual
    const meRes = await fetch(
      `https://graph.instagram.com/v23.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`,
    );
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok) {
      const msg = me?.error?.message || `HTTP ${meRes.status}`;
      console.error(`[ig-token-refresh] ${label} token INVÁLIDO:`, msg);
      await supabase.from("whatsapp_numbers").update({
        is_online: false,
        last_health_check: new Date().toISOString(),
        health_check_error: `Token do Instagram expirado/inválido: ${msg}`.slice(0, 500),
      }).eq("id", row.id);
      results.push({ id: row.id, account: label, status: "expired", error: msg, usingGlobal });
      continue;
    }

    // 2) Renova (estende por mais 60 dias)
    const rfRes = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
    );
    const rf = await rfRes.json().catch(() => ({}));
    if (!rfRes.ok || !rf?.access_token) {
      const msg = rf?.error?.message || `HTTP ${rfRes.status}`;
      console.warn(`[ig-token-refresh] ${label} válido, mas não renovou:`, msg);
      await supabase.from("whatsapp_numbers").update({
        is_online: true,
        last_health_check: new Date().toISOString(),
        health_check_error: null,
      }).eq("id", row.id);
      results.push({ id: row.id, account: label, status: "valid_not_refreshed", error: msg, usingGlobal });
      continue;
    }

    const expiresAt = new Date(Date.now() + Number(rf.expires_in || 0) * 1000).toISOString();
    // Guarda o token renovado na linha (inclusive para a conta principal, que
    // até então usava o token global — assim ela deixa de depender do secret).
    await supabase.from("whatsapp_numbers").update({
      access_token: rf.access_token,
      is_online: true,
      last_health_check: new Date().toISOString(),
      health_check_error: null,
      instagram_username: me.username || row.instagram_username,
    }).eq("id", row.id);
    console.log(`[ig-token-refresh] ${label} renovado até ${expiresAt}`);
    results.push({ id: row.id, account: label, status: "refreshed", expires_at: expiresAt, usingGlobal });
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

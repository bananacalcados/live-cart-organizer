import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  // Auth: cron secret OR signed-in user
  let authorized = await isAuthorizedCron(req);
  if (!authorized) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data } = await admin.auth.getUser(token);
      authorized = !!data?.user;
    }
  }
  if (!authorized) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const today = new Date();
  const until = isDate(body.until) ? body.until : today.toISOString().slice(0, 10);
  const since = isDate(body.since) ? body.since : new Date(today.getTime() - 60 * 86400000).toISOString().slice(0, 10);

  const refresh = async () => {
    const { error } = await admin.rpc("refresh_ad_first_touch");
    return error?.message ?? null;
  };

  // Vault token (renovado) primeiro; segredo como fallback
  const { data: vaultToken } = await admin.rpc("meta_ads_get_token");
  let token: string | undefined = (vaultToken as string) || Deno.env.get("META_ADS_ACCESS_TOKEN");
  if (!token) {
    const refreshErr = await refresh();
    await admin.from("meta_ads_sync_runs").insert({ status: "token_missing", since, until, error: refreshErr });
    return json({ status: "token_missing", refresh_error: refreshErr });
  }

  // Renovação automática (< 30 dias ou validade desconhecida)
  let tokenRefresh: string = "skipped";
  try {
    const { data: st } = await admin.from("meta_ads_token_state").select("token_expires_at").eq("id", 1).maybeSingle();
    const exp = st?.token_expires_at ? new Date(st.token_expires_at).getTime() : null;
    if (!exp || exp - Date.now() < 30 * 86400000) {
      const appId = Deno.env.get("META_APP_ID");
      const appSecret = Deno.env.get("META_APP_SECRET");
      if (!appId || !appSecret) throw new Error("META_APP_ID/META_APP_SECRET ausentes");
      const u = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
      u.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token }).toString();
      const r = await (await fetch(u)).json();
      if (r.error || !r.access_token) throw new Error(r.error?.message || "resposta sem access_token");
      token = r.access_token as string;
      const expiresAt = new Date(Date.now() + (Number(r.expires_in) || 60 * 86400) * 1000).toISOString();
      const { error } = await admin.rpc("meta_ads_set_token", { p_token: token, p_expires_at: expiresAt });
      if (error) throw new Error("vault: " + error.message);
      tokenRefresh = "refreshed";
    }
  } catch (e: any) {
    tokenRefresh = "error";
    await admin.from("meta_ads_token_state").upsert({ id: 1, last_error: String(e?.message || e), updated_at: new Date().toISOString() });
  }

  const accountId = (Deno.env.get("META_ADS_ACCOUNT_ID") || "2253897104825255").replace(/^act_/, "");
  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    fields: "campaign_id,campaign_name,objective,spend,impressions,reach,inline_link_clicks",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  let next: string | null = `https://graph.facebook.com/v21.0/act_${accountId}/insights?${params}`;
  let upserted = 0;
  try {
    while (next) {
      const res = await fetch(next);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const rows = (data.data || []).map((d: any) => ({
        account_id: accountId,
        campaign_id: String(d.campaign_id),
        campaign_name: d.campaign_name ?? null,
        objective: d.objective ?? null,
        date: d.date_start,
        spend: parseFloat(d.spend || "0"),
        impressions: parseInt(d.impressions || "0"),
        reach: parseInt(d.reach || "0"),
        link_clicks: parseInt(d.inline_link_clicks || "0"),
        synced_at: new Date().toISOString(),
      }));
      if (rows.length) {
        const { error } = await admin.from("meta_ads_campaign_spend_daily").upsert(rows, { onConflict: "account_id,campaign_id,date" });
        if (error) throw new Error(error.message);
        upserted += rows.length;
      }
      next = data.paging?.next ?? null;
    }
  } catch (e: any) {
    await admin.from("meta_ads_sync_runs").insert({ status: "error", since, until, rows_upserted: upserted, error: e.message });
    return json({ status: "error", error: e.message, rows_upserted: upserted });
  }

  // Nível conjunto de anúncios (adset)
  let adsetUpserted = 0;
  let adsetError: string | null = null;
  try {
    const p2 = new URLSearchParams({
      level: "adset",
      time_increment: "1",
      fields: "campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,inline_link_clicks",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
      access_token: token,
    });
    let n2: string | null = `https://graph.facebook.com/v21.0/act_${accountId}/insights?${p2}`;
    while (n2) {
      const data = await (await fetch(n2)).json();
      if (data.error) throw new Error(data.error.message);
      const rows = (data.data || []).map((d: any) => ({
        account_id: accountId,
        campaign_id: d.campaign_id ? String(d.campaign_id) : null,
        campaign_name: d.campaign_name ?? null,
        adset_id: String(d.adset_id),
        adset_name: d.adset_name ?? null,
        date: d.date_start,
        spend: parseFloat(d.spend || "0"),
        impressions: parseInt(d.impressions || "0"),
        reach: parseInt(d.reach || "0"),
        link_clicks: parseInt(d.inline_link_clicks || "0"),
        synced_at: new Date().toISOString(),
      }));
      if (rows.length) {
        const { error } = await admin.from("meta_ads_adset_spend_daily").upsert(rows, { onConflict: "account_id,adset_id,date" });
        if (error) throw new Error(error.message);
        adsetUpserted += rows.length;
      }
      n2 = data.paging?.next ?? null;
    }
  } catch (e: any) {
    adsetError = "adset: " + (e?.message || e);
  }

  const refreshErr = await refresh();
  const errs = [refreshErr, adsetError].filter(Boolean).join(" | ") || null;
  await admin.from("meta_ads_sync_runs").insert({ status: "ok", since, until, rows_upserted: upserted + adsetUpserted, error: errs });
  return json({ status: "ok", rows_upserted: upserted, adset_rows_upserted: adsetUpserted, adset_error: adsetError, since, until, token_refresh: tokenRefresh });
});

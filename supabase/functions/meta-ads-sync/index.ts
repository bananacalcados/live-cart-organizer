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

  const token = Deno.env.get("META_ADS_ACCESS_TOKEN");
  if (!token) {
    const refreshErr = await refresh();
    await admin.from("meta_ads_sync_runs").insert({ status: "token_missing", since, until, error: refreshErr });
    return json({ status: "token_missing", refresh_error: refreshErr });
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

  const refreshErr = await refresh();
  await admin.from("meta_ads_sync_runs").insert({ status: "ok", since, until, rows_upserted: upserted, error: refreshErr });
  return json({ status: "ok", rows_upserted: upserted, since, until });
});

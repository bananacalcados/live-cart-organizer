import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const metaToken = Deno.env.get("META_ADS_ACCESS_TOKEN");

    if (!metaToken) {
      return new Response(
        JSON.stringify({ error: "META_ADS_ACCESS_TOKEN not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json().catch(() => ({}));

    const now = new Date();
    const dateFrom = body.date_from || new Date(now.getTime() - 30 * 86400000).toISOString().split("T")[0];
    const dateTo = body.date_to || now.toISOString().split("T")[0];

    // Fetch active ad accounts
    const { data: accounts, error: accErr } = await supabase
      .from("meta_ad_accounts")
      .select("*")
      .eq("is_active", true);

    if (accErr) throw accErr;
    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active ad accounts", synced: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalSynced = 0;
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        const url = `https://graph.facebook.com/v21.0/${account.account_id}/insights?fields=spend,impressions,clicks,cpm,cpc&time_increment=1&time_range={"since":"${dateFrom}","until":"${dateTo}"}&limit=500&access_token=${metaToken}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
          errors.push(`${account.account_id}: ${data.error.message}`);
          continue;
        }

        const rows = (data.data || []).map((d: any) => ({
          account_id: account.account_id,
          date: d.date_start,
          spend: parseFloat(d.spend || "0"),
          impressions: parseInt(d.impressions || "0"),
          clicks: parseInt(d.clicks || "0"),
          cpm: parseFloat(d.cpm || "0"),
          cpc: parseFloat(d.cpc || "0"),
        }));

        if (rows.length > 0) {
          const { error: upsertErr } = await supabase
            .from("meta_ad_spend_daily")
            .upsert(rows, { onConflict: "account_id,date" });

          if (upsertErr) {
            errors.push(`${account.account_id}: upsert error - ${upsertErr.message}`);
          } else {
            totalSynced += rows.length;
          }
        }
      } catch (e: any) {
        errors.push(`${account.account_id}: ${e.message}`);
      }
    }

    return new Response(
      JSON.stringify({ synced: totalSynced, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

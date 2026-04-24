// Lists Meta Ad Accounts accessible by the configured Meta token
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Try META_ADS_ACCESS_TOKEN first, fallback to META_PAGE_ACCESS_TOKEN, then META_WHATSAPP_ACCESS_TOKEN
    const token =
      Deno.env.get("META_ADS_ACCESS_TOKEN") ||
      Deno.env.get("META_PAGE_ACCESS_TOKEN") ||
      Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "No Meta token configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenSource = Deno.env.get("META_ADS_ACCESS_TOKEN")
      ? "META_ADS_ACCESS_TOKEN"
      : Deno.env.get("META_PAGE_ACCESS_TOKEN")
      ? "META_PAGE_ACCESS_TOKEN"
      : "META_WHATSAPP_ACCESS_TOKEN";

    // 1. Get token debug info (which app, scopes, expiration)
    const debugRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${token}&access_token=${token}`
    );
    const debugData = await debugRes.json();

    // 2. Get the user/business associated with the token
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${token}`
    );
    const meData = await meRes.json();

    // 3. Try to list ad accounts the token has access to
    const adAccountsRes = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_id,account_status,currency,business_name&access_token=${token}`
    );
    const adAccountsData = await adAccountsRes.json();

    // 4. Try to list businesses
    const businessesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/businesses?fields=id,name&access_token=${token}`
    );
    const businessesData = await businessesRes.json();

    return new Response(
      JSON.stringify({
        token_source: tokenSource,
        token_debug: debugData,
        me: meData,
        ad_accounts: adAccountsData,
        businesses: businessesData,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

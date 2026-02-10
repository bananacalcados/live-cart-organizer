import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN")!;
  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const redirectUri = `${supabaseUrl}/functions/v1/shopify-oauth-callback`;
  const scopes = "write_orders,read_orders,read_products,write_draft_orders,read_draft_orders";
  const nonce = crypto.randomUUID();

  const installUrl = `https://${shopifyDomain}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: installUrl,
    },
  });
});

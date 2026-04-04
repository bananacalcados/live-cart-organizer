import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  const results: any = {
    domain_set: !!shopifyDomain,
    token_set: !!shopifyToken,
    domain_preview: shopifyDomain ? shopifyDomain.substring(0, 15) + '...' : null,
  };

  if (shopifyDomain && shopifyToken) {
    // Test 1: list first 3 products (no search filter)
    const graphql1 = `{ products(first: 3) { edges { node { id title } } } }`;
    const resp1 = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphql1 }),
    });
    const data1 = await resp1.json();
    results.list_status = resp1.status;
    results.list_products = data1?.data?.products?.edges?.map((e: any) => e.node.title) || [];
    results.list_errors = data1?.errors || null;

    // Test 2: search "tenis"
    const graphql2 = `{ products(first: 3, query: "tenis") { edges { node { id title } } } }`;
    const resp2 = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphql2 }),
    });
    const data2 = await resp2.json();
    results.search_status = resp2.status;
    results.search_products = data2?.data?.products?.edges?.map((e: any) => e.node.title) || [];
    results.search_errors = data2?.errors || null;

    // Test 3: search "jess"
    const graphql3 = `{ products(first: 3, query: "jess") { edges { node { id title } } } }`;
    const resp3 = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphql3 }),
    });
    const data3 = await resp3.json();
    results.search_jess_products = data3?.data?.products?.edges?.map((e: any) => e.node.title) || [];
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

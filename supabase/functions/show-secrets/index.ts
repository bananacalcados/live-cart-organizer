import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SEARCH_STOP_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'por', 'no', 'na', 'o', 'a']);

function normalizeShopifyText(value: string): string {
  return (value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildShopifySearchQueries(query: string): string[] {
  const original = (query || '').trim();
  const normalized = normalizeShopifyText(original);
  const strippedOriginal = original.replace(/\bt[eê]nis\b/gi, '').trim();
  const strippedNormalized = normalized.replace(/\btenis\b/g, '').trim();
  const tokens = normalized.split(' ').filter((t) => t.length > 2 && !SEARCH_STOP_WORDS.has(t));
  const queries = [original, normalized, strippedOriginal, strippedNormalized];
  for (const token of tokens) {
    if (token !== normalized && token !== strippedNormalized) {
      queries.push(token);
    }
  }
  return Array.from(new Set(queries.filter(Boolean)));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN')!;
  const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN')!;

  const testQuery = "Tênis Jess Ortopédico";
  const searchQueries = buildShopifySearchQueries(testQuery);
  const results: any = { testQuery, searchQueries, found: [] };

  for (const sq of searchQueries) {
    const graphql = `{ products(first: 3, query: "${sq.replace(/"/g, '\\"')}") { edges { node { id title } } } }`;
    const resp = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphql }),
    });
    const data = await resp.json();
    const products = data?.data?.products?.edges?.map((e: any) => e.node.title) || [];
    results.found.push({ query: sq, count: products.length, products });
    if (products.length > 0) break;
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

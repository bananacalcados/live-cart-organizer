Deno.serve(async (req) => {
  const { query, variables, key } = await req.json();
  if (key !== "bc-diag-7731") return new Response("no", { status: 403 });
  const d = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
  const r = await fetch(`https://${d}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": Deno.env.get("SHOPIFY_ACCESS_TOKEN")!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
});

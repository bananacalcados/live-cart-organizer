// Admin: busca pedidos na Admin API da Shopify num intervalo de datas e
// reprocessa (via shopify-webhook, caminho interno) os que não existem em pos_sales.
// dry_run=true só lista o que falta.
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireAuth, internalCallHeaders } from "../_shared/requireAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(withAccessLog("shopify-resync-orders", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = await requireAuth(req, [], true);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const from = String(body.from || ""), to = String(body.to || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(from) || !/^\d{4}-\d{2}-\d{2}/.test(to)) return json({ error: "from/to (AAAA-MM-DD) obrigatórios" }, 400);
  const dryRun = body.dry_run !== false;

  const dom = Deno.env.get("SHOPIFY_STORE_DOMAIN"), token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!dom || !token) return json({ error: "Shopify não configurada" }, 500);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const toEnd = to.length === 10 ? `${to}T23:59:59-03:00` : to;
  const fromStart = from.length === 10 ? `${from}T00:00:00-03:00` : from;
  let next: string | null =
    `https://${dom}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(fromStart)}&created_at_max=${encodeURIComponent(toEnd)}`;
  const orders: any[] = [];
  let pages = 0;
  while (next && pages < 40) {
    const r = await fetch(next, { headers: { "X-Shopify-Access-Token": token } });
    if (!r.ok) return json({ error: `Shopify ${r.status}`, fetched: orders.length }, 502);
    const d = await r.json();
    orders.push(...(d.orders || []));
    const link = r.headers.get("link") || "";
    next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    pages++;
    await new Promise((res) => setTimeout(res, 550)); // rate limit 2 req/s
  }

  const paid = orders.filter((o) => ["paid", "partially_paid"].includes(String(o.financial_status || "").toLowerCase()) && !o.cancelled_at);
  const missing: any[] = [];
  for (let i = 0; i < paid.length; i += 200) {
    const ids = paid.slice(i, i + 200).map((o) => String(o.id));
    const { data } = await sb.from("pos_sales").select("external_order_id").eq("external_source", "shopify").in("external_order_id", ids);
    const have = new Set((data || []).map((x: any) => x.external_order_id));
    missing.push(...paid.slice(i, i + 200).filter((o) => !have.has(String(o.id))));
  }

  const results: any[] = [];
  if (!dryRun) {
    const headers = { ...(await internalCallHeaders()), "Content-Type": "application/json", "x-shopify-topic": "orders/paid" };
    for (const o of missing) {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-webhook`, { method: "POST", headers, body: JSON.stringify(o) });
      results.push({ id: String(o.id), name: o.name, status: r.status, body: (await r.text()).slice(0, 200) });
    }
  }
  return json({
    dry_run: dryRun, fetched: orders.length, paid: paid.length,
    missing: missing.map((o) => ({ id: String(o.id), name: o.name, created_at: o.created_at, total: o.total_price })),
    results, truncated: !!next,
  });
}));

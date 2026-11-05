// Confere na Shopify se cada código de produto (master + cor) existe de verdade:
// produto ACTIVE, publicado no canal "Lovable" e com as variações da cor.
// Grava via RPC set_code_shopify_status (só quando muda ou checagem com +24h).
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";

const PUBLICATION = "gid://shopify/Publication/195361112121";
const reply = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const numId = (v: unknown) => String(v ?? "").split("/").pop()?.replace(/\D/g, "") || "";
const colorKey = (v: unknown) => String(v ?? "").trim().toLowerCase();

Deno.serve(withAccessLog("sync-code-shopify-status", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireStaffOrInternal(req, ["inventory"]);
  if (denied) return denied;

  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!domain || !token) return reply({ error: "Credenciais Shopify não configuradas" }, 500);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const gql = async (query: string, variables: Record<string, unknown>) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json().catch(() => ({}));
      const throttled = res.status === 429 || (json.errors || []).some((e: any) => e?.extensions?.code === "THROTTLED");
      if (throttled) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      if (!res.ok || json.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 300)}`);
      const cost = json.extensions?.cost?.throttleStatus;
      if (cost && cost.currentlyAvailable < 300) await new Promise((r) => setTimeout(r, 1500));
      return json.data;
    }
    throw new Error("Shopify: limite de requisições");
  };

  const body = await req.json().catch(() => ({}));
  if (body?.probe) {
    const d = await gql(`query($id:ID!,$pub:ID!){product(id:$id){id status publishedOnPublication(publicationId:$pub) variants(first:5){nodes{id}}}}`, { id: `gid://shopify/Product/${numId(body.probe)}`, pub: PUBLICATION });
    return reply(d);
  }

  // 1) Códigos (paginado) e variações ativas do ERP.
  const codes: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("v_product_color_codes")
      .select("code,master_id,color,shopify_product_id,shopify_status,shopify_sizes_ok,shopify_sizes_total,shopify_checked_at")
      .order("code").range(from, from + 999);
    if (error) return reply({ error: error.message }, 500);
    codes.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const masterIds = [...new Set(codes.map((c) => c.master_id))];
  const variantsByKey = new Map<string, string[]>();
  // Paginate: the API caps each response at 1000 rows, so a single call silently dropped variants.
  for (let i = 0; i < masterIds.length; i += 50) {
   for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("product_variants").select("id,master_id,color,shopify_variant_id")
      .in("master_id", masterIds.slice(i, i + 50)).eq("is_active", true).not("shopify_variant_id", "is", null)
      .order("id").range(from, from + 999);
    if (error) return reply({ error: error.message }, 500);
    const rows = data || [];
    for (const v of rows) {
      const k = `${v.master_id}|${colorKey(v.color)}`;
      const arr = variantsByKey.get(k) || [];
      arr.push(numId(v.shopify_variant_id));
      variantsByKey.set(k, arr);
    }
    if (rows.length < 1000) break;
   }
  }

  // 2) Produtos na Shopify, 25 por consulta.
  const pids = [...new Set(codes.map((c) => numId(c.shopify_product_id)).filter(Boolean))];
  const products = new Map<string, { active: boolean; published: boolean; variants: Set<string> }>();
  const Q = `query($ids:[ID!]!,$pub:ID!){nodes(ids:$ids){... on Product{id status publishedOnPublication(publicationId:$pub) variants(first:250){nodes{id}}}}}`;
  for (let i = 0; i < pids.length; i += 25) {
    const data = await gql(Q, { ids: pids.slice(i, i + 25).map((p) => `gid://shopify/Product/${p}`), pub: PUBLICATION });
    for (const n of data?.nodes || []) {
      if (!n?.id) continue;
      products.set(numId(n.id), {
        active: n.status === "ACTIVE", published: !!n.publishedOnPublication,
        variants: new Set((n.variants?.nodes || []).map((v: any) => numId(v.id))),
      });
    }
  }

  // 3) Status por código.
  const counts: Record<string, number> = {};
  const updates: { code: string; status: string; ok: number | null; total: number | null }[] = [];
  const stale = Date.now() - 24 * 3600 * 1000;
  for (const c of codes) {
    const pid = numId(c.shopify_product_id);
    const expected = variantsByKey.get(`${c.master_id}|${colorKey(c.color)}`) || [];
    let status: string; let ok: number | null = null; let total: number | null = null;
    if (!pid) status = "unlinked";
    else {
      const p = products.get(pid);
      if (!p || !p.active) status = "product_missing";
      else if (!p.published) status = "not_published_lovable";
      else {
        total = expected.length;
        ok = expected.filter((v) => p.variants.has(v)).length;
        status = ok === 0 ? "color_missing" : ok < total ? "partial_sizes" : "ok";
      }
    }
    counts[status] = (counts[status] || 0) + 1;
    const changed = c.shopify_status !== status || (ok != null && (c.shopify_sizes_ok !== ok || c.shopify_sizes_total !== total));
    const old = !c.shopify_checked_at || new Date(c.shopify_checked_at).getTime() < stale;
    if (changed || old) updates.push({ code: c.code, status, ok, total });
  }

  // 4) Grava em paralelo limitado.
  let failed = 0;
  for (let i = 0; i < updates.length; i += 10) {
    const res = await Promise.all(updates.slice(i, i + 10).map((u) =>
      db.rpc("set_code_shopify_status", { p_code: u.code, p_status: u.status, p_sizes_ok: u.ok, p_sizes_total: u.total })));
    failed += res.filter((r) => r.error).length;
  }
  return reply({ ok: true, total: codes.length, products_checked: pids.length, updated: updates.length, failed, counts });
}));

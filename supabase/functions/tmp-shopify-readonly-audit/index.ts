// TEMPORÁRIA — somente leitura (queries GraphQL). Apagar após a auditoria.
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(withAccessLog("tmp-shopify-readonly-audit", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireStaffOrInternal(req, [], true);
  if (denied) return denied;
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;
  const gql = async (query: string, variables: Record<string, unknown> = {}) => {
    const r = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
      method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const t = await r.json();
    if (t.errors) throw new Error(JSON.stringify(t.errors));
    return t.data;
  };
  try {
    const scopes = (await gql(`{currentAppInstallation{accessScopes{handle}}}`)).currentAppInstallation.accessScopes.map((s: any) => s.handle);
    let pubs: any[] = [];
    let pubErr: string | null = null;
    try { pubs = (await gql(`{publications(first:50){nodes{id name}}}`)).publications.nodes; } catch (e) { pubErr = String(e); }
    const fb = pubs.find((p) => /facebook/i.test(p.name));
    const site: any[] = [];
    let after: string | null = null;
    do {
      const d: any = await gql(`query($a:String){products(first:100,after:$a,query:"status:active tag:site"){pageInfo{hasNextPage endCursor} nodes{id title handle tags totalInventory descriptionHtml variantsCount{count} ${fb ? `pub:publishedOnPublication(publicationId:"${fb.id}")` : ""}}}}`, { a: after });
      site.push(...d.products.nodes);
      after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    } while (after);
    const exact = site.filter((p) => p.tags.includes("site"));
    const strip = (h: string) => (h || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const products = exact.map((p) => ({ id: p.id, title: p.title, handle: p.handle, inv: p.totalInventory, variants: p.variantsCount?.count, descLen: strip(p.descriptionHtml).length, fb: p.pub ?? null }));
    const active = (await gql(`{productsCount(query:"status:active",limit:null){count}}`)).productsCount.count;
    const noSite: any[] = [];
    const ns = await gql(`{products(first:10,query:"status:active -tag:site"){nodes{id title tags}}}`);
    noSite.push(...ns.products.nodes);
    const noSiteCount = (await gql(`{productsCount(query:"status:active -tag:site",limit:null){count}}`)).productsCount.count;
    return j({ scopes, pubs, pubErr, fb, activeTotal: active, siteQueryHits: site.length, products, noSiteCount, noSiteExamples: noSite });
  } catch (e) { return j({ error: String(e) }, 500); }
}));

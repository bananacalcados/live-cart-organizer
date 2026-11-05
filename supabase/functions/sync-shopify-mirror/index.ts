// Espelha TODAS as variações da Shopify (somente leitura lá) em shopify_variant_mirror
// e chama relink_products_from_shopify_mirror(): a Shopify é a fonte da verdade,
// o vínculo do ERP é refeito por SKU (GTIN como reserva) e os códigos são reavaliados.
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";

const PUBLICATION = "gid://shopify/Publication/195361112121";
const reply = (b: unknown, status = 200) => {
  if (status >= 400) console.error("sync-shopify-mirror", status, JSON.stringify(b));
  else console.log("sync-shopify-mirror ok", JSON.stringify(b));
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
};
const numId = (v: unknown) => String(v ?? "").split("/").pop()?.replace(/\D/g, "") || "";

const Q = `query($after:String,$pub:ID!){productVariants(first:250,after:$after){pageInfo{hasNextPage endCursor}
nodes{id title sku barcode price selectedOptions{name value} image{url}
product{id title status publishedOnPublication(publicationId:$pub) featuredMedia{preview{image{url}}}}}}}`;

const pickOpt = (opts: any[], re: RegExp) => opts?.find((o) => re.test(String(o?.name || "")))?.value ?? null;

Deno.serve(withAccessLog("sync-shopify-mirror", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireStaffOrInternal(req, ["inventory"]);
  if (denied) return denied;

  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!domain || !token) return reply({ error: "Credenciais Shopify não configuradas" }, 500);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const gql = async (variables: Record<string, unknown>) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: Q, variables }),
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

  try {
    const runAt = new Date().toISOString();
    const rows: any[] = [];
    let after: string | null = null;
    do {
      const data = await gql({ after, pub: PUBLICATION });
      const pv = data?.productVariants;
      for (const v of pv?.nodes || []) {
        const p = v.product || {};
        rows.push({
          shopify_variant_id: numId(v.id), shopify_product_id: numId(p.id),
          product_title: p.title ?? null, product_status: p.status ?? null,
          published_lovable: !!p.publishedOnPublication, variant_title: v.title ?? null,
          sku: v.sku || null, barcode: v.barcode || null,
          option_color: pickOpt(v.selectedOptions, /^cor|colou?r/i),
          option_size: pickOpt(v.selectedOptions, /tamanho|size|numera/i),
          price: v.price != null ? Number(v.price) : null,
          image_url: v.image?.url || p.featuredMedia?.preview?.image?.url || null,
          synced_at: runAt,
        });
      }
      after = pv?.pageInfo?.hasNextPage ? pv.pageInfo.endCursor : null;
    } while (after);

    if (rows.length === 0) return reply({ error: "Shopify não retornou variações; espelho mantido" }, 502);

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("shopify_variant_mirror").upsert(rows.slice(i, i + 500), { onConflict: "shopify_variant_id" });
      if (error) return reply({ error: `upsert: ${error.message}` }, 500);
    }
    // Full sync: só apaga depois que a leitura completa deu certo.
    const { error: delErr, count: removed } = await db.from("shopify_variant_mirror")
      .delete({ count: "exact" }).lt("synced_at", runAt);
    if (delErr) return reply({ error: `delete: ${delErr.message}` }, 500);

    const { data: relink, error: rErr } = await db.rpc("relink_products_from_shopify_mirror");
    if (rErr) return reply({ error: `relink: ${rErr.message}` }, 500);

    return reply({
      products_mirrored: new Set(rows.map((r) => r.shopify_product_id)).size,
      variants_mirrored: rows.length, variants_removed: removed ?? 0, ...(relink as object),
    });
  } catch (e) {
    return reply({ error: String((e as Error)?.message || e) }, 500);
  }
}));

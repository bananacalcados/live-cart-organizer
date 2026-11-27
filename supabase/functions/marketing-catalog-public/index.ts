import { withAccessLog } from "../_shared/withAccessLog.ts";
// Produtos do ERP para páginas PÚBLICAS de marketing (catálogo de captação, Dose Tripla, Link Pages).
// Público de propósito: só devolve o que a vitrine já mostra (nome, preço, cor, tamanho, foto e se tem
// estoque — nunca custo, estoque exato ou dados internos). Aceita apenas ids de produto do ERP (máx. 50).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(withAccessLog("marketing-catalog-public", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
  const raw = Array.isArray(body?.ids) ? body.ids : null;
  if (!raw || raw.length === 0 || raw.length > 50) return json({ error: "ids: 1 a 50" }, 400);
  const ids = [...new Set(raw.map((x: unknown) => String(x ?? "").replace(/^erp(-product)?:/, "").trim()))].filter((x) => UUID.test(x as string));
  if (!ids.length) return json({ items: [] });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.rpc("erp_catalog_public_items", { p_master_ids: ids });
  if (error) { console.error("[marketing-catalog-public]", error.message); return json({ error: "unavailable" }, 500); }
  // deno-lint-ignore no-explicit-any
  const items = ((data || []) as any[]).map((m) => ({
    master_id: m.master_id, name: m.name, description: null, category: null, brand: null,
    sale_price: m.sale_price, shopify_product_id: m.shopify_product_id, hit_variant_id: null,
    // deno-lint-ignore no-explicit-any
    variants: ((m.variants || []) as any[]).map((v) => ({
      variant_id: v.variant_id, sku: v.sku, gtin: null, color: v.color, size: v.size, price: v.price,
      shopify_variant_id: v.shopify_variant_id, live_code: null, image: v.image, image_source: null,
      in_stock: !!v.in_stock,
    })),
  }));
  return json({ items });
}));

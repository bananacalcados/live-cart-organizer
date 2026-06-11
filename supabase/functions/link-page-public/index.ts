// Endpoint público da Link Page: retorna a página, botões (com WhatsApp resolvido
// e filtrado por instância ONLINE), catálogo ativo e dados da vendedora.
// Usa service role para ler whatsapp_numbers sem expor tokens ao cliente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function resolvePhone(n: any): string | null {
  const raw = n.phone_display || n.wasender_phone_number || n.uazapi_owner || "";
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (!d.startsWith("55")) d = "55" + d;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { slug } = await req.json();
    if (!slug) {
      return new Response(JSON.stringify({ error: "slug required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: page } = await supabase
      .from("link_pages")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (!page) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: items }, { data: catalog }, sellerRes, instancesRes] = await Promise.all([
      supabase.from("link_page_items").select("*").eq("page_id", page.id).eq("is_active", true).order("sort_order"),
      supabase.from("link_page_catalog_products").select("*").eq("page_id", page.id).eq("is_active", true).order("sort_order"),
      page.seller_id
        ? supabase.from("pos_sellers").select("id, name").eq("id", page.seller_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("whatsapp_numbers").select("id, phone_display, wasender_phone_number, uazapi_owner, is_online, is_active, provider"),
    ]);

    const instanceMap: Record<string, any> = {};
    for (const inst of instancesRes.data || []) instanceMap[inst.id] = inst;

    // Resolve WhatsApp e filtra offline
    const resolvedItems = (items || []).filter((it: any) => {
      if (it.item_type !== "whatsapp" || !it.whatsapp_number_id) return true;
      const inst = instanceMap[it.whatsapp_number_id];
      if (!inst || inst.is_active === false) return false;
      if (inst.is_online === false) return false; // null = considerado online
      return true;
    }).map((it: any) => {
      if (it.item_type === "whatsapp" && it.whatsapp_number_id) {
        const inst = instanceMap[it.whatsapp_number_id];
        const phone = inst ? resolvePhone(inst) : null;
        if (phone) {
          const msg = it.prefill_message ? `?text=${encodeURIComponent(it.prefill_message)}` : "";
          return { ...it, url: `https://wa.me/${phone}${msg}` };
        }
      }
      return it;
    });

    return new Response(JSON.stringify({
      page,
      items: resolvedItems,
      catalog: catalog || [],
      seller: sellerRes.data || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[link-page-public]", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

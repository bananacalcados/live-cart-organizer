// Captura nome + telefone no gate de uma Link Page vinculada a vendedora.
// - Se já existe cliente (customers_unified) pelo telefone -> marca origem por vendedora.
// - Se é lead novo -> cria/atualiza ad_leads com source=link_page + tag da página.
// - Sempre grava em link_page_leads.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Normaliza telefone BR para E.164 sem '+', injetando 9º dígito quando faltar.
function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  // d agora ~ DDD + numero
  if (d.length === 10) {
    // DDD + 8 dígitos -> injeta 9
    d = d.slice(0, 2) + "9" + d.slice(2);
  }
  return "55" + d;
}
function last8(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  return d.slice(-8);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pageId, name, phone } = await req.json();
    if (!pageId || !name || !phone) {
      return new Response(JSON.stringify({ error: "pageId, name, phone required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (String(name).trim().length < 2 || last8(phone).length < 8) {
      return new Response(JSON.stringify({ error: "dados inválidos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: page } = await supabase
      .from("link_pages")
      .select("id, slug, title, seller_id, store_id")
      .eq("id", pageId)
      .maybeSingle();
    if (!page) {
      return new Response(JSON.stringify({ error: "page not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const e164 = normalizePhone(phone);
    const suffix = last8(phone);
    const tag = `linkpage:${page.slug}`;

    // Vendedora (nome) para registrar origem
    let sellerName: string | null = null;
    if (page.seller_id) {
      const { data: seller } = await supabase
        .from("pos_sellers").select("name").eq("id", page.seller_id).maybeSingle();
      sellerName = seller?.name || null;
    }

    // Procura cliente existente por sufixo de 8 dígitos
    const { data: existingCustomers } = await supabase
      .from("customers_unified")
      .select("id, name, tags")
      .eq("phone_suffix8", suffix)
      .is("merged_into_id", null)
      .limit(1);
    const existingCustomer = existingCustomers?.[0] || null;

    let adLeadId: string | null = null;
    let customerId: string | null = null;

    if (existingCustomer) {
      customerId = existingCustomer.id;
      // marca origem por vendedora via tags (sem sobrescrever dados fortes)
      const tags: string[] = Array.isArray(existingCustomer.tags) ? existingCustomer.tags : [];
      if (!tags.includes(tag)) tags.push(tag);
      const sellerTag = sellerName ? `vendedora:${sellerName}` : null;
      if (sellerTag && !tags.includes(sellerTag)) tags.push(sellerTag);
      await supabase.from("customers_unified").update({ tags }).eq("id", existingCustomer.id);
    } else {
      // cria/atualiza ad_lead com tag da página
      const { data: existLead } = await supabase
        .from("ad_leads")
        .select("id, tags")
        .ilike("phone", `%${suffix}`)
        .limit(1);
      if (existLead?.[0]) {
        adLeadId = existLead[0].id;
        const tags: string[] = Array.isArray(existLead[0].tags) ? existLead[0].tags : [];
        if (!tags.includes(tag)) tags.push(tag);
        await supabase.from("ad_leads").update({ tags, name }).eq("id", existLead[0].id);
      } else {
        const { data: newLead } = await supabase.from("ad_leads").insert({
          phone: e164,
          name,
          source: "link_page",
          channel: "link_page",
          tags: [tag],
          notes: sellerName ? `Captado por ${sellerName} via ${page.title}` : `Via Link Page ${page.title}`,
          is_active: true,
        }).select("id").single();
        adLeadId = newLead?.id || null;
      }
    }

    // grava no histórico da página
    const { data: lpLead } = await supabase.from("link_page_leads").insert({
      page_id: pageId,
      seller_id: page.seller_id,
      name,
      phone: e164,
      customer_id: customerId,
      is_existing_customer: !!existingCustomer,
      ad_lead_id: adLeadId,
    }).select("id").single();

    return new Response(JSON.stringify({
      success: true,
      leadId: lpLead?.id || null,
      isExistingCustomer: !!existingCustomer,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[link-page-capture-lead]", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Backfill de dados de cliente (CPF, e-mail, endereço) em pos_sales de origem Shopify.
// Reprocessa vendas antigas que só possuem o nome, buscando o pedido completo na Admin API.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function digits(v: string | null | undefined): string {
  return (v || "").replace(/\D/g, "");
}

function splitStreetNumber(address1: string | null | undefined): { street: string | null; number: string | null } {
  if (!address1) return { street: null, number: null };
  const raw = address1.trim();
  const m = raw.match(/^(.*?)[,\s]+(\d+[A-Za-z]?)\s*$/);
  if (m) return { street: m[1].replace(/[,\s]+$/, "").trim() || raw, number: m[2] };
  return { street: raw, number: null };
}

function findNoteAttr(notes: any[], ...patterns: RegExp[]): string | null {
  for (const a of notes || []) {
    const name = a?.name || "";
    if (patterns.some((p) => p.test(name))) {
      const val = (a?.value ?? "").toString().trim();
      if (val) return val;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit || 100), 200);

    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return new Response(JSON.stringify({ error: "Shopify env missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: sales, error: qErr } = await supabase
      .from("pos_sales")
      .select("id, external_order_id, notes")
      .eq("external_source", "shopify")
      .neq("status", "cancelled")
      .or("customer_cpf.is.null,customer_cep.is.null")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (qErr) throw qErr;

    let updated = 0, skipped = 0, errors = 0;

    for (const sale of sales || []) {
      try {
        let orderId = sale.external_order_id;
        if (!orderId) { skipped++; continue; }

        const r = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${orderId}.json?fields=id,name,customer,phone,email,shipping_address,billing_address,note_attributes`,
          { headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" } },
        );
        if (!r.ok) { skipped++; continue; }
        const o = (await r.json()).order;
        if (!o) { skipped++; continue; }

        const addr = o.shipping_address || o.billing_address || {};
        const notes = o.note_attributes || [];
        const name = o.customer
          ? `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim() || (addr.name || null)
          : (addr.name || null);
        const phone = digits(o.phone || o.customer?.phone || addr.phone || o.billing_address?.phone);
        const email = (o.email || o.customer?.email || "").trim() || null;
        const cpf = digits(findNoteAttr(notes, /cpf/i, /cnpj/i)) || null;
        const { street, number } = splitStreetNumber(addr.address1);
        const address = street;
        const address_number = number || findNoteAttr(notes, /n[uú]mero/i, /^num/i);
        const complement = (addr.address2 || "").trim() || findNoteAttr(notes, /complement/i);
        const neighborhood = findNoteAttr(notes, /bairro/i, /neighborhood/i) || (addr.company || "").trim() || null;
        const city = addr.city || null;
        const state = addr.province_code || addr.province || null;
        const cep = digits(addr.zip) || null;

        if (!name && !phone && !cpf && !cep) { skipped++; continue; }

        // Cliente do PDV (CPF > telefone)
        let customerId: string | null = null;
        if (cpf) {
          const { data: ex } = await supabase.from("pos_customers").select("id").eq("cpf", cpf).maybeSingle();
          if (ex) customerId = ex.id;
        }
        if (!customerId && phone) {
          const { data: ex } = await supabase.from("pos_customers").select("id").eq("whatsapp", phone).maybeSingle();
          if (ex) customerId = ex.id;
        }
        const custPayload: Record<string, any> = {
          name, whatsapp: phone || null, email,
          address: address || null, address_number: address_number || null,
          complement: complement || null, neighborhood: neighborhood || null,
          city, state, cep,
        };
        if (cpf) custPayload.cpf = cpf;
        const cleanCust = Object.fromEntries(
          Object.entries(custPayload).filter(([, v]) => v !== null && v !== undefined && v !== ""),
        );
        if (Object.keys(cleanCust).length > 0) {
          if (customerId) {
            await supabase.from("pos_customers").update(cleanCust).eq("id", customerId);
          } else {
            const { data: nc } = await supabase.from("pos_customers").insert(cleanCust).select("id").single();
            customerId = nc?.id || null;
          }
        }

        const saleUpdate: Record<string, any> = {
          customer_id: customerId,
          customer_name: name,
          customer_phone: phone || null,
          customer_email: email,
          customer_cpf: cpf,
          customer_city: city,
          customer_state: state,
          customer_cep: cep,
          shipping_address: {
            address, address_number, complement, neighborhood, city, state, cep, name, phone,
          },
        };
        // Nunca sobrescrever com vazio
        const cleanSale = Object.fromEntries(
          Object.entries(saleUpdate).filter(([, v]) => v !== null && v !== undefined && v !== ""),
        );
        await supabase.from("pos_sales").update(cleanSale).eq("id", sale.id);
        updated++;
      } catch (e: any) {
        console.error("backfill error", sale.id, e?.message);
        errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: sales?.length || 0, updated, skipped, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

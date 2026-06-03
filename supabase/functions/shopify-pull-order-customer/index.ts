// Pull a single Shopify order's customer (personal + address) on demand.
// Given a pos_sales.id (Shopify-origin), fetches the live Shopify order,
// extracts full personal + address data, upserts a pos_customers record,
// links it to the sale and mirrors the data onto the sale columns.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function digits(v: string | null | undefined): string {
  return (v || "").replace(/\D/g, "");
}

// Extract a street number from a free-form address1 like "Rua Exemplo, 123"
function splitStreetNumber(address1: string | null | undefined): { street: string | null; number: string | null } {
  if (!address1) return { street: null, number: null };
  const raw = address1.trim();
  // Pattern: "..., 123" or "... 123" at the end
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
    const { sale_id } = await req.json().catch(() => ({}));
    if (!sale_id) {
      return new Response(JSON.stringify({ error: "sale_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // 1. Load the sale and resolve the Shopify order id
    const { data: sale, error: saleErr } = await supabase
      .from("pos_sales")
      .select("id, external_source, external_order_id, notes")
      .eq("id", sale_id)
      .maybeSingle();
    if (saleErr) throw saleErr;
    if (!sale) {
      return new Response(JSON.stringify({ error: "Venda não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let orderId = sale.external_source === "shopify" ? sale.external_order_id : null;
    // Fallback: try to recover the order number from the notes ("Shopify #6316")
    if (!orderId) {
      const m = (sale.notes || "").match(/#(\d+)/);
      if (m) {
        const lookup = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders.json?status=any&name=${encodeURIComponent("#" + m[1])}&fields=id`,
          { headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" } },
        );
        if (lookup.ok) {
          const j = await lookup.json();
          orderId = j.orders?.[0]?.id ? String(j.orders[0].id) : null;
        }
      }
    }
    if (!orderId) {
      return new Response(JSON.stringify({ error: "Esta venda não tem vínculo com a Shopify" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch the full Shopify order
    const r = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${orderId}.json?fields=id,name,customer,phone,email,shipping_address,billing_address,note_attributes`,
      { headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" } },
    );
    if (!r.ok) {
      const txt = await r.text();
      return new Response(JSON.stringify({ error: `Shopify ${r.status}`, body: txt.slice(0, 300) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const o = (await r.json()).order;
    if (!o) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado na Shopify" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const addr = o.shipping_address || o.billing_address || {};
    const notes = o.note_attributes || [];

    const name = o.customer
      ? `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim() || null
      : (addr.name || null);
    const phone = digits(o.phone || o.customer?.phone || addr.phone || o.billing_address?.phone);
    const email = (o.email || o.customer?.email || "").trim() || null;
    const cpf = digits(findNoteAttr(notes, /cpf/i, /cnpj/i));

    const { street, number } = splitStreetNumber(addr.address1);
    const address = street;
    const address_number = number || findNoteAttr(notes, /n[uú]mero/i, /^num/i);
    const complement = (addr.address2 || "").trim() || findNoteAttr(notes, /complement/i);
    const neighborhood = findNoteAttr(notes, /bairro/i, /neighborhood/i) || (addr.company || "").trim() || null;
    const city = addr.city || null;
    const state = addr.province_code || addr.province || null;
    const cep = digits(addr.zip) || null;

    if (!name && !phone && !cpf) {
      return new Response(JSON.stringify({ error: "Pedido da Shopify sem dados de cliente" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Find an existing pos_customers by CPF, then phone
    let customerId: string | null = null;
    if (cpf) {
      const { data: ex } = await supabase.from("pos_customers").select("id").eq("cpf", cpf).maybeSingle();
      if (ex) customerId = ex.id;
    }
    if (!customerId && phone) {
      const { data: ex } = await supabase.from("pos_customers").select("id").eq("whatsapp", phone).maybeSingle();
      if (ex) customerId = ex.id;
    }

    const payload: Record<string, any> = {
      name,
      whatsapp: phone || null,
      email,
      address: address || null,
      address_number: address_number || null,
      complement: complement || null,
      neighborhood: neighborhood || null,
      city,
      state,
      cep,
    };
    if (cpf) payload.cpf = cpf;
    // Drop nulls so we never wipe existing fields on update
    const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null && v !== undefined && v !== ""));

    if (customerId) {
      await supabase.from("pos_customers").update(cleanPayload).eq("id", customerId);
    } else {
      const { data: newCust, error: insErr } = await supabase
        .from("pos_customers")
        .insert(cleanPayload)
        .select("id")
        .single();
      if (insErr) throw insErr;
      customerId = newCust.id;
    }

    // 4. Link to sale + mirror onto the sale columns
    await supabase
      .from("pos_sales")
      .update({
        customer_id: customerId,
        customer_name: name,
        customer_phone: phone || null,
        customer_email: email,
        customer_cpf: cpf || null,
        customer_city: city,
        customer_state: state,
        customer_cep: cep,
        shipping_address: {
          address, address_number, complement, neighborhood, city, state, cep, name, phone,
        },
      } as any)
      .eq("id", sale_id);

    const { data: fresh } = await supabase
      .from("pos_customers")
      .select("id, name, cpf, whatsapp, email, address, address_number, complement, neighborhood, city, state, cep")
      .eq("id", customerId)
      .maybeSingle();

    return new Response(JSON.stringify({ ok: true, customer: fresh }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("shopify-pull-order-customer error", e?.message);
    return new Response(JSON.stringify({ error: e?.message || "Erro inesperado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

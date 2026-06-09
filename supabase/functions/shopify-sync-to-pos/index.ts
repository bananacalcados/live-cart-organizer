// Shopify → POS backfill / cron sync
// Imports Shopify orders as pos_sales rows for the "Tiny Shopify" store.
// Idempotent via pos_sales.external_source='shopify' + external_order_id=<order.id>.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TINY_SHOPIFY_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";

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
    const limit = Number(body.limit || 250);
    // Incremental by default. `days` only used as fallback window when there is
    // no stored watermark, or when caller explicitly forces a full backfill.
    const fallbackDays = Number(body.days || 2);
    const forceFull = body.full === true || body.days != null;

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

    const SYNC_KEY = "shopify_sync_to_pos_watermark";
    // Determine the incremental "since" using the stored watermark.
    let watermark: string | null = null;
    if (!forceFull) {
      const { data: wm } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", SYNC_KEY)
        .maybeSingle();
      watermark = (wm?.value as any)?.last_updated_at || null;
    }
    // 10-min overlap buffer so we never miss orders updated right at the boundary.
    const since = watermark
      ? new Date(new Date(watermark).getTime() - 10 * 60000).toISOString()
      : new Date(Date.now() - fallbackDays * 86400000).toISOString();
    const runStartedAt = new Date().toISOString();

    // status=any + no financial_status filter so we also see cancellations/refunds.
    // Filter by updated_at_min (not created_at_min) so status changes on old
    // orders are caught while keeping the page count tiny on each run.
    let url: string | null = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders.json?status=any&updated_at_min=${since}&limit=${limit}&fields=id,name,total_price,subtotal_price,total_discounts,total_shipping_price_set,line_items,created_at,updated_at,cancelled_at,financial_status,customer,phone,email,gateway,payment_gateway_names,shipping_address,billing_address,note_attributes`;

    let inserted = 0, skipped = 0, errors = 0, pages = 0, cancelled = 0;
    const safetyMax = 20;


    while (url && pages < safetyMax) {
      pages++;
      const r = await fetch(url, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const txt = await r.text();
        return new Response(JSON.stringify({ error: `Shopify ${r.status}`, body: txt.slice(0, 500) }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await r.json();
      const orders = data.orders || [];

      for (const o of orders) {
        const externalId = String(o.id);
        try {
          const fin = (o.financial_status || "").toLowerCase();
          const isCancelled = !!o.cancelled_at || ["refunded", "voided", "partially_refunded"].includes(fin);

          const { data: existing } = await supabase
            .from("pos_sales")
            .select("id, status, notes")
            .eq("external_source", "shopify")
            .eq("external_order_id", externalId)
            .maybeSingle();

          // Cancellation/refund fallback (when webhook missed it).
          if (isCancelled) {
            if (existing && existing.status !== "cancelled") {
              const reason = fin.includes("refund") ? "estorno" : "cancelamento";
              await supabase
                .from("pos_sales")
                .update({
                  status: "cancelled",
                  notes: `${existing.notes || ""} | Shopify ${reason} (sync)`.trim(),
                })
                .eq("id", existing.id);
              cancelled++;
            } else {
              skipped++;
            }
            continue;
          }

          if (existing) { skipped++; continue; }

          // Only paid orders become revenue rows.
          if (!["paid", "partially_paid"].includes(fin)) { skipped++; continue; }


          const total = Number(o.total_price || 0);
          const subtotal = Number(o.subtotal_price || total);
          const discount = Number(o.total_discounts || 0);
          const shippingCost = Number(o.total_shipping_price_set?.shop_money?.amount || 0);
          const items = (o.line_items || []) as any[];
          const customerName = o.customer ? `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim() : null;
          const customerPhone = o.phone || o.customer?.phone || o.shipping_address?.phone || o.billing_address?.phone || null;
          const customerEmail = o.email || o.customer?.email || null;
          const addr = o.shipping_address || o.billing_address || {};
          const customerCity = addr.city || null;
          const customerState = addr.province_code || addr.province || null;
          const customerCep = digits(addr.zip) || null;
          // CPF can be in note_attributes (commonly "cpf" or "CPF")
          const cpfAttr = (o.note_attributes || []).find((a: any) => /cpf/i.test(a?.name || ""));
          const customerCpf = digits(cpfAttr?.value) || null;
          const gateway = (o.payment_gateway_names || [])[0] || o.gateway || "shopify";

          // Full address breakdown (street/number/complement/neighborhood)
          const notesAttrs = o.note_attributes || [];
          const { street, number } = splitStreetNumber(addr.address1);
          const custAddress = street;
          const custNumber = number || findNoteAttr(notesAttrs, /n[uú]mero/i, /^num/i);
          const custComplement = (addr.address2 || "").trim() || findNoteAttr(notesAttrs, /complement/i);
          const custNeighborhood = findNoteAttr(notesAttrs, /bairro/i, /neighborhood/i) || (addr.company || "").trim() || null;
          const phoneClean = digits(customerPhone);

          // Find or create a linked pos_customers record
          let customerId: string | null = null;
          if (customerCpf) {
            const { data: ex } = await supabase.from("pos_customers").select("id").eq("cpf", customerCpf).maybeSingle();
            if (ex) customerId = ex.id;
          }
          if (!customerId && phoneClean) {
            const { data: ex } = await supabase.from("pos_customers").select("id").eq("whatsapp", phoneClean).maybeSingle();
            if (ex) customerId = ex.id;
          }
          if (customerName || phoneClean || customerCpf) {
            const custPayload: Record<string, any> = {
              name: customerName,
              whatsapp: phoneClean || null,
              email: customerEmail,
              address: custAddress || null,
              address_number: custNumber || null,
              complement: custComplement || null,
              neighborhood: custNeighborhood || null,
              city: customerCity,
              state: customerState,
              cep: customerCep,
            };
            if (customerCpf) custPayload.cpf = customerCpf;
            const cleanCust = Object.fromEntries(Object.entries(custPayload).filter(([, v]) => v !== null && v !== undefined && v !== ""));
            if (customerId) {
              await supabase.from("pos_customers").update(cleanCust).eq("id", customerId);
            } else {
              const { data: nc } = await supabase.from("pos_customers").insert(cleanCust).select("id").single();
              customerId = nc?.id || null;
            }
          }

          const { data: sale, error: saleErr } = await supabase
            .from("pos_sales")
            .insert({
              store_id: TINY_SHOPIFY_STORE_ID,
              external_source: "shopify",
              external_order_id: externalId,
              sale_type: "online",
              status: "completed",
              payment_method: gateway,
              payment_gateway: "shopify",
              subtotal,
              discount,
              total,
              shipping_cost: shippingCost,
              customer_id: customerId,
              customer_name: customerName,
              customer_phone: customerPhone,
              customer_email: customerEmail,
              customer_cpf: customerCpf,
              customer_city: customerCity,
              customer_state: customerState,
              customer_cep: customerCep,
              shipping_address: {
                address: custAddress, address_number: custNumber, complement: custComplement,
                neighborhood: custNeighborhood, city: customerCity, state: customerState,
                cep: customerCep, name: customerName, phone: phoneClean || null,
              },
              paid_at: o.created_at,
              created_at: o.created_at,
              notes: `Shopify ${o.name || ""}`.trim(),
            } as any)
            .select("id")
            .single();
          if (saleErr) throw saleErr;

          if (items.length > 0) {
            const itemRows = items.map((li: any) => ({
              sale_id: sale.id,
              product_name: li.title || li.name || "Item Shopify",
              variant_name: li.variant_title || null,
              sku: li.sku || null,
              unit_price: Number(li.price || 0),
              quantity: Number(li.quantity || 1),
              total_price: Number(li.price || 0) * Number(li.quantity || 1),
            }));
            await supabase.from("pos_sale_items").insert(itemRows);
          }
          inserted++;
        } catch (e: any) {
          console.error("Order error", o.id, e.message);
          errors++;
        }
      }

      const link = r.headers.get("link") || r.headers.get("Link");
      const next = link?.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }

    return new Response(JSON.stringify({ ok: true, inserted, skipped, errors, pages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

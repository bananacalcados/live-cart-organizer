// Shopify webhook receiver — orders/paid + orders/updated
// HMAC validation with SHOPIFY_CLIENT_SECRET (used for Shopify custom app webhooks).
// Idempotent upsert via (external_source='shopify', external_order_id).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  extractShopifyAttribution,
  resolveLinkPageAttribution,
  markLinkPageConversion,
} from "../_shared/shopify-attribution.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
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

async function verifyHmac(rawBody: string, hmacHeader: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return computed === hmacHeader;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const raw = await req.text();
    const hmac = req.headers.get("x-shopify-hmac-sha256") || "";
    const topic = req.headers.get("x-shopify-topic") || "";
    const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") || Deno.env.get("SHOPIFY_CLIENT_SECRET") || "";

    if (secret && hmac) {
      const ok = await verifyHmac(raw, hmac, secret);
      if (!ok) {
        console.warn("Invalid HMAC for topic", topic);
        return new Response("Invalid HMAC", { status: 401, headers: corsHeaders });
      }
    }

    const o = JSON.parse(raw);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const financial = (o.financial_status || "").toLowerCase();
    const topicLc = topic.toLowerCase();

    // --- Cancellation / refund handling ---
    // Triggered by orders/cancelled, refunds/create, or orders/updated with
    // cancelled_at set or financial_status refunded/voided. Marks the matching
    // pos_sales row as cancelled so it leaves revenue immediately (event-driven).
    const refundOrderId = o.order_id ? String(o.order_id) : null; // refunds/create payload
    const isCancelEvent =
      topicLc.includes("cancel") ||
      topicLc.includes("refund") ||
      !!o.cancelled_at ||
      ["refunded", "voided", "partially_refunded"].includes(financial);

    if (isCancelEvent) {
      const targetId = refundOrderId || String(o.id);
      const { data: row } = await supabase
        .from("pos_sales")
        .select("id, status, notes")
        .eq("external_source", "shopify")
        .eq("external_order_id", targetId)
        .maybeSingle();
      if (!row) {
        return new Response(JSON.stringify({ ok: true, cancel_skipped: "sale not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.status === "cancelled") {
        return new Response(JSON.stringify({ ok: true, already_cancelled: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const reason = topicLc.includes("refund") || financial.includes("refund") ? "estorno" : "cancelamento";
      await supabase
        .from("pos_sales")
        .update({
          status: "cancelled",
          notes: `${row.notes || ""} | Shopify ${reason} (${topic || financial})`.trim(),
        })
        .eq("id", row.id);
      return new Response(JSON.stringify({ ok: true, cancelled: true, sale_id: row.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only paid orders count as revenue
    if (!["paid", "partially_paid"].includes(financial)) {
      return new Response(JSON.stringify({ ok: true, skipped: "not paid" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const externalId = String(o.id);
    const { data: existing } = await supabase
      .from("pos_sales")
      .select("id")
      .eq("external_source", "shopify")
      .eq("external_order_id", externalId)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const total = Number(o.total_price || 0);
    const subtotal = Number(o.subtotal_price || total);
    const discount = Number(o.total_discounts || 0);
    const shippingCost = Number(o.total_shipping_price_set?.shop_money?.amount || 0);
    const items = (o.line_items || []) as any[];
    const gateway = (o.payment_gateway_names || [])[0] || o.gateway || "shopify";

    // Alguns webhooks chegam sem endereço/atributos completos. Nesse caso buscamos
    // o pedido completo na Admin API para não perder CPF/endereço.
    let full = o;
    if (!o.shipping_address && !o.billing_address) {
      const dom = Deno.env.get("SHOPIFY_STORE_DOMAIN");
      const tok = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
      if (dom && tok) {
        try {
          const rr = await fetch(
            `https://${dom}/admin/api/2024-01/orders/${externalId}.json?fields=id,name,customer,phone,email,shipping_address,billing_address,note_attributes,landing_site`,
            { headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json" } },
          );
          if (rr.ok) {
            const j = await rr.json();
            if (j.order) full = { ...o, ...j.order };
          }
        } catch (e) {
          console.warn("shopify order refetch failed", (e as any)?.message);
        }
      }
    }

    const addr = full.shipping_address || full.billing_address || {};
    const notesAttrs = full.note_attributes || [];
    const customerName = full.customer
      ? `${full.customer.first_name || ""} ${full.customer.last_name || ""}`.trim() || (addr.name || null)
      : (addr.name || null);
    const customerPhone = full.phone || full.customer?.phone || addr.phone || full.billing_address?.phone || null;
    const customerEmail = (full.email || full.customer?.email || "").trim() || null;
    const customerCpf = digits(findNoteAttr(notesAttrs, /cpf/i, /cnpj/i)) || null;
    const customerCity = addr.city || null;
    const customerState = addr.province_code || addr.province || null;
    const customerCep = digits(addr.zip) || null;
    const { street, number } = splitStreetNumber(addr.address1);
    const custAddress = street;
    const custNumber = number || findNoteAttr(notesAttrs, /n[uú]mero/i, /^num/i);
    const custComplement = (addr.address2 || "").trim() || findNoteAttr(notesAttrs, /complement/i);
    const custNeighborhood = findNoteAttr(notesAttrs, /bairro/i, /neighborhood/i) || (addr.company || "").trim() || null;
    const phoneClean = digits(customerPhone);

    // Vincula/cria o cliente no PDV (CPF > telefone)
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
      const cleanCust = Object.fromEntries(
        Object.entries(custPayload).filter(([, v]) => v !== null && v !== undefined && v !== ""),
      );
      if (customerId) {
        await supabase.from("pos_customers").update(cleanCust).eq("id", customerId);
      } else {
        const { data: nc } = await supabase.from("pos_customers").insert(cleanCust).select("id").single();
        customerId = nc?.id || null;
      }
    }

    // Origem/atribuição (UTMs no note_attributes gravadas pelo site)
    const attribution = extractShopifyAttribution(full);
    const lp = await resolveLinkPageAttribution(supabase, attribution);

    const { data: sale, error } = await supabase
      .from("pos_sales")
      .insert({
        store_id: TINY_SHOPIFY_STORE_ID,
        external_source: "shopify",
        external_order_id: externalId,
        sale_type: "online",
        status: "completed",
        payment_method: gateway,
        payment_gateway: "shopify",
        subtotal, discount, total,
        shipping_cost: shippingCost,
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        customer_cpf: customerCpf,
        customer_city: customerCity,
        customer_state: customerState,
        customer_cep: customerCep,
        utm_source: attribution.utm_source,
        utm_medium: attribution.utm_medium,
        utm_campaign: attribution.utm_campaign,
        utm_content: attribution.utm_content,
        utm_term: attribution.utm_term,
        lp_click_id: attribution.lp_click_id,
        attribution_source: attribution.attribution_source,
        link_page_id: lp.link_page_id,
        link_page_item_id: lp.link_page_item_id,
        link_page_catalog_product_id: lp.link_page_catalog_product_id,
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
    if (error) throw error;

    await markLinkPageConversion(supabase, lp.visit_id, {
      saleId: sale.id, externalOrderId: externalId, total,
    });


    if (items.length > 0) {
      // Enriquece cada item com barcode (gtin) e sku reais via product_variants,
      // casando pelo variant_id da Shopify. Isso garante que o trigger de baixa
      // de estoque (apply_pos_sale_stock_movement) encontre o produto certo e
      // abata do estoque compartilhado (loja que tiver saldo da variação).
      const variantIds = Array.from(
        new Set(items.map((li: any) => (li.variant_id != null ? String(li.variant_id) : "")).filter(Boolean)),
      );
      const variantInfo = new Map<string, { gtin: string | null; sku: string | null }>();
      if (variantIds.length) {
        const { data: pv } = await supabase
          .from("product_variants")
          .select("shopify_variant_id, gtin, sku")
          .in("shopify_variant_id", variantIds);
        for (const v of pv || []) {
          if (v.shopify_variant_id) {
            variantInfo.set(String(v.shopify_variant_id), { gtin: v.gtin ?? null, sku: v.sku ?? null });
          }
        }
      }

      const rows = items.map((li: any) => {
        const info = li.variant_id != null ? variantInfo.get(String(li.variant_id)) : undefined;
        return {
          sale_id: sale.id,
          product_name: li.title || li.name || "Item Shopify",
          variant_name: li.variant_title || null,
          sku: info?.sku || li.sku || null,
          barcode: info?.gtin || li.barcode || null,
          unit_price: Number(li.price || 0),
          quantity: Number(li.quantity || 1),
          total_price: Number(li.price || 0) * Number(li.quantity || 1),
        };
      });
      await supabase.from("pos_sale_items").insert(rows);
    }

    return new Response(JSON.stringify({ ok: true, inserted: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("shopify-webhook error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

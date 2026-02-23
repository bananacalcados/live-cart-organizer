import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!shopifyDomain || !shopifyToken) throw new Error("Shopify credentials not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { eventId } = await req.json();
    if (!eventId) throw new Error("eventId is required");

    // 1. Fetch all paid orders for this event with customer data
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, products, created_at, customer_id, is_paid, paid_externally, customer:customers(instagram_handle, whatsapp)")
      .eq("event_id", eventId)
      .or("is_paid.eq.true,paid_externally.eq.true");

    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) {
      return new Response(JSON.stringify({ results: [], total: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Also get customer_registrations for these orders (may have phone/email)
    const orderIds = orders.map(o => o.id);
    const { data: registrations } = await supabase
      .from("customer_registrations")
      .select("order_id, full_name, email, whatsapp, shopify_draft_order_id, shopify_draft_order_name")
      .in("order_id", orderIds);

    const regMap = new Map((registrations || []).map(r => [r.order_id, r]));

    // 2. Determine date range for Shopify query (event orders date range with buffer)
    const dates = orders.map(o => new Date(o.created_at).getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 2);

    // 3. Fetch Shopify orders in that date range (paginated, up to 250 per page)
    const shopifyOrders: any[] = [];
    let pageUrl = `https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&created_at_min=${minDate.toISOString()}&created_at_max=${maxDate.toISOString()}&limit=250&fields=id,name,phone,email,line_items,created_at,customer,financial_status`;

    for (let page = 0; page < 10; page++) {
      const resp = await fetch(pageUrl, {
        headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
      });
      if (!resp.ok) {
        console.error("Shopify API error:", resp.status, await resp.text());
        break;
      }
      const data = await resp.json();
      shopifyOrders.push(...(data.orders || []));

      // Check for next page via Link header
      const linkHeader = resp.headers.get("Link");
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          pageUrl = match[1];
          continue;
        }
      }
      break;
    }

    console.log(`Fetched ${shopifyOrders.length} Shopify orders in date range`);

    // 4. Build lookup structures from Shopify orders
    // Index by phone suffix (last 8 digits) and by variant IDs
    const shopifyByPhone = new Map<string, any[]>();
    const shopifyByEmail = new Map<string, any[]>();

    for (const so of shopifyOrders) {
      // Phone from order or customer
      const phones = [so.phone, so.customer?.phone, so.customer?.default_address?.phone].filter(Boolean);
      for (const p of phones) {
        const suffix = p.replace(/\D/g, "").slice(-8);
        if (suffix.length >= 8) {
          if (!shopifyByPhone.has(suffix)) shopifyByPhone.set(suffix, []);
          shopifyByPhone.get(suffix)!.push(so);
        }
      }
      // Email
      const emails = [so.email, so.customer?.email].filter(Boolean);
      for (const e of emails) {
        const key = e.toLowerCase().trim();
        if (!shopifyByEmail.has(key)) shopifyByEmail.set(key, []);
        shopifyByEmail.get(key)!.push(so);
      }
    }

    // 5. Match each CRM order against Shopify
    const results: { orderId: string; hasShopify: boolean; shopifyOrderName?: string; matchMethod?: string }[] = [];

    for (const order of orders) {
      const reg = regMap.get(order.id);

      // If already has shopify_draft_order_id, it's matched
      if (reg?.shopify_draft_order_id) {
        results.push({ orderId: order.id, hasShopify: true, shopifyOrderName: reg.shopify_draft_order_name || undefined, matchMethod: "registration" });
        continue;
      }

      // Collect phones to search
      const phonesToCheck: string[] = [];
      const customer = order.customer as any;
      if (customer?.whatsapp) phonesToCheck.push(customer.whatsapp.replace(/\D/g, ""));
      if (reg?.whatsapp) phonesToCheck.push(reg.whatsapp.replace(/\D/g, ""));

      // Collect emails to search
      const emailsToCheck: string[] = [];
      if (reg?.email) emailsToCheck.push(reg.email.toLowerCase().trim());

      // Get variant IDs from CRM order products
      const crmVariantIds = new Set<string>();
      const products = order.products as any[];
      for (const p of products) {
        if (p.shopifyId) {
          const match = p.shopifyId.match(/ProductVariant\/(\d+)/);
          if (match) crmVariantIds.add(match[1]);
        }
      }

      let matched = false;
      let matchedOrderName = "";
      let matchMethod = "";

      // Try phone match first
      for (const phone of phonesToCheck) {
        const suffix = phone.slice(-8);
        const candidates = shopifyByPhone.get(suffix) || [];
        for (const so of candidates) {
          // Verify at least one product matches
          const soVariantIds = new Set((so.line_items || []).map((li: any) => String(li.variant_id)));
          const hasProductMatch = [...crmVariantIds].some(vid => soVariantIds.has(vid));
          if (hasProductMatch) {
            matched = true;
            matchedOrderName = so.name;
            matchMethod = "phone+product";
            break;
          }
        }
        if (matched) break;
      }

      // Try email match if phone didn't work
      if (!matched) {
        for (const email of emailsToCheck) {
          const candidates = shopifyByEmail.get(email) || [];
          for (const so of candidates) {
            const soVariantIds = new Set((so.line_items || []).map((li: any) => String(li.variant_id)));
            const hasProductMatch = [...crmVariantIds].some(vid => soVariantIds.has(vid));
            if (hasProductMatch) {
              matched = true;
              matchedOrderName = so.name;
              matchMethod = "email+product";
              break;
            }
          }
          if (matched) break;
        }
      }

      results.push({
        orderId: order.id,
        hasShopify: matched,
        shopifyOrderName: matched ? matchedOrderName : undefined,
        matchMethod: matched ? matchMethod : undefined,
      });
    }

    const missing = results.filter(r => !r.hasShopify).length;
    console.log(`Verification complete: ${results.length} orders checked, ${missing} missing Shopify`);

    return new Response(
      JSON.stringify({ results, total: results.length, missing, shopifyOrdersChecked: shopifyOrders.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { dispatch_id, window_days } = await req.json();
    if (!dispatch_id || !window_days) {
      return new Response(JSON.stringify({ error: "dispatch_id and window_days required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get dispatch info
    const { data: dispatch, error: dErr } = await supabase
      .from("dispatch_history")
      .select("id, started_at, created_at, completed_at, cost_per_message, sent_count, template_category")
      .eq("id", dispatch_id)
      .single();

    if (dErr || !dispatch) {
      return new Response(JSON.stringify({ error: "Dispatch not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get ALL recipients (paginated to bypass 1000-row limit)
    let recipients: { phone: string; recipient_name: string | null }[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data: batch } = await supabase
        .from("dispatch_recipients")
        .select("phone, recipient_name")
        .eq("dispatch_id", dispatch_id)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!batch || batch.length === 0) break;
      recipients = recipients.concat(batch);
      if (batch.length < PAGE_SIZE) break;
      page++;
      if (recipients.length >= 50000) break;
    }

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({
        buyers: [], total_revenue: 0, total_buyers: 0,
        cost: (dispatch.cost_per_message || 0) * (dispatch.sent_count || 0),
        window_days,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const dispatchDate = dispatch.created_at || dispatch.started_at;
    const windowEnd = new Date(new Date(dispatchDate).getTime() + window_days * 24 * 60 * 60 * 1000).toISOString();

    // Build phone suffix map (DDD + last 8 digits) for matching
    const phoneSuffixes = new Map<string, string>(); // suffix -> original phone
    const recipientNames = new Map<string, string>(); // suffix -> name
    for (const r of recipients) {
      const digits = r.phone.replace(/\D/g, "");
      const suffix = digits.slice(-8);
      phoneSuffixes.set(suffix, r.phone);
      if (r.recipient_name) recipientNames.set(suffix, r.recipient_name);
    }
    const suffixArray = Array.from(phoneSuffixes.keys());

    // 3. Check for NEWER dispatches that also reached these phones (for dedup)
    const { data: laterDispatches } = await supabase
      .from("dispatch_history")
      .select("id, created_at")
      .gt("created_at", dispatchDate)
      .lte("created_at", windowEnd)
      .neq("id", dispatch_id)
      .in("status", ["completed", "sending"])
      .order("created_at", { ascending: true });

    const dedupMap = new Map<string, string>();
    if (laterDispatches && laterDispatches.length > 0) {
      for (const ld of laterDispatches) {
        const { data: ldRecipients } = await supabase
          .from("dispatch_recipients")
          .select("phone")
          .eq("dispatch_id", ld.id);

        if (ldRecipients) {
          for (const lr of ldRecipients) {
            const s = lr.phone.replace(/\D/g, "").slice(-8);
            if (phoneSuffixes.has(s) && !dedupMap.has(s)) {
              dedupMap.set(s, ld.created_at);
            }
          }
        }
      }
    }

    // 4. Query sales from ALL sources
    interface BuyerResult {
      name: string;
      phone: string;
      total: number;
      source: string;
      purchased_at: string;
      store_name: string | null;
      seller_name: string | null;
      products: { name: string; variant?: string; qty: number; price: number }[];
      is_first_purchase: boolean;
    }
    const buyers: BuyerResult[] = [];
    const countedPhones = new Set<string>();

    // 4a. POS Sales
    let posSales: any[] = [];
    let posPage = 0;
    while (true) {
      const { data: batch } = await supabase
        .from("pos_sales")
        .select("id, total, created_at, customer_id, status, store_id, seller_id")
        .gte("created_at", dispatchDate)
        .lte("created_at", windowEnd)
        .in("status", ["completed", "paid"])
        .range(posPage * 1000, (posPage + 1) * 1000 - 1);
      if (!batch || batch.length === 0) break;
      posSales = posSales.concat(batch);
      if (batch.length < 1000) break;
      posPage++;
    }

    if (posSales.length > 0) {
      const customerIds = [...new Set(posSales.filter(s => s.customer_id).map(s => s.customer_id))];
      const storeIds = [...new Set(posSales.filter(s => s.store_id).map(s => s.store_id))];
      const sellerIds = [...new Set(posSales.filter(s => s.seller_id).map(s => s.seller_id))];
      const saleIds = posSales.map(s => s.id);

      // Batch fetch customers, stores, sellers, items
      const customerMap = new Map<string, { name: string; whatsapp: string; suffix: string }>();
      for (let i = 0; i < customerIds.length; i += 100) {
        const batch = customerIds.slice(i, i + 100);
        const { data: customers } = await supabase
          .from("pos_customers")
          .select("id, name, whatsapp")
          .in("id", batch);
        if (customers) {
          for (const c of customers) {
            if (c.whatsapp) {
              const suffix = c.whatsapp.replace(/\D/g, "").slice(-8);
              customerMap.set(c.id, { name: c.name || "", whatsapp: c.whatsapp, suffix });
            }
          }
        }
      }

      // Stores
      const storeMap = new Map<string, string>();
      if (storeIds.length > 0) {
        const { data: stores } = await supabase.from("pos_stores").select("id, name").in("id", storeIds);
        if (stores) for (const s of stores) storeMap.set(s.id, s.name);
      }

      // Sellers
      const sellerMap = new Map<string, string>();
      if (sellerIds.length > 0) {
        const { data: sellers } = await supabase.from("pos_sellers").select("id, name").in("id", sellerIds);
        if (sellers) for (const s of sellers) sellerMap.set(s.id, s.name);
      }

      // Sale items - fetch for matched sales only (we'll filter after matching)
      const matchedSaleIds: string[] = [];

      for (const sale of posSales) {
        if (!sale.customer_id) continue;
        const customer = customerMap.get(sale.customer_id);
        if (!customer || !phoneSuffixes.has(customer.suffix)) continue;
        const laterDate = dedupMap.get(customer.suffix);
        if (laterDate && new Date(sale.created_at) >= new Date(laterDate)) continue;
        matchedSaleIds.push(sale.id);
      }

      // Fetch items for matched sales
      const saleItemsMap = new Map<string, { name: string; variant?: string; qty: number; price: number }[]>();
      for (let i = 0; i < matchedSaleIds.length; i += 50) {
        const batch = matchedSaleIds.slice(i, i + 50);
        const { data: items } = await supabase
          .from("pos_sale_items")
          .select("sale_id, product_name, variant_name, quantity, unit_price")
          .in("sale_id", batch);
        if (items) {
          for (const item of items) {
            if (!saleItemsMap.has(item.sale_id)) saleItemsMap.set(item.sale_id, []);
            saleItemsMap.get(item.sale_id)!.push({
              name: item.product_name || "Produto",
              variant: item.variant_name || undefined,
              qty: item.quantity || 1,
              price: item.unit_price || 0,
            });
          }
        }
      }

      // Check first purchase: for each matched customer suffix, check if they had purchases before dispatch
      const firstPurchaseMap = new Map<string, boolean>();
      const suffixesForCheck = [...new Set(
        posSales
          .filter(s => s.customer_id && customerMap.has(s.customer_id) && phoneSuffixes.has(customerMap.get(s.customer_id)!.suffix))
          .map(s => customerMap.get(s.customer_id)!.suffix)
      )];

      // Check pos_sales before dispatch date
      for (const suffix of suffixesForCheck) {
        // Find all customer_ids with this suffix
        const cids = Array.from(customerMap.entries())
          .filter(([_, v]) => v.suffix === suffix)
          .map(([k]) => k);
        if (cids.length === 0) { firstPurchaseMap.set(suffix, true); continue; }
        
        const { data: prev, count } = await supabase
          .from("pos_sales")
          .select("id", { count: "exact", head: true })
          .in("customer_id", cids)
          .lt("created_at", dispatchDate)
          .in("status", ["completed", "paid"]);
        
        const hasZoppy = await supabase
          .from("zoppy_sales")
          .select("id", { count: "exact", head: true })
          .ilike("customer_phone", `%${suffix}`)
          .lt("completed_at", dispatchDate);

        firstPurchaseMap.set(suffix, (count || 0) === 0 && (hasZoppy.count || 0) === 0);
      }

      for (const sale of posSales) {
        if (!sale.customer_id) continue;
        const customer = customerMap.get(sale.customer_id);
        if (!customer || !phoneSuffixes.has(customer.suffix)) continue;
        const laterDate = dedupMap.get(customer.suffix);
        if (laterDate && new Date(sale.created_at) >= new Date(laterDate)) continue;

        if (!countedPhones.has(customer.suffix + "_pos_" + sale.id)) {
          countedPhones.add(customer.suffix + "_pos_" + sale.id);
          buyers.push({
            name: customer.name || recipientNames.get(customer.suffix) || customer.whatsapp,
            phone: customer.whatsapp,
            total: sale.total || 0,
            source: "PDV",
            purchased_at: sale.created_at,
            store_name: storeMap.get(sale.store_id) || null,
            seller_name: sellerMap.get(sale.seller_id) || null,
            products: saleItemsMap.get(sale.id) || [],
            is_first_purchase: firstPurchaseMap.get(customer.suffix) ?? false,
          });
        }
      }
    }

    // 4b. Shopify/Online sales (zoppy_sales)
    const { data: zoppySales } = await supabase
      .from("zoppy_sales")
      .select("id, total, customer_phone, customer_name, completed_at, status, line_items")
      .gte("completed_at", dispatchDate)
      .lte("completed_at", windowEnd)
      .in("status", ["paid", "complete", "completed"]);

    if (zoppySales) {
      // Check first purchase for zoppy customers
      const zoppySuffixes = [...new Set(
        zoppySales.filter(s => s.customer_phone).map(s => s.customer_phone!.replace(/\D/g, "").slice(-8))
          .filter(s => phoneSuffixes.has(s))
      )];

      const zoppyFirstMap = new Map<string, boolean>();
      for (const suffix of zoppySuffixes) {
        if (firstPurchaseMap && firstPurchaseMap.has(suffix)) {
          // Already checked via POS
          zoppyFirstMap.set(suffix, false);
          continue;
        }
        const { count: prevZoppy } = await supabase
          .from("zoppy_sales")
          .select("id", { count: "exact", head: true })
          .ilike("customer_phone", `%${suffix}`)
          .lt("completed_at", dispatchDate);
        const { count: prevPos } = await supabase
          .from("pos_sales")
          .select("id", { count: "exact", head: true })
          .lt("created_at", dispatchDate)
          .in("status", ["completed", "paid"]);
        // For pos we'd need to cross-reference customer, simplified: just check zoppy
        zoppyFirstMap.set(suffix, (prevZoppy || 0) === 0);
      }

      for (const sale of zoppySales) {
        if (!sale.customer_phone) continue;
        const suffix = sale.customer_phone.replace(/\D/g, "").slice(-8);
        if (!phoneSuffixes.has(suffix)) continue;

        const laterDate = dedupMap.get(suffix);
        if (laterDate && new Date(sale.completed_at) >= new Date(laterDate)) continue;

        const key = suffix + "_zoppy_" + sale.id;
        if (!countedPhones.has(key)) {
          countedPhones.add(key);

          // Parse line_items
          let products: { name: string; variant?: string; qty: number; price: number }[] = [];
          if (sale.line_items && Array.isArray(sale.line_items)) {
            products = (sale.line_items as any[]).map(li => ({
              name: li.title || li.name || "Produto",
              variant: li.variant_title || li.variant || undefined,
              qty: li.quantity || 1,
              price: li.price || 0,
            }));
          }

          buyers.push({
            name: sale.customer_name || recipientNames.get(suffix) || sale.customer_phone,
            phone: sale.customer_phone,
            total: sale.total || 0,
            source: "Shopify",
            purchased_at: sale.completed_at,
            store_name: null,
            seller_name: null,
            products,
            is_first_purchase: zoppyFirstMap.get(suffix) ?? false,
          });
        }
      }
    }

    // 4c. WhatsApp/Event orders
    const { data: orders } = await supabase
      .from("orders")
      .select("id, products, is_paid, paid_at, customer_id, stage, created_at")
      .eq("is_paid", true)
      .gte("paid_at", dispatchDate)
      .lte("paid_at", windowEnd);

    if (orders && orders.length > 0) {
      const orderCustomerIds = [...new Set(orders.filter(o => o.customer_id).map(o => o.customer_id))];
      const orderCustomerMap = new Map<string, { whatsapp: string; instagram: string }>();

      for (let i = 0; i < orderCustomerIds.length; i += 100) {
        const batch = orderCustomerIds.slice(i, i + 100);
        const { data: customers } = await supabase
          .from("customers")
          .select("id, whatsapp, instagram_handle")
          .in("id", batch);
        if (customers) {
          for (const c of customers) {
            if (c.whatsapp) {
              orderCustomerMap.set(c.id, { whatsapp: c.whatsapp, instagram: c.instagram_handle || "" });
            }
          }
        }
      }

      for (const order of orders) {
        if (!order.customer_id) continue;
        const customer = orderCustomerMap.get(order.customer_id);
        if (!customer) continue;
        const suffix = customer.whatsapp.replace(/\D/g, "").slice(-8);
        if (!phoneSuffixes.has(suffix)) continue;

        const laterDate = dedupMap.get(suffix);
        const purchaseDate = order.paid_at || order.created_at;
        if (laterDate && new Date(purchaseDate) >= new Date(laterDate)) continue;

        let orderTotal = 0;
        let products: { name: string; variant?: string; qty: number; price: number }[] = [];
        if (order.products && Array.isArray(order.products)) {
          for (const p of order.products as any[]) {
            orderTotal += (p.price || 0) * (p.quantity || 1);
            products.push({
              name: p.title || "Produto",
              variant: p.variant || undefined,
              qty: p.quantity || 1,
              price: p.price || 0,
            });
          }
        }

        const key = suffix + "_order_" + order.id;
        if (!countedPhones.has(key)) {
          countedPhones.add(key);
          buyers.push({
            name: customer.instagram || recipientNames.get(suffix) || customer.whatsapp,
            phone: customer.whatsapp,
            total: orderTotal,
            source: "WhatsApp",
            purchased_at: purchaseDate,
            store_name: null,
            seller_name: null,
            products,
            is_first_purchase: false,
          });
        }
      }
    }

    // Sort by purchase date
    buyers.sort((a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime());

    const totalRevenue = buyers.reduce((sum, b) => sum + b.total, 0);
    const uniqueBuyerPhones = new Set(buyers.map(b => b.phone.replace(/\D/g, "").slice(-8)));
    const cost = (dispatch.cost_per_message || 0) * (dispatch.sent_count || 0);

    return new Response(JSON.stringify({
      buyers,
      total_revenue: totalRevenue,
      total_buyers: uniqueBuyerPhones.size,
      total_orders: buyers.length,
      cost,
      roi: cost > 0 ? ((totalRevenue - cost) / cost * 100).toFixed(1) : null,
      window_days,
      dispatch_date: dispatchDate,
      window_end: windowEnd,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("dispatch-attribution error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

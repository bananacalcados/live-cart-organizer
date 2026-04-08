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
      .select("id, started_at, created_at, completed_at, cost_per_message, sent_count")
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
    const PAGE_SIZE = 5000;
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

    // Build phone suffix map (last 8 digits) for matching
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
    // Get all dispatches AFTER this one
    const { data: laterDispatches } = await supabase
      .from("dispatch_history")
      .select("id, created_at")
      .gt("created_at", dispatchDate)
      .lte("created_at", windowEnd)
      .neq("id", dispatch_id)
      .in("status", ["completed", "sending"])
      .order("created_at", { ascending: true });

    // For each later dispatch, get their recipients to build dedup map
    // suffix -> earliest later dispatch date that also reached this phone
    const dedupMap = new Map<string, string>(); // suffix -> date of next dispatch
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
    }
    const buyers: BuyerResult[] = [];
    const countedPhones = new Set<string>(); // avoid counting same phone from multiple sources

    // 4a. POS Sales (pos_sales + pos_customers) - paginated
    let posSales: any[] = [];
    let posPage = 0;
    while (true) {
      const { data: batch } = await supabase
        .from("pos_sales")
        .select("id, total, created_at, customer_id, status")
        .gte("created_at", dispatchDate)
        .lte("created_at", windowEnd)
        .in("status", ["completed", "paid"])
        .range(posPage * 1000, (posPage + 1) * 1000 - 1);
      if (!batch || batch.length === 0) break;
      posSales = posSales.concat(batch);
      if (batch.length < 1000) break;
      posPage++;
    }

    if (posSales && posSales.length > 0) {
      const customerIds = [...new Set(posSales.filter(s => s.customer_id).map(s => s.customer_id))];
      
      // Batch fetch customers
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

      for (const sale of posSales) {
        if (!sale.customer_id) continue;
        const customer = customerMap.get(sale.customer_id);
        if (!customer || !phoneSuffixes.has(customer.suffix)) continue;

        // Dedup: if there's a later dispatch for this phone before the purchase, skip
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
          });
        }
      }
    }

    // 4b. Shopify/Online sales (zoppy_sales)
    const { data: zoppySales } = await supabase
      .from("zoppy_sales")
      .select("id, total, customer_phone, customer_name, completed_at, status")
      .gte("completed_at", dispatchDate)
      .lte("completed_at", windowEnd)
      .in("status", ["paid", "complete", "completed"]);

    if (zoppySales) {
      for (const sale of zoppySales) {
        if (!sale.customer_phone) continue;
        const suffix = sale.customer_phone.replace(/\D/g, "").slice(-8);
        if (!phoneSuffixes.has(suffix)) continue;

        const laterDate = dedupMap.get(suffix);
        if (laterDate && new Date(sale.completed_at) >= new Date(laterDate)) continue;

        const key = suffix + "_zoppy_" + sale.id;
        if (!countedPhones.has(key)) {
          countedPhones.add(key);
          buyers.push({
            name: sale.customer_name || recipientNames.get(suffix) || sale.customer_phone,
            phone: sale.customer_phone,
            total: sale.total || 0,
            source: "Shopify",
            purchased_at: sale.completed_at,
          });
        }
      }
    }

    // 4c. WhatsApp/Event orders (orders + customers)
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

        // Calc order total from products
        let orderTotal = 0;
        if (order.products && Array.isArray(order.products)) {
          for (const p of order.products as any[]) {
            orderTotal += (p.price || 0) * (p.quantity || 1);
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
          });
        }
      }
    }

    // Sort by purchase date
    buyers.sort((a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime());

    const totalRevenue = buyers.reduce((sum, b) => sum + b.total, 0);
    // Count unique phones
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

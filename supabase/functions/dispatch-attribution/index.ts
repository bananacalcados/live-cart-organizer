import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  BuyerResult, PreviousPurchase, BuyerProduct,
  extractPhoneKey, parseLineItems, parseOrderProducts, sortPurchasesDesc,
} from "../_shared/dispatch-attribution.ts";

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
      .select("id, started_at, created_at, completed_at, cost_per_message, sent_count, template_category, template_name, whatsapp_number_id")
      .eq("id", dispatch_id)
      .single();

    let whatsapp_label: string | null = null;
    let whatsapp_phone: string | null = null;
    if (dispatch?.whatsapp_number_id) {
      const { data: wn } = await supabase
        .from("whatsapp_numbers")
        .select("label, phone_display")
        .eq("id", dispatch.whatsapp_number_id)
        .single();
      if (wn) {
        whatsapp_label = wn.label;
        whatsapp_phone = wn.phone_display;
      }
    }

    if (dErr || !dispatch) {
      return new Response(JSON.stringify({ error: "Dispatch not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get ALL recipients (paginated)
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
        buyers: [], total_revenue: 0, total_buyers: 0, total_orders: 0,
        cost: 0, cost_per_message: 0, template_category: "MARKETING",
        template_name: null, whatsapp_label: null, whatsapp_phone: null,
        roi: null, roas: null, window_days,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const dispatchDate = dispatch.created_at || dispatch.started_at;
    const windowEnd = new Date(new Date(dispatchDate).getTime() + window_days * 86400000).toISOString();

    // Build phone suffix map (DDD + last 8 digits)
    const phoneSuffixes = new Map<string, string>();
    const recipientNames = new Map<string, string>();
    for (const r of recipients) {
      const key = extractPhoneKey(r.phone);
      if (!key) continue;
      const suffix = key; // DDD + 8 digits
      phoneSuffixes.set(suffix, r.phone);
      if (r.recipient_name) recipientNames.set(suffix, r.recipient_name);
    }

    // 3. Dedup with newer dispatches
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
            const s = extractPhoneKey(lr.phone);
            if (s && phoneSuffixes.has(s) && !dedupMap.has(s)) {
              dedupMap.set(s, ld.created_at);
            }
          }
        }
      }
    }

    // 4. Query sales from ALL sources
    const buyers: BuyerResult[] = [];
    const countedPhones = new Set<string>();
    // Track suffixes that matched for previous purchase lookup
    const matchedSuffixes = new Set<string>();

    // ===== GLOBAL RECURRENCE CHECK =====
    // Pre-fetch zoppy_customers data for ALL recipients at once (batch)
    // We'll check total_orders and first_purchase_at
    const globalRecurrenceMap = new Map<string, boolean>(); // suffix -> is_first_purchase

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
              const suffix = extractPhoneKey(c.whatsapp);
              if (suffix) customerMap.set(c.id, { name: c.name || "", whatsapp: c.whatsapp, suffix });
            }
          }
        }
      }

      const storeMap = new Map<string, string>();
      if (storeIds.length > 0) {
        const { data: stores } = await supabase.from("pos_stores").select("id, name").in("id", storeIds);
        if (stores) for (const s of stores) storeMap.set(s.id, s.name);
      }

      const sellerMap = new Map<string, string>();
      if (sellerIds.length > 0) {
        const { data: sellers } = await supabase.from("pos_sellers").select("id, name").in("id", sellerIds);
        if (sellers) for (const s of sellers) sellerMap.set(s.id, s.name);
      }

      const matchedSaleIds: string[] = [];
      for (const sale of posSales) {
        if (!sale.customer_id) continue;
        const customer = customerMap.get(sale.customer_id);
        if (!customer || !phoneSuffixes.has(customer.suffix)) continue;
        const laterDate = dedupMap.get(customer.suffix);
        if (laterDate && new Date(sale.created_at) >= new Date(laterDate)) continue;
        matchedSaleIds.push(sale.id);
      }

      const saleItemsMap = new Map<string, BuyerProduct[]>();
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

      for (const sale of posSales) {
        if (!sale.customer_id) continue;
        const customer = customerMap.get(sale.customer_id);
        if (!customer || !phoneSuffixes.has(customer.suffix)) continue;
        const laterDate = dedupMap.get(customer.suffix);
        if (laterDate && new Date(sale.created_at) >= new Date(laterDate)) continue;

        const key = customer.suffix + "_pos_" + sale.id;
        if (!countedPhones.has(key)) {
          countedPhones.add(key);
          matchedSuffixes.add(customer.suffix);
          buyers.push({
            name: customer.name || recipientNames.get(customer.suffix) || customer.whatsapp,
            phone: customer.whatsapp,
            total: sale.total || 0,
            source: "PDV",
            purchased_at: sale.created_at,
            store_name: storeMap.get(sale.store_id) || null,
            seller_name: sellerMap.get(sale.seller_id) || null,
            products: saleItemsMap.get(sale.id) || [],
            is_first_purchase: false, // Will be set later
            previous_purchases: [],
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
      for (const sale of zoppySales) {
        if (!sale.customer_phone) continue;
        const suffix = extractPhoneKey(sale.customer_phone);
        if (!suffix || !phoneSuffixes.has(suffix)) continue;
        const laterDate = dedupMap.get(suffix);
        if (laterDate && new Date(sale.completed_at) >= new Date(laterDate)) continue;

        const key = suffix + "_zoppy_" + sale.id;
        if (!countedPhones.has(key)) {
          countedPhones.add(key);
          matchedSuffixes.add(suffix);
          buyers.push({
            name: sale.customer_name || recipientNames.get(suffix) || sale.customer_phone,
            phone: sale.customer_phone,
            total: sale.total || 0,
            source: "Shopify",
            purchased_at: sale.completed_at,
            store_name: null,
            seller_name: null,
            products: parseLineItems(sale.line_items),
            is_first_purchase: false,
            previous_purchases: [],
          });
        }
      }
    }

    // 4c. WhatsApp/Event orders (only truly paid & not cancelled)
    const PAID_STAGES = ["paid", "shipped", "awaiting_shipment", "awaiting_shipping", "store_pickup", "awaiting_mototaxi", "awaiting_pickup", "completed"];
    const { data: orders } = await supabase
      .from("orders")
      .select("id, products, is_paid, paid_at, customer_id, stage, created_at")
      .eq("is_paid", true)
      .in("stage", PAID_STAGES)
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
        const suffix = extractPhoneKey(customer.whatsapp);
        if (!suffix || !phoneSuffixes.has(suffix)) continue;
        const laterDate = dedupMap.get(suffix);
        const purchaseDate = order.paid_at || order.created_at;
        if (laterDate && new Date(purchaseDate) >= new Date(laterDate)) continue;

        const { items, total: orderTotal } = parseOrderProducts(order.products as any);
        const key = suffix + "_order_" + order.id;
        if (!countedPhones.has(key)) {
          countedPhones.add(key);
          matchedSuffixes.add(suffix);
          buyers.push({
            name: customer.instagram || recipientNames.get(suffix) || customer.whatsapp,
            phone: customer.whatsapp,
            total: orderTotal,
            source: "WhatsApp",
            purchased_at: purchaseDate,
            store_name: null,
            seller_name: null,
            products: items,
            is_first_purchase: false,
            previous_purchases: [],
          });
        }
      }
    }

    // ===== 5. GLOBAL RECURRENCE + PREVIOUS PURCHASES =====
    // For each matched suffix, gather ALL historical purchases from ALL sources
    for (const suffix of matchedSuffixes) {
      const prevPurchases: PreviousPurchase[] = [];
      let hasAnyPrior = false;

      // 5a. pos_sales history (all time before dispatch)
      // Find customer IDs matching this suffix
      const { data: posCustomers } = await supabase
        .from("pos_customers")
        .select("id, name, whatsapp")
        .filter("whatsapp", "not.is", null);

      const matchingCustIds: string[] = [];
      if (posCustomers) {
        for (const pc of posCustomers) {
          const k = extractPhoneKey(pc.whatsapp);
          if (k === suffix) matchingCustIds.push(pc.id);
        }
      }

      if (matchingCustIds.length > 0) {
        const { data: prevPos } = await supabase
          .from("pos_sales")
          .select("id, total, created_at, store_id, seller_id, status")
          .in("customer_id", matchingCustIds)
          .lt("created_at", dispatchDate)
          .in("status", ["completed", "paid"])
          .order("created_at", { ascending: false })
          .limit(20);

        if (prevPos && prevPos.length > 0) {
          hasAnyPrior = true;
          // Fetch store/seller names
          const sIds = [...new Set(prevPos.filter(s => s.store_id).map(s => s.store_id))];
          const slIds = [...new Set(prevPos.filter(s => s.seller_id).map(s => s.seller_id))];
          const stMap = new Map<string, string>();
          const slMap = new Map<string, string>();
          if (sIds.length > 0) {
            const { data: sts } = await supabase.from("pos_stores").select("id, name").in("id", sIds);
            if (sts) for (const s of sts) stMap.set(s.id, s.name);
          }
          if (slIds.length > 0) {
            const { data: sls } = await supabase.from("pos_sellers").select("id, name").in("id", slIds);
            if (sls) for (const s of sls) slMap.set(s.id, s.name);
          }

          // Fetch items
          const prevSaleIds = prevPos.map(s => s.id);
          const prevItemsMap = new Map<string, BuyerProduct[]>();
          for (let i = 0; i < prevSaleIds.length; i += 50) {
            const batch = prevSaleIds.slice(i, i + 50);
            const { data: items } = await supabase
              .from("pos_sale_items")
              .select("sale_id, product_name, variant_name, quantity, unit_price")
              .in("sale_id", batch);
            if (items) {
              for (const it of items) {
                if (!prevItemsMap.has(it.sale_id)) prevItemsMap.set(it.sale_id, []);
                prevItemsMap.get(it.sale_id)!.push({
                  name: it.product_name || "Produto",
                  variant: it.variant_name || undefined,
                  qty: it.quantity || 1,
                  price: it.unit_price || 0,
                });
              }
            }
          }

          for (const ps of prevPos) {
            prevPurchases.push({
              reference_id: ps.id,
              source: "PDV",
              purchased_at: ps.created_at,
              total: ps.total,
              store_name: stMap.get(ps.store_id) || null,
              seller_name: slMap.get(ps.seller_id) || null,
              products: prevItemsMap.get(ps.id) || [],
            });
          }
        }
      }

      // 5b. zoppy_sales history
      const { data: prevZoppy } = await supabase
        .from("zoppy_sales")
        .select("id, total, completed_at, customer_name, line_items, status")
        .ilike("customer_phone", `%${suffix.slice(-8)}`)
        .lt("completed_at", dispatchDate)
        .in("status", ["paid", "complete", "completed"])
        .order("completed_at", { ascending: false })
        .limit(20);

      if (prevZoppy && prevZoppy.length > 0) {
        hasAnyPrior = true;
        for (const zs of prevZoppy) {
          prevPurchases.push({
            reference_id: zs.id,
            source: "Shopify",
            purchased_at: zs.completed_at,
            total: zs.total,
            store_name: null,
            seller_name: null,
            products: parseLineItems(zs.line_items),
          });
        }
      }

      // 5c. Check zoppy_customers for ERP consolidated history
      if (!hasAnyPrior) {
        const { data: zCust } = await supabase
          .from("zoppy_customers")
          .select("total_orders, first_purchase_at, total_spent")
          .ilike("phone", `%${suffix.slice(-8)}`)
          .gt("total_orders", 0)
          .limit(1);
        if (zCust && zCust.length > 0 && zCust[0].first_purchase_at &&
            new Date(zCust[0].first_purchase_at) < new Date(dispatchDate)) {
          hasAnyPrior = true;
          // Add a synthetic entry for the ERP history
          prevPurchases.push({
            source: "CRM/ERP",
            purchased_at: zCust[0].first_purchase_at,
            total: zCust[0].total_spent || null,
            store_name: null,
            seller_name: null,
            products: [],
            note: `Histórico consolidado: ${zCust[0].total_orders} pedido(s) registrado(s) no ERP`,
          });
        }
      }

      // 5d. Also check pos_customers itself for historical flag (created_at before dispatch)
      if (!hasAnyPrior && matchingCustIds.length > 0) {
        // Customer exists in POS but no sales found — still a known customer
        hasAnyPrior = true;
        prevPurchases.push({
          source: "PDV (cadastro)",
          purchased_at: dispatchDate,
          total: null,
          store_name: null,
          seller_name: null,
          products: [],
          note: "Cliente cadastrado no PDV antes do disparo",
        });
      }

      // Sort previous purchases desc
      sortPurchasesDesc(prevPurchases);

      // Set recurrence + previous purchases for all buyers with this suffix
      const isFirst = !hasAnyPrior;
      globalRecurrenceMap.set(suffix, isFirst);

      for (const b of buyers) {
        const bSuffix = extractPhoneKey(b.phone);
        if (bSuffix === suffix) {
          b.is_first_purchase = isFirst;
          b.previous_purchases = prevPurchases;
        }
      }
    }

    // Sort by purchase date
    buyers.sort((a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime());

    const totalRevenue = buyers.reduce((sum, b) => sum + b.total, 0);
    const uniqueBuyerPhones = new Set(buyers.map(b => {
      const k = extractPhoneKey(b.phone);
      return k || b.phone;
    }));

    const category = (dispatch.template_category || "MARKETING").toUpperCase();
    // Use saved cost_per_message if set (manual override), otherwise derive from category
    const costPerMsg = dispatch.cost_per_message != null
      ? Number(dispatch.cost_per_message)
      : (category === "UTILITY" ? 0.05 : 0.40);
    const cost = costPerMsg * (dispatch.sent_count || 0);
    const roas = cost > 0 ? (totalRevenue / cost).toFixed(2) : null;

    return new Response(JSON.stringify({
      buyers,
      total_revenue: totalRevenue,
      total_buyers: uniqueBuyerPhones.size,
      total_orders: buyers.length,
      cost,
      cost_per_message: costPerMsg,
      template_category: category,
      template_name: dispatch.template_name || null,
      whatsapp_label,
      whatsapp_phone,
      roi: cost > 0 ? ((totalRevenue - cost) / cost * 100).toFixed(1) : null,
      roas,
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

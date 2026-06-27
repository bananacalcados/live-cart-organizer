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

    if (dErr || !dispatch) {
      return new Response(JSON.stringify({ error: "Dispatch not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let whatsapp_label: string | null = null;
    let whatsapp_phone: string | null = null;
    if (dispatch?.whatsapp_number_id) {
      const { data: wn } = await supabase
        .from("whatsapp_numbers")
        .select("label, phone_display")
        .eq("id", dispatch.whatsapp_number_id)
        .maybeSingle();
      if (wn) {
        whatsapp_label = wn.label;
        whatsapp_phone = wn.phone_display;
      }
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

    const dispatchDate = dispatch.created_at || dispatch.started_at;
    const windowEnd = new Date(new Date(dispatchDate).getTime() + window_days * 86400000).toISOString();
    const category = (dispatch.template_category || "MARKETING").toUpperCase();
    const costPerMsg = dispatch.cost_per_message != null
      ? Number(dispatch.cost_per_message)
      : (category === "UTILITY" ? 0.05 : 0.40);
    const baseCost = costPerMsg * (dispatch.sent_count || 0);

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({
        buyers: [], total_revenue: 0, total_buyers: 0, total_orders: 0,
        cost: baseCost, cost_per_message: costPerMsg, template_category: category,
        template_name: dispatch.template_name || null, whatsapp_label, whatsapp_phone,
        roi: null, roas: null, window_days, dispatch_date: dispatchDate, window_end: windowEnd,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build phone suffix map (DDD + last 8 digits) for recipients of THIS dispatch
    const phoneSuffixes = new Map<string, string>();
    const recipientNames = new Map<string, string>();
    for (const r of recipients) {
      const key = extractPhoneKey(r.phone);
      if (!key) continue;
      phoneSuffixes.set(key, r.phone);
      if (r.recipient_name) recipientNames.set(key, r.recipient_name);
    }

    // ===== Pre-fetch ALL pos_customers ONCE (paginated) =====
    // Built once and reused for current-window matching AND historical lookups.
    // (Previously re-fetched inside a per-buyer loop AND capped at 1000 rows,
    //  which both slowed the function and silently dropped customers > 1000.)
    const custIdToInfo = new Map<string, { name: string; whatsapp: string; suffix: string }>();
    const suffixToCustIds = new Map<string, string[]>();
    {
      let cPage = 0;
      while (true) {
        const { data: batch } = await supabase
          .from("pos_customers")
          .select("id, name, whatsapp")
          .not("whatsapp", "is", null)
          .range(cPage * PAGE_SIZE, (cPage + 1) * PAGE_SIZE - 1);
        if (!batch || batch.length === 0) break;
        for (const c of batch) {
          const suffix = extractPhoneKey(c.whatsapp);
          if (!suffix) continue;
          custIdToInfo.set(c.id, { name: c.name || "", whatsapp: c.whatsapp, suffix });
          const arr = suffixToCustIds.get(suffix) || [];
          arr.push(c.id);
          suffixToCustIds.set(suffix, arr);
        }
        if (batch.length < PAGE_SIZE) break;
        cPage++;
      }
    }

    // 3. Dedup with newer dispatches (a buyer is attributed to the most recent
    //    dispatch that reached them before the purchase)
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
        let ldPage = 0;
        while (true) {
          const { data: ldRecipients } = await supabase
            .from("dispatch_recipients")
            .select("phone")
            .eq("dispatch_id", ld.id)
            .range(ldPage * PAGE_SIZE, (ldPage + 1) * PAGE_SIZE - 1);
          if (!ldRecipients || ldRecipients.length === 0) break;
          for (const lr of ldRecipients) {
            const s = extractPhoneKey(lr.phone);
            if (s && phoneSuffixes.has(s) && !dedupMap.has(s)) {
              dedupMap.set(s, ld.created_at);
            }
          }
          if (ldRecipients.length < PAGE_SIZE) break;
          ldPage++;
        }
      }
    }

    // Helper: did a later dispatch supersede attribution for this purchase?
    const supersededByLater = (suffix: string, purchaseISO: string) => {
      const laterDate = dedupMap.get(suffix);
      return !!laterDate && new Date(purchaseISO) >= new Date(laterDate);
    };

    // 4. Query sales from ALL sources
    const buyers: BuyerResult[] = [];
    const countedKeys = new Set<string>();
    const matchedSuffixes = new Set<string>();

    // ─── 4a. POS Sales (physical stores) ───
    // Match via customer_id → pos_customers.whatsapp OR directly via
    // pos_sales.customer_phone (catches sales whose customer has no whatsapp
    // on file, or sales without a linked customer record).
    let posSales: any[] = [];
    {
      let posPage = 0;
      while (true) {
        const { data: batch } = await supabase
          .from("pos_sales")
          .select("id, total, created_at, customer_id, customer_phone, customer_name, status, store_id, seller_id")
          .gte("created_at", dispatchDate)
          .lte("created_at", windowEnd)
          .in("status", ["completed", "paid"])
          .range(posPage * PAGE_SIZE, (posPage + 1) * PAGE_SIZE - 1);
        if (!batch || batch.length === 0) break;
        posSales = posSales.concat(batch);
        if (batch.length < PAGE_SIZE) break;
        posPage++;
      }
    }

    if (posSales.length > 0) {
      // Resolve each sale's matching recipient suffix (if any) up-front
      type PosMatch = { suffix: string; name: string; phone: string };
      const saleMatch = new Map<string, PosMatch>(); // sale.id -> match
      for (const sale of posSales) {
        let suffix: string | null = null;
        let name = sale.customer_name || "";
        let phone = sale.customer_phone || "";
        // Prefer linked customer record (has reliable whatsapp + name)
        if (sale.customer_id && custIdToInfo.has(sale.customer_id)) {
          const c = custIdToInfo.get(sale.customer_id)!;
          suffix = c.suffix;
          name = name || c.name;
          phone = c.whatsapp || phone;
        }
        // Fallback: match directly on the phone stored on the sale
        if (!suffix && sale.customer_phone) {
          suffix = extractPhoneKey(sale.customer_phone);
        }
        if (!suffix || !phoneSuffixes.has(suffix)) continue;
        if (supersededByLater(suffix, sale.created_at)) continue;
        saleMatch.set(sale.id, { suffix, name, phone });
      }

      const matchedSaleIds = [...saleMatch.keys()];
      const storeIds = [...new Set(posSales.filter(s => s.store_id && saleMatch.has(s.id)).map(s => s.store_id))];
      const sellerIds = [...new Set(posSales.filter(s => s.seller_id && saleMatch.has(s.id)).map(s => s.seller_id))];

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
        const m = saleMatch.get(sale.id);
        if (!m) continue;
        const key = m.suffix + "_pos_" + sale.id;
        if (countedKeys.has(key)) continue;
        countedKeys.add(key);
        matchedSuffixes.add(m.suffix);
        buyers.push({
          name: m.name || recipientNames.get(m.suffix) || m.phone,
          phone: m.phone || m.suffix,
          total: sale.total || 0,
          source: "PDV",
          purchased_at: sale.created_at,
          store_name: storeMap.get(sale.store_id) || null,
          seller_name: sellerMap.get(sale.seller_id) || null,
          products: saleItemsMap.get(sale.id) || [],
          is_first_purchase: false,
          previous_purchases: [],
        });
      }
    }

    // ─── 4b. Shopify/Online sales (zoppy_sales — site / Tiny) ───
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
        if (supersededByLater(suffix, sale.completed_at)) continue;

        const key = suffix + "_zoppy_" + sale.id;
        if (countedKeys.has(key)) continue;
        countedKeys.add(key);
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

    // ─── 4c. WhatsApp/Event orders (only truly paid & not cancelled) ───
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
        const purchaseDate = order.paid_at || order.created_at;
        if (supersededByLater(suffix, purchaseDate)) continue;

        const { items, total: orderTotal } = parseOrderProducts(order.products as any);
        const key = suffix + "_order_" + order.id;
        if (countedKeys.has(key)) continue;
        countedKeys.add(key);
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

    // ===== 5. GLOBAL RECURRENCE + PREVIOUS PURCHASES =====
    // For each matched suffix, gather historical purchases (before the dispatch).
    for (const suffix of matchedSuffixes) {
      const prevPurchases: PreviousPurchase[] = [];
      let hasAnyPrior = false;

      // 5a. pos_sales history — via pre-built suffix→customerIds map (fast, complete)
      const matchingCustIds = suffixToCustIds.get(suffix) || [];
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

      // 5c. Check crm_customers_v for ERP consolidated history
      if (!hasAnyPrior) {
        const { data: zCust } = await supabase
          .from("crm_customers_v")
          .select("total_orders, first_purchase_at, total_spent")
          .ilike("phone", `%${suffix.slice(-8)}`)
          .gt("total_orders", 0)
          .limit(1);
        if (zCust && zCust.length > 0 && zCust[0].first_purchase_at &&
            new Date(zCust[0].first_purchase_at) < new Date(dispatchDate)) {
          hasAnyPrior = true;
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

      // 5d. Customer cadastrado no PDV antes do disparo
      if (!hasAnyPrior && matchingCustIds.length > 0) {
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

      sortPurchasesDesc(prevPurchases);

      const isFirst = !hasAnyPrior;
      for (const b of buyers) {
        const bSuffix = extractPhoneKey(b.phone);
        if (bSuffix === suffix) {
          b.is_first_purchase = isFirst;
          b.previous_purchases = prevPurchases;
        }
      }
    }

    // Sort by purchase date (most recent first)
    buyers.sort((a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime());

    const totalRevenue = buyers.reduce((sum, b) => sum + b.total, 0);
    const uniqueBuyerPhones = new Set(buyers.map(b => extractPhoneKey(b.phone) || b.phone));

    const cost = baseCost;
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
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

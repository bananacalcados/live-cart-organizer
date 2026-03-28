import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { store_filter, date_from, date_to } = await req.json().catch(() => ({}));

    // ─── 1. Get stores ───
    const { data: stores } = await supabase
      .from("pos_stores")
      .select("id, name")
      .order("name");

    // ─── 2. Get all completed sales with customer (paginated) ───
    let allSales: any[] = [];
    let off = 0;
    while (true) {
      let q = supabase
        .from("pos_sales")
        .select("id, customer_id, total, created_at, store_id")
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .order("created_at", { ascending: true });
      if (date_from) q = q.gte("created_at", date_from);
      if (date_to) q = q.lte("created_at", date_to);
      if (store_filter && store_filter !== "all") {
        q = q.eq("store_id", store_filter);
      }
      q = q.range(off, off + 999);
      const { data } = await q;
      if (!data || data.length === 0) break;
      allSales = allSales.concat(data);
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 3. Group by customer ───
    const customerData: Record<string, {
      orders: number;
      totalSpent: number;
      dates: Date[];
      storeId: string;
    }> = {};

    for (const s of allSales) {
      if (!customerData[s.customer_id]) {
        customerData[s.customer_id] = { orders: 0, totalSpent: 0, dates: [], storeId: s.store_id };
      }
      customerData[s.customer_id].orders++;
      customerData[s.customer_id].totalSpent += Number(s.total || 0);
      customerData[s.customer_id].dates.push(new Date(s.created_at));
    }

    const customers = Object.values(customerData);
    const totalCustomers = customers.length;
    const totalOrders = customers.reduce((a, b) => a + b.orders, 0);
    const totalRevenue = customers.reduce((a, b) => a + b.totalSpent, 0);

    // ─── 4. Calculate metrics ───
    const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const ltv = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
    const repeatCustomers = customers.filter(c => c.orders >= 2).length;
    const repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

    const secondPurchaseTimes: number[] = [];
    for (const c of customers) {
      if (c.dates.length >= 2) {
        c.dates.sort((a, b) => a.getTime() - b.getTime());
        const diff = (c.dates[1].getTime() - c.dates[0].getTime()) / 86400000;
        secondPurchaseTimes.push(diff);
      }
    }
    const avgDaysToSecondPurchase = secondPurchaseTimes.length > 0
      ? secondPurchaseTimes.reduce((a, b) => a + b, 0) / secondPurchaseTimes.length
      : 0;

    const avgOrders = totalCustomers > 0 ? totalOrders / totalCustomers : 0;

    // ─── 5. Per-store breakdown ───
    const storeStats: Record<string, {
      name: string;
      customers: Set<string>;
      orders: number;
      revenue: number;
      repeatCustomers: number;
      secondPurchaseDays: number[];
    }> = {};

    for (const store of stores || []) {
      storeStats[store.id] = {
        name: store.name,
        customers: new Set(),
        orders: 0,
        revenue: 0,
        repeatCustomers: 0,
        secondPurchaseDays: [],
      };
    }

    const storeCustomerOrders: Record<string, Record<string, Date[]>> = {};
    for (const s of allSales) {
      if (!storeCustomerOrders[s.store_id]) storeCustomerOrders[s.store_id] = {};
      if (!storeCustomerOrders[s.store_id][s.customer_id]) storeCustomerOrders[s.store_id][s.customer_id] = [];
      storeCustomerOrders[s.store_id][s.customer_id].push(new Date(s.created_at));

      if (storeStats[s.store_id]) {
        storeStats[s.store_id].customers.add(s.customer_id);
        storeStats[s.store_id].orders++;
        storeStats[s.store_id].revenue += Number(s.total || 0);
      }
    }

    for (const [storeId, custMap] of Object.entries(storeCustomerOrders)) {
      if (!storeStats[storeId]) continue;
      for (const [, dates] of Object.entries(custMap)) {
        if (dates.length >= 2) {
          storeStats[storeId].repeatCustomers++;
          dates.sort((a, b) => a.getTime() - b.getTime());
          storeStats[storeId].secondPurchaseDays.push(
            (dates[1].getTime() - dates[0].getTime()) / 86400000
          );
        }
      }
    }

    const storeBreakdown = Object.entries(storeStats)
      .filter(([, v]) => v.customers.size > 0)
      .map(([id, v]) => ({
        store_id: id,
        store_name: v.name,
        total_customers: v.customers.size,
        total_orders: v.orders,
        total_revenue: Math.round(v.revenue * 100) / 100,
        avg_ticket: v.orders > 0 ? Math.round(v.revenue / v.orders * 100) / 100 : 0,
        ltv: v.customers.size > 0 ? Math.round(v.revenue / v.customers.size * 100) / 100 : 0,
        repeat_rate: v.customers.size > 0
          ? Math.round(v.repeatCustomers / v.customers.size * 10000) / 100
          : 0,
        repeat_customers: v.repeatCustomers,
        avg_days_to_second_purchase: v.secondPurchaseDays.length > 0
          ? Math.round(v.secondPurchaseDays.reduce((a, b) => a + b, 0) / v.secondPurchaseDays.length * 10) / 10
          : 0,
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue);

    // ─── 6. Frequency distribution ───
    const freqDist: Record<string, number> = { "1x": 0, "2x": 0, "3x": 0, "4x": 0, "5+": 0 };
    for (const c of customers) {
      if (c.orders === 1) freqDist["1x"]++;
      else if (c.orders === 2) freqDist["2x"]++;
      else if (c.orders === 3) freqDist["3x"]++;
      else if (c.orders === 4) freqDist["4x"]++;
      else freqDist["5+"]++;
    }

    return new Response(JSON.stringify({
      summary: {
        total_customers: totalCustomers,
        total_orders: totalOrders,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        avg_ticket: Math.round(avgTicket * 100) / 100,
        ltv: Math.round(ltv * 100) / 100,
        repeat_rate: Math.round(repeatRate * 100) / 100,
        repeat_customers: repeatCustomers,
        avg_orders_per_customer: Math.round(avgOrders * 100) / 100,
        avg_days_to_second_purchase: Math.round(avgDaysToSecondPurchase * 10) / 10,
      },
      stores: storeBreakdown,
      frequency_distribution: freqDist,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("LTV error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

    const { date_from, date_to } = await req.json().catch(() => ({}));

    // ─── 1. Get ALL customers from zoppy_customers (pre-computed metrics) ───
    // This has the full 27k+ customer base
    let allCustomers: any[] = [];
    let off = 0;
    while (true) {
      const { data } = await supabase
        .from("zoppy_customers")
        .select("id, total_orders, total_spent, first_purchase_at, last_purchase_at, avg_ticket, source, region_type, email, phone")
        .gt("total_orders", 0)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      allCustomers = allCustomers.concat(data);
      if (data.length < 1000) break;
      off += 1000;
    }

    // Apply date filter if provided (filter by first_purchase_at or last_purchase_at)
    let filtered = allCustomers;
    if (date_from || date_to) {
      filtered = allCustomers.filter(c => {
        // Include customer if any of their purchase activity falls within the range
        const first = c.first_purchase_at ? new Date(c.first_purchase_at) : null;
        const last = c.last_purchase_at ? new Date(c.last_purchase_at) : null;
        if (!first && !last) return false;
        if (date_from) {
          const from = new Date(date_from);
          // Customer's last purchase must be after the start of the period
          if (last && last < from) return false;
        }
        if (date_to) {
          const to = new Date(date_to);
          // Customer's first purchase must be before the end of the period
          if (first && first > to) return false;
        }
        return true;
      });
    }

    // ─── 2. Overall metrics ───
    const totalCustomers = filtered.length;
    const totalOrders = filtered.reduce((a, c) => a + (c.total_orders || 0), 0);
    const totalRevenue = filtered.reduce((a, c) => a + Number(c.total_spent || 0), 0);
    const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const ltv = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
    const repeatCustomers = filtered.filter(c => (c.total_orders || 0) >= 2).length;
    const repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;
    const avgOrders = totalCustomers > 0 ? totalOrders / totalCustomers : 0;

    // ─── Avg days to SECOND purchase ───
    // Strategy: combine sources, deduplicating by key
    const secondPurchaseGaps: Map<string, number> = new Map();

    // Source 1a: zoppy_customers with total_orders=2 AND both dates filled
    // For these, last_purchase_at IS the 2nd purchase date
    const missingFirstDateCustomers: { id: string; email?: string; phone?: string; last: number }[] = [];
    for (const c of allCustomers) {
      if (c.total_orders !== 2) continue;
      if (!c.last_purchase_at) continue;

      if (c.first_purchase_at) {
        const first = new Date(c.first_purchase_at).getTime();
        const last = new Date(c.last_purchase_at).getTime();
        const gap = (last - first) / 86400000;
        if (gap > 0) secondPurchaseGaps.set(`zc:${c.id}`, gap);
      } else {
        // Missing first_purchase_at — will try to find it from zoppy_sales
        missingFirstDateCustomers.push({
          id: c.id,
          email: c.email || undefined,
          phone: c.phone || undefined,
          last: new Date(c.last_purchase_at).getTime(),
        });
      }
    }

    // Source 1b: For zoppy_customers missing first_purchase_at,
    // look up their earliest sale in zoppy_sales
    // Build lookup from zoppy_sales (already need it for Source 3)
    const zoppySalesFirstDate: Record<string, Date> = {}; // key → earliest date
    const zoppySalesDates: Record<string, Date[]> = {};
    let zOff = 0;
    while (true) {
      const { data } = await supabase
        .from("zoppy_sales")
        .select("customer_email, customer_phone, completed_at")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: true })
        .range(zOff, zOff + 999);
      if (!data || data.length === 0) break;
      for (const s of data) {
        const key = s.customer_email || s.customer_phone || "";
        if (!key) continue;
        const d = new Date(s.completed_at);
        if (!zoppySalesFirstDate[key] || d < zoppySalesFirstDate[key]) {
          zoppySalesFirstDate[key] = d;
        }
        if (!zoppySalesDates[key]) zoppySalesDates[key] = [];
        if (zoppySalesDates[key].length < 2) {
          zoppySalesDates[key].push(d);
        }
      }
      if (data.length < 1000) break;
      zOff += 1000;
    }

    // Now resolve missing first_purchase_at from zoppy_sales
    for (const c of missingFirstDateCustomers) {
      const key = c.email || c.phone || "";
      if (!key) continue;
      const firstDate = zoppySalesFirstDate[key];
      if (firstDate) {
        const gap = (c.last - firstDate.getTime()) / 86400000;
        if (gap > 0) secondPurchaseGaps.set(`zc:${c.id}`, gap);
      }
    }

    // Source 2: pos_sales – group by customer_id, pick 1st and 2nd
    const posCustomerDates: Record<string, Date[]> = {};
    let posOff = 0;
    while (true) {
      const { data } = await supabase
        .from("pos_sales")
        .select("customer_id, created_at")
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .order("created_at", { ascending: true })
        .range(posOff, posOff + 999);
      if (!data || data.length === 0) break;
      for (const s of data) {
        if (!posCustomerDates[s.customer_id]) posCustomerDates[s.customer_id] = [];
        if (posCustomerDates[s.customer_id].length < 2) {
          posCustomerDates[s.customer_id].push(new Date(s.created_at));
        }
      }
      if (data.length < 1000) break;
      posOff += 1000;
    }

    for (const [custId, dates] of Object.entries(posCustomerDates)) {
      if (dates.length >= 2) {
        const gap = (dates[1].getTime() - dates[0].getTime()) / 86400000;
        if (gap > 0) secondPurchaseGaps.set(`pos:${custId}`, gap);
      }
    }

    // Source 3: zoppy_sales – already loaded above, use zoppySalesDates
    for (const [key, dates] of Object.entries(zoppySalesDates)) {
      if (dates.length >= 2) {
        const gap = (dates[1].getTime() - dates[0].getTime()) / 86400000;
        if (gap > 0) secondPurchaseGaps.set(`zs:${key}`, gap);
      }
    }

    const allGaps = Array.from(secondPurchaseGaps.values());
    const totalDaysSum = allGaps.reduce((a, b) => a + b, 0);
    const avgDaysToSecondPurchase = allGaps.length > 0
      ? totalDaysSum / allGaps.length
      : 0;
    const secondPurchaseSampleSize = allGaps.length;

    // ─── 3. Frequency distribution ───
    const freqDist: Record<string, number> = { "1x": 0, "2x": 0, "3x": 0, "4x": 0, "5+": 0 };
    for (const c of filtered) {
      const o = c.total_orders || 0;
      if (o === 1) freqDist["1x"]++;
      else if (o === 2) freqDist["2x"]++;
      else if (o === 3) freqDist["3x"]++;
      else if (o === 4) freqDist["4x"]++;
      else if (o >= 5) freqDist["5+"]++;
    }

    // ─── 4. Channel breakdown using zoppy_customers (full RFM matrix) ───
    // Group by region_type to get the breakdown across all 27k+ customers
    const channelStats: Record<string, {
      name: string;
      customers: number;
      orders: number;
      revenue: number;
      repeatCustomers: number;
      secondPurchaseDays: number[];
    }> = {};

    // Initialize channels
    const channelMap: Record<string, string> = {
      "local": "Lojas Físicas",
      "online": "Site (Online)",
      "unknown": "Outros / Não identificado",
    };

    for (const [key, name] of Object.entries(channelMap)) {
      channelStats[key] = { name, customers: 0, orders: 0, revenue: 0, repeatCustomers: 0, secondPurchaseDays: [] };
    }

    for (const c of filtered) {
      const channel = c.region_type || "unknown";
      if (!channelStats[channel]) {
        channelStats[channel] = { name: channel, customers: 0, orders: 0, revenue: 0, repeatCustomers: 0, secondPurchaseDays: [] };
      }
      channelStats[channel].customers++;
      channelStats[channel].orders += c.total_orders || 0;
      channelStats[channel].revenue += Number(c.total_spent || 0);

      if ((c.total_orders || 0) >= 2) {
        channelStats[channel].repeatCustomers++;
        // secondPurchaseDays per channel: only use customers with exactly 2 orders
        // where we have exact first/last dates (since first=1st, last=2nd)
        if (c.total_orders === 2 && c.first_purchase_at && c.last_purchase_at) {
          const first = new Date(c.first_purchase_at).getTime();
          const last = new Date(c.last_purchase_at).getTime();
          if (last > first) {
            channelStats[channel].secondPurchaseDays.push((last - first) / 86400000);
          }
        }
      }
    }

    // Also get per-physical-store detail from pos_sales for sub-breakdown
    const { data: posStores } = await supabase
      .from("pos_stores")
      .select("id, name")
      .order("name");

    const physicalStoreStats: Record<string, {
      name: string; customers: Set<string>; orders: number; revenue: number;
      repeatCustomers: number; secondPurchaseDays: number[];
    }> = {};

    for (const store of (posStores || []).filter(s => !s.name.toLowerCase().includes("site") && !s.name.toLowerCase().includes("tiny") && !s.name.toLowerCase().includes("shopify"))) {
      physicalStoreStats[store.id] = {
        name: store.name, customers: new Set(), orders: 0, revenue: 0,
        repeatCustomers: 0, secondPurchaseDays: [],
      };
    }

    // Fetch pos_sales for per-store detail
    off = 0;
    const storeCustomerOrders: Record<string, Record<string, Date[]>> = {};
    while (true) {
      let q = supabase
        .from("pos_sales")
        .select("customer_id, total, created_at, store_id")
        .eq("status", "completed")
        .not("customer_id", "is", null);
      if (date_from) q = q.gte("created_at", date_from);
      if (date_to) q = q.lte("created_at", date_to);
      q = q.range(off, off + 999);
      const { data } = await q;
      if (!data || data.length === 0) break;
      for (const s of data) {
        if (physicalStoreStats[s.store_id]) {
          physicalStoreStats[s.store_id].customers.add(s.customer_id);
          physicalStoreStats[s.store_id].orders++;
          physicalStoreStats[s.store_id].revenue += Number(s.total || 0);
          if (!storeCustomerOrders[s.store_id]) storeCustomerOrders[s.store_id] = {};
          if (!storeCustomerOrders[s.store_id][s.customer_id]) storeCustomerOrders[s.store_id][s.customer_id] = [];
          storeCustomerOrders[s.store_id][s.customer_id].push(new Date(s.created_at));
        }
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    for (const [storeId, custMap] of Object.entries(storeCustomerOrders)) {
      if (!physicalStoreStats[storeId]) continue;
      for (const dates of Object.values(custMap)) {
        if (dates.length >= 2) {
          physicalStoreStats[storeId].repeatCustomers++;
          dates.sort((a, b) => a.getTime() - b.getTime());
          physicalStoreStats[storeId].secondPurchaseDays.push(
            (dates[1].getTime() - dates[0].getTime()) / 86400000
          );
        }
      }
    }

    // Build store breakdown: channels from zoppy_customers + physical store detail from pos_sales
    const storeBreakdown = [
      // Channel-level breakdown from RFM matrix
      ...Object.entries(channelStats)
        .filter(([, v]) => v.customers > 0)
        .map(([id, v]) => ({
          store_id: `channel:${id}`,
          store_name: v.name,
          total_customers: v.customers,
          total_orders: v.orders,
          total_revenue: Math.round(v.revenue * 100) / 100,
          avg_ticket: v.orders > 0 ? Math.round(v.revenue / v.orders * 100) / 100 : 0,
          ltv: v.customers > 0 ? Math.round(v.revenue / v.customers * 100) / 100 : 0,
          repeat_rate: v.customers > 0 ? Math.round(v.repeatCustomers / v.customers * 10000) / 100 : 0,
          repeat_customers: v.repeatCustomers,
          avg_days_to_second_purchase: v.secondPurchaseDays.length > 0
            ? Math.round(v.secondPurchaseDays.reduce((a, b) => a + b, 0) / v.secondPurchaseDays.length * 10) / 10 : 0,
          is_channel: true,
        })),
      // Per-physical-store detail from POS (sub-breakdown)
      ...Object.entries(physicalStoreStats)
        .filter(([, v]) => v.customers.size > 0)
        .map(([id, v]) => ({
          store_id: id,
          store_name: `  ↳ ${v.name} (PDV)`,
          total_customers: v.customers.size,
          total_orders: v.orders,
          total_revenue: Math.round(v.revenue * 100) / 100,
          avg_ticket: v.orders > 0 ? Math.round(v.revenue / v.orders * 100) / 100 : 0,
          ltv: v.customers.size > 0 ? Math.round(v.revenue / v.customers.size * 100) / 100 : 0,
          repeat_rate: v.customers.size > 0 ? Math.round(v.repeatCustomers / v.customers.size * 10000) / 100 : 0,
          repeat_customers: v.repeatCustomers,
          avg_days_to_second_purchase: v.secondPurchaseDays.length > 0
            ? Math.round(v.secondPurchaseDays.reduce((a, b) => a + b, 0) / v.secondPurchaseDays.length * 10) / 10 : 0,
          is_channel: false,
        })),
    ].sort((a, b) => b.total_revenue - a.total_revenue);

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
        second_purchase_sample_size: secondPurchaseSampleSize,
        second_purchase_total_days: Math.round(totalDaysSum),
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

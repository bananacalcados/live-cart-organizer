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

    // ─── 1. Fetch all leads ───
    const { data: lpLeads } = await supabase
      .from("lp_leads")
      .select("id, campaign_tag, phone, name, source, converted, converted_at, created_at")
      .not("phone", "is", null)
      .order("created_at", { ascending: false });

    const { data: campaignLeads } = await supabase
      .from("campaign_leads")
      .select("id, campaign_id, phone, name, source, converted, converted_at, created_at")
      .not("phone", "is", null)
      .order("created_at", { ascending: false });

    // ─── 2. Fetch campaign names for campaign_leads ───
    const campaignIds = [...new Set((campaignLeads || []).map(l => l.campaign_id).filter(Boolean))];
    let campaignNameMap: Record<string, string> = {};
    if (campaignIds.length > 0) {
      const { data: mcData } = await supabase
        .from("marketing_campaigns")
        .select("id, name")
        .in("id", campaignIds);
      for (const c of mcData || []) campaignNameMap[c.id] = c.name;
    }

    // ─── 3. Fetch all pos_customers with whatsapp ───
    let allCustomers: any[] = [];
    let custOffset = 0;
    while (true) {
      const { data: batch } = await supabase
        .from("pos_customers")
        .select("id, whatsapp")
        .not("whatsapp", "is", null)
        .range(custOffset, custOffset + 999);
      if (!batch || batch.length === 0) break;
      allCustomers = allCustomers.concat(batch);
      if (batch.length < 1000) break;
      custOffset += 1000;
    }

    // Build phone suffix → customer_id map
    const phoneSuffixToCustomerId: Record<string, string> = {};
    for (const c of allCustomers) {
      const suffix = (c.whatsapp || "").replace(/\D/g, "").slice(-8);
      if (suffix.length >= 8) phoneSuffixToCustomerId[suffix] = c.id;
    }

    // ─── 4. Fetch pos_sales (last 12 months) ───
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    let allSales: any[] = [];
    let salesOffset = 0;
    while (true) {
      const { data: batch } = await supabase
        .from("pos_sales")
        .select("id, customer_id, total, created_at, store_id")
        .gte("created_at", twelveMonthsAgo.toISOString())
        .eq("status", "completed")
        .range(salesOffset, salesOffset + 999);
      if (!batch || batch.length === 0) break;
      allSales = allSales.concat(batch);
      if (batch.length < 1000) break;
      salesOffset += 1000;
    }

    // Build customer_id → sales[]
    const customerSales: Record<string, any[]> = {};
    for (const s of allSales) {
      if (!s.customer_id) continue;
      if (!customerSales[s.customer_id]) customerSales[s.customer_id] = [];
      customerSales[s.customer_id].push(s);
    }

    // ─── 5. Process lead attribution ───
    const campaignStats: Record<string, {
      campaign: string;
      type: string; // 'lead_capture' | 'mass_dispatch'
      leads_captured: number;
      leads_converted: number;
      total_revenue: number;
      conversion_times_days: number[];
      converted_phones: Set<string>;
    }> = {};

    const allLeads = [
      ...(lpLeads || []).map(l => ({
        phone: l.phone,
        campaign: l.campaign_tag || "Sem campanha",
        created_at: l.created_at,
        source: l.source,
      })),
      ...(campaignLeads || []).map(l => ({
        phone: l.phone,
        campaign: campaignNameMap[l.campaign_id] || "Campanha sem nome",
        created_at: l.created_at,
        source: l.source,
      })),
    ];

    for (const lead of allLeads) {
      const suffix = (lead.phone || "").replace(/\D/g, "").slice(-8);
      if (suffix.length < 8) continue;

      const key = `lead:${lead.campaign}`;
      if (!campaignStats[key]) {
        campaignStats[key] = {
          campaign: lead.campaign,
          type: "lead_capture",
          leads_captured: 0,
          leads_converted: 0,
          total_revenue: 0,
          conversion_times_days: [],
          converted_phones: new Set(),
        };
      }
      campaignStats[key].leads_captured++;

      const custId = phoneSuffixToCustomerId[suffix];
      if (!custId || !customerSales[custId]) continue;

      const leadDate = new Date(lead.created_at);
      const sales = customerSales[custId];

      // Check if customer had sales BEFORE lead capture
      const hadPriorSales = sales.some(s => new Date(s.created_at) < leadDate);

      for (const sale of sales) {
        const saleDate = new Date(sale.created_at);
        if (saleDate <= leadDate) continue; // must be after capture

        if (hadPriorSales) {
          // Existing customer: 7-day attribution window
          const daysDiff = (saleDate.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff > 7) continue;
        }
        // New lead: any purchase after capture counts

        if (!campaignStats[key].converted_phones.has(suffix)) {
          campaignStats[key].converted_phones.add(suffix);
          campaignStats[key].leads_converted++;
          const daysDiff = (saleDate.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24);
          campaignStats[key].conversion_times_days.push(daysDiff);
        }
        campaignStats[key].total_revenue += Number(sale.total || 0);
      }
    }

    // ─── 6. Mass dispatch attribution ───
    let allDispatches: any[] = [];
    let dispOffset = 0;
    while (true) {
      const { data: batch } = await supabase
        .from("dispatch_history")
        .select("id, template_name, created_at, total_recipients, sent_count, status")
        .gte("created_at", twelveMonthsAgo.toISOString())
        .range(dispOffset, dispOffset + 999);
      if (!batch || batch.length === 0) break;
      allDispatches = allDispatches.concat(batch);
      if (batch.length < 1000) break;
      dispOffset += 1000;
    }

    for (const dispatch of allDispatches) {
      // Get recipients
      const { data: recipients } = await supabase
        .from("dispatch_recipients")
        .select("phone, status")
        .eq("dispatch_id", dispatch.id)
        .eq("status", "sent");

      if (!recipients || recipients.length === 0) continue;

      // Check which recipients had their message read
      const recipientPhones = recipients.map(r => r.phone).filter(Boolean);
      
      // Query whatsapp_messages to find which were read
      // We check messages sent around dispatch time with is_mass_dispatch=true
      const dispatchDate = new Date(dispatch.created_at);
      const dispatchEnd = new Date(dispatchDate.getTime() + 24 * 60 * 60 * 1000); // +1 day window
      
      const readPhones = new Set<string>();
      
      // Process in batches of 50 phones
      for (let i = 0; i < recipientPhones.length; i += 50) {
        const phoneBatch = recipientPhones.slice(i, i + 50);
        const { data: msgs } = await supabase
          .from("whatsapp_messages")
          .select("phone, status")
          .in("phone", phoneBatch)
          .eq("direction", "outgoing")
          .eq("status", "read")
          .gte("created_at", dispatchDate.toISOString())
          .lte("created_at", dispatchEnd.toISOString());
        
        for (const m of msgs || []) {
          readPhones.add(m.phone);
        }
      }

      const key = `dispatch:${dispatch.template_name || dispatch.id}`;
      if (!campaignStats[key]) {
        campaignStats[key] = {
          campaign: dispatch.template_name || "Disparo sem nome",
          type: "mass_dispatch",
          leads_captured: dispatch.sent_count || recipients.length,
          leads_converted: 0,
          total_revenue: 0,
          conversion_times_days: [],
          converted_phones: new Set(),
        };
      } else {
        campaignStats[key].leads_captured += (dispatch.sent_count || recipients.length);
      }

      // Check if any read recipients made a purchase within 7 days
      const sevenDaysAfter = new Date(dispatchDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      for (const phone of readPhones) {
        const suffix = phone.replace(/\D/g, "").slice(-8);
        if (suffix.length < 8) continue;

        const custId = phoneSuffixToCustomerId[suffix];
        if (!custId || !customerSales[custId]) continue;

        for (const sale of customerSales[custId]) {
          const saleDate = new Date(sale.created_at);
          if (saleDate > dispatchDate && saleDate <= sevenDaysAfter) {
            if (!campaignStats[key].converted_phones.has(suffix)) {
              campaignStats[key].converted_phones.add(suffix);
              campaignStats[key].leads_converted++;
              const daysDiff = (saleDate.getTime() - dispatchDate.getTime()) / (1000 * 60 * 60 * 24);
              campaignStats[key].conversion_times_days.push(daysDiff);
            }
            campaignStats[key].total_revenue += Number(sale.total || 0);
          }
        }
      }
    }

    // ─── 7. Build response ───
    const results = Object.values(campaignStats).map(s => {
      const avgConversionDays = s.conversion_times_days.length > 0
        ? s.conversion_times_days.reduce((a, b) => a + b, 0) / s.conversion_times_days.length
        : 0;
      const conversionRate = s.leads_captured > 0 ? (s.leads_converted / s.leads_captured) * 100 : 0;
      const avgTicket = s.leads_converted > 0 ? s.total_revenue / s.leads_converted : 0;

      return {
        campaign: s.campaign,
        type: s.type,
        leads_captured: s.leads_captured,
        leads_converted: s.leads_converted,
        conversion_rate: Math.round(conversionRate * 100) / 100,
        total_revenue: Math.round(s.total_revenue * 100) / 100,
        avg_ticket: Math.round(avgTicket * 100) / 100,
        avg_conversion_days: Math.round(avgConversionDays * 10) / 10,
      };
    });

    // Sort by revenue desc
    results.sort((a, b) => b.total_revenue - a.total_revenue);

    // Summary
    const leadResults = results.filter(r => r.type === "lead_capture");
    const dispatchResults = results.filter(r => r.type === "mass_dispatch");

    const summary = {
      total_leads: leadResults.reduce((a, b) => a + b.leads_captured, 0),
      total_leads_converted: leadResults.reduce((a, b) => a + b.leads_converted, 0),
      total_lead_revenue: Math.round(leadResults.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      total_dispatches_sent: dispatchResults.reduce((a, b) => a + b.leads_captured, 0),
      total_dispatch_conversions: dispatchResults.reduce((a, b) => a + b.leads_converted, 0),
      total_dispatch_revenue: Math.round(dispatchResults.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      overall_revenue: Math.round(results.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      avg_conversion_days: results.length > 0
        ? Math.round(
            results.filter(r => r.avg_conversion_days > 0)
              .reduce((a, b) => a + b.avg_conversion_days, 0) /
            Math.max(results.filter(r => r.avg_conversion_days > 0).length, 1) * 10
          ) / 10
        : 0,
    };

    return new Response(JSON.stringify({ summary, campaigns: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Attribution error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

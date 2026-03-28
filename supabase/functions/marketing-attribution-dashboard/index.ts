import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function phoneSuffix(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-8);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // ─── 1. Fetch all leads (paginated) ───
    let allLpLeads: any[] = [];
    let off = 0;
    while (true) {
      const { data } = await supabase
        .from("lp_leads")
        .select("id, campaign_tag, phone, name, source, created_at")
        .not("phone", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      allLpLeads = allLpLeads.concat(data);
      if (data.length < 1000) break;
      off += 1000;
    }

    let allCampaignLeads: any[] = [];
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("campaign_leads")
        .select("id, campaign_id, phone, name, source, created_at")
        .not("phone", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      allCampaignLeads = allCampaignLeads.concat(data);
      if (data.length < 1000) break;
      off += 1000;
    }

    // Get campaign names
    const campaignIds = [...new Set(allCampaignLeads.map(l => l.campaign_id).filter(Boolean))];
    const campaignNameMap: Record<string, string> = {};
    if (campaignIds.length > 0) {
      const { data } = await supabase.from("marketing_campaigns").select("id, name").in("id", campaignIds);
      for (const c of data || []) campaignNameMap[c.id] = c.name;
    }

    // ─── 2. Fetch pos_customers with whatsapp (paginated) ───
    const suffixToCustomerId: Record<string, string> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("pos_customers")
        .select("id, whatsapp")
        .not("whatsapp", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const c of data) {
        const s = phoneSuffix(c.whatsapp);
        if (s.length >= 8) suffixToCustomerId[s] = c.id;
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 3. Fetch pos_sales (completed, last 12 months, paginated) ───
    const customerSales: Record<string, any[]> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("pos_sales")
        .select("id, customer_id, total, created_at, store_id")
        .gte("created_at", twelveMonthsAgo.toISOString())
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const s of data) {
        if (!customerSales[s.customer_id]) customerSales[s.customer_id] = [];
        customerSales[s.customer_id].push(s);
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 4. Process lead attribution ───
    type CampaignStat = {
      campaign: string;
      type: string;
      captured: number;
      converted: number;
      revenue: number;
      convDays: number[];
      convertedSuffixes: Set<string>;
    };
    const stats: Record<string, CampaignStat> = {};

    const allLeads = [
      ...allLpLeads.map(l => ({
        phone: l.phone,
        campaign: l.campaign_tag || "Sem campanha",
        created_at: l.created_at,
      })),
      ...allCampaignLeads.map(l => ({
        phone: l.phone,
        campaign: campaignNameMap[l.campaign_id] || "Campanha sem nome",
        created_at: l.created_at,
      })),
    ];

    for (const lead of allLeads) {
      const suffix = phoneSuffix(lead.phone);
      if (suffix.length < 8) continue;

      const key = `lead:${lead.campaign}`;
      if (!stats[key]) {
        stats[key] = {
          campaign: lead.campaign, type: "lead_capture",
          captured: 0, converted: 0, revenue: 0, convDays: [],
          convertedSuffixes: new Set(),
        };
      }
      stats[key].captured++;

      const custId = suffixToCustomerId[suffix];
      if (!custId || !customerSales[custId]) continue;

      const leadDate = new Date(lead.created_at);
      const sales = customerSales[custId];
      const hadPriorSales = sales.some(s => new Date(s.created_at) < leadDate);

      for (const sale of sales) {
        const saleDate = new Date(sale.created_at);
        if (saleDate <= leadDate) continue;
        if (hadPriorSales) {
          const daysDiff = (saleDate.getTime() - leadDate.getTime()) / 86400000;
          if (daysDiff > 7) continue;
        }
        if (!stats[key].convertedSuffixes.has(suffix)) {
          stats[key].convertedSuffixes.add(suffix);
          stats[key].converted++;
          stats[key].convDays.push((saleDate.getTime() - leadDate.getTime()) / 86400000);
        }
        stats[key].revenue += Number(sale.total || 0);
      }
    }

    // ─── 5. Mass dispatch attribution ───
    let allDispatches: any[] = [];
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("dispatch_history")
        .select("id, template_name, created_at, sent_count, status")
        .gte("created_at", twelveMonthsAgo.toISOString())
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      allDispatches = allDispatches.concat(data);
      if (data.length < 1000) break;
      off += 1000;
    }

    for (const dispatch of allDispatches) {
      // Get sent recipients (paginated)
      let recipients: any[] = [];
      let rOff = 0;
      while (true) {
        const { data } = await supabase
          .from("dispatch_recipients")
          .select("phone")
          .eq("dispatch_id", dispatch.id)
          .eq("status", "sent")
          .range(rOff, rOff + 999);
        if (!data || data.length === 0) break;
        recipients = recipients.concat(data);
        if (data.length < 1000) break;
        rOff += 1000;
      }

      if (recipients.length === 0) continue;

      const key = `dispatch:${dispatch.template_name || dispatch.id}`;
      if (!stats[key]) {
        stats[key] = {
          campaign: dispatch.template_name || "Disparo sem nome",
          type: "mass_dispatch",
          captured: 0, converted: 0, revenue: 0, convDays: [],
          convertedSuffixes: new Set(),
        };
      }
      stats[key].captured += recipients.length;

      const dispatchDate = new Date(dispatch.created_at);
      const sevenDaysAfter = new Date(dispatchDate.getTime() + 7 * 86400000);

      for (const r of recipients) {
        const suffix = phoneSuffix(r.phone);
        if (suffix.length < 8) continue;

        const custId = suffixToCustomerId[suffix];
        if (!custId || !customerSales[custId]) continue;

        for (const sale of customerSales[custId]) {
          const saleDate = new Date(sale.created_at);
          if (saleDate > dispatchDate && saleDate <= sevenDaysAfter) {
            if (!stats[key].convertedSuffixes.has(suffix)) {
              stats[key].convertedSuffixes.add(suffix);
              stats[key].converted++;
              stats[key].convDays.push((saleDate.getTime() - dispatchDate.getTime()) / 86400000);
            }
            stats[key].revenue += Number(sale.total || 0);
          }
        }
      }
    }

    // ─── 6. Build response ───
    const results = Object.values(stats).map(s => {
      const avgDays = s.convDays.length > 0
        ? s.convDays.reduce((a, b) => a + b, 0) / s.convDays.length : 0;
      const rate = s.captured > 0 ? (s.converted / s.captured) * 100 : 0;
      const avgTicket = s.converted > 0 ? s.revenue / s.converted : 0;
      return {
        campaign: s.campaign, type: s.type,
        leads_captured: s.captured, leads_converted: s.converted,
        conversion_rate: Math.round(rate * 100) / 100,
        total_revenue: Math.round(s.revenue * 100) / 100,
        avg_ticket: Math.round(avgTicket * 100) / 100,
        avg_conversion_days: Math.round(avgDays * 10) / 10,
      };
    });
    results.sort((a, b) => b.total_revenue - a.total_revenue);

    const leadR = results.filter(r => r.type === "lead_capture");
    const dispR = results.filter(r => r.type === "mass_dispatch");

    const summary = {
      total_leads: leadR.reduce((a, b) => a + b.leads_captured, 0),
      total_leads_converted: leadR.reduce((a, b) => a + b.leads_converted, 0),
      total_lead_revenue: Math.round(leadR.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      total_dispatches_sent: dispR.reduce((a, b) => a + b.leads_captured, 0),
      total_dispatch_conversions: dispR.reduce((a, b) => a + b.leads_converted, 0),
      total_dispatch_revenue: Math.round(dispR.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      overall_revenue: Math.round(results.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      avg_conversion_days: (() => {
        const withDays = results.filter(r => r.avg_conversion_days > 0);
        return withDays.length > 0
          ? Math.round(withDays.reduce((a, b) => a + b.avg_conversion_days, 0) / withDays.length * 10) / 10
          : 0;
      })(),
    };

    return new Response(JSON.stringify({ summary, campaigns: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Attribution error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

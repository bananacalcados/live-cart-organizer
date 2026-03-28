import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Normalize a Brazilian phone to E.164: 55 + DDD + 9 + 8 digits.
 * This ensures consistent matching even when the 9th digit is missing.
 */
function normalizePhone(raw: string): string {
  let phone = (raw || "").replace(/\D/g, "");
  if (!phone) return "";
  // Add country code if missing (10-11 digits = BR without 55)
  if (phone.length >= 10 && phone.length <= 11) {
    phone = "55" + phone;
  }
  // If 12-digit BR number (55 + DDD + 8 digits), inject the 9th digit
  if (phone.startsWith("55") && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    phone = "55" + ddd + "9" + number;
  }
  return phone;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { date_from, date_to, attribution_window_days = 7 } = body;
    const windowDays = Number(attribution_window_days) || 7;

    // ─── 1. Fetch all leads (paginated) ───
    let allLpLeads: any[] = [];
    let off = 0;
    while (true) {
      let q = supabase
        .from("lp_leads")
        .select("id, campaign_tag, phone, name, source, created_at")
        .not("phone", "is", null);
      if (date_from) q = q.gte("created_at", date_from);
      if (date_to) q = q.lte("created_at", date_to);
      q = q.range(off, off + 999);
      const { data } = await q;
      if (!data || data.length === 0) break;
      allLpLeads = allLpLeads.concat(data);
      if (data.length < 1000) break;
      off += 1000;
    }

    let allCampaignLeads: any[] = [];
    off = 0;
    while (true) {
      let q = supabase
        .from("campaign_leads")
        .select("id, campaign_id, phone, name, source, created_at")
        .not("phone", "is", null);
      if (date_from) q = q.gte("created_at", date_from);
      if (date_to) q = q.lte("created_at", date_to);
      q = q.range(off, off + 999);
      const { data } = await q;
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

    // ─── 2. Fetch pos_customers with whatsapp AND cpf (paginated) ───
    const phoneToCustomerIds: Record<string, string[]> = {};
    const cpfToCustomerIds: Record<string, string[]> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("pos_customers")
        .select("id, whatsapp, cpf")
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const c of data) {
        if (c.whatsapp) {
          const s = normalizePhone(c.whatsapp);
          if (s) {
            if (!phoneToCustomerIds[s]) phoneToCustomerIds[s] = [];
            phoneToCustomerIds[s].push(c.id);
          }
        }
        if (c.cpf) {
          const normCpf = (c.cpf || '').replace(/\D/g, '');
          if (normCpf.length >= 11) {
            if (!cpfToCustomerIds[normCpf]) cpfToCustomerIds[normCpf] = [];
            cpfToCustomerIds[normCpf].push(c.id);
          }
        }
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // Also build zoppy_customers CPF+phone index
    const zoppyCpfToPhone: Record<string, string> = {};
    const phoneToZoppyPhone: Record<string, string> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("zoppy_customers")
        .select("phone, cpf")
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const c of data) {
        if (c.phone) {
          const s = normalizePhone(c.phone);
          if (s) phoneToZoppyPhone[s] = c.phone;
        }
        if (c.cpf && c.phone) {
          const normCpf = (c.cpf || '').replace(/\D/g, '');
          if (normCpf.length >= 11) zoppyCpfToPhone[normCpf] = c.phone;
        }
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 3. Fetch pos_sales (completed, paginated) ───
    const customerSales: Record<string, any[]> = {};
    off = 0;
    while (true) {
      let q = supabase
        .from("pos_sales")
        .select("id, customer_id, total, created_at, store_id")
        .eq("status", "completed")
        .not("customer_id", "is", null);
      q = q.range(off, off + 999);
      const { data } = await q;
      if (!data || data.length === 0) break;
      for (const s of data) {
        if (!customerSales[s.customer_id]) customerSales[s.customer_id] = [];
        customerSales[s.customer_id].push(s);
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 3b. Fetch zoppy_sales (online sales from Tiny ERP) ───
    const zoppyPhoneSales: Record<string, any[]> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("zoppy_sales")
        .select("id, customer_phone, total, completed_at")
        .not("customer_phone", "is", null)
        .not("completed_at", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const s of data) {
        const normalized = normalizePhone(s.customer_phone);
        if (!zoppyPhoneSales[normalized]) zoppyPhoneSales[normalized] = [];
        zoppyPhoneSales[normalized].push({ ...s, created_at: s.completed_at });
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // Helper: get ALL sales for a normalized phone, also checking CPF cross-references
    function getAllSalesForPhone(phone: string, cpf?: string): any[] {
      const sales: any[] = [];
      const seenSaleIds = new Set<string>();

      // Collect customer IDs by phone
      const custIdsByPhone = phoneToCustomerIds[phone] || [];
      // Collect customer IDs by CPF (if available)
      const custIdsByCpf = cpf ? (cpfToCustomerIds[cpf] || []) : [];
      // Merge unique customer IDs
      const allCustIds = [...new Set([...custIdsByPhone, ...custIdsByCpf])];

      for (const cid of allCustIds) {
        for (const s of (customerSales[cid] || [])) {
          if (!seenSaleIds.has(s.id)) { seenSaleIds.add(s.id); sales.push(s); }
        }
      }
      // Zoppy sales by phone
      for (const s of (zoppyPhoneSales[phone] || [])) {
        if (!seenSaleIds.has(s.id)) { seenSaleIds.add(s.id); sales.push(s); }
      }
      // If CPF maps to a different phone in zoppy, also check those sales
      if (cpf && zoppyCpfToPhone[cpf]) {
        const altPhone = normalizePhone(zoppyCpfToPhone[cpf]);
        if (altPhone && altPhone !== phone) {
          for (const s of (zoppyPhoneSales[altPhone] || [])) {
            if (!seenSaleIds.has(s.id)) { seenSaleIds.add(s.id); sales.push(s); }
          }
        }
      }
      return sales;
    }

    // ─── 4. Process lead attribution ───
    type CampaignStat = {
      campaign: string;
      templateName: string;
      type: string;
      captured: number;
      converted: number;
      revenue: number;
      convDays: number[];
      convertedPhones: Set<string>;
      leadsAreCustomers: number;
      leadsNotCustomers: number;
      dispatchDates: string[];
      dispatchCount: number;
      costPerMsg: number;
      totalMessagesSent: number;
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
      const normalized = normalizePhone(lead.phone);
      if (!normalized) continue;

      const key = `lead:${lead.campaign}`;
      if (!stats[key]) {
        stats[key] = {
          campaign: lead.campaign, templateName: "", type: "lead_capture",
          captured: 0, converted: 0, revenue: 0, convDays: [],
          convertedPhones: new Set(),
          leadsAreCustomers: 0, leadsNotCustomers: 0,
          dispatchDates: [], dispatchCount: 0,
          costPerMsg: 0, totalMessagesSent: 0,
        };
      }
      stats[key].captured++;

      // Check if this lead has ANY sales (from pos or zoppy)
      const allSales = getAllSalesForPhone(normalized, undefined);
      const isExistingCustomer = allSales.length > 0;

      if (isExistingCustomer) {
        stats[key].leadsAreCustomers++;
      } else {
        stats[key].leadsNotCustomers++;
      }

      if (allSales.length === 0) continue;

      const leadDate = new Date(lead.created_at);
      const hadPriorSales = allSales.some(s => new Date(s.created_at) < leadDate);

      for (const sale of allSales) {
        const saleDate = new Date(sale.created_at);
        if (saleDate <= leadDate) continue;
        if (hadPriorSales) {
          const daysDiff = (saleDate.getTime() - leadDate.getTime()) / 86400000;
          if (daysDiff > windowDays) continue;
        }
        if (!stats[key].convertedPhones.has(normalized)) {
          stats[key].convertedPhones.add(normalized);
          stats[key].converted++;
          stats[key].convDays.push((saleDate.getTime() - leadDate.getTime()) / 86400000);
        }
        stats[key].revenue += Number(sale.total || 0);
      }
    }

    // ─── 5. Mass dispatch attribution ───
    // Include completed AND cancelled dispatches that actually sent messages (>10)
    let allDispatches: any[] = [];
    off = 0;
    while (true) {
      let q = supabase
        .from("dispatch_history")
        .select("id, template_name, campaign_name, created_at, sent_count, status, cost_per_message")
        .in("status", ["completed", "cancelled"])
        .gt("sent_count", 10); // exclude transactional one-offs
      if (date_from) q = q.gte("created_at", date_from);
      if (date_to) q = q.lte("created_at", date_to);
      q = q.range(off, off + 999);
      const { data } = await q;
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

      // Each dispatch is its own entry (unique by ID)
      const displayName = dispatch.campaign_name || dispatch.template_name || "Disparo sem nome";
      const key = `dispatch:${dispatch.id}`;
      if (!stats[key]) {
        // Cost: default to UTILITY (R$0.05). Only mark as MARKETING (R$0.40)
        // for templates that are promotional/marketing in nature.
        const isMarketing = (dispatch.template_name || "").toLowerCase().match(/xepa|promo|oferta|desconto|black|sale|marketing|cupom/);
        const costPerMsg = dispatch.cost_per_message ? Number(dispatch.cost_per_message) : (isMarketing ? 0.40 : 0.05);
        
        stats[key] = {
          campaign: displayName,
          templateName: dispatch.template_name || "",
          type: "mass_dispatch",
          captured: 0, converted: 0, revenue: 0, convDays: [],
          convertedPhones: new Set(),
          leadsAreCustomers: 0, leadsNotCustomers: 0,
          dispatchDates: [], dispatchCount: 0,
          costPerMsg,
          totalMessagesSent: 0,
        };
      }
      stats[key].captured += recipients.length;
      stats[key].totalMessagesSent += recipients.length;
      stats[key].dispatchCount++;
      stats[key].dispatchDates.push(dispatch.created_at);




      if (recipients.length === 0) continue;

      const dispatchDate = new Date(dispatch.created_at);
      const windowEnd = new Date(dispatchDate.getTime() + windowDays * 86400000);

      for (const r of recipients) {
        const normalized = normalizePhone(r.phone);
        if (!normalized) continue;

        const allSales = getAllSalesForPhone(normalized, undefined);
        if (allSales.length === 0) continue;

        for (const sale of allSales) {
          const saleDate = new Date(sale.created_at);
          if (saleDate > dispatchDate && saleDate <= windowEnd) {
            if (!stats[key].convertedPhones.has(normalized)) {
              stats[key].convertedPhones.add(normalized);
              stats[key].converted++;
              stats[key].convDays.push((saleDate.getTime() - dispatchDate.getTime()) / 86400000);
            }
            stats[key].revenue += Number(sale.total || 0);
          }
        }
      }
    }

    // ─── 6. Build response with ROAS ───
    const results = Object.values(stats).map(s => {
      const avgDays = s.convDays.length > 0
        ? s.convDays.reduce((a, b) => a + b, 0) / s.convDays.length : 0;
      const rate = s.captured > 0 ? (s.converted / s.captured) * 100 : 0;
      const avgTicket = s.converted > 0 ? s.revenue / s.converted : 0;

      // ROAS calc using stored costPerMsg
      const totalCost = s.totalMessagesSent * s.costPerMsg;
      const roas = totalCost > 0 ? s.revenue / totalCost : 0;

      return {
        campaign: s.campaign, template_name: s.templateName, type: s.type,
        leads_captured: s.captured, leads_converted: s.converted,
        conversion_rate: Math.round(rate * 100) / 100,
        total_revenue: Math.round(s.revenue * 100) / 100,
        avg_ticket: Math.round(avgTicket * 100) / 100,
        avg_conversion_days: Math.round(avgDays * 10) / 10,
        leads_are_customers: s.leadsAreCustomers,
        leads_not_customers: s.leadsNotCustomers,
        dispatch_dates: s.dispatchDates.sort(),
        dispatch_count: s.dispatchCount,
        total_messages_sent: s.totalMessagesSent,
        cost_per_msg: s.costPerMsg,
        total_cost: Math.round(totalCost * 100) / 100,
        roas: Math.round(roas * 100) / 100,
      };
    });
    results.sort((a, b) => b.total_revenue - a.total_revenue);

    const leadR = results.filter(r => r.type === "lead_capture");
    const dispR = results.filter(r => r.type === "mass_dispatch");

    const totalDispatchCost = dispR.reduce((a, b) => a + b.total_cost, 0);
    const totalDispatchRevenue = dispR.reduce((a, b) => a + b.total_revenue, 0);

    const summary = {
      total_leads: leadR.reduce((a, b) => a + b.leads_captured, 0),
      total_leads_converted: leadR.reduce((a, b) => a + b.leads_converted, 0),
      total_lead_revenue: Math.round(leadR.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      total_dispatches_sent: dispR.reduce((a, b) => a + b.leads_captured, 0),
      total_dispatch_conversions: dispR.reduce((a, b) => a + b.leads_converted, 0),
      total_dispatch_revenue: Math.round(totalDispatchRevenue * 100) / 100,
      overall_revenue: Math.round(results.reduce((a, b) => a + b.total_revenue, 0) * 100) / 100,
      avg_conversion_days: (() => {
        const withDays = results.filter(r => r.avg_conversion_days > 0);
        return withDays.length > 0
          ? Math.round(withDays.reduce((a, b) => a + b.avg_conversion_days, 0) / withDays.length * 10) / 10
          : 0;
      })(),
      total_leads_are_customers: leadR.reduce((a, b) => a + b.leads_are_customers, 0),
      total_leads_not_customers: leadR.reduce((a, b) => a + b.leads_not_customers, 0),
      total_dispatch_cost: Math.round(totalDispatchCost * 100) / 100,
      dispatch_roas: totalDispatchCost > 0 ? Math.round(totalDispatchRevenue / totalDispatchCost * 100) / 100 : 0,
      attribution_window_days: windowDays,
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Normalize a Brazilian phone to E.164: 55 + DDD + 9 + 8 digits. */
function normalizePhone(raw: string): string {
  let phone = (raw || "").replace(/\D/g, "");
  if (!phone) return "";
  if (phone.length >= 10 && phone.length <= 11) phone = "55" + phone;
  if (phone.startsWith("55") && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    phone = "55" + ddd + "9" + number;
  }
  return phone;
}

function classifyChannel(storeName?: string, isZoppy?: boolean): string {
  if (isZoppy) return "Online (Site)";
  const n = (storeName || "").toLowerCase();
  if (n.includes("site") || n.includes("shopify") || n.includes("tiny")) return "Online (Site)";
  if (n.includes("live")) return "Live";
  if (!n) return "Não identificado";
  return "Loja Física";
}

// Human-friendly grouping for lead acquisition sources
function prettySource(source?: string): string {
  const s = (source || "").toLowerCase();
  if (!s) return "Não informado";
  if (s.includes("organic_whatsapp")) return "WhatsApp Orgânico";
  if (s.includes("landing_page") || s === "landing_page_typebot") return "Landing Page / Typebot";
  if (s.includes("event_typebot")) return "Evento (Typebot)";
  if (s.includes("whatsapp_ad") || s.includes("ia_ads")) return "Anúncios (Ads)";
  if (s.includes("abandoned_cart")) return "Carrinho Abandonado";
  if (s.includes("live_campaign")) return "Live";
  if (s.includes("external_lead")) return "Importação Externa";
  return source as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    // mode: "captured" = leads captured in period; "purchased" = leads (any period) that bought in period
    const mode: "captured" | "purchased" = body.mode === "purchased" ? "purchased" : "captured";
    const firstPurchaseOnly: boolean = !!body.first_purchase_only;
    const dateFrom = body.date_from ? new Date(body.date_from) : null;
    const dateTo = body.date_to ? new Date(body.date_to) : null;

    const inPeriod = (d: Date) => {
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    };

    // ─── 1. Store name map ───
    const storeNames: Record<string, string> = {};
    {
      const { data } = await supabase.from("pos_stores").select("id, name");
      for (const s of data || []) storeNames[s.id] = s.name;
    }

    // ─── 2. pos_customers phone -> customerIds ───
    const phoneToCustomerIds: Record<string, string[]> = {};
    let off = 0;
    while (true) {
      const { data } = await supabase
        .from("pos_customers")
        .select("id, whatsapp")
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const c of data) {
        if (c.whatsapp) {
          const s = normalizePhone(c.whatsapp);
          if (s) (phoneToCustomerIds[s] ||= []).push(c.id);
        }
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 3. pos_sales (completed) grouped by customer_id ───
    const customerSales: Record<string, any[]> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("pos_sales")
        .select("id, customer_id, total, created_at, store_id")
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const s of data) {
        (customerSales[s.customer_id] ||= []).push({
          id: `pos:${s.id}`,
          total: Number(s.total || 0),
          date: new Date(s.created_at),
          channel: classifyChannel(storeNames[s.store_id]),
        });
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 4. zoppy_sales (online) grouped by normalized phone ───
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
        const p = normalizePhone(s.customer_phone);
        if (!p) continue;
        (zoppyPhoneSales[p] ||= []).push({
          id: `zoppy:${s.id}`,
          total: Number(s.total || 0),
          date: new Date(s.completed_at),
          channel: classifyChannel(undefined, true),
        });
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    function getAllSalesForPhone(phone: string): any[] {
      const sales: any[] = [];
      const seen = new Set<string>();
      for (const cid of (phoneToCustomerIds[phone] || [])) {
        for (const s of (customerSales[cid] || [])) {
          if (!seen.has(s.id)) { seen.add(s.id); sales.push(s); }
        }
      }
      for (const s of (zoppyPhoneSales[phone] || [])) {
        if (!seen.has(s.id)) { seen.add(s.id); sales.push(s); }
      }
      sales.sort((a, b) => a.date.getTime() - b.date.getTime());
      return sales;
    }

    // ─── 5. Load leads, dedup by phone (earliest capture) ───
    type LeadAgg = { phone: string; captureDate: Date; source: string; campaign: string };
    const leadByPhone: Record<string, LeadAgg> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("lp_leads")
        .select("phone, source, campaign_tag, created_at")
        .not("phone", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const l of data) {
        const p = normalizePhone(l.phone);
        if (!p) continue;
        const created = new Date(l.created_at);
        const existing = leadByPhone[p];
        if (!existing || created < existing.captureDate) {
          leadByPhone[p] = {
            phone: p,
            captureDate: created,
            source: l.source || "",
            campaign: l.campaign_tag || "",
          };
        }
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 6. Compute metrics ───
    let leadsInScope = 0;          // denominator (captured leads in period, or leads that bought in period)
    let leadsConverted = 0;        // leads with >=1 qualifying purchase
    let wereCustomersBefore = 0;   // converted leads that already had purchases before becoming lead
    let firstTimeBuyers = 0;       // converted leads whose first ever purchase came after lead capture
    let totalPurchases = 0;
    let totalRevenue = 0;

    const channelMap: Record<string, { channel: string; purchases: number; revenue: number; leads: Set<string> }> = {};
    const sourceMap: Record<string, { source: string; leads: number; converted: number; purchases: number; revenue: number }> = {};
    const monthMap: Record<string, { month: string; converted: number; purchases: number; revenue: number }> = {};

    for (const lead of Object.values(leadByPhone)) {
      const allSales = getAllSalesForPhone(lead.phone);
      const hadPriorSales = allSales.some(s => s.date < lead.captureDate);

      // first_purchase_only: keep only leads that were NOT customers before (their conversion is a first purchase)
      if (firstPurchaseOnly && hadPriorSales) continue;

      // Qualifying purchases = sales strictly after capture
      let qualifying = allSales.filter(s => s.date > lead.captureDate);
      if (mode === "purchased") {
        qualifying = qualifying.filter(s => inPeriod(s.date));
      }

      // Determine scope membership
      let inScope = false;
      if (mode === "captured") {
        inScope = inPeriod(lead.captureDate);
      } else {
        inScope = qualifying.length > 0; // leads (any period) that bought within the period
      }
      if (!inScope) continue;

      leadsInScope++;

      const srcKey = prettySource(lead.source);
      const srcEntry = (sourceMap[srcKey] ||= { source: srcKey, leads: 0, converted: 0, purchases: 0, revenue: 0 });
      srcEntry.leads++;

      const converted = qualifying.length > 0;
      if (!converted) continue;

      leadsConverted++;
      srcEntry.converted++;
      if (hadPriorSales) wereCustomersBefore++; else firstTimeBuyers++;

      for (const s of qualifying) {
        totalPurchases++;
        totalRevenue += s.total;
        srcEntry.purchases++;
        srcEntry.revenue += s.total;

        const ch = (channelMap[s.channel] ||= { channel: s.channel, purchases: 0, revenue: 0, leads: new Set() });
        ch.purchases++;
        ch.revenue += s.total;
        ch.leads.add(lead.phone);

        const mk = `${s.date.getFullYear()}-${String(s.date.getMonth() + 1).padStart(2, "0")}`;
        const m = (monthMap[mk] ||= { month: mk, converted: 0, purchases: 0, revenue: 0 });
        m.purchases++;
        m.revenue += s.total;
      }
    }

    const channels = Object.values(channelMap)
      .map(c => ({ channel: c.channel, purchases: c.purchases, revenue: Math.round(c.revenue * 100) / 100, leads: c.leads.size }))
      .sort((a, b) => b.revenue - a.revenue);

    const sources = Object.values(sourceMap)
      .map(s => ({
        source: s.source,
        leads: s.leads,
        converted: s.converted,
        purchases: s.purchases,
        revenue: Math.round(s.revenue * 100) / 100,
        conversion_rate: s.leads > 0 ? Math.round((s.converted / s.leads) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const months = Object.values(monthMap)
      .map(m => ({ ...m, revenue: Math.round(m.revenue * 100) / 100 }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return new Response(JSON.stringify({
      mode,
      first_purchase_only: firstPurchaseOnly,
      summary: {
        leads_in_scope: leadsInScope,
        leads_converted: leadsConverted,
        conversion_rate: leadsInScope > 0 ? Math.round((leadsConverted / leadsInScope) * 10000) / 100 : 0,
        were_customers_before: wereCustomersBefore,
        first_time_buyers: firstTimeBuyers,
        total_purchases: totalPurchases,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        avg_ticket: totalPurchases > 0 ? Math.round((totalRevenue / totalPurchases) * 100) / 100 : 0,
        avg_purchases_per_lead: leadsConverted > 0 ? Math.round((totalPurchases / leadsConverted) * 100) / 100 : 0,
      },
      channels,
      sources,
      months,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("leads-dashboard error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

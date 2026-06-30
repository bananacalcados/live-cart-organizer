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

// Real store UUIDs (from pos_stores).
const STORE_PEROLA = "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2";
const STORE_CENTRO = "4ade7b44-5043-4ab1-a124-7a6ab5468e29";

/**
 * Classify the SALE channel into the 5 real channels.
 * Order is critical:
 *  a) sale_type='live'                 → "Live Shopping"  (BEFORE physical store)
 *  b) Shopify site (external_source='shopify' OR any zoppy_sales) → "Shopify site"
 *  c) sale_type='physical' → Loja Pérola / Loja Centro / Loja Física (outra)
 *  d) sale_type='online' (not shopify) → "Online (link/checkout)"
 *  e) anything else                    → "Não identificado"
 */
function classifyChannel(opts: { saleType?: string | null; externalSource?: string | null; storeId?: string | null; isZoppy?: boolean }): string {
  const { saleType, externalSource, storeId, isZoppy } = opts;
  // a) Live first — a live sale can live in the Pérola store, must win over physical.
  if (saleType === "live") return "Live Shopping";
  // b) Shopify site.
  if (isZoppy) return "Shopify site";
  if ((externalSource || "").toLowerCase() === "shopify") return "Shopify site";
  // c) Physical stores.
  if (saleType === "physical") {
    if (storeId === STORE_PEROLA) return "Loja Pérola";
    if (storeId === STORE_CENTRO) return "Loja Centro";
    return "Loja Física (outra)";
  }
  // d) Online non-shopify (origin not trackable today — do NOT label WhatsApp).
  if (saleType === "online") return "Online (link/checkout)";
  // e) Rest.
  return "Não identificado";
}


/**
 * Human-friendly grouping for lead ACQUISITION (capture) sources.
 * The `source` column in lp_leads is mixed: some rows carry real channel codes,
 * others carry a person's first name (legacy XLS imports, e.g. "TYPEBOT março").
 * Anything not recognized as a channel code is bucketed as an import list.
 */
function prettySource(source?: string): string {
  const raw = (source || "").trim();
  const s = raw.toLowerCase();
  if (!s) return "Não informado";
  if (s.includes("organic_whatsapp")) return "WhatsApp Orgânico";
  if (s.includes("event_typebot")) return "Evento / Live (Typebot)";
  if (s.includes("landing_page")) return "Landing Page (site)";
  if (s.includes("catalog_lead_page")) return "Catálogo / Link";
  if (s.includes("whatsapp_ad") || s.includes("ia_ads")) return "Anúncios (Ads)";
  if (s.includes("abandoned_cart")) return "Carrinho Abandonado";
  if (s.includes("live_campaign")) return "Live";
  if (s.includes("external_lead")) return "Importação Externa";
  // Known channel codes use snake_case; a value with letters/spaces only is a
  // legacy named import (a person's name), group them all together.
  if (/^[a-zà-ÿ][a-zà-ÿ .'-]*$/i.test(raw) && !raw.includes("_")) {
    return "Importação (Lista)";
  }
  return raw;
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
    // "Somente leads novos" (default ON): only people who were NOT customers when
    // they entered as a lead (no sales before their first-ever capture).
    // includeExisting = the explicit toggle "incluir quem já era cliente".
    // Backwards-compat: a legacy `first_purchase_only:true` keeps new-only behavior.
    const includeExisting: boolean = body.include_existing_customers === true;
    const onlyNewLeads: boolean = !includeExisting;
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
        .select("id, customer_id, total, created_at, store_id, sale_type, external_source")
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const s of data) {
        (customerSales[s.customer_id] ||= []).push({
          id: `pos:${s.id}`,
          total: Number(s.total || 0),
          date: new Date(s.created_at),
          channel: classifyChannel({ saleType: s.sale_type, externalSource: s.external_source, storeId: s.store_id }),
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
          channel: classifyChannel({ isZoppy: true }),
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

    // ─── 5. Load leads, aggregate per phone ───
    // We keep BOTH the earliest-ever capture (to know prior-customer status and
    // for "purchased" mode) and the earliest capture WITHIN the period (so a
    // phone re-captured in the period — e.g. via the event typebot — still
    // counts as "captado no período", which is what the user expects).
    type LeadAgg = {
      phone: string;
      firstEverDate: Date;
      firstEverSource: string;
      firstInPeriodDate: Date | null;
      firstInPeriodSource: string;
    };
    const leadByPhone: Record<string, LeadAgg> = {};
    off = 0;
    while (true) {
      const { data } = await supabase
        .from("lp_leads")
        .select("phone, source, created_at")
        .not("phone", "is", null)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const l of data) {
        const p = normalizePhone(l.phone);
        if (!p) continue;
        const created = new Date(l.created_at);
        const src = l.source || "";
        const agg = (leadByPhone[p] ||= {
          phone: p,
          firstEverDate: created,
          firstEverSource: src,
          firstInPeriodDate: null,
          firstInPeriodSource: "",
        });
        if (created < agg.firstEverDate) {
          agg.firstEverDate = created;
          agg.firstEverSource = src;
        }
        if (inPeriod(created)) {
          if (!agg.firstInPeriodDate || created < agg.firstInPeriodDate) {
            agg.firstInPeriodDate = created;
            agg.firstInPeriodSource = src;
          }
        }
      }
      if (data.length < 1000) break;
      off += 1000;
    }

    // ─── 6. Compute metrics ───
    let leadsInScope = 0;          // captured leads in period, or leads that bought in period
    let leadsConverted = 0;        // leads with >=1 qualifying purchase
    let wereCustomersBefore = 0;   // converted leads that already had purchases before becoming lead
    let firstTimeBuyers = 0;       // converted leads whose first ever purchase came after lead capture
    let totalPurchases = 0;
    let totalRevenue = 0;          // receita_total_com_recompras: ALL qualifying purchases
    let convertedRevenue = 0;      // valor_convertido: only the 1st purchase (conversionSale) per lead

    // Capture-channel aggregation (where the lead came in)
    // revenue = receita com recompras (todas qualifying); convertedRevenue = só 1ª compra
    const captureMap: Record<string, { channel: string; leads: number; converted: number; purchases: number; revenue: number; convertedRevenue: number }> = {};
    // Sale-channel aggregation (where the conversion sale happened) — for the monthly trend + future use
    const monthMap: Record<string, { month: string; purchases: number; revenue: number }> = {};
    // NEW: conversion by SALE channel (channel of the conversionSale per converted lead).
    const conversionChannelMap: Record<string, { channel: string; converted: number; valor_convertido: number }> = {};
    // NEW: matrix capture-channel × sale-channel for converted leads.
    const matrixMap: Record<string, { capture_channel: string; conversion_channel: string; converted: number; valor_convertido: number }> = {};

    for (const lead of Object.values(leadByPhone)) {
      const allSales = getAllSalesForPhone(lead.phone);

      // Capture source for the channel breakdown depends on the mode.
      const captureSource = mode === "captured"
        ? lead.firstInPeriodSource
        : lead.firstEverSource;

      // ── Scope membership (the denominator = "Leads captados") ──
      // captured: only leads with a capture record inside the period.
      // purchased: EVERY lead ever registered (all-time base, e.g. 10k+),
      //   then we check how many of them bought within the period.
      let inScope = false;
      if (mode === "captured") {
        inScope = !!lead.firstInPeriodDate;
      } else {
        inScope = true;
      }

      // Prior-customer status is judged against the EARLIEST-ever capture,
      // so the "1ª compra" semantics stay stable regardless of mode.
      const hadPriorSales = allSales.some(s => s.date < lead.firstEverDate);
      // Default behavior: analyze ONLY new leads (people who were not customers
      // when they entered as a lead). Explicit toggle re-includes ex-customers.
      if (onlyNewLeads && hadPriorSales) continue;

      if (!inScope) continue;

      // ── Qualifying purchases (define conversion) ──
      // A sale only qualifies as a conversion if it happened STRICTLY AFTER the
      // lead's capture date — in BOTH modes. Purchases before/at capture are
      // never conversions.
      //   captured: capture date = first capture WITHIN the period.
      //   purchased: capture date = earliest-ever capture (lead may predate window).
      const capDate = mode === "captured" ? lead.firstInPeriodDate! : lead.firstEverDate;
      const qualifying = allSales.filter(s => inPeriod(s.date) && s.date > capDate);

      // Conversion event = the FIRST qualifying sale (oldest after capture).
      // allSales is sorted ascending, so qualifying[0] is the earliest.
      const conversionSale = qualifying.length > 0
        ? {
            id: qualifying[0].id,
            date: qualifying[0].date,
            total: qualifying[0].total,
            channel: qualifying[0].channel,
            source: qualifying[0].id.startsWith("zoppy:") ? "zoppy" : "pos",
          }
        : null;

      leadsInScope++;

      const chKey = prettySource(captureSource);
      const cap = (captureMap[chKey] ||= { channel: chKey, leads: 0, converted: 0, purchases: 0, revenue: 0, convertedRevenue: 0 });
      cap.leads++;

      // A lead is "converted" if it has >= 1 qualifying purchase. Subsequent
      // purchases of the same lead do NOT create new conversions.
      const converted = !!conversionSale;
      if (!converted) continue;

      leadsConverted++;
      cap.converted++;
      if (hadPriorSales) wereCustomersBefore++; else firstTimeBuyers++;

      // VALOR DE CONVERSÃO (métrica principal): apenas a 1ª compra (conversionSale).
      convertedRevenue += conversionSale.total;
      cap.convertedRevenue += conversionSale.total;

      // NEW: conversion by SALE channel (channel of the 1st purchase).
      const convCh = conversionSale.channel || "Não identificado";
      const cc = (conversionChannelMap[convCh] ||= { channel: convCh, converted: 0, valor_convertido: 0 });
      cc.converted++;
      cc.valor_convertido += conversionSale.total;

      // NEW: matrix capture-channel × sale-channel for this converted lead.
      const mxKey = `${chKey}|||${convCh}`;
      const mx = (matrixMap[mxKey] ||= { capture_channel: chKey, conversion_channel: convCh, converted: 0, valor_convertido: 0 });
      mx.converted++;
      mx.valor_convertido += conversionSale.total;

      // RECEITA TOTAL COM RECOMPRAS (métrica secundária): soma TODAS as qualifying.
      for (const s of qualifying) {
        totalPurchases++;
        totalRevenue += s.total;
        cap.purchases++;
        cap.revenue += s.total;

        const mk = `${s.date.getFullYear()}-${String(s.date.getMonth() + 1).padStart(2, "0")}`;
        const m = (monthMap[mk] ||= { month: mk, purchases: 0, revenue: 0 });
        m.purchases++;
        m.revenue += s.total;
      }
    }


    // Channels (bar chart) and sources (table) are both the capture-channel
    // breakdown now — the user wants "onde o lead foi captado", not where the
    // sale happened. Sorted by number of leads captured.
    const captureChannels = Object.values(captureMap)
      .map(c => ({
        channel: c.channel,
        leads: c.leads,
        converted: c.converted,
        purchases: c.purchases,
        // valor_convertido (1ª compra) é o valor financeiro principal do canal.
        valor_convertido: Math.round(c.convertedRevenue * 100) / 100,
        receita_total_com_recompras: Math.round(c.revenue * 100) / 100,
        // `revenue` mantido = valor_convertido para o gráfico principal.
        revenue: Math.round(c.convertedRevenue * 100) / 100,
        ticket_medio_conversao: c.converted > 0 ? Math.round((c.convertedRevenue / c.converted) * 100) / 100 : 0,
        conversion_rate: c.leads > 0 ? Math.round((c.converted / c.leads) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.leads - a.leads);

    const sources = captureChannels.map(c => ({
      source: c.channel,
      leads: c.leads,
      converted: c.converted,
      purchases: c.purchases,
      valor_convertido: c.valor_convertido,
      receita_total_com_recompras: c.receita_total_com_recompras,
      revenue: c.revenue,
      ticket_medio_conversao: c.ticket_medio_conversao,
      conversion_rate: c.conversion_rate,
    }));

    const months = Object.values(monthMap)
      .map(m => ({ ...m, revenue: Math.round(m.revenue * 100) / 100 }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // NEW: conversion by SALE channel (one of the 5 real channels).
    const conversionChannels = Object.values(conversionChannelMap)
      .map(c => ({
        channel: c.channel,
        converted: c.converted,
        valor_convertido: Math.round(c.valor_convertido * 100) / 100,
        ticket_medio_conversao: c.converted > 0 ? Math.round((c.valor_convertido / c.converted) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.converted - a.converted);

    // NEW: capture-channel × sale-channel matrix (converted leads only).
    const captureXconversion = Object.values(matrixMap)
      .map(m => ({
        capture_channel: m.capture_channel,
        conversion_channel: m.conversion_channel,
        converted: m.converted,
        valor_convertido: Math.round(m.valor_convertido * 100) / 100,
      }))
      .sort((a, b) => b.converted - a.converted);

    return new Response(JSON.stringify({
      mode,
      only_new_leads: onlyNewLeads,
      include_existing_customers: includeExisting,
      // legacy alias kept for any older client still reading this field
      first_purchase_only: onlyNewLeads,
      summary: {
        leads_in_scope: leadsInScope,
        leads_converted: leadsConverted,
        conversion_rate: leadsInScope > 0 ? Math.round((leadsConverted / leadsInScope) * 10000) / 100 : 0,
        were_customers_before: wereCustomersBefore,
        first_time_buyers: firstTimeBuyers,
        total_purchases: totalPurchases,
        // VALOR DE CONVERSÃO (principal): soma só da 1ª compra de cada lead convertido.
        valor_convertido: Math.round(convertedRevenue * 100) / 100,
        ticket_medio_conversao: leadsConverted > 0 ? Math.round((convertedRevenue / leadsConverted) * 100) / 100 : 0,
        // RECEITA TOTAL COM RECOMPRAS (secundária): soma de todas as compras qualifying.
        receita_total_com_recompras: Math.round(totalRevenue * 100) / 100,
        // alias legado: total_revenue agora reflete o valor_convertido (1ª compra).
        total_revenue: Math.round(convertedRevenue * 100) / 100,
        avg_ticket: totalPurchases > 0 ? Math.round((totalRevenue / totalPurchases) * 100) / 100 : 0,
        compras_por_lead: leadsConverted > 0 ? Math.round((totalPurchases / leadsConverted) * 100) / 100 : 0,
        avg_purchases_per_lead: leadsConverted > 0 ? Math.round((totalPurchases / leadsConverted) * 100) / 100 : 0,
      },
      // capture channels (where the lead came in)
      channels: captureChannels,
      sources,
      months,
      // NEW: sale-channel breakdown of conversions + capture×conversion matrix
      conversionChannels,
      captureXconversion,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("leads-dashboard error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

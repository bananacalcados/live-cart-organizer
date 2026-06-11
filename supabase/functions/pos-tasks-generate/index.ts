// Gera/garante as instâncias de tarefa do dia para uma vendedora (ou todas).
// Chamada on-demand pelo popup do PDV e também pode rodar por cron.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Categorias que geram lista de contatos verificáveis automaticamente.
const CONTACT_CATEGORIES = new Set([
  "contact_old_customers",
  "post_sale",
  "cold_leads",
]);

function todaySaoPaulo(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // YYYY-MM-DD
}

// Verifica se a definição se aplica hoje conforme recorrência.
function appliesToday(def: any, dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00-03:00");
  const cfg = def.recurrence_config || {};
  switch (def.recurrence) {
    case "daily":
      return true;
    case "once":
      return cfg.date === dateStr;
    case "weekly": {
      // todo dia da semana indicado (0=domingo..6=sábado)
      if (cfg.weekday === undefined || cfg.weekday === null) return true;
      return d.getDay() === Number(cfg.weekday);
    }
    case "weekly_specific": {
      // semana específica do mês (week_of_month 1..5) + opcional weekday
      const dayOfMonth = d.getDate();
      const weekOfMonth = Math.ceil(dayOfMonth / 7);
      if (cfg.week_of_month && weekOfMonth !== Number(cfg.week_of_month)) return false;
      if (cfg.weekday !== undefined && cfg.weekday !== null && d.getDay() !== Number(cfg.weekday)) return false;
      return true;
    }
    case "monthly": {
      // todo dia X do mês
      if (!cfg.day_of_month) return true;
      return d.getDate() === Number(cfg.day_of_month);
    }
    case "monthly_specific": {
      // somente em determinado mês (1..12) + opcional dia
      if (cfg.month && d.getMonth() + 1 !== Number(cfg.month)) return false;
      if (cfg.day_of_month && d.getDate() !== Number(cfg.day_of_month)) return false;
      return true;
    }
    default:
      return true;
  }
}

function appliesToSeller(def: any, seller: any): boolean {
  if (def.assignment === "all") return true;
  if (def.assignment === "managers") return !!seller.is_manager;
  if (def.assignment === "specific") {
    const ids = def.assigned_seller_ids || [];
    return ids.includes(seller.id);
  }
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const storeId: string | undefined = body.storeId;
    const sellerId: string | undefined = body.sellerId; // opcional: gera só p/ esta vendedora
    if (!storeId) {
      return new Response(JSON.stringify({ error: "storeId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dateStr = todaySaoPaulo();

    // Vendedoras alvo
    let sellersQ = supabase
      .from("pos_sellers")
      .select("id, name, is_manager, whatsapp_phone")
      .eq("store_id", storeId)
      .eq("is_active", true);
    if (sellerId) sellersQ = sellersQ.eq("id", sellerId);
    const { data: sellers } = await sellersQ;

    const { data: defs } = await supabase
      .from("pos_task_definitions")
      .select("*")
      .eq("store_id", storeId)
      .eq("is_active", true);

    if (!sellers?.length || !defs?.length) {
      return new Response(JSON.stringify({ ok: true, created: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let created = 0;

    for (const seller of sellers) {
      for (const def of defs) {
        if (!appliesToday(def, dateStr)) continue;
        if (!appliesToSeller(def, seller)) continue;

        const target = Math.max(1, Number(def.target_count) || 1);

        // Já existe?
        const { data: existing } = await supabase
          .from("pos_seller_task_instances")
          .select("id")
          .eq("definition_id", def.id)
          .eq("seller_id", seller.id)
          .eq("due_date", dateStr)
          .maybeSingle();
        if (existing) continue;

        const { data: inst, error: instErr } = await supabase
          .from("pos_seller_task_instances")
          .insert({
            definition_id: def.id,
            store_id: storeId,
            seller_id: seller.id,
            due_date: dateStr,
            status: "pending",
            progress_current: 0,
            progress_target: def.verification_mode === "auto" ? target : 1,
            payload: {},
          })
          .select("id")
          .single();
        if (instErr || !inst) continue;
        created++;

        // Gera contatos para tarefas automáticas baseadas em contato
        if (def.verification_mode === "auto" && CONTACT_CATEGORIES.has(def.category)) {
          const contacts = await buildContacts(supabase, def, storeId, target);
          if (contacts.length > 0) {
            await supabase.from("pos_task_contacts").insert(
              contacts.map((c) => ({
                instance_id: inst.id,
                customer_phone: c.phone,
                customer_name: c.name,
                customer_meta: c.meta || {},
              })),
            );
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, created, date: dateStr }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pos-tasks-generate error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function buildContacts(supabase: any, def: any, storeId: string, target: number) {
  const cfg = def.auto_config || {};
  const out: { phone: string; name: string; meta?: any }[] = [];

  if (def.category === "contact_old_customers") {
    // Clientes antigos: sem compra recente, prioriza RFM "perdidos/em risco"
    let q = supabase
      .from("customers_unified")
      .select("name, phone_e164, rfm_segment, last_purchase_at, total_orders")
      .not("phone_e164", "is", null)
      .gt("total_orders", 0)
      .order("last_purchase_at", { ascending: true, nullsFirst: false })
      .limit(target * 3);
    if (cfg.rfm_segment) q = q.eq("rfm_segment", cfg.rfm_segment);
    const { data } = await q;
    for (const c of data || []) {
      if (!c.phone_e164) continue;
      out.push({ phone: c.phone_e164, name: c.name || "Cliente", meta: { rfm: c.rfm_segment, last_purchase_at: c.last_purchase_at } });
      if (out.length >= target) break;
    }
  } else if (def.category === "post_sale") {
    // Pós-venda: clientes que compraram ontem nesta loja
    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("pos_sales")
      .select("customer_name, customer_phone, created_at")
      .eq("store_id", storeId)
      .neq("status", "cancelled")
      .gte("created_at", since)
      .not("customer_phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(target * 2);
    const seen = new Set<string>();
    for (const s of data || []) {
      const ph = (s.customer_phone || "").replace(/\D/g, "");
      if (!ph || seen.has(ph)) continue;
      seen.add(ph);
      out.push({ phone: s.customer_phone, name: s.customer_name || "Cliente", meta: { sale_at: s.created_at } });
      if (out.length >= target) break;
    }
  } else if (def.category === "cold_leads") {
    // Leads frios: contatos de ~7 dias atrás que não compraram
    const daysAgo = Number(cfg.days_ago) || 7;
    const end = new Date(Date.now() - (daysAgo - 1) * 86400000).toISOString();
    const start = new Date(Date.now() - (daysAgo + 1) * 86400000).toISOString();
    const { data } = await supabase
      .from("chat_contacts")
      .select("name, phone, created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .limit(target * 4);
    for (const c of data || []) {
      if (!c.phone) continue;
      out.push({ phone: c.phone, name: c.name || "Lead", meta: { lead_at: c.created_at } });
      if (out.length >= target) break;
    }
  }

  return out;
}

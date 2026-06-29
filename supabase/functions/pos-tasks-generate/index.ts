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

// Dia da semana em São Paulo (0=domingo..6=sábado)
function weekdaySaoPaulo(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00-03:00");
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d);
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wd] ?? 0;
}

// Desloca uma data (YYYY-MM-DD) em N dias, mantendo o fuso de São Paulo.
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00-03:00");
  d.setDate(d.getDate() + days);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
}

// Chave normalizada de telefone (DDD + 8 últimos dígitos), tolerante a
// variações de formato (com/sem 55, com/sem 9º dígito). Usada para deduplicar
// clientes mesmo quando o número está salvo em formatos diferentes.
function phoneKey(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}



// Verifica se a definição se aplica hoje conforme recorrência.
function appliesToday(def: any, dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00-03:00");
  const cfg = def.recurrence_config || {};
  switch (def.recurrence) {
    case "daily":
      return true;
    case "weekdays": {
      // Dias úteis: segunda a sexta (São Paulo)
      const wd = weekdaySaoPaulo(dateStr);
      return wd >= 1 && wd <= 5;
    }
    case "once":
      return cfg.date === dateStr;
    case "custom_range": {
      // período personalizado (start_date..end_date, inclusivo)
      if (cfg.start_date && dateStr < cfg.start_date) return false;
      if (cfg.end_date && dateStr > cfg.end_date) return false;
      return true;
    }
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

    const today = todaySaoPaulo();
    // Permite gerar instâncias para uma data específica (ex.: navegação no quadro de tarefas).
    // Nunca geramos para datas FUTURAS para não congelar listas automáticas (pós-venda etc.) antes da hora.
    const requested: string | undefined = typeof body.date === "string" ? body.date : undefined;
    const dateStr = requested && requested <= today ? requested : today;

    // Vendedoras alvo
    let sellersQ = supabase
      .from("pos_sellers")
      .select("id, name, is_manager, whatsapp_phone")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .eq("excluded_from_tasks", false); // ignora vendedores "fantasmas"
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

        const baseTarget = Math.max(1, Number(def.target_count) || 1);
        const isAuto = def.verification_mode === "auto";
        const isContactAuto = isAuto && CONTACT_CATEGORIES.has(def.category);
        const dynamic = isAuto && (def.auto_config?.dynamic_target === true);

        // Já existe?
        const { data: existing } = await supabase
          .from("pos_seller_task_instances")
          .select("id")
          .eq("definition_id", def.id)
          .eq("seller_id", seller.id)
          .eq("due_date", dateStr)
          .maybeSingle();
        if (existing) continue;

        // Para tarefas automáticas de contato, monta a lista primeiro
        // (a meta dinâmica vira o nº real de clientes encontrados).
        let contacts: { phone: string; name: string; meta?: any }[] = [];
        if (isContactAuto) {
          const cap = dynamic ? 500 : baseTarget;
          contacts = await buildContacts(supabase, def, storeId, cap, dateStr, seller);
        }

        let target: number;
        if (!isAuto) target = 1;
        else if (dynamic) target = isContactAuto ? Math.max(1, contacts.length) : baseTarget;
        else target = baseTarget;

        const { data: inst, error: instErr } = await supabase
          .from("pos_seller_task_instances")
          .insert({
            definition_id: def.id,
            store_id: storeId,
            seller_id: seller.id,
            due_date: dateStr,
            status: "pending",
            progress_current: 0,
            progress_target: target,
            payload: {},
          })
          .select("id")
          .single();
        if (instErr || !inst) continue;
        created++;

        if (isContactAuto) {
          if (contacts.length > 0) {
            await supabase.from("pos_task_contacts").insert(
              contacts.map((c) => ({
                instance_id: inst.id,
                customer_phone: c.phone,
                customer_name: c.name,
                customer_meta: c.meta || {},
              })),
            );
          } else if (dynamic) {
            // Meta dinâmica sem clientes hoje: nada a fazer, conclui na hora.
            await supabase
              .from("pos_seller_task_instances")
              .update({ status: "completed", completion_mode: "auto", completed_at: new Date().toISOString() })
              .eq("id", inst.id);
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

async function buildContacts(supabase: any, def: any, storeId: string, target: number, dateStr: string, seller?: any) {
  const cfg = def.auto_config || {};
  const out: { phone: string; name: string; meta?: any }[] = [];

  if (def.category === "contact_old_customers") {
    // Clientes antigos/ausentes: N clientes DIFERENTES para cada vendedora.
    // Para não repetir as mesmas pessoas, excluímos:
    //  (a) quem já foi atribuído HOJE em qualquer vendedora (não duplica no dia);
    //  (b) quem já foi atribuído a ESTA vendedora nos últimos N dias (rotação real
    //      por toda a base — sem isso, os "mais antigos" voltavam todo dia).
    const used = new Set<string>();

    // (a) Já atribuídos hoje (qualquer vendedora)
    {
      const { data: insts } = await supabase
        .from("pos_seller_task_instances")
        .select("id")
        .eq("definition_id", def.id)
        .eq("due_date", dateStr);
      const ids = (insts || []).map((i: any) => i.id);
      if (ids.length) {
        const { data: usedRows } = await supabase
          .from("pos_task_contacts")
          .select("customer_phone")
          .in("instance_id", ids);
        for (const r of usedRows || []) {
          const ph = phoneKey(r.customer_phone || "");
          if (ph) used.add(ph);
        }
      }
    }

    // (b) Já atribuídos a ESTA vendedora nos últimos N dias
    const noRepeatDays = Math.max(1, Number(cfg.no_repeat_days) || 60);
    if (seller?.id) {
      const sinceDate = shiftDate(dateStr, -noRepeatDays);
      const { data: pastInsts } = await supabase
        .from("pos_seller_task_instances")
        .select("id")
        .eq("definition_id", def.id)
        .eq("seller_id", seller.id)
        .gte("due_date", sinceDate)
        .lt("due_date", dateStr);
      const pastIds = (pastInsts || []).map((i: any) => i.id);
      for (let i = 0; i < pastIds.length; i += 100) {
        const { data: pastRows } = await supabase
          .from("pos_task_contacts")
          .select("customer_phone")
          .in("instance_id", pastIds.slice(i, i + 100));
        for (const r of pastRows || []) {
          const ph = phoneKey(r.customer_phone || "");
          if (ph) used.add(ph);
        }
      }
    }

    // Pool grande o suficiente para sobrar candidatos após remover os excluídos.
    let q = supabase
      .from("customers_unified")
      .select("name, phone_e164, rfm_segment, last_purchase_at, total_orders")
      .not("phone_e164", "is", null)
      .gt("total_orders", 0)
      .order("last_purchase_at", { ascending: true, nullsFirst: false })
      .limit(Math.max(target * 80, 500));
    if (cfg.rfm_segment) q = q.eq("rfm_segment", cfg.rfm_segment);
    const { data } = await q;

    const candidates = data || [];
    for (const c of candidates) {
      if (!c.phone_e164) continue;
      const ph = phoneKey(c.phone_e164);
      if (!ph || used.has(ph)) continue;
      used.add(ph);
      out.push({ phone: c.phone_e164, name: c.name || "Cliente", meta: { rfm: c.rfm_segment, last_purchase_at: c.last_purchase_at } });
      if (out.length >= target) break;
    }

    // Fallback: se a base de clientes antigos se esgotou dentro da janela de
    // não-repetição, completamos liberando o histórico (mantendo só a regra de
    // não duplicar no MESMO dia). Garante que a lista nunca venha vazia à toa.
    if (out.length < target) {
      const sameDay = new Set<string>();
      {
        const { data: insts } = await supabase
          .from("pos_seller_task_instances")
          .select("id")
          .eq("definition_id", def.id)
          .eq("due_date", dateStr);
        const ids = (insts || []).map((i: any) => i.id);
        if (ids.length) {
          const { data: usedRows } = await supabase
            .from("pos_task_contacts")
            .select("customer_phone")
            .in("instance_id", ids);
          for (const r of usedRows || []) {
            const ph = phoneKey(r.customer_phone || "");
            if (ph) sameDay.add(ph);
          }
        }
      }
      const picked = new Set(out.map((o) => phoneKey(o.phone)));
      for (const c of candidates) {
        if (!c.phone_e164) continue;
        const ph = phoneKey(c.phone_e164);
        if (!ph || picked.has(ph) || sameDay.has(ph)) continue;
        picked.add(ph);
        out.push({ phone: c.phone_e164, name: c.name || "Cliente", meta: { rfm: c.rfm_segment, last_purchase_at: c.last_purchase_at } });
        if (out.length >= target) break;
      }
    }

  } else if (def.category === "post_sale") {
    // Pós-venda: clientes que compraram no(s) dia(s) anterior(es) nesta loja
    // ATENDIDOS PELA PRÓPRIA VENDEDORA da tarefa (não mistura vendas de outras).
    // Em recorrência "dias úteis", a segunda-feira puxa sexta + sábado + domingo.
    const wd = weekdaySaoPaulo(dateStr);
    let startDate: string;
    let endDate: string;
    if (def.recurrence === "weekdays" && wd === 1) {
      startDate = shiftDate(dateStr, -3); // sexta
      endDate = shiftDate(dateStr, -1);   // domingo
    } else {
      startDate = endDate = shiftDate(dateStr, -1); // ontem
    }
    const startIso = `${startDate}T00:00:00-03:00`;
    const endIso = `${endDate}T23:59:59-03:00`;
    let salesQ = supabase
      .from("pos_sales")
      .select("customer_name, customer_phone, created_at, seller_id")
      .eq("store_id", storeId)
      .neq("status", "cancelled")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .not("customer_phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(Math.max(target * 2, 50));
    // Só clientes da vendedora desta tarefa.
    if (seller?.id) salesQ = salesQ.eq("seller_id", seller.id);
    const { data } = await salesQ;
    const seen = new Set<string>();
    for (const s of data || []) {
      const ph = phoneKey(s.customer_phone || "");
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
      .select("display_name, custom_name, phone, created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .limit(target * 4);
    for (const c of data || []) {
      if (!c.phone) continue;
      out.push({ phone: c.phone, name: c.custom_name || c.display_name || "Lead", meta: { lead_at: c.created_at } });
      if (out.length >= target) break;
    }

  }

  return out;
}

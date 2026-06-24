// Daily scheduler for recurring WhatsApp carousel campaigns (Etapa 3).
//
// For each ACTIVE campaign whose `dias_semana` includes today's weekday
// (America/Sao_Paulo), it:
//   1. resolves the right template by the count of "ok" cards (>= 2),
//   2. selects the eligible batch (opt-out, per-campaign cooldown, global cap),
//   3. enqueues `pendente` rows in `campanha_envios`, assigning a seller name
//      via round-robin (rodízio de vendedoras) when enabled.
//
// Actual sending happens in the worker (Etapa 4). This function only schedules.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";

// Mirror of src/lib/pos/virtualSellers.ts — only real human names rotate.
const VIRTUAL_SELLER_PATTERNS = [
  /^live\s*shopping$/i,
  /^vendedor[a]?\s*live$/i,
  /^live$/i,
  /^loja$/i,
  /^loja\s*f[ií]sica$/i,
  /^loja\s*online$/i,
];
function isVirtualSeller(name?: string | null): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  return VIRTUAL_SELLER_PATTERNS.some((re) => re.test(n));
}

// JS getDay() semantics in São Paulo: 0=Sun .. 6=Sat.
function saoPauloWeekday(): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(new Date());
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[wd] ?? new Date().getDay();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, serviceKey);

  const today = saoPauloWeekday();
  const results: Array<Record<string, unknown>> = [];

  const { data: campaigns, error: campErr } = await sb
    .from("campanhas_auto")
    .select("*")
    .eq("ativa", true);

  if (campErr) return json({ error: campErr.message }, 500);

  for (const c of campaigns || []) {
    const dias: number[] = Array.isArray(c.dias_semana) ? c.dias_semana : [];
    if (dias.length && !dias.includes(today)) {
      results.push({ campanha: c.id, skipped: "fora do dia da semana" });
      continue;
    }

    // 1) Resolve template by count of "ok" cards.
    const { data: tpl } = await sb.rpc("resolve_campaign_template", {
      p_campanha_id: c.id,
    });
    if (!tpl || (Array.isArray(tpl) ? tpl.length === 0 : !tpl.template_id)) {
      results.push({ campanha: c.id, skipped: "sem template (precisa >= 2 cards ok aprovados)" });
      continue;
    }

    // 2) Select eligible batch.
    const { data: batch, error: batchErr } = await sb.rpc("select_campaign_batch", {
      p_campanha_id: c.id,
      p_limit: c.qtd_por_dia ?? 50,
    });
    if (batchErr) {
      results.push({ campanha: c.id, error: batchErr.message });
      continue;
    }
    if (!batch || batch.length === 0) {
      results.push({ campanha: c.id, enqueued: 0, note: "nenhum cliente elegível hoje" });
      continue;
    }

    // 3) Build seller rotation pool (real human names only).
    let sellers: Array<{ id: string; name: string }> = [];
    if (c.rodizio_vendedora) {
      let q = sb.from("pos_sellers").select("id, name").eq("is_active", true);
      const allow: string[] | null = Array.isArray(c.vendedoras_rodizio) && c.vendedoras_rodizio.length
        ? c.vendedoras_rodizio
        : null;
      if (allow) q = q.in("id", allow);
      const { data: sellerRows } = await q;
      sellers = (sellerRows || [])
        .map((s: { id: string; name: string | null }) => ({ id: s.id, name: (s.name || "").trim() }))
        .filter((s) => s.name && !isVirtualSeller(s.name));
    }

    // 4) Enqueue pendente rows (skip clients already enqueued/sent recently for this campaign).
    const rows = (batch as Array<{ cliente_id: string; phone: string; phone_suffix8: string }>).map(
      (b, idx) => {
        const seller = sellers.length ? sellers[idx % sellers.length] : null;
        return {
          campanha_id: c.id,
          cliente_id: b.cliente_id,
          phone: b.phone,
          phone_suffix8: b.phone_suffix8,
          vendedora_id: seller?.id ?? null,
          vendedora_nome: seller?.name ?? null,
          status: "pendente",
        };
      },
    );

    const { error: insErr, count } = await sb
      .from("campanha_envios")
      .insert(rows, { count: "exact" });

    if (insErr) {
      results.push({ campanha: c.id, error: insErr.message });
      continue;
    }
    results.push({ campanha: c.id, enqueued: count ?? rows.length });
  }

  return json({ ok: true, weekday: today, processed: results });
});

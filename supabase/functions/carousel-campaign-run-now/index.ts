// Manual immediate trigger for a single carousel campaign ("Iniciar disparos agora").
//
// Called from the POS UI by an authenticated user. It:
//   1. validates the user JWT,
//   2. resolves the campaign template (>= 2 ok cards),
//   3. selects today's eligible batch (respecting qtd_por_dia, cooldown, opt-out,
//      and skipping clients already enqueued/sent),
//   4. enqueues `pendente` rows in `campanha_envios`,
//   5. invokes the sender worker immediately so messages start going out now.
//
// The recurring daily scheduler keeps running on the next days; this only kicks
// off the current day's batch on demand.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // --- Auth: require a valid authenticated user JWT. ---
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimsErr } = await authClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { campanha_id?: string } = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }
  const campanhaId = body.campanha_id;
  if (!campanhaId) return json({ error: "campanha_id obrigatório" }, 400);

  const sb = createClient(url, serviceKey);

  // 1) Campaign.
  const { data: c, error: cErr } = await sb
    .from("campanhas_auto")
    .select("*")
    .eq("id", campanhaId)
    .maybeSingle();
  if (cErr) return json({ error: cErr.message }, 500);
  if (!c) return json({ error: "Automação não encontrada" }, 404);
  if (!c.ativa) return json({ error: "Ative a automação antes de iniciar os disparos." }, 400);

  // 2) Resolve template.
  const { data: tpl } = await sb.rpc("resolve_campaign_template", { p_campanha_id: campanhaId });
  const tplRow = Array.isArray(tpl) ? tpl[0] : tpl;
  if (!tplRow || !tplRow.template_id) {
    return json({ error: "Sem template aprovado para esta automação (precisa de pelo menos 2 cards aprovados)." }, 400);
  }

  // 3) Select eligible batch (already skips clients with pendente / recently-sent rows).
  const { data: batch, error: batchErr } = await sb.rpc("select_campaign_batch", {
    p_campanha_id: campanhaId,
    p_limit: c.qtd_por_dia ?? 50,
  });
  if (batchErr) return json({ error: batchErr.message }, 500);
  if (!batch || batch.length === 0) {
    return json({ ok: true, enqueued: 0, note: "Nenhum cliente elegível no momento (público vazio, em cooldown ou já enfileirado)." });
  }

  // 4) Seller rotation pool (real human names only).
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

  const rows = (batch as Array<{ cliente_id: string; phone: string; phone_suffix8: string }>).map(
    (b, idx) => {
      const seller = sellers.length ? sellers[idx % sellers.length] : null;
      return {
        campanha_id: campanhaId,
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
  if (insErr) return json({ error: insErr.message }, 500);

  const enqueued = count ?? rows.length;

  // 5) Kick off the sender immediately (fire-and-forget; cron also runs every 5 min).
  try {
    await fetch(`${url}/functions/v1/carousel-campaign-sender`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trigger: "run-now", campanha_id: campanhaId }),
    });
  } catch (_e) {
    // Sending will still happen via the every-5-min cron.
  }

  return json({ ok: true, enqueued, started: true });
});

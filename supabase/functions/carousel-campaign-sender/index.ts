// Etapa 4 — Worker de envio das campanhas de carrossel recorrentes.
//
// Processa as linhas `pendente` de `campanha_envios` que já podem ser enviadas
// (proxima_tentativa nula ou vencida). Para cada uma:
//   1. resolve o template aprovado pela contagem de cards "ok",
//   2. monta os componentes do carrossel (header imagem + body com variáveis),
//      resolvendo {{nome}} / {{primeiro_nome}} / {{tamanho}} / {{vendedora}} /
//      texto livre por destinatário,
//   3. envia via Cloud API (reusa meta-whatsapp-send-template, que também grava
//      a mensagem no chat e fecha a conversa),
//   4. atualiza o status do envio (enviado + wamid).
//
// Tratamento de falha: erro no envio incrementa `tentativas`; abaixo de 3 reagenda
// para daqui 48h (continua `pendente`), na 3ª vira `falhou` (encerrado). O webhook
// (meta-whatsapp-webhook) faz a mesma lógica para falhas pós-envio e marca
// entregue/lido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";

const RETRY_HOURS = 48;
const MAX_ATTEMPTS = 3;
const BATCH = 80;

const TOKEN_RE = /\{\{\s*([\w-]+)\s*\}\}/g;

function tokensInOrder(raw: string | null | undefined): string[] {
  const out: string[] = [];
  if (!raw) return out;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(raw)) !== null) out.push(m[1]);
  return out;
}

interface ResolveCtx {
  name?: string | null;
  first_name?: string | null;
  sizes?: string[] | null;
  vendedora?: string | null;
  legenda?: string | null;
  vars?: Record<string, unknown> | null;
}

function resolveToken(token: string, ctx: ResolveCtx): string {
  const name = (ctx.name || "").trim();
  switch (token) {
    case "nome":
      return name || "cliente";
    case "primeiro_nome":
      return (ctx.first_name || name.split(/\s+/)[0] || "cliente").trim();
    case "tamanho":
      return (ctx.sizes && ctx.sizes.length ? String(ctx.sizes[0]) : "") || "—";
    case "vendedora":
      return (ctx.vendedora || "nossa loja").trim();
    case "legenda":
      return (ctx.legenda || "").trim() || "—";
    default: {
      const v = ctx.vars && ctx.vars[token] != null ? String(ctx.vars[token]) : "";
      return v.trim() || "—";
    }
  }
}

function textParams(tokens: string[], ctx: ResolveCtx) {
  return tokens.map((t) => ({ type: "text", text: resolveToken(t, ctx) }));
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

  const nowIso = new Date().toISOString();

  // 1) Envios prontos para disparo.
  const { data: pendentes, error: pendErr } = await sb
    .from("campanha_envios")
    .select("*")
    .eq("status", "pendente")
    .or(`proxima_tentativa.is.null,proxima_tentativa.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (pendErr) return json({ error: pendErr.message }, 500);
  if (!pendentes || pendentes.length === 0) return json({ ok: true, sent: 0, note: "nada pendente" });

  // Cache por campanha (template + cards + tokens).
  const campCache = new Map<string, {
    campaign: any;
    templateName: string | null;
    language: string;
    okCards: any[];
    topTokens: string[];
    cardTokens: string[];
  }>();

  async function getCampaignCtx(campanhaId: string) {
    if (campCache.has(campanhaId)) return campCache.get(campanhaId)!;

    const { data: campaign } = await sb
      .from("campanhas_auto")
      .select("*")
      .eq("id", campanhaId)
      .maybeSingle();

    let templateName: string | null = null;
    let language = "pt_BR";
    const { data: tpl } = await sb.rpc("resolve_campaign_template", { p_campanha_id: campanhaId });
    const tplRow = Array.isArray(tpl) ? tpl[0] : tpl;
    if (tplRow && tplRow.template_id) {
      templateName = tplRow.template_id;
      language = tplRow.template_language || "pt_BR";
    }

    const { data: cards } = await sb
      .from("campanha_cards")
      .select("*")
      .eq("campanha_id", campanhaId)
      .eq("status", "ok")
      .order("ordem", { ascending: true });
    const okCards = (cards || []).slice(0, 10);

    const ctx = {
      campaign,
      templateName,
      language,
      okCards,
      topTokens: tokensInOrder(campaign?.top_body),
      cardTokens: tokensInOrder(campaign?.card_body),
    };
    campCache.set(campanhaId, ctx);
    return ctx;
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const env of pendentes) {
    const cc = await getCampaignCtx(env.campanha_id);

    if (!cc.campaign || !cc.campaign.ativa) {
      skipped++;
      continue;
    }
    if (!cc.templateName || cc.okCards.length < 2) {
      // Sem template aprovado / cards insuficientes — deixa pendente para o próximo ciclo.
      skipped++;
      continue;
    }

    // Dados frescos do destinatário.
    const { data: rec } = await sb
      .from("crm_customers_v")
      .select("name, first_name, purchased_sizes")
      .eq("id", env.cliente_id)
      .maybeSingle();

    const baseCtx: ResolveCtx = {
      name: rec?.name,
      first_name: rec?.first_name,
      sizes: (rec?.purchased_sizes as string[]) || null,
      vendedora: env.vendedora_nome,
      vars: (cc.campaign.variaveis as Record<string, unknown>) || null,
    };

    // Componentes do carrossel.
    const components: any[] = [];
    if (cc.topTokens.length) {
      components.push({ type: "body", parameters: textParams(cc.topTokens, baseCtx) });
    }
    const carouselCards = cc.okCards.map((card, i) => {
      const comps: any[] = [
        { type: "header", parameters: [{ type: "image", image: { link: card.imagem_url } }] },
      ];
      if (cc.cardTokens.length) {
        comps.push({
          type: "body",
          parameters: textParams(cc.cardTokens, { ...baseCtx, legenda: card.legenda }),
        });
      }
      return { card_index: i, components: comps };
    });
    components.push({ type: "carousel", cards: carouselCards });

    // Envia via meta-whatsapp-send-template.
    let ok = false;
    let wamid: string | null = null;
    let errMsg = "";
    try {
      const res = await fetch(`${url}/functions/v1/meta-whatsapp-send-template`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: env.phone,
          templateName: cc.templateName,
          language: cc.language,
          whatsappNumberId: cc.campaign.whatsapp_number_id || undefined,
          components,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        ok = true;
        wamid = data.messageId || null;
      } else {
        errMsg = data?.error
          ? `${data.error}${data.details ? ": " + JSON.stringify(data.details).slice(0, 400) : ""}`
          : `HTTP ${res.status}`;
      }
    } catch (e) {
      errMsg = (e as Error).message;
    }

    if (ok) {
      await sb
        .from("campanha_envios")
        .update({
          status: "enviado",
          message_wamid: wamid,
          enviado_em: new Date().toISOString(),
          erro: null,
        })
        .eq("id", env.id);
      sent++;
    } else {
      const attempts = (env.tentativas || 0) + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      await sb
        .from("campanha_envios")
        .update({
          tentativas: attempts,
          erro: errMsg.slice(0, 500),
          status: terminal ? "falhou" : "pendente",
          proxima_tentativa: terminal
            ? null
            : new Date(Date.now() + RETRY_HOURS * 3600 * 1000).toISOString(),
        })
        .eq("id", env.id);
      failed++;
    }

    // Throttle leve para respeitar o rate limit da Meta.
    await new Promise((r) => setTimeout(r, 150));
  }

  return json({ ok: true, processed: pendentes.length, sent, failed, skipped });
});

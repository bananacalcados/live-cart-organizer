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
import { issueMagicLink } from "../_shared/member-magic-link.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { classifySendError, extractMetaErrorCode } from "../_shared/meta-send-error.ts";
import { resolveMetaMediaId } from "../_shared/meta-media-cache.ts";
import { sendTextFallback } from "../_shared/meta-fallback.ts";


const MAX_ATTEMPTS = 3;
const BATCH = 80;
const TRANSIENT_FALLBACK_MS = 30 * 60 * 1000; // 30min se o classificador não der retryMs

// Espelho de src/lib/pos/virtualSellers.ts — só nomes humanos reais entram no rodízio.
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
  member_link?: string | null;
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
    case "area_membros":
    case "link_area_membros":
      return (ctx.member_link || "https://checkout.bananacalcados.com.br/minha-area").trim();
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

    // ETAPA 1: sobe cada imagem de card UMA vez e reaproveita o media_id. Sem isso
    // a Meta rebaixa a mesma URL a cada mensagem e devolve 131053 quando o nosso
    // storage oscila, derrubando o disparo inteiro.
    const mediaIds = new Map<string, string>();
    try {
      let q = sb.from("whatsapp_numbers").select("meta_phone_number_id, meta_access_token").eq("provider", "meta").limit(1);
      q = campaign?.whatsapp_number_id
        ? sb.from("whatsapp_numbers").select("meta_phone_number_id, meta_access_token").eq("id", campaign.whatsapp_number_id).limit(1)
        : q;
      const { data: numRows } = await q;
      const num = (numRows || [])[0];
      if (num?.meta_phone_number_id && num?.meta_access_token) {
        for (const card of okCards) {
          if (!card.imagem_url) continue;
          const id = await resolveMetaMediaId(sb, {
            url: card.imagem_url,
            kind: "image",
            phoneNumberId: num.meta_phone_number_id,
            accessToken: num.meta_access_token,
          });
          if (id) mediaIds.set(card.imagem_url, id);
        }
      }
    } catch (e) {
      console.warn("[carousel-sender] media cache falhou:", (e as Error).message);
    }

    const ctx = {
      campaign,
      templateName,
      language,
      okCards,
      mediaIds,
      topTokens: tokensInOrder(campaign?.top_body),
      cardTokens: tokensInOrder(campaign?.card_body),
    };
    campCache.set(campanhaId, ctx);
    return ctx;
  }


  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const touchedCampaigns = new Set<string>();

  for (const env of pendentes) {
    touchedCampaigns.add(env.campanha_id);

    // TRAVA DURA ANTI-DUPLICADO: independente do motivo do reagendamento
    // (mídia, rate limit, falha pós-envio no webhook), ninguém recebe a mesma
    // campanha mais de MAX_SENDS vezes.
    if ((env.envios_realizados || 0) >= MAX_SENDS) {
      await sb
        .from("campanha_envios")
        .update({ status: "falhou", proxima_tentativa: null, erro: `limite de ${MAX_SENDS} envios atingido` })
        .eq("id", env.id);
      skipped++;
      continue;
    }

    const cc = await getCampaignCtx(env.campanha_id);

    if (!cc.campaign || !cc.campaign.ativa) {
      skipped++;
      continue;
    }

    const isSimple = String(cc.campaign.template_tipo || "carrossel") === "simples";
    if (!cc.templateName || (!isSimple && cc.okCards.length < 2)) {
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

    // Link autenticado da Área de Membros, só quando o template usa o token.
    const memberTokens = ["area_membros", "link_area_membros"];
    const usesMemberLink = [...cc.topTokens, ...cc.cardTokens].some((t: string) =>
      memberTokens.includes(t),
    );
    if (usesMemberLink) baseCtx.member_link = await issueMagicLink(sb, env.phone);

    // Componentes (carrossel ou template simples texto / imagem+texto).
    const components: any[] = [];
    if (isSimple) {
      const headerUrl = cc.okCards[0]?.imagem_url || null;
      if (headerUrl) {
        const mid = cc.mediaIds.get(headerUrl);
        components.push({
          type: "header",
          parameters: [{ type: "image", image: mid ? { id: mid } : { link: headerUrl } }],
        });
      }
      if (cc.topTokens.length) {
        components.push({ type: "body", parameters: textParams(cc.topTokens, baseCtx) });
      }
    } else {
      if (cc.topTokens.length) {
        components.push({ type: "body", parameters: textParams(cc.topTokens, baseCtx) });
      }
      const carouselCards = cc.okCards.map((card, i) => {
        const mid = card.imagem_url ? cc.mediaIds.get(card.imagem_url) : null;
        const comps: any[] = [
          { type: "header", parameters: [{ type: "image", image: mid ? { id: mid } : { link: card.imagem_url } }] },
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
    }


    // Envia via meta-whatsapp-send-template.
    let ok = false;
    let wamid: string | null = null;
    let errMsg = "";
    let errCode: number | null = null;
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
        errCode = extractMetaErrorCode(data?.details) ?? extractMetaErrorCode(data?.error);
        errMsg = data?.error
          ? `${data.error}${data.details ? ": " + JSON.stringify(data.details).slice(0, 400) : ""}`
          : `HTTP ${res.status}`;
      }
    } catch (e) {
      errMsg = (e as Error).message;
    }

    const envios = (env.envios_realizados || 0) + 1;

    if (ok) {
      await sb
        .from("campanha_envios")
        .update({
          status: "enviado",
          message_wamid: wamid,
          enviado_em: new Date().toISOString(),
          erro: null,
          envios_realizados: envios,
        })
        .eq("id", env.id);
      sent++;

    } else {
      const cls = classifySendError(errCode, errMsg);
      const attempts = (env.tentativas || 0) + (cls.countsAttempt ? 1 : 0);

      // ETAPA 3: falhas não terminais elegíveis (mídia/cobrança) ganham uma
      // segunda via em TEXTO por uazapi/wasender — o cliente não fica sem nada.
      let fbProvider: string | null = null;
      if (cls.fallbackEligible) {
        const fbText = [cc.campaign.top_body, cc.okCards[0]?.legenda]
          .filter(Boolean)
          .map((t: string) => t.replace(TOKEN_RE, (_m, tk) => resolveToken(tk, { ...baseCtx, legenda: cc.okCards[0]?.legenda })))
          .join("\n\n");
        if (fbText.trim()) {
          const fb = await sendTextFallback(sb, {
            phone: env.phone,
            text: fbText,
            supabaseUrl: url,
            serviceKey,
            reason: `meta_${errCode ?? "erro"}`,
          });
          if (fb.ok) fbProvider = fb.provider || "fallback";
        }
      }

      if (fbProvider) {
        await sb
          .from("campanha_envios")
          .update({
            status: "enviado",
            enviado_em: new Date().toISOString(),
            erro: `entregue por fallback (${fbProvider}) após erro Meta: ${errMsg.slice(0, 300)}`,
            error_code: errCode,
            fallback_provider: fbProvider,
            fallback_at: new Date().toISOString(),
            proxima_tentativa: null,
            envios_realizados: envios,
          })
          .eq("id", env.id);
        sent++;
      } else {
        // Terminal quando: a Meta diz que é inentregável (nao_entregavel), OU
        // estourou o limite de tentativas, OU já usamos o teto de envios.
        let status: string;
        let proxima: string | null;
        if (cls.status === "nao_entregavel") {
          status = "nao_entregavel";
          proxima = null;
        } else if ((cls.countsAttempt && attempts >= MAX_ATTEMPTS) || envios >= MAX_SENDS) {
          status = "falhou";
          proxima = null;
        } else {
          status = "pendente";
          proxima = new Date(Date.now() + (cls.retryMs ?? TRANSIENT_FALLBACK_MS)).toISOString();
        }
        await sb
          .from("campanha_envios")
          .update({
            tentativas: attempts,
            erro: errMsg.slice(0, 500),
            error_code: errCode,
            status,
            proxima_tentativa: proxima,
            envios_realizados: envios,
          })
          .eq("id", env.id);
        failed++;

      }

      // Cobrança pendente na Meta: nenhum envio vai passar até resolver o
      // pagamento — interrompe o ciclo em vez de queimar a fila inteira.
      if (cls.pauseBatch) {
        console.error("[carousel-sender] PAUSANDO ciclo — cobrança Meta (131042):", errMsg.slice(0, 200));
        return json({ paused: true, reason: "meta_billing_131042", sent, failed, skipped });
      }
    }



    // Throttle leve para respeitar o rate limit da Meta.
    await new Promise((r) => setTimeout(r, 150));
  }

  // 2) Reposição: para cada campanha tocada neste ciclo, repõe o público com NOVAS
  //    pessoas elegíveis até atingir a meta diária de envios bem-sucedidos
  //    (qtd_por_dia). Considera quem já deu certo hoje + quem ainda está pendente.
  //    Quem falhou definitivamente (nao_entregavel/falhou) já é excluído na seleção,
  //    então cada falha abre espaço para uma nova tentativa em outra pessoa.
  let toppedUp = 0;
  for (const campanhaId of touchedCampaigns) {
    try {
      const cc = campCache.get(campanhaId);
      if (!cc?.campaign?.ativa) continue;

      const { data: deficit, error: defErr } = await sb.rpc("campaign_daily_deficit", {
        p_campanha_id: campanhaId,
      });
      const need = typeof deficit === "number" ? deficit : Number(deficit ?? 0);
      if (defErr || !need || need <= 0) continue;

      const { data: batch, error: batchErr } = await sb.rpc("select_campaign_batch", {
        p_campanha_id: campanhaId,
        p_limit: need,
      });
      if (batchErr || !batch || batch.length === 0) continue;

      // Pool de rodízio de vendedoras (só nomes humanos reais).
      let sellers: Array<{ id: string; name: string }> = [];
      if (cc.campaign.rodizio_vendedora) {
        let q = sb.from("pos_sellers").select("id, name").eq("is_active", true);
        const allow: string[] | null = Array.isArray(cc.campaign.vendedoras_rodizio) && cc.campaign.vendedoras_rodizio.length
          ? cc.campaign.vendedoras_rodizio
          : null;
        if (allow) q = q.in("id", allow);
        const { data: sellerRows } = await q;
        sellers = (sellerRows || [])
          .map((s: { id: string; name: string | null }) => ({ id: s.id, name: (s.name || "").trim() }))
          .filter((s) => s.name && !isVirtualSeller(s.name));
      }

      // WIRE-IN motor de cotas: reposição passa por enqueue_campanha_envios_guarded
      // (auto-upsert unified, check_touch_quota + matriz tipos_permitidos, snapshot
      // categoria/custo, respeita shadow_mode). Envios barrados são visíveis no
      // retorno (reasons/excluded) e serão auditáveis via shadow_report_period.
      const candidates = (batch as Array<{ cliente_id: string; phone: string; phone_suffix8: string }>).map(
        (b, idx) => {
          const seller = sellers.length ? sellers[idx % sellers.length] : null;
          return {
            unified_id: b.cliente_id,
            phone: b.phone,
            vendedora_id: seller?.id ?? null,
            vendedora_nome: seller?.name ?? null,
          };
        },
      );

      const tipo = (cc.campaign.tipo_comunicacao as string) || "oferta";
      const { data: gr, error: insErr } = await sb.rpc(
        "enqueue_campanha_envios_guarded",
        {
          p_campanha_id: campanhaId,
          p_candidates: candidates,
          p_tipo_comunicacao: tipo,
          p_template_category: cc.campaign.template_categoria || null,
        } as any,
      );
      if (!insErr && gr) {
        const obj = gr as any;
        toppedUp += Number(obj?.inserted ?? 0) + Number(obj?.shadow_inserted ?? 0);
        if ((obj?.excluded ?? 0) > 0) {
          console.log(
            `[carousel] top-up campanha=${campanhaId} inserted=${obj.inserted} shadow=${obj.shadow_inserted} excluded=${obj.excluded} reasons=${JSON.stringify(obj.reasons)} custo=${obj.cost_estimate_brl}`,
          );
        }
      }
    } catch (_e) {
      // Reposição é best-effort; o próximo ciclo do cron tenta de novo.
    }
  }

  return json({ ok: true, processed: pendentes.length, sent, failed, skipped, toppedUp });

});

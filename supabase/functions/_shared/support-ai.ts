// Fase 4b — triagem e agente de suporte por IA (modo sombra).
// A IA só sugere texto e pede ações por ferramenta; quem decide e valida é o servidor.
import { createOpenAI } from "npm:@ai-sdk/openai@4";
import { jsonSchema, Output, stepCountIs, streamText, tool } from "npm:ai@7";
import { createLovableAiGatewayRunIdFetch } from "./run-id.ts";
import { alreadyResolved, CONSOLIDATION_TEXT, cpfRequestAllowed, linkText, preferredLink, publicCommentReply, silentHandoffText, type SupportFacts, waitingMinutes, withinWindowByShipping } from "./support-policy.ts";

export const TRIAGE_CATEGORIES = ["venda", "troca", "devolucao", "troca_ou_devolucao_ambiguo", "rastreio", "outro_suporte", "nada"] as const;
export type TriageCategory = typeof TRIAGE_CATEGORIES[number];
export type Triage = { categoria: TriageCategory; confianca: number; justificativa: string; motivo_tamanho: boolean; facts?: SupportFacts };

export type ConvMessage = { from: "cliente" | "loja"; text: string; at: string; instance_id?: string | null; instance?: string; human?: boolean };
export type OrderItem = { item: string; produto: string; tamanho: string | null; quantidade: number };
export type OrderCtx = {
  ref: string; // P1, P2… (o id real fica só no servidor)
  data: string; canal: "online" | "loja"; status: string; entregue_em: string | null; itens: OrderItem[];
};

/** Tira CPF, telefones, e-mails e CEPs antes de mandar para o modelo. */
export function sanitizeText(t: string): string {
  return (t || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]")
    .replace(/\b\d{5}-?\d{3}\b/g, "[cep]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[numero]")
    .slice(0, 800);
}

export function firstName(name: string | null | undefined): string | null {
  const f = (name || "").trim().split(/\s+/)[0] || "";
  if (!f || /\d|@/.test(f)) return null;
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
}

export function transcript(msgs: ConvMessage[]): string {
  return msgs.map((m) => `${m.at} [${m.instance ?? "WhatsApp"}; id=${m.instance_id ?? "atual"}${m.human ? "; HUMANO" : ""}] ${m.from === "cliente" ? "CLIENTE" : "LOJA"}: ${sanitizeText(m.text)}`).join("\n");
}

/** Mapeia a triagem para a intenção antiga (contador por tipo e compatibilidade). */
export function triageToIntent(c: TriageCategory): "troca" | "devolucao" | "rastreio" | "indefinido" {
  return c === "troca" ? "troca" : c === "devolucao" ? "devolucao" : c === "rastreio" ? "rastreio" : "indefinido";
}
/** Categorias que pertencem à linha SUPORTE do WhatsApp do PDV. */
export const SUPPORT_CATEGORIES: TriageCategory[] = ["troca", "devolucao", "troca_ou_devolucao_ambiguo", "rastreio", "outro_suporte"];
/** Moveria para a linha SUPORTE: triagem de suporte ou agente escalou para humano. */
export const shouldRouteSupport = (c: TriageCategory, escalated: boolean) => escalated || SUPPORT_CATEGORIES.includes(c);
export const triageIgnores = (c: TriageCategory) => c === "venda" || c === "nada";

const TRIAGE_SCHEMA = jsonSchema<Triage>({
  type: "object", additionalProperties: false,
  required: ["categoria", "confianca", "justificativa", "motivo_tamanho", "facts"],
  properties: {
    categoria: { type: "string", enum: [...TRIAGE_CATEGORIES] },
    confianca: { type: "number", description: "0 a 1" },
    justificativa: { type: "string", description: "uma frase curta" },
    motivo_tamanho: { type: "boolean", description: "a cliente cita tamanho/numeração/modelo/ficou pequeno ou grande" },
    facts: { type: "object", additionalProperties: false, required: ["originality", "danger", "selected_ref", "insisted_return", "exchange_offer_made", "same_subject_instance", "confirmed_product"], properties: {
      originality: { type: "boolean", description: "alegação ou suspeita de falsificado, réplica ou não original" },
      danger: { type: "boolean", description: "defeito/avaria, irritação, Procon/Reclame Aqui, pedido de estorno/valor/dinheiro ou assunto não entendido. Simples pedido de devolução não é estorno financeiro" },
      selected_ref: { type: ["string", "null"], description: "P1/P2 se cliente identificou inequivocamente o pedido; null se não" },
      insisted_return: { type: "boolean", description: "insistiu na devolução depois de oferta humana de troca com link no histórico" },
      exchange_offer_made: { type: "boolean", description: "já houve oferta de troca pela loja nesse mesmo assunto, em qualquer número; não repetir oferta" },
      same_subject_instance: { type: ["string", "null"], description: "id da OUTRA instância onde HUMANO respondeu nas últimas 72h SOBRE O MESMO assunto de suporte; não inferir por saudação ou venda diferente" },
      confirmed_product: { type: ["string", "null"], description: "nome exato do produto que a cliente confirmou explicitamente após a pergunta de identificação por CPF; null antes da confirmação" },
    } },
  },
});

const TRIAGE_INSTRUCTIONS = `Você classifica conversas de WhatsApp de uma loja de calçados. Não responda à cliente.
Leia as últimas mensagens (a mais recente é a última) e o contexto de pedidos e escolha UMA categoria:
- venda: quer comprar, preço, estoque para comprar, pagamento de compra nova.
- troca: pede explicitamente troca ou outro tamanho/modelo/cor.
- devolucao: pede explicitamente devolução/devolver, inclusive por tamanho; a oferta de troca é feita pelo agente, não altere a intenção original.
- troca_ou_devolucao_ambiguo: fala em trocar/devolver sem dar para saber qual.
- rastreio: cadê meu pedido, código/link de rastreio, não chegou, quando chega, status da entrega.
- outro_suporte: extravio, defeito, avaria, pagamento de pedido já feito, reclamação.
- nada: saudação, agradecimento, assunto sem relação.
Considere o histórico unificado e marque fatos do assunto ATUAL, não reclamações antigas já resolvidas. Indique outra instância só se uma pessoa respondeu sobre esse mesmo assunto nas últimas 72h; mensagens automáticas não contam.
Seja conservador: na dúvida entre troca e devolução use troca_ou_devolucao_ambiguo.`;

export type GatewayConfig = { apiKey: string; baseURL: string; timeoutMs: number; guardedFetch?: typeof fetch };
export type CallLog = { kind: "triagem" | "agente"; model: string; ok: boolean; error?: string; ms: number; inTok?: number; outTok?: number };

function provider(cfg: GatewayConfig) {
  const run = createLovableAiGatewayRunIdFetch();
  return createOpenAI({
    baseURL: `${cfg.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`,
    apiKey: cfg.apiKey,
    headers: { "Lovable-API-Key": cfg.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: cfg.guardedFetch ? ((input, init) => cfg.guardedFetch ? cfg.guardedFetch(input, init) : run.fetch(input, init)) : run.fetch,
  });
}
const reasoningOpts = { store: false, forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] };

async function usage(result: any) {
  try { const u = await result.totalUsage; return { inTok: u?.inputTokens, outTok: u?.outputTokens }; } catch { return {}; }
}

export async function runTriage(cfg: GatewayConfig, model: string, conv: ConvMessage[], orders: OrderCtx[], log: (c: CallLog) => void): Promise<Triage> {
  const t0 = Date.now();
  try {
    const result = streamText({
      model: provider(cfg).responses(model),
      instructions: TRIAGE_INSTRUCTIONS,
      messages: [{ role: "user", content: `PEDIDOS (60 dias):\n${JSON.stringify(orders)}\n\nCONVERSA:\n${transcript(conv)}` }],
      output: Output.object({ schema: TRIAGE_SCHEMA }),
      ...(cfg.guardedFetch ? { maxRetries: 0 } : {}),
      abortSignal: AbortSignal.timeout(cfg.timeoutMs),
      providerOptions: { openai: reasoningOpts as any },
    });
    const out = (await result.output) as Triage;
    if (!out || !TRIAGE_CATEGORIES.includes(out.categoria)) throw new Error("triagem_vazia");
    log({ kind: "triagem", model, ok: true, ms: Date.now() - t0, ...(await usage(result)) });
    return { ...out, confianca: Math.max(0, Math.min(1, Number(out.confianca) || 0)), justificativa: String(out.justificativa || "").slice(0, 300) };
  } catch (e) {
    log({ kind: "triagem", model, ok: false, error: String((e as Error)?.message || e).slice(0, 400), ms: Date.now() - t0 });
    throw e;
  }
}

/** Ferramentas: o servidor implementa e valida. */
/** Rastreio do pedido. url = página pública de rastreio (a mesma enviada na confirmação). */
export type TrackingInfo = {
  url: string | null; etapa: "em_separacao" | "separado" | "enviado" | "entregue" | "sem_envio";
  enviado_em: string | null; entregue_em: string | null; ocorrencia: boolean; dias_desde_envio: number | null;
  ultimo_evento?: string | null;
};
/** Atraso grande: enviado há mais de 15 dias sem entrega. */
export const TRACKING_LATE_DAYS = 15;
export function trackingNeedsHuman(t: TrackingInfo): string | null {
  if (t.ocorrencia) return "ocorrencia_na_entrega";
  if (t.etapa !== "sem_envio" && t.etapa !== "entregue" && !t.url) return "sem_rastreio";
  if (t.etapa === "enviado" && (t.dias_desde_envio ?? 0) > TRACKING_LATE_DAYS) return "atraso_grande";
  return null;
}
export type AgentDeps = {
  orders: OrderCtx[];
  tracking?: (ref: string) => Promise<TrackingInfo | null>;
  checkEligibility: (ref: string, tipo: "troca" | "devolucao") => Promise<{ elegivel: string; motivo: string; prazo_ate: string | null }>;
  sizesInStock: (ref: string, item: string) => Promise<{ tamanhos: string[] } | { erro: string }>;
  offersAlreadyMade: number;
  maxOffers: number;
  consolidation?: { id: string; label: string } | null;
  publicComment?: boolean;
  supportPhone?: string | null;
  now?: number;
  shippedAt?: (ref: string) => Promise<string | null>;
  cpfLookup?: () => Promise<{ found?: boolean; error?: string; first_name?: string; product?: string; month?: string; confirmed?: boolean; different_phone?: boolean }>;
};
export type AgentAction = { acao: string; pedido: Record<string, unknown>; resultado: unknown };
export type AgentOutcome = {
  text: string; actions: AgentAction[];
  link: { ref: string; tipo: "troca" | "devolucao" } | null;
  handoff: { motivo: string; resumo: string } | null;
  exchangeOffered: boolean;
  tracking: { ref: string; info: TrackingInfo } | null;
  consolidation?: { id: string; label: string } | null;
  cpfDifferentPhone?: boolean;
  resolved?: boolean;
  prazoPorEnvio?: boolean;
  publicComment?: boolean;
};

export async function runAgent(cfg: GatewayConfig, model: string, script: string, nome: string | null, triage: Triage,
  conv: ConvMessage[], deps: AgentDeps, log: (c: CallLog) => void): Promise<AgentOutcome> {
  const actions: AgentAction[] = [];
  const out: AgentOutcome = { text: "", actions, link: null, handoff: null, exchangeOffered: false, tracking: null };
  const rec = (acao: string, pedido: Record<string, unknown>, resultado: unknown) => { actions.push({ acao, pedido, resultado }); return resultado; };
  const refOk = (ref: string) => deps.orders.find((o) => o.ref === ref);
  const tipoSchema = { type: "string", enum: ["troca", "devolucao"] };

  const now = deps.now ?? Date.now();
  // Escalar em silêncio: vai para a linha SUPORTE com resumo; texto à cliente só se ela espera há >30 min e houver algo útil.
  const handoff = (motivo: string, resumo: string): AgentOutcome => ({ ...out, text: silentHandoffText(motivo, waitingMinutes(conv, now), nome), handoff: { motivo, resumo } });
  if (alreadyResolved(conv)) return { ...out, resolved: true };
  if (deps.publicComment) return { ...out, publicComment: true, text: publicCommentReply(nome, deps.supportPhone ?? null), handoff: { motivo: "comentario_publico", resumo: triage.justificativa } };
  if (deps.consolidation) return { ...out, text: CONSOLIDATION_TEXT, consolidation: deps.consolidation };
  if (triage.facts?.danger) return handoff("situacao_sensivel", triage.justificativa);
  if (!deps.orders.length && deps.cpfLookup) {
    if (!cpfRequestAllowed(triage.categoria, conv, false)) return handoff("pedido_nao_localizado", triage.justificativa);
    const candidate = await deps.cpfLookup();
    rec("buscar_pedido_por_cpf", {}, candidate);
    if (!candidate.found) return candidate.error ? handoff(candidate.error, "CPF não confirmou identidade/pedido") : { ...out, text: `${nome ? `${nome}, ` : ""}não achei sua compra por este número 😕 Pode me passar o CPF de quem fez a compra?` };
    if (!candidate.confirmed) return { ...out, text: `Encontrei um pedido no nome de ${candidate.first_name}. É o do ${candidate.product} comprado em ${candidate.month}?` };
    out.cpfDifferentPhone = candidate.different_phone;
  }
  const selected = deps.orders.length === 1 ? deps.orders[0] : deps.orders.find(o => o.ref === triage.facts?.selected_ref);
  if (deps.orders.length > 1 && !selected) return handoff("varios_pedidos_sem_identificacao", triage.justificativa);
  const wanted = preferredLink(triage.categoria, triage.facts ?? {}, deps.offersAlreadyMade);
  if (selected?.canal === "online" && wanted) {
    const eligibility = await deps.checkEligibility(selected.ref, wanted);
    rec("checar_elegibilidade", { pedido: selected.ref, tipo: wanted }, eligibility);
    if (eligibility.elegivel !== "eligible") {
      // Sem data de entrega: a entrega é sempre depois do envio, então envio + 7 dias está garantidamente no prazo.
      const shipped = eligibility.motivo === "sem_data_de_entrega" && deps.shippedAt ? await deps.shippedAt(selected.ref) : null;
      if (!withinWindowByShipping(shipped, now)) return handoff(eligibility.motivo, triage.justificativa);
      out.prazoPorEnvio = true;
      rec("prazo_pela_data_de_envio", { pedido: selected.ref }, { enviado_em: shipped, garantido: true });
    }
    out.link = { ref: selected.ref, tipo: wanted };
    out.exchangeOffered = triage.categoria === "devolucao" && wanted === "troca";
    rec("preparar_link", { pedido: selected.ref, tipo: wanted }, { ok: true });
    out.text = linkText(wanted, nome, !!triage.facts?.originality, out.exchangeOffered);
    return out;
  }

  const tools = {
    buscar_pedido_por_cpf: tool({
      description: "Consulta o CPF detectado pelo servidor na conversa, sem receber nem revelar os dígitos. Antes de confirmar identidade devolve apenas primeiro nome, produto e mês.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", additionalProperties: false, properties: {}, required: [] }),
      execute: async () => rec("buscar_pedido_por_cpf", {}, deps.cpfLookup ? await deps.cpfLookup() : { error: "indisponivel" }),
    }),
    buscar_pedidos: tool({
      description: "Lista os pedidos da cliente dos últimos 60 dias (encontrados pelo telefone da conversa).",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", additionalProperties: false, properties: {}, required: [] }),
      execute: async () => rec("buscar_pedidos", {}, deps.orders),
    }),
    checar_elegibilidade: tool({
      description: "Confere se um pedido está no prazo para troca ou devolução.",
      inputSchema: jsonSchema<{ pedido: string; tipo: "troca" | "devolucao" }>({ type: "object", additionalProperties: false, required: ["pedido", "tipo"], properties: { pedido: { type: "string" }, tipo: tipoSchema } }),
      execute: async ({ pedido, tipo }) => {
        if (!refOk(pedido)) return rec("checar_elegibilidade", { pedido, tipo }, { erro: "pedido_inexistente" });
        return rec("checar_elegibilidade", { pedido, tipo }, await deps.checkEligibility(pedido, tipo));
      },
    }),
    consultar_numeracoes: tool({
      description: "Numerações com estoque do mesmo produto de um item do pedido.",
      inputSchema: jsonSchema<{ pedido: string; item: string }>({ type: "object", additionalProperties: false, required: ["pedido", "item"], properties: { pedido: { type: "string" }, item: { type: "string", description: "código do item, ex.: I1" } } }),
      execute: async ({ pedido, item }) => rec("consultar_numeracoes", { pedido, item }, refOk(pedido) ? await deps.sizesInStock(pedido, item) : { erro: "pedido_inexistente" }),
    }),
    registrar_oferta_troca: tool({
      description: "Chame ANTES de oferecer a troca. Se voltar permitido=false, não ofereça de novo: siga com a devolução.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", additionalProperties: false, properties: {}, required: [] }),
      execute: async () => {
        const permitido = deps.offersAlreadyMade < deps.maxOffers && !out.exchangeOffered;
        if (permitido) out.exchangeOffered = true;
        return rec("registrar_oferta_troca", {}, { permitido, ofertas_feitas: deps.offersAlreadyMade });
      },
    }),
    preparar_link: tool({
      description: "Prepara o link da Central para a cliente registrar a troca ou devolução. Só funciona para pedido online elegível.",
      inputSchema: jsonSchema<{ pedido: string; tipo: "troca" | "devolucao" }>({ type: "object", additionalProperties: false, required: ["pedido", "tipo"], properties: { pedido: { type: "string" }, tipo: tipoSchema } }),
      execute: async ({ pedido, tipo }) => {
        const o = refOk(pedido);
        if (!o) return rec("preparar_link", { pedido, tipo }, { ok: false, motivo: "pedido_inexistente" });
        if (o.canal !== "online") return rec("preparar_link", { pedido, tipo }, { ok: false, motivo: "compra_na_loja_troca_presencial" });
        if (out.link) return rec("preparar_link", { pedido, tipo }, { ok: false, motivo: "link_ja_preparado" });
        const el = await deps.checkEligibility(pedido, tipo);
        if (el.elegivel !== "eligible") return rec("preparar_link", { pedido, tipo }, { ok: false, motivo: el.motivo, instrucao: "escale para humano" });
        out.link = { ref: pedido, tipo };
        return rec("preparar_link", { pedido, tipo }, { ok: true, escreva_no_texto: "{{link}}" });
      },
    }),
    consultar_rastreio: tool({
      description: "Rastreio de um pedido ONLINE: etapa da expedição, data de envio e link de rastreio. Se a cliente tiver vários pedidos online e não disse qual, pergunte antes.",
      inputSchema: jsonSchema<{ pedido: string }>({ type: "object", additionalProperties: false, required: ["pedido"], properties: { pedido: { type: "string" } } }),
      execute: async ({ pedido }) => {
        const o = refOk(pedido);
        if (!o) return rec("consultar_rastreio", { pedido }, { erro: "pedido_inexistente" });
        if (o.canal !== "online") return rec("consultar_rastreio", { pedido }, { erro: "compra_na_loja_sem_envio" });
        const info = deps.tracking ? await deps.tracking(pedido) : null;
        if (!info) return rec("consultar_rastreio", { pedido }, { erro: "sem_dados_de_envio", instrucao: "escale para humano" });
        out.tracking = { ref: pedido, info };
        const humano = trackingNeedsHuman(info);
        const { url: _u, ...semUrl } = info;
        return rec("consultar_rastreio", { pedido }, {
          ...semUrl, tem_link: !!info.url,
          ...(info.url ? { escreva_no_texto: "{{rastreio}}" } : {}),
          ...(humano ? { instrucao: `escale para humano (${humano})` } : {}),
          regra: "não invente prazo de entrega; diga só a etapa e a data de envio",
        });
      },
    }),
    escalar_humano: tool({
      description: "Passa a conversa para uma pessoa da equipe, com um resumo curto.",
      inputSchema: jsonSchema<{ motivo: string; resumo: string }>({ type: "object", additionalProperties: false, required: ["motivo", "resumo"], properties: { motivo: { type: "string" }, resumo: { type: "string" } } }),
      execute: async ({ motivo, resumo }) => { out.handoff = { motivo: motivo.slice(0, 120), resumo: resumo.slice(0, 500) }; return rec("escalar_humano", { motivo }, { ok: true }); },
    }),
  };

  const instructions = `${script}

CONTEXTO DO SISTEMA (não invente nada além disso):
- Primeiro nome da cliente: ${nome ?? "desconhecido (não use nome)"}
- Triagem: ${triage.categoria} (confiança ${triage.confianca.toFixed(2)}; motivo de tamanho: ${triage.motivo_tamanho ? "sim" : "não"})
- Ofertas de troca já feitas nesta conversa: ${deps.offersAlreadyMade} de no máximo ${deps.maxOffers}
- Rastreio (cadê meu pedido, não chegou, quando chega): use consultar_rastreio e escreva {{rastreio}} onde vai o link; resposta curta. Sem envio ainda: diga a etapa, sem inventar prazo. Vários pedidos online e ela não disse qual: pergunte qual. Sem rastreio, atraso grande ou extravio: escale para humano.
- Use as ferramentas para pedidos, prazos e numerações. Os pedidos se chamam P1, P2…; itens I1, I2…
- Responda apenas com a próxima mensagem para a cliente, em português. Chame pelo primeiro nome, frase calorosa e curta, terminando com uma pergunta quando fizer sentido. Se escalar para humano, não escreva nada para a cliente (o sistema decide).`;

  const t0 = Date.now();
  try {
    const result = streamText({
      model: provider(cfg).responses(model),
      instructions,
      messages: [{ role: "user", content: `CONVERSA (a última linha é a mais recente):\n${transcript(conv)}` }],
      tools,
      ...(cfg.guardedFetch ? { maxRetries: 0 } : {}),
      stopWhen: stepCountIs(6),
      abortSignal: AbortSignal.timeout(cfg.timeoutMs),
      providerOptions: { openai: reasoningOpts as any },
    });
    out.text = (await result.text).trim().slice(0, 1000);
    log({ kind: "agente", model, ok: true, ms: Date.now() - t0, ...(await usage(result)) });
    if (out.handoff) { out.text = silentHandoffText(out.handoff.motivo, waitingMinutes(conv, now), nome); return out; }
    // Sem texto e sem ferramenta: trata como escalada silenciosa (nunca resposta vazia para a cliente).
    if (!out.text) { out.handoff = { motivo: "ia_sem_resposta", resumo: triage.justificativa }; return out; }
    if (out.link && !out.text.includes("{{link}}")) out.text += "\n{{link}}";
    if (!out.link) out.text = out.text.replaceAll("{{link}}", "").trim();
    // O link de rastreio é colocado pelo sistema, nunca digitado pela IA.
    const trackUrl = out.tracking?.info.url;
    out.text = trackUrl ? out.text.replaceAll("{{rastreio}}", trackUrl) : out.text.replaceAll("{{rastreio}}", "").trim();
    return out;
  } catch (e) {
    log({ kind: "agente", model, ok: false, error: String((e as Error)?.message || e).slice(0, 400), ms: Date.now() - t0 });
    throw e;
  }
}

/** Decisão final é do sistema, a partir das ações validadas. */
export function finalDecision(o: Pick<AgentOutcome, "link" | "handoff"> & { tracking?: AgentOutcome["tracking"]; consolidation?: AgentOutcome["consolidation"]; resolved?: boolean; prazoPorEnvio?: boolean }, orders: OrderCtx[]): { decision: string; reason: string } {
  if (o.resolved) return { decision: "nada", reason: "caso_ja_resolvido" };
  if (o.consolidation) return { decision: "consolidar_em_outra_instancia", reason: "atendimento_humano_mesmo_assunto:" + o.consolidation.id };
  if (o.handoff) return { decision: "fila", reason: "ia_escalou:" + o.handoff.motivo };
  if (o.link) return { decision: "enviar_link", reason: o.prazoPorEnvio ? "prazo_garantido_pela_data_de_envio" : "um_pedido_elegivel" };
  if (o.tracking) {
    const h = trackingNeedsHuman(o.tracking.info);
    if (h) return { decision: "fila", reason: "rastreio:" + h };
    return { decision: "conversa", reason: "rastreio_" + o.tracking.info.etapa };
  }
  if (orders.length && orders.every((x) => x.canal === "loja")) return { decision: "presencial", reason: "compra_na_loja" };
  return { decision: "conversa", reason: "ia_conversando" };
}

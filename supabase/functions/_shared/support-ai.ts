// Fase 4b — triagem e agente de suporte por IA (modo sombra).
// A IA só sugere texto e pede ações por ferramenta; quem decide e valida é o servidor.
import { createOpenAI } from "npm:@ai-sdk/openai@4";
import { jsonSchema, Output, stepCountIs, streamText, tool } from "npm:ai@7";
import { createLovableAiGatewayRunIdFetch } from "./run-id.ts";

export const TRIAGE_CATEGORIES = ["venda", "troca", "devolucao", "troca_ou_devolucao_ambiguo", "outro_suporte", "nada"] as const;
export type TriageCategory = typeof TRIAGE_CATEGORIES[number];
export type Triage = { categoria: TriageCategory; confianca: number; justificativa: string; motivo_tamanho: boolean };

export type ConvMessage = { from: "cliente" | "loja"; text: string; at: string };
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
  return msgs.map((m) => `${m.from === "cliente" ? "CLIENTE" : "LOJA"}: ${sanitizeText(m.text)}`).join("\n");
}

/** Mapeia a triagem para a intenção antiga (contador por tipo e compatibilidade). */
export function triageToIntent(c: TriageCategory): "troca" | "devolucao" | "indefinido" {
  return c === "troca" ? "troca" : c === "devolucao" ? "devolucao" : "indefinido";
}
export const triageIgnores = (c: TriageCategory) => c === "venda" || c === "nada";

const TRIAGE_SCHEMA = jsonSchema<Triage>({
  type: "object", additionalProperties: false,
  required: ["categoria", "confianca", "justificativa", "motivo_tamanho"],
  properties: {
    categoria: { type: "string", enum: [...TRIAGE_CATEGORIES] },
    confianca: { type: "number", description: "0 a 1" },
    justificativa: { type: "string", description: "uma frase curta" },
    motivo_tamanho: { type: "boolean", description: "a cliente cita tamanho/numeração/modelo/ficou pequeno ou grande" },
  },
});

const TRIAGE_INSTRUCTIONS = `Você classifica conversas de WhatsApp de uma loja de calçados. Não responda à cliente.
Leia as últimas mensagens (a mais recente é a última) e o contexto de pedidos e escolha UMA categoria:
- venda: quer comprar, preço, estoque para comprar, pagamento de compra nova.
- troca: quer outro tamanho/modelo/cor, ou diz "devolver" mas o motivo é tamanho/numeração (isso é troca).
- devolucao: quer o dinheiro de volta / devolver sem motivo de tamanho, ou insiste em devolver depois de oferecida a troca.
- troca_ou_devolucao_ambiguo: fala em trocar/devolver sem dar para saber qual.
- outro_suporte: rastreio, atraso, defeito, avaria, pagamento de pedido já feito, reclamação.
- nada: saudação, agradecimento, assunto sem relação.
Seja conservador: na dúvida entre troca e devolução use troca_ou_devolucao_ambiguo.`;

export type GatewayConfig = { apiKey: string; baseURL: string; timeoutMs: number };
export type CallLog = { kind: "triagem" | "agente"; model: string; ok: boolean; error?: string; ms: number; inTok?: number; outTok?: number };

function provider(cfg: GatewayConfig) {
  const run = createLovableAiGatewayRunIdFetch();
  return createOpenAI({
    baseURL: `${cfg.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`,
    apiKey: cfg.apiKey,
    headers: { "Lovable-API-Key": cfg.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: run.fetch,
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
export type AgentDeps = {
  orders: OrderCtx[];
  checkEligibility: (ref: string, tipo: "troca" | "devolucao") => Promise<{ elegivel: string; motivo: string; prazo_ate: string | null }>;
  sizesInStock: (ref: string, item: string) => Promise<{ tamanhos: string[] } | { erro: string }>;
  offersAlreadyMade: number;
  maxOffers: number;
};
export type AgentAction = { acao: string; pedido: Record<string, unknown>; resultado: unknown };
export type AgentOutcome = {
  text: string; actions: AgentAction[];
  link: { ref: string; tipo: "troca" | "devolucao" } | null;
  handoff: { motivo: string; resumo: string } | null;
  exchangeOffered: boolean;
};

export async function runAgent(cfg: GatewayConfig, model: string, script: string, nome: string | null, triage: Triage,
  conv: ConvMessage[], deps: AgentDeps, log: (c: CallLog) => void): Promise<AgentOutcome> {
  const actions: AgentAction[] = [];
  const out: AgentOutcome = { text: "", actions, link: null, handoff: null, exchangeOffered: false };
  const rec = (acao: string, pedido: Record<string, unknown>, resultado: unknown) => { actions.push({ acao, pedido, resultado }); return resultado; };
  const refOk = (ref: string) => deps.orders.find((o) => o.ref === ref);
  const tipoSchema = { type: "string", enum: ["troca", "devolucao"] };

  const tools = {
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
- Use as ferramentas para pedidos, prazos e numerações. Os pedidos se chamam P1, P2…; itens I1, I2…
- Responda apenas com a próxima mensagem para a cliente, em português. Se escalar para humano, escreva uma mensagem curta avisando que uma pessoa da equipe vai continuar.`;

  const t0 = Date.now();
  try {
    const result = streamText({
      model: provider(cfg).responses(model),
      instructions,
      messages: [{ role: "user", content: `CONVERSA (a última linha é a mais recente):\n${transcript(conv)}` }],
      tools,
      stopWhen: stepCountIs(6),
      abortSignal: AbortSignal.timeout(cfg.timeoutMs),
      providerOptions: { openai: reasoningOpts as any },
    });
    out.text = (await result.text).trim().slice(0, 1000);
    log({ kind: "agente", model, ok: true, ms: Date.now() - t0, ...(await usage(result)) });
    if (!out.text) throw new Error("resposta_vazia");
    if (out.link && !out.text.includes("{{link}}")) out.text += "\n{{link}}";
    if (!out.link) out.text = out.text.replaceAll("{{link}}", "").trim();
    return out;
  } catch (e) {
    log({ kind: "agente", model, ok: false, error: String((e as Error)?.message || e).slice(0, 400), ms: Date.now() - t0 });
    throw e;
  }
}

/** Decisão final é do sistema, a partir das ações validadas. */
export function finalDecision(o: Pick<AgentOutcome, "link" | "handoff">, orders: OrderCtx[]): { decision: string; reason: string } {
  if (o.handoff) return { decision: "fila", reason: "ia_escalou:" + o.handoff.motivo };
  if (o.link) return { decision: "enviar_link", reason: "um_pedido_elegivel" };
  if (orders.length && orders.every((x) => x.canal === "loja")) return { decision: "presencial", reason: "compra_na_loja" };
  return { decision: "conversa", reason: "ia_conversando" };
}

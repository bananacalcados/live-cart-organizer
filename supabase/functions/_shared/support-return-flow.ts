import type { ConvMessage } from "./support-ai.ts";
import { linkText } from "./support-policy.ts";

export const RETURN_FLOW_STATES = ["motivo_perguntado", "troca_oferecida", "troca_aceita", "devolucao_confirmada"] as const;
export type ReturnFlowState = typeof RETURN_FLOW_STATES[number];
export type ReturnFlowContext = {
  state: ReturnFlowState;
  reason?: string | null;
  pendingLink?: "troca" | "devolucao" | null;
};
export type ReturnReason = "originalidade" | "tamanho" | "modelo_cor" | "nao_gostou" | "outro" | null;
export type ReturnFlowDecision =
  | { kind: "text"; text: string; state: ReturnFlowState; reason: string | null }
  | { kind: "link"; linkType: "troca" | "devolucao"; text: string; state: ReturnFlowState; reason: string | null }
  | { kind: "handoff"; motive: string };

const normal = (value: string) => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function currentCustomerText(conv: ConvMessage[]): string {
  const tail: string[] = [];
  for (let i = conv.length - 1; i >= 0 && conv[i].from === "cliente"; i--) tail.unshift(conv[i].text);
  return tail.join(" ").trim();
}

export function hasOriginalityClaim(text: string): boolean {
  const s = normal(text);
  return /\b(falsificad\w*|replic\w*|pirat\w*|fake|imita\w*|copia\w*)/.test(s)
    || /\b(nao|nunca)\b.{0,20}\b(original|autentic[ao])\b/.test(s)
    || /\b(original|autentic[ao])\b.{0,15}\b(nao|nunca)\b/.test(s);
}

export function returnReason(text: string, allowGenericOther = false): ReturnReason {
  if (hasOriginalityClaim(text)) return "originalidade";
  const s = normal(text);
  if (/\b(tamanho|numeracao|numero|apertad\w*|pequen\w*|curto|justo|grande|folgad\w*|largo|sobrando|forma maior|forma menor|calc[ao])\b/.test(s)) return "tamanho";
  if (/\b(modelo|cor|colorid|estilo|desenho|outro tenis|outro sapato)\b/.test(s)) return "modelo_cor";
  if (/\b(nao gostei|nao gostou|arrepend|nao quero mais|desisti|nao serviu|nao me agradou|chateada)\b/.test(s)) return "nao_gostou";
  if (/\b(feio|feia|diferente|errado|errada|caro|cara|preco|vestir|experimentar|nao sei|acabamento|qualidade|confort|desconfort|nao era|esperava)\b/.test(s)) return "outro";
  const generic = /\b(devolver|devolucao|reembolso|dinheiro de volta|procedimento|como faco|como fazer|como|devo|faco|fazer|para|porque|quero|preciso|recebi|pedido|compra|tenis|sapato|meu|minha|me|o|a|do|da|mas|por favor|por|favor|gente|podem|pode|auxiliar|ajuda|oi|ola|bom dia|boa tarde|boa noite)\b/g;
  const rest = s.replace(generic, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return allowGenericOther && rest.length >= 3 ? "outro" : null;
}

export function isReceiptDateAnswer(text: string): boolean {
  const s = normal(text);
  return /\b(recebi|chegou|entregue)\b/.test(s) && (/\b\d{1,2}([/.\\-]\d{1,2}){1,2}\b/.test(s) || /\b(hoje|ontem|dia)\b/.test(s));
}

export function returnTextNeedsHuman(text: string): boolean {
  return /\b(defeito|avaria|danificad\w*|quebrad\w*|descol\w*|rasgad\w*|procon|reclame aqui)/i.test(normal(text));
}

export function acceptsExchange(text: string): boolean {
  const s = normal(text);
  if (/\b(nao|nunca|nem)\b/.test(s) || /\bdevol|reembolso|dinheiro/.test(s)) return false;
  return /\b(aceito|quero trocar|quero a troca|prefiro trocar|pode trocar|pode fazer|faz a troca|faca a troca|vamos trocar|troca sim|sim|isso|combinado|ok|okay|ta bom|pode ser)\b/.test(s);
}

export function insistsOnReturn(text: string): boolean {
  const s = normal(text);
  return /\b(quero|prefiro|vou|preciso)\b.{0,30}\b(devolver|devolucao|reembolso|dinheiro)\b/.test(s)
    || /\bdevol(ucao|ver)\b.{0,20}\b(mesmo|sim)\b/.test(s)
    || /\b(nao|nem)\b.{0,35}\b(troca|trocar|outro modelo|outro tenis)\b.{0,45}\b(devol|reembolso|dinheiro)?/.test(s)
    || /\bquero meu dinheiro\b/.test(s);
}

const offerText = (reason: Exclude<ReturnReason, "originalidade" | null>, nome: string | null) => {
  const n = nome ? `, ${nome}` : "";
  if (reason === "tamanho") return `Entendi${n}. Se foi só o tamanho, posso trocar pela numeração que servir melhor, sem complicação. Quer que eu faça a troca pra você?`;
  if (reason === "modelo_cor") return `Entendi${n}. Se o modelo ou a cor não foi o que você esperava, posso verificar uma troca por outra opção. Quer que eu faça a troca pra você?`;
  if (reason === "nao_gostou") return `Entendi${n}. Posso oferecer uma troca por outro modelo que combine mais com você. Quer que eu faça a troca pra você?`;
  return `Entendi${n}. Posso verificar uma troca para encontrarmos uma opção melhor pra você. Quer que eu faça a troca pra você?`;
};

/** Regra determinística: uma etapa por mensagem; link só após originalidade, aceite ou insistência. */
export function resolveReturnFlow(input: {
  category: string;
  text: string;
  nome: string | null;
  flow?: ReturnFlowContext | null;
  offersAlreadyMade: number;
  maxOffers: number;
  originality?: boolean;
}): ReturnFlowDecision | null {
  const { category, text, nome, flow } = input;
  const active = flow?.state === "motivo_perguntado" || flow?.state === "troca_oferecida" || !!flow?.pendingLink;
  if (!active && category !== "devolucao") return null;
  if (flow?.pendingLink) {
    const type = flow.pendingLink;
    return { kind: "link", linkType: type, state: type === "troca" ? "troca_aceita" : "devolucao_confirmada", reason: flow.reason ?? null,
      text: linkText(type, nome, flow.reason === "originalidade", false) };
  }
  if (returnTextNeedsHuman(text)) return { kind: "handoff", motive: "defeito_ou_situacao_sensivel" };
  if (input.originality || hasOriginalityClaim(text)) return { kind: "link", linkType: "devolucao", state: "devolucao_confirmada", reason: "originalidade", text: linkText("devolucao", nome, true, false) };

  if (flow && isReceiptDateAnswer(text)) {
    if (flow.state === "motivo_perguntado") {
      const n = nome ? `, ${nome}` : "";
      return { kind: "text", state: "motivo_perguntado", reason: null, text: `Entendi${n}. Me conta rapidinho o motivo da devolução, pra eu te ajudar da melhor forma?` };
    }
    if (flow.state === "troca_oferecida") {
      const reason = flow.reason === "tamanho" || flow.reason === "modelo_cor" || flow.reason === "nao_gostou" ? flow.reason : "outro";
      return { kind: "text", state: "troca_oferecida", reason, text: offerText(reason, nome) };
    }
  }

  if (flow?.state === "troca_oferecida") {
    if (acceptsExchange(text)) return { kind: "link", linkType: "troca", state: "troca_aceita", reason: flow.reason ?? null, text: linkText("troca", nome, false, false) };
    if (insistsOnReturn(text)) return { kind: "link", linkType: "devolucao", state: "devolucao_confirmada", reason: flow.reason ?? null, text: linkText("devolucao", nome, false, false) };
    return { kind: "handoff", motive: "resposta_da_oferta_nao_entendida" };
  }

  if (flow?.state === "motivo_perguntado" && (acceptsExchange(text) || (category === "troca" && !returnReason(text)))) {
    return { kind: "link", linkType: "troca", state: "troca_aceita", reason: flow.reason ?? null, text: linkText("troca", nome, false, false) };
  }

  const reason = returnReason(text, flow?.state === "motivo_perguntado");
  if (!reason) {
    const n = nome ? `, ${nome}` : "";
    return { kind: "text", state: "motivo_perguntado", reason: null,
      text: `Entendi${n}. Me conta rapidinho o motivo da devolução, pra eu te ajudar da melhor forma?` };
  }
  if (reason === "originalidade") {
    return { kind: "link", linkType: "devolucao", state: "devolucao_confirmada", reason, text: linkText("devolucao", nome, true, false) };
  }
  if (insistsOnReturn(text) && (flow || input.offersAlreadyMade >= input.maxOffers)) {
    return { kind: "link", linkType: "devolucao", state: "devolucao_confirmada", reason, text: linkText("devolucao", nome, false, false) };
  }
  if (input.offersAlreadyMade >= input.maxOffers && !flow) {
    return { kind: "link", linkType: "devolucao", state: "devolucao_confirmada", reason, text: linkText("devolucao", nome, false, false) };
  }
  return { kind: "text", state: "troca_oferecida", reason, text: offerText(reason, nome) };
}

export function returnFlowContinuation(flow: ReturnFlowContext | null | undefined): boolean {
  return !!flow && (flow.state === "motivo_perguntado" || flow.state === "troca_oferecida" || !!flow.pendingLink);
}

export type UnifiedMessage = { from: "cliente" | "loja"; text: string; at: string; instance_id?: string | null; instance?: string; human?: boolean };
export const CONSOLIDATION_TEXT = "Vi que você já está conversando com a gente no nosso outro número sobre esse assunto, correto? Para facilitar, vamos manter seu atendimento só por lá e finalizar a conversa neste número, tá bom?";
export function unifyMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  const unique = new Map<string, UnifiedMessage>();
  for (const m of messages) unique.set(`${m.instance_id}:${m.at}:${m.from}:${m.text}`, m);
  return [...unique.values()].sort((a, b) => a.at.localeCompare(b.at));
}
export function humanOtherInstances(messages: UnifiedMessage[], current: string | null, now: number) {
  return [...new Set(messages.filter(m => m.human && m.from === "loja" && m.instance_id && m.instance_id !== current && now - Date.parse(m.at) <= 72 * 3600000 && Date.parse(m.at) <= now).map(m => m.instance_id))];
}
export function validCpf(value: string): boolean {
  const n = value.replace(/\D/g, "");
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false;
  for (let len = 9; len <= 10; len++) {
    const sum = [...n.slice(0, len)].reduce((a, d, i) => a + Number(d) * (len + 1 - i), 0);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(n[len])) return false;
  }
  return true;
}
export const maskCpf = (n: string) => `***.***.***-${n.replace(/\D/g, "").slice(-2)}`;
export const cpfAttemptAllowed = (count: number) => count < 2;
const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function cpfIdentityConfirmed(conversationName: string | null, candidateName: string | null, product: string, confirmedProduct: string | null): boolean {
  if (conversationName && candidateName && normal(conversationName.split(/\s/)[0]) === normal(candidateName.split(/\s/)[0])) return true;
  return !!confirmedProduct && normal(confirmedProduct) === normal(product);
}
export type SupportFacts = { originality?: boolean; danger?: boolean; selected_ref?: string | null; insisted_return?: boolean; exchange_offer_made?: boolean; same_subject_instance?: string | null; confirmed_product?: string | null };
export function preferredLink(category: string, facts: SupportFacts, offers: number): "troca" | "devolucao" | null {
  if (facts.danger) return null;
  if (category === "troca") return "troca";
  if (category !== "devolucao") return null;
  return facts.originality || facts.insisted_return || facts.exchange_offer_made || offers >= 1 ? "devolucao" : "troca";
}
// ---- Rodada 3 ----
const ACK = /^(\s*(ok+|okay|blz|beleza|certo|certinho|ta bom|tá bom|t[aá]|perfeito|maravilha|show|top|entendi|combinado|valeu|vlw|amem|amém|am[eé]m|gratid[aã]o|(muito )?obrigad[ao]s?( (pela|por)( \S+){0,3})?|brigad[ao]|obg|deus (te |lhe )?(aben[cç]oe|abencoe)|de nada|tudo bem|[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200d\ufe0f]+)\s*[!.,]*\s*)+$/iu;
/** Mensagem só de agradecimento/confirmação/emoji. */
export function isAckOnly(t: string): boolean {
  const s = normal(t || "").replace(/[!.,?]+/g, " ").replace(/\s+/g, " ").trim();
  return !!s && ACK.test(s);
}
/** Confirmação de que a cliente mesma encontrou/recebeu a solução, sem pedido novo. */
export function isResolutionConfirmation(t: string): boolean {
  const s = normal(t || "");
  if (!s || /\?/.test(s) || /\b(nao|não|ainda nao|ainda não)\b.{0,30}\b(achei|encontrei|recebi|consegui)\b/.test(s)) return false;
  return /\b(achei|encontrei|recebi|consegui)\b.{0,45}\b(rastreio|codigo|código|pedido|comprovante|estorno|reembolso)\b/.test(s)
    || /\b(rastreio|pedido|comprovante)\b.{0,35}\b(achei|encontrei|recebi)\b/.test(s)
    || /\b(estou|vou ficar|fico)\b.{0,20}\bacompanhando\b/.test(s) && /\b(obrigad|valeu|gratidao|gratidão)\b/.test(s);
}
/** Só sobra pergunta/pedido se a parte final da cliente trouxer um pedido explícito. */
export function hasPendingCustomerRequest(conv: UnifiedMessage[]): boolean {
  if (alreadyResolved(conv)) return false;
  const tail: UnifiedMessage[] = [];
  for (let i = conv.length - 1; i >= 0 && conv[i].from === "cliente"; i--) tail.unshift(conv[i]);
  if (!tail.length || tail.every(m => isAckOnly(m.text) || isResolutionConfirmation(m.text))) return false;
  const s = normal(tail.map(m => m.text).join(" "));
  return /\?/.test(s) || /\b(quero|preciso|pode|podem|consegue|conseguem|ajuda|ajudar|favor|cade|quando|como|onde|qual|quais|manda|mandar|envia|enviar|reenvia|reenviar|troca|trocar|devolucao|devolver|estorno|estornar|reembolso|reembolsar|nao recebi|nao chegou|nao consegui|nao encontrei|nao achei)\b/.test(s);
}
/** 1) Caso já resolvido: depois da última resposta da loja a cliente só agradece/confirma. */
export function alreadyResolved(conv: UnifiedMessage[]): boolean {
  let i = conv.length - 1; const tail: UnifiedMessage[] = [];
  while (i >= 0 && conv[i].from === "cliente") tail.unshift(conv[i--]);
  if (i < 0 || !tail.length) return false;
  if (conv[i].text.trim().endsWith("?") && !/c[oó]digo|estorno|chegou|resolvid/i.test(conv[i].text)) return false;
  return tail.every(m => isAckOnly(m.text) || isResolutionConfirmation(m.text));
}
/** Pergunta de status/comprovante de estorno; pedido novo de dinheiro de volta continua sensível. */
export function isRefundStatusQuestion(conv: UnifiedMessage[]): boolean {
  const last = [...conv].reverse().find(m => m.from === "cliente");
  const s = normal(last?.text || "");
  if (!/\b(estorno|reembolso|comprovante)\b/.test(s)) return false;
  if (/procon|reclame|defeit|avaria|falsific|replica|quero (o )?(estorno|reembolso)|quero meu dinheiro|quero cancelar/.test(s)) return false;
  return /\?|\b(cade|quando|como|onde|status|comprovante|reenvia|reenviar|manda|mandar|foi feito|ja foi|já foi)\b/.test(s);
}
/** 2) Sem data de entrega: dentro do prazo garantido até envio + 7 dias. */
export function withinWindowByShipping(shippedAt: string | null | undefined, now: number, days = 7): boolean {
  if (!shippedAt) return false;
  const t = Date.parse(shippedAt.length === 10 ? shippedAt + "T23:59:59-03:00" : shippedAt);
  return Number.isFinite(t) && t <= now && now <= t + days * 864e5;
}
/** 3) Escalar em silêncio: mensagem só se a cliente espera há >30 min e a mensagem for útil. */
export function waitingMinutes(conv: UnifiedMessage[], now: number): number {
  let i = conv.length - 1; let first: string | null = null;
  while (i >= 0 && conv[i].from === "cliente") first = conv[i--].at;
  return first ? Math.max(0, (now - Date.parse(first)) / 60000) : 0;
}
export function silentHandoffText(motivo: string, waitingMin: number, nome: string | null): string {
  if (waitingMin <= 30) return "";
  const n = nome ? `, ${nome}` : "";
  if (/estorno|reembolso|dinheiro|pagamento/i.test(motivo)) return `Oi${n}! Recebemos sua mensagem, vamos verificar seu estorno e te retornamos ainda hoje, tá bom? 😊`;
  if (/defeito|avaria/i.test(motivo)) return `Oi${n}! Recebemos sua mensagem e já estamos olhando o seu caso, te retornamos ainda hoje, tá bom? 😊`;
  return "";
}
/** 4) Pedir CPF só com pedido de suporte ativo e nunca em comentário público. */
export const ACTIVE_SUPPORT = ["troca", "devolucao", "troca_ou_devolucao_ambiguo", "rastreio", "outro_suporte"];
export const cpfRequestAllowed = (category: string, conv: UnifiedMessage[], publicComment: boolean) =>
  !publicComment && ACTIVE_SUPPORT.includes(category) && !alreadyResolved(conv);
export function publicCommentReply(nome: string | null, supportPhone: string | null): string {
  const n = nome ? `, ${nome}` : "";
  const digits = (supportPhone || "").replace(/\D/g, "");
  return digits ? `Oi${n}! Chama a gente no direct ou no WhatsApp que a gente resolve rapidinho pra você 😊 wa.me/${digits}` : `Oi${n}! Chama a gente no direct que a gente resolve rapidinho pra você 😊`;
}
/** 5) Consolidação: só pedido de suporte novo/repetido com o outro atendimento ainda ativo; uma vez por cliente. */
const GENERIC = /^(mais informa[cç](o|õ)es|informa[cç](o|õ)es|oi+|ol[aá]|bom dia|boa tarde|boa noite|\?+)[!.?\s]*$/i;
export function consolidationAllowed(conv: UnifiedMessage[], targetId: string | null, category: string): boolean {
  if (!targetId || !ACTIVE_SUPPORT.includes(category) || alreadyResolved(conv)) return false;
  if (conv.some(m => m.from === "loja" && m.text.includes("vamos manter seu atendimento só por lá"))) return false;
  const lastClient = [...conv].reverse().find(m => m.from === "cliente");
  if (!lastClient || GENERIC.test(lastClient.text.trim()) || isAckOnly(lastClient.text)) return false;
  const other = conv.filter(m => m.instance_id === targetId);
  if (!other.length) return false;
  const last = other[other.length - 1];
  // Ativo e sem resposta final: lá a cliente está esperando (fala que não é só agradecimento) ou a loja fez uma pergunta.
  if (last.from === "cliente") return !isAckOnly(last.text);
  return !!last.human && last.text.trim().endsWith("?");
}
/** 6) Uma sugestão por cliente: número onde a conversa de suporte está mais ativa (última mensagem da cliente). */
export function primaryInstance(conv: UnifiedMessage[]): string | null {
  const last = [...conv].reverse().find(m => m.from === "cliente" && m.instance_id && !isAckOnly(m.text)) ?? [...conv].reverse().find(m => m.from === "cliente" && m.instance_id);
  return last?.instance_id ?? null;
}
/** 7) Tom: primeiro nome, caloroso, curto, terminando em pergunta. */
export function linkText(tipo: "troca" | "devolucao", nome: string | null, originality: boolean, offerFromReturn: boolean): string {
  const n = nome ? `, ${nome}` : "";
  if (tipo === "devolucao") return originality
    ? `Claro${n}, sem problema! É só registrar sua devolução aqui: {{link}}. O código de postagem chega logo em seguida, tá bom?`
    : `Tudo certo${n}! É só registrar sua devolução aqui: {{link}}. O código de postagem chega logo em seguida, tá bom?`;
  if (offerFromReturn) return `Poxa${n}, que pena! Que tal trocar? A gente troca pra você 😊 É só registrar aqui e escolher a nova numeração ou modelo: {{link}}. O código de postagem chega logo em seguida, tá bom?`;
  return `Maravilha${n}! A gente troca pra você 😊 É só registrar aqui e escolher a nova numeração: {{link}}. O código de postagem chega logo em seguida, tá bom?`;
}
/** 8) Loja (humano) respondeu nas últimas 2h: no uso real o agente não age. */
export const humanRepliedRecently = (conv: UnifiedMessage[], now: number, hours = 2) =>
  conv.some(m => m.from === "loja" && m.human && now - Date.parse(m.at) <= hours * 3600000 && Date.parse(m.at) <= now);

// Espelho das funções support_classify_intent / support_auto_evaluate do banco (Fase 4, sem IA).
export type Intent = "troca" | "devolucao" | "indefinido";
export type Decision = "enviar_link" | "presencial" | "instagram_whatsapp" | "fila";
export type AutoMode = "off" | "shadow" | "auto";

export function normalizeText(s: string | null | undefined): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

const TROCA = [
  /\b(tro[ck]a\w*|tro[ck]ar\w*|tro[ck]o|tro[ck]ei)\b/,
  /\boutr[oa] (numero|numeracao|tamanho|n)\b/,
  /\bnumeracao\b/,
  /\bnao (me )?(serviu|servio|servil|coube)\b/,
  /\bficou (muito |bem |um pouco )?(grande|pequen\w*|apertad\w*|larg\w*|folgad\w*)/,
  /\btamanho errado\b/,
];
const DEVOLUCAO = [
  /\b(devol\w*|devou\w*|devolv\w*)/,
  /\breembols\w*/,
  /\bestorn\w*/,
  /\bdinheiro de volta\b/,
  /\barrepend\w*/,
  /\bcancelar (o |meu |a )?(pedido|compra)\b/,
];

export function classifyIntent(text: string | null | undefined): Intent | null {
  const t = normalizeText(text);
  const troca = TROCA.some((r) => r.test(t));
  const dev = DEVOLUCAO.some((r) => r.test(t));
  if (troca && dev) return "indefinido";
  if (troca) return "troca";
  if (dev) return "devolucao";
  return null;
}

export interface DecisionInput {
  intent: Intent;
  onlineOrders: number;
  storeOrders: number;
  deliveredAt: Date | null;
  windowDays: number;
  now?: Date;
}

export function decide(i: DecisionInput): { decision: Decision; reason: string } {
  const now = i.now ?? new Date();
  if (i.onlineOrders === 0 && i.storeOrders > 0) return { decision: "presencial", reason: "compra_na_loja" };
  if (i.onlineOrders === 0) return { decision: "fila", reason: "nenhum_pedido" };
  if (i.onlineOrders > 1) return { decision: "fila", reason: "varios_pedidos" };
  if (i.intent === "indefinido") return { decision: "fila", reason: "intencao_indefinida" };
  if (!i.deliveredAt) return { decision: "fila", reason: "entrega_sem_confirmacao" };
  if (now.getTime() > i.deliveredAt.getTime() + i.windowDays * 86400000) return { decision: "fila", reason: "fora_do_prazo" };
  return { decision: "enviar_link", reason: "um_pedido_elegivel" };
}

/** Envio automático só no modo 'auto', com Centrais abertas e caso de 1 pedido elegível. */
export function shouldAutoSend(mode: AutoMode, centralOpen: boolean, decision: Decision): boolean {
  return mode === "auto" && centralOpen && decision === "enviar_link";
}

export const REASON_TEXT: Record<string, string> = {
  um_pedido_elegivel: "1 pedido no prazo",
  compra_na_loja: "Compra na loja",
  nenhum_pedido: "Nenhum pedido online em 60 dias",
  varios_pedidos: "Vários pedidos — escolha qual",
  intencao_indefinida: "Não deu pra saber se é troca ou devolução",
  entrega_sem_confirmacao: "Entrega sem confirmação",
  fora_do_prazo: "Fora do prazo",
  instagram_para_whatsapp: "Instagram → levar pro WhatsApp",
  numero_atendimento_nao_configurado: "Número de atendimento não configurado",
};

export function waMeLink(phone: string, intent: "troca" | "devolucao"): string {
  const d = phone.replace(/\D/g, "");
  const text = intent === "troca" ? "Olá! Quero trocar meu pedido" : "Olá! Quero devolver meu pedido";
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

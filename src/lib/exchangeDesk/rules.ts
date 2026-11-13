// Regras puras do Painel do Atendente (Centrais de Troca/Devolução).
// O servidor (RPC exchange_desk_action) repete estas mesmas regras; aqui elas
// decidem o que a tela mostra e ficam cobertas por testes.

export type DeskStatus =
  | "solicitado" | "aprovado" | "aguardando_postagem" | "em_transito" | "recebido"
  | "concluido" | "recusado" | "cancelado" | "escalado";
export type DeskTab = "precisa" | "andamento" | "concluidas";
export type DeskAction = "assign" | "approve" | "deny" | "request_info" | "offer_size" | "reverse" | "create_troca" | "choose_product" | "confirm_intent";

export interface DeskReq {
  status: DeskStatus;
  request_type: string | null;
  reverse_shipping_code?: string | null;
  trocas_devolucoes_id?: string | null;
  replacement_product_id?: string | null;
  intent_confirmation_required?: boolean | null;
}

/** Troca sem produto separado não pode ser aprovada, virar registro nem gerar reversa. */
export function needsProductChoice(r: DeskReq): boolean {
  return r.request_type === "troca" && !r.replacement_product_id;
}
const NEED_PRODUCT = "Escolha e separe o produto novo antes.";
export interface Actor { isHuman: boolean; isStaff: boolean }

export function tabOf(r: DeskReq): DeskTab {
  if (r.status === "escalado" || (r.status === "aprovado" && !r.reverse_shipping_code)) return "precisa";
  if (["concluido", "recusado", "cancelado"].includes(r.status)) return "concluidas";
  return "andamento";
}

/** Pode executar a ação? Retorna null se pode, ou o motivo em português. */
export function canAct(r: DeskReq, action: DeskAction, actor: Actor, reason = ""): string | null {
  if (!actor.isStaff) return "Só a equipe pode mexer nas solicitações.";
  const open = r.status === "escalado" || r.status === "solicitado";
  const confirmFirst = "Confirme com a cliente: troca ou devolução antes de separar ou avançar.";
  switch (action) {
    case "assign": return null;
    case "confirm_intent":
      return actor.isHuman && r.intent_confirmation_required ? null : "Esta solicitação não está aguardando confirmação.";
    case "choose_product":
      if (r.intent_confirmation_required) return confirmFirst;
      return r.request_type === "troca" && open ? null : "Só para troca ainda em análise.";
    case "approve":
      if (r.intent_confirmation_required) return confirmFirst;
      if (needsProductChoice(r)) return NEED_PRODUCT;
      if (r.status !== "escalado") return "Só dá para aprovar o que está com o atendente.";
      return reason.trim().length >= 3 ? null : "Escreva o motivo da aprovação.";
    case "deny":
      if (!actor.isHuman) return "Só uma pessoa da equipe pode negar.";
      if (!open) return "Esta solicitação não pode mais ser negada.";
      return reason.trim().length >= 3 ? null : "Escreva o motivo da negativa.";
    case "request_info": return open ? null : "Esta solicitação já foi decidida.";
    case "offer_size":
      return r.request_type === "troca" && open ? null : "Só para troca ainda em análise.";
    case "reverse":
      if (r.intent_confirmation_required) return confirmFirst;
      if (needsProductChoice(r)) return NEED_PRODUCT;
      if (r.status !== "aprovado") return "A reversa só aparece para solicitação aprovada.";
      return r.reverse_shipping_code ? "Esta solicitação já tem reversa." : null;
    case "create_troca":
      if (r.intent_confirmation_required) return confirmFirst;
      if (needsProductChoice(r)) return NEED_PRODUCT;
      if (!["aprovado", "aguardando_postagem", "em_transito", "recebido"].includes(r.status)) return "Aprove antes de abrir o registro.";
      return r.trocas_devolucoes_id ? "Já existe registro desta solicitação." : null;
  }
}

export function ageHours(createdAt: string, now = Date.now()): number {
  return Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
}
export function ageLevel(createdAt: string, now = Date.now()): "normal" | "24h" | "48h" {
  const h = ageHours(createdAt, now);
  return h > 48 ? "48h" : h > 24 ? "24h" : "normal";
}
export function ageLabel(createdAt: string, now = Date.now()): string {
  const h = ageHours(createdAt, now);
  if (h < 1) return "agora há pouco";
  if (h < 24) return `há ${Math.floor(h)}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

/** Dias restantes (positivo) ou excedidos (negativo) até o prazo. */
export function daysLeft(deadline: string | null | undefined, now = Date.now()): number | null {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - now) / 86_400_000);
}

export const REASON_LABEL: Record<string, string> = {
  tamanho: "Tamanho", defeito: "Defeito", nao_gostou: "Não gostou", produto_errado: "Produto errado", outro: "Outro",
};
export const STATUS_LABEL: Record<string, string> = {
  solicitado: "Solicitado", aprovado: "Aprovado", aguardando_postagem: "Aguardando postagem", em_transito: "A caminho",
  recebido: "Recebido", concluido: "Concluído", recusado: "Negado", cancelado: "Cancelado", escalado: "Precisa de você",
};
export const SOURCE_LABEL = (s: string | null | undefined) =>
  s === "carrier" ? "Confirmada pela transportadora" : s === "customer" ? "Informada pela cliente" : "Sem confirmação";

/** Motivo da central → motivo do registro de troca. */
export const TD_MOTIVO: Record<string, "tamanho" | "defeito_avaria" | "arrependimento" | "erro_expedicao" | "outro"> = {
  tamanho: "tamanho", defeito: "defeito_avaria", nao_gostou: "arrependimento", produto_errado: "erro_expedicao", outro: "outro",
};

export function fillTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? "").toString());
}
export function waLink(phone: string | null | undefined, text: string): string {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

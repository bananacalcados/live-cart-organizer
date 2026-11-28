import { type ExpOrder, type ExpStage, isMototaxi, isPickup, nextStage, onlyDigits, orderChannelLabel } from "./expedition";
import { isSedexOrder } from "@/lib/expeditionPriority";

/** Forma de envio efetiva — mesmo campo que o desktop filtra (delivery_method || shipping_carrier). */
export const shippingMethodOf = (o: Pick<ExpOrder, "delivery_method" | "shipping_carrier">) => (o.delivery_method || o.shipping_carrier || "").trim();

export type ShippingTone = "sedex" | "moto" | "pickup" | "carrier" | "none";
export function shippingTag(o: ExpOrder): { label: string; tone: ShippingTone } {
  const m = shippingMethodOf(o);
  if (isSedexOrder(o) || o.shipping_type === "sedex" || /sedex/i.test(m)) return { label: "SEDEX", tone: "sedex" };
  if (isMototaxi(m)) return { label: "Mototaxista GV", tone: "moto" };
  if (isPickup(m) || o.is_store_pickup) return { label: o.pickup_store_name ? `Retirada · ${o.pickup_store_name}` : "Retirada na loja", tone: "pickup" };
  if (m) return { label: /pac/i.test(m) ? "PAC" : m, tone: "carrier" };
  return { label: "Sem frete definido", tone: "none" };
}

/** Mobile: SEDEX e Mototaxista GV primeiro; depois mais antigo (mesma ordem da consulta mobile_pdv_expedition_ids_v2). */
export const mobilePriorityRank = (o: ExpOrder) => (["sedex", "moto"].includes(shippingTag(o).tone) ? 0 : 1);
export function sortMobileExpedition(list: ExpOrder[], stage: ExpStage) {
  return [...list].sort((a, b) => mobilePriorityRank(a) - mobilePriorityRank(b)
    || (stage === "concluido" ? -1 : 1) * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
}

export const originLabel = (o: ExpOrder) => orderChannelLabel(o);

/**
 * O que falta para emitir etiqueta/NF-e — espelha as validações de gravação do ExpOrderEditDialog
 * (nome, CPF válido se informado, CEP 8 díg./logradouro/número/bairro/cidade/UF fora de retirada)
 * e expeditionShippingError (forma de envio). Telefone e pagamento: necessários para contato e liberação.
 */
export function missingOrderData(o: ExpOrder): string[] {
  const pd = o.payment_details || {}; const a = o.shipping_address || {};
  const out: string[] = [];
  const method = shippingMethodOf(o);
  if (!(o.customer_name || pd.customer_name || "").trim()) out.push("nome");
  if (!(o.resolved_phone || onlyDigits(o.customer_phone || pd.customer_phone).length >= 10)) out.push("telefone");
  if (onlyDigits(o.customer_cpf || pd.customer_cpf).length !== 11) out.push("CPF");
  if (!method) out.push("frete");
  if (!isPickup(method) && !o.is_store_pickup) {
    if (onlyDigits(a.cep || pd.customer_cep).length !== 8) out.push("CEP");
    if (!(a.address || pd.customer_address) || !(a.number || pd.customer_address_number) || !(a.neighborhood || pd.customer_neighborhood) || !(a.city || pd.customer_city) || !(a.state || pd.customer_state)) out.push("endereço");
  }
  if (!o.paid_at && !o.payment_on_delivery && !["completed", "paid", "pending_sync"].includes(o.status)) out.push("pagamento");
  return out;
}

/** Mesmas regras do avanço em massa do desktop: sem conferência/concluído e sem avulso incompleto. */
export const canBulkAdvance = (o: ExpOrder, stage: ExpStage) => !!nextStage(stage) && stage !== "conferencia" && stage !== "concluido" && !(o.is_avulso && !o.avulso_ready);
export const advanceMode = (stage: ExpStage) => (stage === "separacao" ? "items" : stage === "aguardando" ? "waiting" : "advance") as "items" | "waiting" | "advance";

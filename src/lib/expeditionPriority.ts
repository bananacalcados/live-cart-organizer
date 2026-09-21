/**
 * Prioridade de embalagem/envio na Expedição.
 * SEDEX (marcado no pedido da Live ou manualmente) vem primeiro,
 * depois entregas em Governador Valadares/MG, depois o restante.
 */

const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export const isValadaresOrder = (order: any): boolean => {
  const addr = order?.shipping_address || {};
  const city = stripAccents(String(addr.city || order?.customer_city || ""));
  const province = stripAccents(String(addr.province || addr.state || order?.customer_state || ""));
  if (!city.includes("governador valadares") && city !== "valadares") return false;
  // Sem UF informada ainda consideramos Valadares (cidade é única no Brasil).
  return !province || province.includes("mg") || province.includes("minas");
};

export const isSedexOrder = (order: any): boolean =>
  Boolean(order?.priority_sedex || order?.is_sedex);

/** Envio prioritário marcado no atendimento: SEDEX, Correios ou Transportadora. */
export const isPriorityShippingOrder = (order: any): boolean =>
  isSedexOrder(order) ||
  order?.shipping_type === "sedex" ||
  order?.shipping_type === "correios" ||
  order?.shipping_type === "transportadora";

/** Retirada em loja física (marcada na Live, no site ou manualmente). */
export const isStorePickupOrder = (order: any): boolean => {
  if (order?.is_store_pickup || order?.pickup_store_id || order?.pickup_date) return true;
  const method = stripAccents(
    String(order?.shipping_carrier || order?.delivery_method || order?.shipping_method || ""),
  );
  return method.includes("retirad") || method.includes("pickup");
};

/** 0 = Envio prioritário (SEDEX/Correios/Transportadora), 1 = Retirada na loja, 2 = Valadares, 3 = demais. */
export const expeditionPriorityRank = (order: any): number => {
  if (isPriorityShippingOrder(order)) return 0;
  if (isStorePickupOrder(order)) return 1;
  if (isValadaresOrder(order)) return 2;
  return 3;
};

/** Mototáxi/entrega local (inclui Governador Valadares). */
export const isMototaxiOrder = (order: any): boolean => {
  const method = stripAccents(
    String(order?.shipping_carrier || order?.delivery_method || order?.shipping_method || ""),
  );
  return method.includes("moto") || isValadaresOrder(order);
};

/**
 * Prioridade da aba AGUARDANDO:
 * 0 SEDEX · 1 mototáxi/Valadares · 2 retirada na loja · 3 Correios/transportadora · 4 demais.
 * Dentro de cada faixa, os mais antigos primeiro.
 */
export const expeditionWaitingRank = (order: any): number => {
  if (isSedexOrder(order) || order?.shipping_type === "sedex") return 0;
  if (isMototaxiOrder(order)) return 1;
  if (isStorePickupOrder(order)) return 2;
  if (order?.shipping_type === "correios" || order?.shipping_type === "transportadora") return 3;
  return 4;
};

/** Ordena mantendo a data (mais recente primeiro) dentro de cada prioridade. */
export const sortByExpeditionPriority = <T,>(orders: T[]): T[] =>
  [...orders].sort((a: any, b: any) => {
    const diff = expeditionPriorityRank(a) - expeditionPriorityRank(b);
    if (diff !== 0) return diff;
    const da = new Date(a?.shopify_created_at || a?.created_at || 0).getTime();
    const db = new Date(b?.shopify_created_at || b?.created_at || 0).getTime();
    return db - da;
  });

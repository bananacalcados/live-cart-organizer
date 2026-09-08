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

/** Retirada em loja física (marcada na Live, no site ou manualmente). */
export const isStorePickupOrder = (order: any): boolean => {
  if (order?.is_store_pickup || order?.pickup_store_id || order?.pickup_date) return true;
  const method = stripAccents(
    String(order?.shipping_carrier || order?.delivery_method || order?.shipping_method || ""),
  );
  return method.includes("retirad") || method.includes("pickup");
};

/** 0 = SEDEX, 1 = Retirada na loja, 2 = Valadares, 3 = demais. */
export const expeditionPriorityRank = (order: any): number => {
  if (isSedexOrder(order)) return 0;
  if (isStorePickupOrder(order)) return 1;
  if (isValadaresOrder(order)) return 2;
  return 3;
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

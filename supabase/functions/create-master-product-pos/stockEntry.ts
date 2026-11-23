export const SITE_LIVE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";
export const PEROLA_STORE_ID = "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2";

/** Loja que recebe o estoque inicial: Site/Live nunca recebe, vai para a Pérola. */
export function resolveStockStore(storeId: string | null): string | null {
  return storeId === SITE_LIVE_STORE_ID ? PEROLA_STORE_ID : storeId;
}

/** Estoque inicial só entra quando a linha é CRIADA nesta chamada. Linha existente: nunca mexe no saldo. */
export function initialStockFor(rowExists: boolean, entryStock: number): number | null {
  if (rowExists) return null; // null = não tocar em stock
  return Math.max(0, Number(entryStock) || 0);
}

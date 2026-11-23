/** Loja Site/Live: saldo sempre zero (trigger redireciona para a Pérola). Ajuste manual nela é recusado. */
export const SITE_LIVE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";
export const SITE_LIVE_MANUAL_ADJUST_MSG =
  "A loja Site/Live fica sempre com saldo zero. Faça o ajuste na Loja Pérola.";
export const isSiteLiveStore = (id?: string | null) => id === SITE_LIVE_STORE_ID;

export const CONVERSATION_LIST_REFRESH_WINDOW_MS = 4000;

type ConversationListPayload = {
  event?: "wa_msg_insert" | "wa_msg_update";
  is_mass_dispatch?: boolean;
  source?: string | null;
};

/**
 * A lista lateral não acompanha recibos de campanha. O banco já suprime esses
 * broadcasts por is_mass_dispatch; este filtro também protege as telas caso o
 * marcador/origem seja incluído no payload. Respostas da cliente e envios
 * manuais continuam atualizando a lista normalmente.
 */
export function shouldRefreshConversationList(payload: ConversationListPayload): boolean {
  if (payload.event === "wa_msg_update") return false;
  if (payload.is_mass_dispatch === true || payload.source === "broadcast") return false;
  return true;
}

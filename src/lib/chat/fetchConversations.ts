import { supabase } from "@/integrations/supabase/client";

/**
 * Linha devolvida por `get_conversations` / `get_conversations_multi`.
 * Ambas leem a tabela-resumo `whatsapp_conversations` (1 linha por
 * telefone+instância, mantida por trigger) — não agregam mensagens.
 */
export interface ConversationRow {
  phone: string;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
  direction: string | null;
  is_group: boolean;
  whatsapp_number_id: string | null;
  sender_name: string | null;
  status: string | null;
  has_outgoing: boolean;
  is_dispatch_only: boolean;
  channel: string | null;
  has_incoming: boolean;
  last_is_mass_dispatch: boolean;
}

export interface FetchConversationsParams {
  /** Instâncias a incluir. `null` = todas as instâncias do sistema. */
  numberIds: string[] | null;
  /** `false` = só conversas reais; `true` = só disparos sem resposta; `null` = todas. */
  dispatchOnly: boolean | null;
  /** Incluir conversas sem instância (IG DMs antigas / zapi legado). */
  includeUnassigned?: boolean;
  /** Tamanho da página (a API corta em 1000 linhas por resposta). */
  pageSize?: number;
  /** Teto de páginas por segurança (10 × 1000 = 10 mil conversas). */
  maxPages?: number;
}

/**
 * Busca TODAS as conversas das instâncias informadas em UMA rota, paginando
 * por trás dos panos para contornar o corte de 1000 linhas da API.
 */
export async function fetchConversationRows(params: FetchConversationsParams): Promise<{ rows: ConversationRow[]; error: Error | null }> {
  const pageSize = Math.min(1000, Math.max(100, params.pageSize ?? 1000));
  const maxPages = params.maxPages ?? 10;
  const rows: ConversationRow[] = [];

  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await supabase.rpc("get_conversations_multi", {
      p_number_ids: params.numberIds,
      p_dispatch_only: params.dispatchOnly,
      p_include_unassigned: params.includeUnassigned ?? false,
      p_limit: pageSize,
      p_offset: page * pageSize,
    });
    if (error) return { rows, error: new Error(error.message) };
    const batch = (data || []) as unknown as ConversationRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return { rows, error: null };
}

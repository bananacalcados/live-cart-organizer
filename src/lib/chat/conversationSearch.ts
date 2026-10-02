import { supabase } from "@/integrations/supabase/client";

/**
 * Busca local de conversas — regra ÚNICA para as visões Linhas e Tradicional.
 * - nome: texto sem diferenciar maiúsculas;
 * - telefone: pelos DÍGITOS da busca; com 8+ dígitos casa também pelos 8 últimos
 *   (cobre com/sem 55 e com/sem 9º dígito);
 * - extraText (opcional): ex. última mensagem na visão em Linhas.
 */
export function buildConversationMatcher(query: string) {
  const q = query.trim();
  if (!q) return null;
  const qLower = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  const tail8 = digits.length >= 8 ? digits.slice(-8) : null;
  return (phone: string, names: (string | null | undefined)[], extraText?: string | null) => {
    for (const n of names) if (n && n.toLowerCase().includes(qLower)) return true;
    if (digits.length > 0) {
      const p = String(phone || "").replace(/\D/g, "");
      if (p.includes(digits)) return true;
      if (tail8 && p.includes(tail8)) return true;
    }
    if (extraText && extraText.toLowerCase().includes(qLower)) return true;
    return false;
  };
}

export interface FastSearchResult {
  phone: string;
  whatsapp_number_id: string | null;
  instance_label: string | null;
  sender_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  is_group: boolean;
  is_finished: boolean;
  is_archived: boolean;
  only_in_archive: boolean;
  is_dispatch_only: boolean;
}

/** Busca no histórico completo deve rodar? (4+ dígitos ou 3+ letras) */
export function canSearchHistory(query: string) {
  const q = query.trim();
  return q.replace(/\D/g, "").length >= 4 || q.replace(/[\d\s\W_]/g, "").length >= 3;
}

export async function searchConversationsFast(query: string, limit = 60): Promise<FastSearchResult[]> {
  const { data, error } = await (supabase.rpc as any)("search_conversations_fast", { p_query: query.trim(), p_limit: limit });
  if (error) throw error;
  return (data || []) as FastSearchResult[];
}

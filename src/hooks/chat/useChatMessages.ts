import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWaMessageBroadcast } from '@/hooks/useWaMessageBroadcast';
import type { Message } from '@/components/chat/ChatTypes';

/**
 * useChatMessages — carrega mensagens de UMA conversa (phone + numberId opcional)
 * com auto-refresh via broadcast e polling de status (✓✓).
 *
 * - `numberId` = string  → filtra por aquela instância (modo POS/Eventos)
 * - `numberId` = null    → filtra `is null` (legado sem instância)
 * - `numberId` = undefined → ignora filtro (todas as instâncias deste phone)
 *
 * - Broadcast: refetch quando bate qualquer evento (filtragem fina poderia ser feita
 *   no payload — hoje o POS já faz refetch geral, mantemos paridade).
 * - Polling: 15s para refletir status `sent → delivered → read`.
 */
export interface UseChatMessagesOptions {
  /** Filtra mensagens por essa lista de variações do telefone (útil pra cross-9-digit). Se omitido, usa apenas `phone`. */
  phoneVariations?: string[];
  /** Desativa o polling de 15s. Default: false. */
  disablePolling?: boolean;
  /** Desativa o broadcast. Default: false. */
  disableBroadcast?: boolean;
}

export function useChatMessages(
  phone: string | null | undefined,
  numberId: string | null | undefined,
  options: UseChatMessagesOptions = {},
) {
  const { phoneVariations, disablePolling = false, disableBroadcast = false } = options;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Chave única da conversa atual. Muda quando o usuário troca de chat.
  const conversationKey = `${phone ?? ''}|${numberId ?? ''}|${phoneVariations?.join(',') ?? ''}`;
  // Guarda a chave da requisição mais recente para descartar respostas fora de ordem.
  const latestKeyRef = useRef(conversationKey);

  const load = useCallback(async () => {
    if (!phone) {
      setMessages([]);
      return;
    }
    const requestKey = conversationKey;
    setIsLoading(true);
    let query = supabase
      .from('whatsapp_messages')
      .select('*')
      .order('created_at', { ascending: true });

    if (phoneVariations && phoneVariations.length > 0) {
      query = query.in('phone', phoneVariations);
    } else {
      query = query.eq('phone', phone);
    }

    if (numberId) {
      query = query.eq('whatsapp_number_id', numberId);
    } else if (numberId === null) {
      query = query.is('whatsapp_number_id', null);
    }

    const { data } = await query;
    // Descarta respostas de uma conversa que já não está mais aberta (race condition).
    if (latestKeyRef.current !== requestKey) return;
    setMessages((data as Message[]) || []);
    setIsLoading(false);
  }, [phone, numberId, conversationKey, phoneVariations?.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao trocar de conversa: limpa imediatamente o histórico antigo e marca a nova chave
  // como a mais recente, evitando que mensagens do chat anterior fiquem visíveis.
  useEffect(() => {
    latestKeyRef.current = conversationKey;
    setMessages([]);
    if (phone) setIsLoading(true);
  }, [conversationKey, phone]);

  // Initial + reactive load
  useEffect(() => {
    load();
  }, [load]);

  // Realtime via broadcast (low CPU, replaces postgres_changes)
  useWaMessageBroadcast((payload) => {
    if (disableBroadcast) return;
    if (!phone) return;
    // Optional fine filter: only refetch if payload phone matches
    if (payload?.phone) {
      const variations = phoneVariations && phoneVariations.length > 0 ? phoneVariations : [phone];
      if (!variations.includes(payload.phone)) return;
    }
    load();
  });

  // Status polling (✓✓ refresh)
  useEffect(() => {
    if (disablePolling || !phone) return;
    const interval = setInterval(() => load(), 15000);
    return () => clearInterval(interval);
  }, [phone, disablePolling, load]);

  return {
    messages,
    setMessages,
    isLoading,
    refresh: load,
  };
}

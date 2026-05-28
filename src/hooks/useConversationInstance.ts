import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWhatsAppNumberStore, type WhatsAppNumber } from '@/stores/whatsappNumberStore';

/**
 * useConversationInstance
 *
 * Resolve a instância de WhatsApp VINCULADA a uma conversa (telefone).
 * Regra única do sistema: a instância de envio NUNCA vem do seletor global
 * quando existe histórico — ela vem da última mensagem trocada com aquele
 * telefone. Isso impede que mensagens "vazem" entre instâncias.
 *
 * Pode receber:
 *  - apenas o telefone: faz uma query rápida para descobrir a última instância
 *  - opcionalmente uma lista de mensagens já carregadas: evita roundtrip
 */
export interface ConversationInstanceMessageLike {
  whatsapp_number_id?: string | null;
}

interface UseConversationInstanceOptions {
  /** Mensagens já carregadas (mais novas em qualquer posição). Se passado, evita query. */
  messages?: ConversationInstanceMessageLike[] | null;
  /** Força ignorar o histórico e usar o seletor global. Só para "Nova conversa". */
  forceGlobal?: boolean;
}

export function useConversationInstance(
  phone: string | null | undefined,
  options: UseConversationInstanceOptions = {}
) {
  const { messages, forceGlobal = false } = options;
  const { numbers, selectedNumberId, fetchNumbers } = useWhatsAppNumberStore();

  const [fetchedId, setFetchedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (numbers.length === 0) fetchNumbers();
  }, [numbers.length, fetchNumbers]);

  // 1) Try from in-memory messages first
  const boundFromMessages = useMemo<string | null>(() => {
    if (!messages || messages.length === 0) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i]?.whatsapp_number_id;
      if (id) return id;
    }
    return null;
  }, [messages]);

  // 2) If no messages were passed, query the DB once
  useEffect(() => {
    let cancelled = false;
    if (forceGlobal || !phone || boundFromMessages || (messages && messages.length > 0)) {
      setFetchedId(null);
      return;
    }
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('whatsapp_number_id')
        .eq('phone', phone)
        .not('whatsapp_number_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setFetchedId((data as any)?.whatsapp_number_id ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phone, boundFromMessages, messages, forceGlobal]);

  const boundNumberId = forceGlobal ? null : boundFromMessages || fetchedId;
  const effectiveNumberId = boundNumberId || selectedNumberId || null;

  const boundNumber: WhatsAppNumber | null = useMemo(
    () => numbers.find((n) => n.id === boundNumberId) || null,
    [numbers, boundNumberId]
  );
  const effectiveNumber: WhatsAppNumber | null = useMemo(
    () => numbers.find((n) => n.id === effectiveNumberId) || null,
    [numbers, effectiveNumberId]
  );

  return {
    /** Instância travada pelo histórico da conversa (null se ainda não conversou). */
    boundNumberId,
    boundNumber,
    /** Instância que DEVE ser usada para enviar agora. */
    effectiveNumberId,
    effectiveNumber,
    /** Se true, a conversa já tem instância travada e o seletor global é ignorado. */
    isLocked: !!boundNumberId,
    loading,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWaMessageBroadcast } from '@/hooks/useWaMessageBroadcast';
import type { Message } from '@/components/chat/ChatTypes';

/**
 * useChatMessages — carrega a JANELA MAIS RECENTE de mensagens de UMA conversa
 * (phone + numberId opcional) com auto-refresh via broadcast e polling de status.
 *
 * - Consulta em ordem DESC com limite (`windowSize`, inicia em 300) e inverte no
 *   cliente. Antes era ASC sem limite: a API cortava em 1000 e devolvia as MAIS
 *   ANTIGAS, então conversas grandes (grupos) "paravam no tempo".
 * - `hasOlder` = veio a janela cheia; `loadOlder()` aumenta a janela em +300.
 * - `numberId` string → instância; null → `is null`; undefined → todas.
 */
export interface UseChatMessagesOptions {
  phoneVariations?: string[];
  disablePolling?: boolean;
  disableBroadcast?: boolean;
}

const WINDOW_STEP = 300;

export function useChatMessages(
  phone: string | null | undefined,
  numberId: string | null | undefined,
  options: UseChatMessagesOptions = {},
) {
  const { phoneVariations, disablePolling = false, disableBroadcast = false } = options;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [windowSize, setWindowSize] = useState(WINDOW_STEP);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const conversationKey = `${phone ?? ''}|${numberId ?? ''}|${phoneVariations?.join(',') ?? ''}`;
  const latestKeyRef = useRef(conversationKey);
  const sigRef = useRef('');
  const windowRef = useRef(WINDOW_STEP);

  const buildSignature = (rows: Message[]) =>
    rows
      .map(
        (r) =>
          `${r.id}:${r.status ?? ''}:${(r as any).sender_name ?? ''}:${r.message ?? ''}:${r.media_url ?? ''}`,
      )
      .join('|');

  const load = useCallback(async (silent = false) => {
    if (!phone) {
      sigRef.current = '';
      setMessages([]);
      setHasOlder(false);
      return;
    }
    const requestKey = conversationKey;
    const size = windowRef.current;
    if (!silent) setIsLoading(true);
    let query = supabase
      .from('whatsapp_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(size);

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
    if (latestKeyRef.current !== requestKey) return;
    const rows = ((data as Message[]) || []).slice().reverse();
    setHasOlder(rows.length >= size);
    const sig = buildSignature(rows);
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setMessages(rows);
    }
    if (!silent) setIsLoading(false);
  }, [phone, numberId, conversationKey, phoneVariations?.join('|'), windowSize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    latestKeyRef.current = conversationKey;
    sigRef.current = '';
    windowRef.current = WINDOW_STEP;
    setWindowSize(WINDOW_STEP);
    setHasOlder(false);
    setMessages([]);
    if (phone) setIsLoading(true);
  }, [conversationKey, phone]);

  useEffect(() => {
    load(false);
  }, [load]);

  const loadOlder = useCallback(async () => {
    if (!phone || loadingOlder) return;
    setLoadingOlder(true);
    windowRef.current += WINDOW_STEP;
    try {
      await load(true);
    } finally {
      setWindowSize(windowRef.current);
      setLoadingOlder(false);
    }
  }, [phone, loadingOlder, load]);

  useWaMessageBroadcast((payload) => {
    if (disableBroadcast) return;
    if (!phone) return;
    if (payload?.phone) {
      const variations = phoneVariations && phoneVariations.length > 0 ? phoneVariations : [phone];
      if (!variations.includes(payload.phone)) return;
    }
    load(true);
  });

  useEffect(() => {
    if (disablePolling || !phone) return;
    const interval = setInterval(() => load(true), 15000);
    return () => clearInterval(interval);
  }, [phone, disablePolling, load]);

  return {
    messages,
    setMessages,
    isLoading,
    refresh: load,
    hasOlder,
    loadOlder,
    loadingOlder,
  };
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Message } from '@/components/chat/ChatTypes';

const PAGE = 100;

export interface ArchiveLoader {
  messages: Message[];
  load: () => Promise<void>;
  loading: boolean;
  exhausted: boolean;
}

/**
 * Histórico ARQUIVADO (whatsapp_messages_archive) de uma conversa, carregado
 * apenas sob demanda ("Ler msgs antigas"). Uma consulta pontual por clique,
 * restrita a phone + instância + created_at anterior ao mais antigo já exibido,
 * atendida pelo índice idx_wm_archive_phone_inst_created. Sem polling.
 *
 * - `numberId` string → só aquela instância; null → sem instância; undefined → todas.
 */
export function useArchivedMessages(
  phone: string | null | undefined,
  numberId: string | null | undefined,
  liveMessages: Message[],
  phoneVariations?: string[],
): ArchiveLoader {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const key = `${phone ?? ''}|${numberId ?? ''}`;
  useEffect(() => {
    setMessages([]);
    setExhausted(false);
    setLoading(false);
  }, [key]);

  const load = useCallback(async () => {
    if (!phone || loading || exhausted) return;
    setLoading(true);
    try {
      const oldest = messages[0]?.created_at ?? liveMessages[0]?.created_at ?? null;
      let q = supabase.from('whatsapp_messages_archive' as any).select('*');
      q = phoneVariations && phoneVariations.length > 0 ? q.in('phone', phoneVariations) : q.eq('phone', phone);
      if (numberId) q = q.eq('whatsapp_number_id', numberId);
      else if (numberId === null) q = q.is('whatsapp_number_id', null);
      if (oldest) q = q.lt('created_at', oldest);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(PAGE);
      if (error) throw error;
      const rows = ((data as unknown as Message[]) || []).reverse();
      if (rows.length < PAGE) setExhausted(true);
      if (rows.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...rows.filter((r) => !seen.has(r.id)), ...prev];
        });
      }
    } catch (e) {
      console.error('[useArchivedMessages] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [phone, numberId, loading, exhausted, messages, liveMessages, phoneVariations]);

  return { messages, load, loading, exhausted };
}

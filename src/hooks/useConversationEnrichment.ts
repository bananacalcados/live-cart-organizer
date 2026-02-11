import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, ConversationStatus } from '@/components/chat/ChatTypes';
import { useWhatsAppNumberStore } from '@/stores/whatsappNumberStore';

interface FinishedConversation {
  phone: string;
}

/**
 * Computes conversation status from message data and enriches with instance info.
 */
export function useConversationEnrichment() {
  const [finishedPhones, setFinishedPhones] = useState<Set<string>>(new Set());
  const { numbers } = useWhatsAppNumberStore();

  const loadFinished = useCallback(async () => {
    const { data } = await supabase.from('chat_finished_conversations').select('phone');
    if (data) {
      setFinishedPhones(new Set((data as FinishedConversation[]).map(d => d.phone)));
    }
  }, []);

  useEffect(() => {
    loadFinished();
    const channel = supabase
      .channel('chat-finished-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_finished_conversations' }, () => loadFinished())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadFinished]);

  const finishConversation = useCallback(async (phone: string) => {
    await supabase.from('chat_finished_conversations').upsert({ phone, finished_at: new Date().toISOString() }, { onConflict: 'phone' });
  }, []);

  const reopenConversation = useCallback(async (phone: string) => {
    await supabase.from('chat_finished_conversations').delete().eq('phone', phone);
  }, []);

  /**
   * Compute conversation status from messages:
   * - not_started: has incoming but zero outgoing
   * - awaiting_reply: has outgoing, last msg is incoming
   * - awaiting_customer: last msg is outgoing
   */
  const computeStatus = useCallback((messages: { direction: string }[]): ConversationStatus => {
    if (messages.length === 0) return 'awaiting_customer';
    const hasOutgoing = messages.some(m => m.direction === 'outgoing');
    const lastMsg = messages[0]; // assuming sorted desc
    if (!hasOutgoing && lastMsg.direction === 'incoming') return 'not_started';
    if (lastMsg.direction === 'incoming') return 'awaiting_reply';
    return 'awaiting_customer';
  }, []);

  const getInstanceLabel = useCallback((whatsappNumberId: string | null | undefined): string => {
    if (!whatsappNumberId) return 'Z-API';
    const num = numbers.find(n => n.id === whatsappNumberId);
    return num?.label || 'Meta';
  }, [numbers]);

  const enrichConversations = useCallback((
    convs: Conversation[],
    phoneMessages: Map<string, { direction: string }[]>
  ): Conversation[] => {
    // Track all phone base numbers to detect cross-instance contacts
    const phoneBaseMap = new Map<string, string[]>();
    for (const conv of convs) {
      const base = conv.phone.replace(/\D/g, '').slice(-8);
      if (!phoneBaseMap.has(base)) phoneBaseMap.set(base, []);
      phoneBaseMap.get(base)!.push(conv.phone);
    }

    return convs.map(conv => {
      const msgs = phoneMessages.get(conv.phone) || [];
      const status = computeStatus(msgs);
      const isFinished = finishedPhones.has(conv.phone);
      const instanceLabel = getInstanceLabel(conv.whatsapp_number_id);
      const base = conv.phone.replace(/\D/g, '').slice(-8);
      const hasOtherInstances = (phoneBaseMap.get(base)?.length || 0) > 1;

      return {
        ...conv,
        conversationStatus: status,
        isFinished,
        instanceLabel,
        hasOtherInstances,
      };
    });
  }, [computeStatus, finishedPhones, getInstanceLabel]);

  return {
    enrichConversations,
    finishConversation,
    reopenConversation,
    finishedPhones,
    loadFinished,
  };
}

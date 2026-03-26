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
  const [archivedPhones, setArchivedPhones] = useState<Set<string>>(new Set());
  const [awaitingPaymentPhones, setAwaitingPaymentPhones] = useState<Set<string>>(new Set());
  const { numbers } = useWhatsAppNumberStore();

  const loadFinished = useCallback(async () => {
    const { data } = await supabase.from('chat_finished_conversations').select('phone');
    if (data) {
      setFinishedPhones(new Set((data as FinishedConversation[]).map(d => d.phone)));
    }
  }, []);

  const loadArchived = useCallback(async () => {
    const { data } = await supabase.from('chat_archived_conversations').select('phone');
    if (data) {
      setArchivedPhones(new Set((data as any[]).map(d => d.phone)));
    }
  }, []);

  const loadAwaitingPayment = useCallback(async () => {
    const { data } = await supabase.from('chat_awaiting_payment').select('phone');
    if (data) {
      setAwaitingPaymentPhones(new Set((data as any[]).map(d => d.phone)));
    }
  }, []);

  useEffect(() => {
    loadFinished();
    loadArchived();
    loadAwaitingPayment();

    const channel = supabase
      .channel('chat-enrichment-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_finished_conversations' }, () => loadFinished())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_archived_conversations' }, () => loadArchived())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_awaiting_payment' }, () => loadAwaitingPayment())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadFinished, loadArchived, loadAwaitingPayment]);

  const finishConversation = useCallback(async (phone: string, reason?: string, sellerId?: string) => {
    await supabase.from('chat_finished_conversations').upsert({
      phone,
      finished_at: new Date().toISOString(),
      finish_reason: reason || null,
      seller_id: sellerId || null,
    } as any, { onConflict: 'phone' });
  }, []);

  const reopenConversation = useCallback(async (phone: string) => {
    await supabase.from('chat_finished_conversations').delete().eq('phone', phone);
  }, []);

  const archiveConversation = useCallback(async (phone: string, archivedBy?: string) => {
    await supabase.from('chat_archived_conversations').upsert({
      phone,
      archived_at: new Date().toISOString(),
      archived_by: archivedBy || null,
    } as any, { onConflict: 'phone' });
  }, []);

  const unarchiveConversation = useCallback(async (phone: string) => {
    await supabase.from('chat_archived_conversations').delete().eq('phone', phone);
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
    if (!whatsappNumberId) return '';
    const num = numbers.find(n => n.id === whatsappNumberId);
    return num?.label || 'Meta';
  }, [numbers]);

  const enrichConversations = useCallback((
    convs: Conversation[],
    phoneMessages: Map<string, { direction: string }[]>
  ): Conversation[] => {
    // Track all phone base numbers to detect cross-instance contacts
    // Key: phone digits suffix, Value: array of { conversationKey, instanceLabel }
    const phoneBaseMap = new Map<string, { key: string; label: string }[]>();
    for (const conv of convs) {
      const base = conv.phone.replace(/\D/g, '').slice(-8);
      const convKey = `${conv.phone}__${conv.whatsapp_number_id || 'none'}`;
      const label = getInstanceLabel(conv.whatsapp_number_id);
      if (!phoneBaseMap.has(base)) phoneBaseMap.set(base, []);
      phoneBaseMap.get(base)!.push({ key: convKey, label: label || 'Sem instância' });
    }

    return convs.map(conv => {
      const convKey = `${conv.phone}__${conv.whatsapp_number_id || 'none'}`;
      const msgs = phoneMessages.get(convKey) || phoneMessages.get(conv.phone) || [];
      const status = computeStatus(msgs);
      const isFinished = finishedPhones.has(conv.phone);
      const isArchived = archivedPhones.has(conv.phone);
      const isAwaitingPayment = awaitingPaymentPhones.has(conv.phone);
      const instanceLabel = getInstanceLabel(conv.whatsapp_number_id);
      const base = conv.phone.replace(/\D/g, '').slice(-8);
      const allInstances = phoneBaseMap.get(base) || [];
      const otherInstances = allInstances.filter(i => i.key !== convKey);
      const hasOtherInstances = otherInstances.length > 0;
      const otherInstanceLabels = otherInstances.map(i => i.label);

      return {
        ...conv,
        conversationKey: convKey,
        conversationStatus: status,
        isFinished,
        isArchived,
        isAwaitingPayment,
        isDispatchOnly: false, // will be set from RPC data
        instanceLabel,
        hasOtherInstances,
        otherInstanceLabels,
      };
    });
  }, [computeStatus, finishedPhones, archivedPhones, awaitingPaymentPhones, getInstanceLabel]);

  return {
    enrichConversations,
    finishConversation,
    reopenConversation,
    archiveConversation,
    unarchiveConversation,
    finishedPhones,
    archivedPhones,
    awaitingPaymentPhones,
    loadFinished,
  };
}

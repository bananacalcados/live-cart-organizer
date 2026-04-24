import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, ConversationStatus } from '@/components/chat/ChatTypes';
import { useWhatsAppNumberStore } from '@/stores/whatsappNumberStore';

interface FinishedConversation {
  phone: string;
}

const normalizePhoneKey = (phone: string | null | undefined) => {
  const digits = (phone || '').replace(/\D/g, '');
  return digits ? digits.slice(-8) : '';
};

/**
 * Computes conversation status from message data and enriches with instance info.
 */
export function useConversationEnrichment() {
  const [finishedPhones, setFinishedPhones] = useState<Set<string>>(new Set());
  const [archivedPhones, setArchivedPhones] = useState<Set<string>>(new Set());
  const [awaitingPaymentPhones, setAwaitingPaymentPhones] = useState<Set<string>>(new Set());
  const [aiTransferredPhones, setAiTransferredPhones] = useState<Set<string>>(new Set());
  const { numbers } = useWhatsAppNumberStore();

  const loadFinished = useCallback(async () => {
    let allFinished: FinishedConversation[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('chat_finished_conversations')
        .select('phone')
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) break;

      allFinished = allFinished.concat(data as FinishedConversation[]);

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    setFinishedPhones(new Set(allFinished.map(d => normalizePhoneKey(d.phone)).filter(Boolean)));
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

  // Conversations transferred by AI awaiting human pickup → must show in "Novas"
  const loadAiTransferred = useCallback(async () => {
    const { data } = await supabase
      .from('chat_assignments')
      .select('phone')
      .eq('assigned_by', 'ai')
      .eq('status', 'pending');
    if (data) {
      setAiTransferredPhones(
        new Set((data as any[]).map(d => normalizePhoneKey(d.phone)).filter(Boolean))
      );
    }
  }, []);

  // Mark an AI-transferred conversation as picked up (when human sends a message)
  const resolveAiTransfer = useCallback(async (phone: string) => {
    const key = normalizePhoneKey(phone);
    if (!key || !aiTransferredPhones.has(key)) return;
    setAiTransferredPhones(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    await supabase
      .from('chat_assignments')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() } as any)
      .eq('phone', phone)
      .eq('assigned_by', 'ai')
      .eq('status', 'pending');
  }, [aiTransferredPhones]);

  useEffect(() => {
    loadFinished();
    loadArchived();
    loadAwaitingPayment();
    loadAiTransferred();

    const channel = supabase
      .channel('chat-enrichment-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_finished_conversations' }, () => loadFinished())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_archived_conversations' }, () => loadArchived())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_awaiting_payment' }, () => loadAwaitingPayment())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_assignments' }, () => loadAiTransferred())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadFinished, loadArchived, loadAwaitingPayment, loadAiTransferred]);

  const finishConversation = useCallback(async (
    phone: string,
    reason?: string,
    sellerId?: string,
    extras?: { saleValue?: number; saleCurrency?: string; triggerId?: string | null; whatsappNumberId?: string | null }
  ) => {
    const phoneKey = normalizePhoneKey(phone);
    if (phoneKey) {
      setFinishedPhones(prev => new Set([...prev, phoneKey]));
    }

    const { error } = await supabase.from('chat_finished_conversations').upsert({
      phone,
      finished_at: new Date().toISOString(),
      finish_reason: reason || null,
      seller_id: sellerId || null,
      sale_value: extras?.saleValue ?? null,
      sale_currency: extras?.saleCurrency ?? 'BRL',
      trigger_id: extras?.triggerId ?? null,
    } as any, { onConflict: 'phone' });

    if (error && phoneKey) {
      setFinishedPhones(prev => {
        const next = new Set(prev);
        next.delete(phoneKey);
        return next;
      });
      throw error;
    }

    // Track sale conversion + fire Meta CAPI when reason is 'compra' and value > 0
    if (reason === 'compra' && extras?.saleValue && extras.saleValue > 0) {
      try {
        const { data: conv } = await supabase.from('trigger_conversions').insert({
          trigger_id: extras.triggerId ?? null,
          phone,
          sale_value: extras.saleValue,
          sale_currency: extras.saleCurrency ?? 'BRL',
          finish_reason: reason,
          seller_id: sellerId ?? null,
          whatsapp_number_id: extras.whatsappNumberId ?? null,
        } as any).select('id').single();

        // Fire Meta CAPI Purchase (non-blocking)
        supabase.functions.invoke('meta-capi-purchase', {
          body: {
            conversion_id: conv?.id,
            phone,
            value: extras.saleValue,
            currency: extras.saleCurrency ?? 'BRL',
            trigger_id: extras.triggerId ?? null,
          },
        }).catch(() => {});
      } catch (e) {
        console.warn('[finishConversation] failed to record conversion', e);
      }
    }
  }, []);

  const reopenConversation = useCallback(async (phone: string) => {
    const phoneKey = normalizePhoneKey(phone);
    if (phoneKey) {
      setFinishedPhones(prev => {
        const next = new Set(prev);
        next.delete(phoneKey);
        return next;
      });
    }

    const { error } = await supabase.from('chat_finished_conversations').delete().eq('phone', phone);

    if (error && phoneKey) {
      setFinishedPhones(prev => new Set([...prev, phoneKey]));
      throw error;
    }
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
      let status = computeStatus(msgs);
      const isFinished = finishedPhones.has(normalizePhoneKey(conv.phone));
      const isArchived = archivedPhones.has(conv.phone);
      const isAwaitingPayment = awaitingPaymentPhones.has(conv.phone);
      const isAiTransferred = aiTransferredPhones.has(normalizePhoneKey(conv.phone));

      // Force AI-transferred conversations into "Novas" so sellers spot them quickly
      if (isAiTransferred && !isFinished && !isArchived) {
        status = 'not_started';
      }

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
        isAiTransferred,
        isDispatchOnly: conv.isDispatchOnly || false,
        instanceLabel,
        hasOtherInstances,
        otherInstanceLabels,
      };
    });
  }, [computeStatus, finishedPhones, archivedPhones, awaitingPaymentPhones, aiTransferredPhones, getInstanceLabel]);

  return {
    enrichConversations,
    finishConversation,
    reopenConversation,
    archiveConversation,
    unarchiveConversation,
    finishedPhones,
    archivedPhones,
    awaitingPaymentPhones,
    aiTransferredPhones,
    resolveAiTransfer,
    loadFinished,
  };
}

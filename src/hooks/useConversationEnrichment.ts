import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, ConversationStatus } from '@/components/chat/ChatTypes';
import { useWhatsAppNumberStore } from '@/stores/whatsappNumberStore';
import {
  finishedPhoneKey,
  peekFinishedMap,
  resolveFinishedConversations,
  setFinishedLocal,
  subscribeFinishedCache,
} from '@/lib/finishedConversationsCache';

const normalizePhoneKey = (phone: string | null | undefined) => finishedPhoneKey(phone);

/**
 * Computes conversation status from message data and enriches with instance info.
 */
export function useConversationEnrichment() {
  // Bump-only counter: o mapa de finalizadas vive no cache de módulo
  // (compartilhado entre todas as telas de chat) e este contador apenas força
  // o re-render quando o cache muda.
  const [finishedVersion, setFinishedVersion] = useState(0);
  const [archivedPhones, setArchivedPhones] = useState<Set<string>>(new Set());
  const [awaitingPaymentPhones, setAwaitingPaymentPhones] = useState<Set<string>>(new Set());
  const [aiTransferredPhones, setAiTransferredPhones] = useState<Set<string>>(new Set());
  const { numbers } = useWhatsAppNumberStore();

  useEffect(() => subscribeFinishedCache(() => setFinishedVersion(v => v + 1)), []);

  const finishedAtByPhone = useMemo(() => peekFinishedMap(), [finishedVersion]);
  const finishedPhones = useMemo(() => new Set(finishedAtByPhone.keys()), [finishedAtByPhone]);

  /** Resolve (sob demanda) apenas os telefones informados. */
  const ensureFinished = useCallback((phones: (string | null | undefined)[]) => {
    void resolveFinishedConversations(phones);
  }, []);

  // Fallback: força re-resolução dos telefones já conhecidos.
  const loadFinished = useCallback(async () => {
    await resolveFinishedConversations(Array.from(peekFinishedMap().keys()), true);
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
    // `chat_finished_conversations` NÃO é mais baixada inteira aqui: cada tela
    // resolve sob demanda os telefones visíveis (ver ensureFinished).
    loadArchived();
    loadAwaitingPayment();
    loadAiTransferred();


    // Debounce realtime reloads. Each of these handlers re-fetches an entire
    // table; without debouncing, a burst of changes (e.g. many conversations
    // finishing during a busy period or a mass dispatch) triggers dozens of
    // full-table reloads per client, which is a major source of Cloud egress
    // and compute cost. Collapsing bursts into a single reload keeps the UI
    // correct while drastically cutting redundant queries.
    const timers: Record<string, ReturnType<typeof setTimeout> | null> = {
      finished: null, archived: null, awaiting: null, transferred: null,
    };
    const debounce = (key: keyof typeof timers, fn: () => void, ms = 3000) => {
      if (timers[key]) clearTimeout(timers[key]!);
      timers[key] = setTimeout(fn, ms);
    };

    const channel = supabase
      .channel('chat-enrichment-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_finished_conversations' }, () => debounce('finished', loadFinished))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_archived_conversations' }, () => debounce('archived', loadArchived))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_awaiting_payment' }, () => debounce('awaiting', loadAwaitingPayment))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_assignments' }, () => debounce('transferred', loadAiTransferred))
      .subscribe();
    return () => {
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      supabase.removeChannel(channel);
    };
  }, [loadFinished, loadArchived, loadAwaitingPayment, loadAiTransferred]);

  const finishConversation = useCallback(async (
    phone: string,
    reason?: string,
    sellerId?: string,
    extras?: {
      saleValue?: number;
      saleCurrency?: string;
      triggerId?: string | null;
      whatsappNumberId?: string | null;
      purchased?: boolean;
      supportReason?: string;
      supportSatisfactory?: boolean;
      duvidaText?: string;
    }
  ) => {
    const phoneKey = normalizePhoneKey(phone);
    const finishedAtIso = new Date().toISOString();
    if (phoneKey) {
      setFinishedPhones(prev => new Set([...prev, phoneKey]));
      // Keep the timestamp map in sync too — enrichConversations reads this map
      // (not the Set) to decide isFinished, so it MUST be updated optimistically
      // or the conversation reverts on the next list refresh.
      setFinishedAtByPhone(prev => {
        const next = new Map(prev);
        next.set(phoneKey, finishedAtIso);
        return next;
      });
    }

    const { error } = await supabase.from('chat_finished_conversations').upsert({
      phone,
      finished_at: finishedAtIso,
      finish_reason: reason || null,
      seller_id: sellerId || null,
      sale_value: extras?.saleValue ?? null,
      sale_currency: extras?.saleCurrency ?? 'BRL',
      trigger_id: extras?.triggerId ?? null,
      purchased: extras?.purchased ?? null,
      support_reason: extras?.supportReason ?? null,
      support_satisfactory: extras?.supportSatisfactory ?? null,
      duvida_text: extras?.duvidaText ?? null,
    } as any, { onConflict: 'phone' });


    if (error && phoneKey) {
      setFinishedPhones(prev => {
        const next = new Set(prev);
        next.delete(phoneKey);
        return next;
      });
      setFinishedAtByPhone(prev => {
        const next = new Map(prev);
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

        // Capture Meta browser cookies (fbc/fbp) for better attribution match (EMQ).
        // These must be sent in PLAIN TEXT (not hashed) per Meta CAPI spec.
        const readCookie = (name: string): string | undefined => {
          try {
            const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
            return m ? decodeURIComponent(m[1]) : undefined;
          } catch { return undefined; }
        };
        const fbc = readCookie('_fbc');
        const fbp = readCookie('_fbp');

        // Fire Meta CAPI Purchase (non-blocking)
        supabase.functions.invoke('meta-capi-purchase', {
          body: {
            conversion_id: conv?.id,
            phone,
            value: extras.saleValue,
            currency: extras.saleCurrency ?? 'BRL',
            trigger_id: extras.triggerId ?? null,
            fbc,
            fbp,
            client_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            action_source: 'chat',
          },
        }).catch(() => {});
      } catch (e) {
        console.warn('[finishConversation] failed to record conversion', e);
      }
    }
  }, []);

  const reopenConversation = useCallback(async (phone: string) => {
    const phoneKey = normalizePhoneKey(phone);
    const prevFinishedAt = phoneKey ? finishedAtByPhone.get(phoneKey) : undefined;
    if (phoneKey) {
      setFinishedPhones(prev => {
        const next = new Set(prev);
        next.delete(phoneKey);
        return next;
      });
      setFinishedAtByPhone(prev => {
        const next = new Map(prev);
        next.delete(phoneKey);
        return next;
      });
    }

    const { error } = await supabase.rpc('reopen_finished_conversation', { p_phone: phone });

    if (error && phoneKey) {
      setFinishedPhones(prev => new Set([...prev, phoneKey]));
      if (prevFinishedAt) {
        setFinishedAtByPhone(prev => {
          const next = new Map(prev);
          next.set(phoneKey, prevFinishedAt);
          return next;
        });
      }
      throw error;
    }
  }, [finishedAtByPhone]);

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
      const phoneKey = normalizePhoneKey(conv.phone);
      const finishedAt = finishedAtByPhone.get(phoneKey);
      const isFinished = Boolean(
        finishedAt && new Date(conv.lastMessageAt).getTime() <= new Date(finishedAt).getTime()
      );
      const isArchived = archivedPhones.has(conv.phone);
      const isAwaitingPayment = awaitingPaymentPhones.has(conv.phone);
      const isAiTransferred = aiTransferredPhones.has(phoneKey);

      // Force AI-transferred conversations into "Novas" so sellers spot them quickly,
      // but only while the conversation still has no human outgoing history.
      // If the customer already had prior replies from the team, keep it in
      // "Aguardando resposta" so it doesn't jump between tabs after refresh.
      if (isAiTransferred && !isFinished && !isArchived && status === 'not_started') {
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
  }, [computeStatus, finishedAtByPhone, archivedPhones, awaitingPaymentPhones, aiTransferredPhones, getInstanceLabel]);

  return {
    enrichConversations,
    finishConversation,
    reopenConversation,
    archiveConversation,
    unarchiveConversation,
    finishedPhones,
    finishedAtByPhone,
    archivedPhones,
    awaitingPaymentPhones,
    aiTransferredPhones,
    resolveAiTransfer,
    loadFinished,
  };
}

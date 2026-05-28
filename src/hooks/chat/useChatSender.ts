import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * useChatSender — envio unificado de mensagens WhatsApp (Z-API + Meta) e Messenger/Instagram (Meta).
 *
 * Responsabilidade única: rotear o envio pelo provider correto, persistir no banco e (opcionalmente)
 * pausar a IA. NÃO conhece a UI; recebe tudo por parâmetro. Reutilizável por POS, Eventos, Leads,
 * Support, Global FAB, Dashboard.
 *
 * Regras invioláveis (já presentes hoje no POS, agora centralizadas):
 *  - A instância (`numberId`) DEVE vir travada pela conversa (ver useConversationInstance).
 *  - Mensagens outgoing vão pra `whatsapp_messages` com `sender_user_id`/`sender_name` preenchidos.
 *  - `pauseAi` (default true) atualiza `automation_ai_sessions.is_active=false` — NÃO chamar
 *    endpoint externo `bananacalcados.com.br/ia/pausar` (ver mem://constraints).
 */

export type SendChannel = 'whatsapp' | 'instagram' | 'messenger';
export type SendProvider = 'zapi' | 'meta';

export interface SendRoute {
  channel: SendChannel;
  /** 'zapi' ou 'meta'. Ignorado se channel != 'whatsapp' (sempre meta). */
  provider: SendProvider;
  /** ID da instância travada da conversa (obrigatório). */
  numberId: string | null;
}

export interface SendBaseParams {
  phone: string;
  route: SendRoute;
  /** ID da mensagem citada (apenas Z-API/WhatsApp). */
  quotedMessageId?: string | null;
  senderUserId?: string | null;
  senderName?: string | null;
  /** Pausa a IA automaticamente após envio bem-sucedido. Default: true. */
  pauseAi?: boolean;
  hooks?: {
    /** Executado antes do envio (ex: reabrir conversa finalizada). */
    onBeforeSend?: (phone: string) => Promise<void> | void;
    /** Executado após envio + insert (ex: resolveAiTransfer, first_reply_at). */
    onAfterSend?: (phone: string) => Promise<void> | void;
  };
}

export interface SendTextParams extends SendBaseParams {
  message: string;
}

export interface SendMediaParams extends SendBaseParams {
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'audio' | 'document' | string;
  caption?: string;
}

interface SendResult {
  success: boolean;
  messageId?: string | null;
  error?: string;
}

export function useChatSender() {
  const [isSending, setIsSending] = useState(false);

  /** Wrapper interno: chama edge function correta baseado em route + insere no banco. */
  const dispatch = useCallback(
    async (
      kind: 'text' | 'media',
      params: SendTextParams | SendMediaParams,
    ): Promise<SendResult> => {
      const { phone, route, quotedMessageId, senderUserId, senderName, pauseAi = true, hooks } = params;
      const isMessenger = route.channel === 'instagram' || route.channel === 'messenger';

      if (!isMessenger && !route.numberId) {
        toast.error('Selecione a instância correta desta conversa antes de enviar.');
        return { success: false, error: 'NO_INSTANCE' };
      }
      if (isMessenger && !route.numberId) {
        toast.error('Nenhuma conta Meta disponível para esta conversa.');
        return { success: false, error: 'NO_META_INSTANCE' };
      }

      setIsSending(true);
      try {
        await hooks?.onBeforeSend?.(phone);

        const isMedia = kind === 'media';
        const text = isMedia
          ? (params as SendMediaParams).caption || `[${(params as SendMediaParams).mediaType}]`
          : (params as SendTextParams).message;
        const mediaUrl = isMedia ? (params as SendMediaParams).mediaUrl : undefined;
        const mediaType = isMedia ? (params as SendMediaParams).mediaType : undefined;

        let providerMessageId: string | null = null;

        if (isMessenger) {
          // Messenger / Instagram via meta-messenger-send
          const messengerType = !isMedia
            ? 'text'
            : mediaType === 'document'
              ? 'file'
              : (mediaType as 'image' | 'video' | 'audio');
          const { data, error } = await supabase.functions.invoke('meta-messenger-send', {
            body: {
              recipientId: phone,
              message: text,
              channel: route.channel,
              type: messengerType,
              mediaUrl,
              whatsapp_number_id: route.numberId,
            },
          });
          if (error) throw error;
          if (data?.success === false) throw new Error(data?.error || 'Erro Messenger/Instagram');
          providerMessageId = data?.messageId || null;
        } else if (route.provider === 'meta') {
          // WhatsApp via Meta Cloud API
          const { data, error } = await supabase.functions.invoke('meta-whatsapp-send', {
            body: {
              phone,
              message: text,
              whatsapp_number_id: route.numberId,
              ...(isMedia ? { media_url: mediaUrl, media_type: mediaType } : {}),
            },
          });
          if (error) throw error;
          providerMessageId = data?.messageId || null;
        } else {
          // WhatsApp via Z-API
          const fnName = isMedia ? 'zapi-send-media' : 'zapi-send-message';
          const body = isMedia
            ? {
                phone,
                mediaUrl,
                mediaType,
                caption: (params as SendMediaParams).caption,
                whatsapp_number_id: route.numberId,
                quotedMessageId: quotedMessageId || undefined,
              }
            : {
                phone,
                message: text,
                whatsapp_number_id: route.numberId,
                quotedMessageId: quotedMessageId || undefined,
              };
          const { data, error } = await supabase.functions.invoke(fnName, { body });
          if (error) throw error;
          providerMessageId =
            data?.messageId ||
            data?.data?.messageId ||
            data?.data?.zaapId ||
            data?.data?.id ||
            null;
        }

        // Persistir no banco
        const insertPayload: Record<string, unknown> = {
          phone,
          message: text,
          direction: 'outgoing',
          status: 'sent',
          message_id: providerMessageId,
          whatsapp_number_id: isMessenger ? null : route.numberId,
          channel: isMessenger ? route.channel : 'whatsapp',
          quoted_message_id: quotedMessageId || null,
          sender_user_id: senderUserId || null,
          sender_name: senderName || null,
        };
        if (isMedia) {
          insertPayload.media_type = mediaType;
          insertPayload.media_url = mediaUrl;
        }
        const { error: insertErr } = await supabase.from('whatsapp_messages').insert(insertPayload as never);
        if (insertErr) console.error('[useChatSender] DB insert failed:', insertErr);

        // Pausar IA (regra: sempre via automation_ai_sessions, NUNCA endpoint externo)
        if (pauseAi) {
          await supabase
            .from('automation_ai_sessions')
            .update({ is_active: false })
            .eq('phone', phone)
            .eq('is_active', true);
        }

        await hooks?.onAfterSend?.(phone);
        return { success: true, messageId: providerMessageId };
      } catch (err) {
        console.error(`[useChatSender] ${kind} send failed:`, err);
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Erro ao enviar ${kind === 'media' ? 'mídia' : 'mensagem'}`);
        return { success: false, error: msg };
      } finally {
        setIsSending(false);
      }
    },
    [],
  );

  const sendText = useCallback((params: SendTextParams) => dispatch('text', params), [dispatch]);
  const sendMedia = useCallback((params: SendMediaParams) => dispatch('media', params), [dispatch]);
  /** Atalho semântico: áudio é apenas media com mediaType='audio' e caption fixo. */
  const sendAudio = useCallback(
    (params: Omit<SendMediaParams, 'mediaType' | 'caption'>) =>
      dispatch('media', { ...params, mediaType: 'audio', caption: '[áudio]' }),
    [dispatch],
  );

  return { sendText, sendMedia, sendAudio, isSending };
}

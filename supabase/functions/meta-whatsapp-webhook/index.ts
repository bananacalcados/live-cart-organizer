import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeMessage, isOperatorCooldownActive } from "../_shared/message-router.ts";
import { logRouting } from "../_shared/routing-log.ts";
import { classifySendError } from "../_shared/meta-send-error.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhone(rawPhone: string): string {
  let phone = rawPhone.replace(/\D/g, '');

  // Meta API sometimes sends phone IDs in non-standard formats.
  // If the number doesn't start with '55' and has 12+ digits, try to extract
  // a valid Brazilian number by matching DDD(2) + 9 + 8 digits at the end.
  if (!phone.startsWith('55') && phone.length >= 12) {
    // Try to find a valid BR mobile pattern in the last 11 digits: DDD(2) + 9XXXXXXXX
    const last11 = phone.slice(-11);
    if (/^\d{2}9\d{8}$/.test(last11)) {
      phone = '55' + last11;
    } else {
      // Try last 10 digits (landline or mobile without 9th digit)
      const last10 = phone.slice(-10);
      if (/^\d{2}\d{8}$/.test(last10)) {
        phone = '55' + last10;
      }
    }
  }

  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
  // Brazilian mobile normalization: ensure 13 digits (55 + DDD + 9XXXXXXXX)
  if (phone.startsWith('55') && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    phone = '55' + ddd + '9' + number;
  }
  return phone;
}

async function downloadMetaMedia(mediaId: string, accessToken: string, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  try {
    // Step 1: Get media URL from Meta
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.error('Failed to get media URL:', await metaRes.text());
      return null;
    }
    const metaData = await metaRes.json();
    const mediaUrl = metaData.url;
    if (!mediaUrl) return null;

    // Step 2: Download the binary
    const downloadRes = await fetch(mediaUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!downloadRes.ok) {
      console.error('Failed to download media:', downloadRes.status);
      return null;
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    const mimeType = metaData.mime_type || 'application/octet-stream';
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const fileName = `meta-${mediaId}.${ext}`;

    if (arrayBuffer.byteLength === 0) {
      console.error('Downloaded media is empty (0 bytes)');
      return null;
    }

    console.log(`Downloaded media ${mediaId}: ${arrayBuffer.byteLength} bytes, type: ${mimeType}`);

    // Step 3: Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(fileName, new Uint8Array(arrayBuffer), {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Failed to upload media to storage:', uploadError);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(fileName);

    return publicUrlData?.publicUrl || null;
  } catch (err) {
    console.error('Error downloading Meta media:', err);
    return null;
  }
}

interface MetaInstanceResolution {
  /** Access token used ONLY for media download (best effort when unresolved) */
  accessToken: string;
  /** Resolved whatsapp_number_id, or null when the instance could NOT be identified */
  numberId: string | null;
  method: 'phone_number_id' | 'display_phone_number' | 'none';
  matched: boolean;
  rawIdentifier: string;
}

/**
 * Resolve which of OUR Meta instances received the message.
 * Strong keys only: phone_number_id (primary) → display_phone_number (secondary).
 * NEVER falls back to the is_default instance — guessing the instance causes
 * customer replies to land in the wrong store inbox. When nothing matches we
 * return numberId=null so the message is saved as "não identificada".
 */
async function resolveMetaInstance(
  supabase: ReturnType<typeof createClient>,
  metaPhoneNumberId: string,
  metaDisplayPhoneNumber: string,
): Promise<MetaInstanceResolution> {
  // 1. Primary: phone_number_id
  if (metaPhoneNumberId) {
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select('id, access_token')
      .eq('phone_number_id', metaPhoneNumberId)
      .eq('is_active', true)
      .maybeSingle();
    if (data) {
      return { accessToken: data.access_token, numberId: data.id, method: 'phone_number_id', matched: true, rawIdentifier: metaPhoneNumberId };
    }
  }

  // 2. Secondary: display_phone_number (e.g. "5533936180823")
  if (metaDisplayPhoneNumber) {
    const cleanDisplay = metaDisplayPhoneNumber.replace(/\D/g, '');
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select('id, access_token')
      .eq('provider', 'meta')
      .eq('is_active', true)
      .ilike('phone_display', `%${cleanDisplay.slice(-8)}%`)
      .maybeSingle();
    if (data) {
      return { accessToken: data.access_token, numberId: data.id, method: 'display_phone_number', matched: true, rawIdentifier: metaPhoneNumberId || cleanDisplay };
    }
  }

  // 3. UNRESOLVED — do NOT guess. Use env token only for best-effort media download.
  const fallbackToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '';
  return { accessToken: fallbackToken, numberId: null, method: 'none', matched: false, rawIdentifier: metaPhoneNumberId || metaDisplayPhoneNumber || '' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // === GET: Webhook Verification ===
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = Deno.env.get('META_WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Webhook verified successfully');
      return new Response(challenge, { status: 200 });
    }
    console.error('Webhook verification failed', { mode, token });
    return new Response('Forbidden', { status: 403 });
  }

  // === POST: Incoming messages & status updates ===
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log('Meta webhook received:', JSON.stringify(body));

    // LOG BRUTO COMO PRIMEIRA AÇÃO (caixa-preta). Nunca pode bloquear o fluxo.
    // Garante que TODO evento recebido da Meta fique registrado, mesmo que a
    // resolução de instância ou o insert em whatsapp_messages falhem depois.
    let rawEventId: string | null = null;
    try {
      const firstChange = body?.entry?.[0]?.changes?.[0];
      const eventType = (firstChange?.field || body?.object || '').toString().toLowerCase() || null;
      const owner =
        firstChange?.value?.metadata?.display_phone_number ||
        firstChange?.value?.metadata?.phone_number_id ||
        null;
      const { data: rawRow } = await supabase
        .from('webhook_events_raw')
        .insert({ provider: 'meta', event_type: eventType, owner, payload: body })
        .select('id')
        .maybeSingle();
      rawEventId = (rawRow as { id?: string } | null)?.id ?? null;
    } catch (e) {
      console.error('[meta-wa] raw log falhou:', (e as Error).message);
    }

    // Marca o motivo de descarte nas saídas silenciosas (deixa rastro).
    const markSkip = async (reason: string) => {
      if (!rawEventId) return;
      try {
        await supabase.from('webhook_events_raw').update({ skip_reason: reason }).eq('id', rawEventId);
      } catch (e) {
        console.error('[meta-wa] markSkip falhou:', (e as Error).message);
      }
    };

    if (body.object !== 'whatsapp_business_account') {
      await markSkip(`object_not_wa:${body?.object ?? 'null'}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        // Capture template review results (approved/rejected/flagged/paused) from Meta.
        if (change.field === 'message_template_status_update') {
          const v = change.value || {};
          const templateId = String(v.message_template_id ?? '');
          const templateName = v.message_template_name ?? null;
          const event = String(v.event ?? '').toUpperCase();
          // Meta sends events like APPROVED, REJECTED, FLAGGED, PAUSED, PENDING_DELETION
          const metaStatus = event || 'PENDING';
          if (templateId) {
            try {
              await supabase
                .from('meta_template_status_log')
                .upsert(
                  {
                    template_id: templateId,
                    template_name: templateName,
                    language: v.message_template_language ?? null,
                    event: v.event ?? null,
                    rejected_reason: v.reason ?? v.rejected_reason ?? null,
                    raw_payload: v,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: 'template_id' },
                );
            } catch (e) {
              console.error('[meta-wa] template status upsert falhou:', (e as Error).message);
            }
          }
          // Espelha o status na tabela templates_carrossel (match por template_id = name).
          if (templateName) {
            try {
              await supabase
                .from('templates_carrossel')
                .update({
                  meta_status: metaStatus,
                  aprovado: metaStatus === 'APPROVED',
                  updated_at: new Date().toISOString(),
                })
                .eq('template_id', templateName);
            } catch (e) {
              console.error('[meta-wa] templates_carrossel sync falhou:', (e as Error).message);
            }
          }
          await markSkip(`template_status_update:${v.event ?? 'unknown'}`);
          continue;
        }

        if (change.field !== 'messages') continue;
        const value = change.value;

        // Determine which WhatsApp number received this (strong keys only — never guess)
        const metaPhoneNumberId = value.metadata?.phone_number_id || '';
        const metaDisplayPhoneNumber = value.metadata?.display_phone_number || '';
        const resolution = await resolveMetaInstance(supabase, metaPhoneNumberId, metaDisplayPhoneNumber);
        const accessToken = resolution.accessToken || '';
        const whatsappNumberDbId = resolution.numberId;

        // Process incoming messages
        if (value.messages) {
          for (const msg of value.messages) {
            // Diagnostic: record how this incoming message was routed
            await logRouting(supabase, {
              provider: 'meta',
              senderPhone: normalizePhone(msg.from),
              resolutionMethod: resolution.method,
              resolvedWhatsappNumberId: whatsappNumberDbId,
              rawIdentifier: resolution.rawIdentifier,
              matched: resolution.matched,
              rawPayload: { metadata: value.metadata, message_id: msg.id, type: msg.type },
            });

            const phone = normalizePhone(msg.from);
            const messageId = msg.id;
            const timestamp = msg.timestamp
              ? new Date(parseInt(msg.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            // Dedup: Meta frequently re-delivers the same webhook. The wamid is globally
            // unique, so if we already stored this incoming message, skip it entirely
            // (avoids duplicated chat rows AND double AI replies).
            if (messageId) {
              const { data: dupRow } = await supabase
                .from('whatsapp_messages')
                .select('id')
                .eq('message_id', messageId)
                .eq('direction', 'incoming')
                .limit(1);
              if (dupRow && dupRow.length > 0) {
                console.log(`[meta-wa] Dedup: incoming message ${messageId} already exists, skipping`);
                continue;
              }
            }


            let messageText = '';
            let mediaType = 'text';
            let mediaUrl: string | null = null;
            let rawMediaId: string | null = null;
            let buttonPayload: string | null = null;

            switch (msg.type) {
              case 'text':
                messageText = msg.text?.body || '';
                break;
              case 'button': {
                // Quick reply button response from template (incl. carousel cards)
                messageText = msg.button?.text || '';
                buttonPayload = msg.button?.payload || null;
                mediaType = 'text';
                const btnText = msg.button?.text || 'Quero Esse';
                const parentId: string | null = msg.context?.id || null;

                // Load the original carousel message (if this is a reply to one) so we
                // can name the exact card regardless of which send path was used.
                let parentCards: any[] | null = null;
                if (parentId) {
                  const { data: parentMsg } = await supabase
                    .from('whatsapp_messages')
                    .select('template_payload')
                    .eq('message_id', parentId)
                    .maybeSingle();
                  const tp = parentMsg?.template_payload as any;
                  if (tp?.type === 'carousel' && Array.isArray(tp.cards)) parentCards = tp.cards;
                }

                let resolvedCardIdx: number | null = null;
                let productLabel = '';

                // 1) Preferred: explicit card index from the bcq payload.
                if (buttonPayload && buttonPayload.startsWith('bcq:')) {
                  try {
                    const [, dispatchId, cardIdxStr] = buttonPayload.split(':');
                    const cardIdx = parseInt(cardIdxStr, 10);
                    if (Number.isFinite(cardIdx)) resolvedCardIdx = cardIdx;
                    if (dispatchId && dispatchId !== 'test' && dispatchId !== 'na' && dispatchId !== 'auto') {
                      const { data: disp } = await supabase
                        .from('dispatch_history')
                        .select('variables_config')
                        .eq('id', dispatchId)
                        .maybeSingle();
                      const vc = (disp?.variables_config || {}) as Record<string, { staticValue?: string }>;
                      productLabel = vc[`card_${cardIdx}_product_name`]?.staticValue || '';
                    }
                  } catch (e) {
                    console.error('[meta-wa] Failed to parse bcq payload:', e);
                  }
                }

                // 2) Fallback: no usable payload, but the button text uniquely matches
                //    one card's button in the original carousel.
                if (resolvedCardIdx === null && parentCards) {
                  const matches = parentCards
                    .map((c: any, i: number) => ({ i, c }))
                    .filter(({ c }) =>
                      (c.buttons || []).some(
                        (b: any) => (b.text || '').trim().toLowerCase() === btnText.trim().toLowerCase(),
                      ),
                    );
                  if (matches.length === 1) resolvedCardIdx = matches[0].i;
                }

                // Enrich the product label from the stored carousel card body when
                // dispatch_history didn't provide one.
                if (!productLabel && parentCards && resolvedCardIdx !== null) {
                  const card = parentCards[resolvedCardIdx];
                  const firstLine = (card?.body || '').split('\n')[0].trim();
                  if (firstLine) productLabel = firstLine;
                }

                if (resolvedCardIdx !== null) {
                  const cardLabel = `Card ${resolvedCardIdx + 1}`;
                  messageText = productLabel
                    ? `🛒 ${btnText} → ${cardLabel}: ${productLabel}`
                    : `🛒 ${btnText} → ${cardLabel}`;
                } else if (parentCards) {
                  // Tapped a carousel button but we couldn't pin the exact card.
                  messageText = `🛒 ${btnText} (carrossel — card não identificado)`;
                }
                break;
              }
              case 'interactive':
                // Interactive button/list response
                if (msg.interactive?.type === 'button_reply') {
                  messageText = msg.interactive.button_reply?.title || '';
                } else if (msg.interactive?.type === 'list_reply') {
                  messageText = msg.interactive.list_reply?.title || '';
                } else {
                  messageText = '[interativo]';
                }
                break;
              case 'image':
                messageText = msg.image?.caption || '[imagem]';
                mediaType = 'image';
                rawMediaId = msg.image?.id || null;
                break;
              case 'video':
                messageText = msg.video?.caption || '[vídeo]';
                mediaType = 'video';
                rawMediaId = msg.video?.id || null;
                break;
              case 'audio':
                messageText = '[áudio]';
                mediaType = 'audio';
                rawMediaId = msg.audio?.id || null;
                break;
              case 'document':
                messageText = msg.document?.caption || msg.document?.filename || '[documento]';
                mediaType = 'document';
                rawMediaId = msg.document?.id || null;
                break;
              case 'reaction':
                messageText = `[reação: ${msg.reaction?.emoji || ''}]`;
                break;
              case 'sticker':
                messageText = '[figurinha]';
                mediaType = 'image';
                rawMediaId = msg.sticker?.id || null;
                break;
              default:
                messageText = `[${msg.type || 'desconhecido'}]`;
            }

            // Download media if present
            if (rawMediaId && accessToken) {
              const downloadedUrl = await downloadMetaMedia(rawMediaId, accessToken, supabase);
              mediaUrl = downloadedUrl;
            }

            // Get sender name from contacts array
            const contact = value.contacts?.find((c: any) => c.wa_id === msg.from);
            const senderName = contact?.profile?.name || null;

            // Capture referral data from Meta ads (Click-to-WhatsApp)
            const referralData = msg.referral ? {
              source_url: msg.referral.source_url || null,
              source_type: msg.referral.source_type || null,
              source_id: msg.referral.source_id || null,
              headline: msg.referral.headline || null,
              body: msg.referral.body || null,
              media_url: msg.referral.image_url || msg.referral.media_url || msg.referral.thumbnail_url || null,
              video_url: msg.referral.video_url || null,
              ctwa_clid: msg.referral.ctwa_clid || null,
            } : null;

            if (referralData) {
              console.log(`Ad referral detected for ${phone}:`, JSON.stringify(referralData));
            }

            // Capture quoted message context (reply)
            const quotedMessageId = msg.context?.message_id || null;

            const { error } = await supabase.from('whatsapp_messages').insert({
              phone,
              message: messageText,
              direction: 'incoming',
              message_id: messageId,
              status: 'received',
              media_type: mediaType,
              media_url: mediaUrl,
              is_group: false,
              whatsapp_number_id: whatsappNumberDbId || null,
              sender_name: senderName,
              referral: referralData,
              quoted_message_id: quotedMessageId,
              button_payload: buttonPayload,
            });

            if (error) {
              // 23505 = unique violation → concurrent retry inserted it first; safe to skip
              if ((error as any).code === '23505') {
                console.log(`[meta-wa] Dedup (race): incoming ${messageId} already saved, skipping side-effects`);
                continue;
              }
              console.error('Error saving incoming message:', error);
              // Falha de persistência: a Meta recebeu 200 e NÃO vai reenviar.
              // Deixa rastro na caixa-preta para reconciliação posterior.
              await markSkip(`insert_failed:${(error as any).code || 'unknown'}:${messageId}`);
            } else {
              console.log(`Saved incoming message from ${phone} (${senderName || 'unknown'})`);

              // Detect referral signals (coupon code or pending friend phone match) - fire & forget
              try {
                fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/referral-detect-incoming`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ from_phone: phone, message_text: messageText }),
                }).catch(() => {});
              } catch (_) { /* ignore */ }

               // Reopen any finished conversation when customer sends a new message
              // Uses suffix matching to handle phone format variations (with/without 9th digit)
              const { data: reopenCount } = await supabase.rpc('reopen_finished_conversation', { p_phone: phone });
              if (reopenCount && reopenCount > 0) {
                console.log(`Reopened ${reopenCount} finished conversation(s) for ${phone}`);
              }
              // NPS capture (only individual chats)
              const trimmed = (messageText || '').trim();
              const score = Number(trimmed);
              if (!Number.isNaN(score) && score >= 0 && score <= 10) {
                const { data: openSurvey } = await supabase
                  .from('chat_nps_surveys')
                  .select('id')
                  .eq('phone', phone)
                  .is('responded_at', null)
                  .order('sent_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();

                if (openSurvey) {
                  await supabase.from('chat_nps_surveys').update({
                    score,
                    responded_at: new Date().toISOString(),
                  }).eq('id', openSurvey.id);
                }
              }

              // ========== [LIVE CAMPAIGN TRIGGER] ==========
              // Detecta frase-chave de campanha de Live e dispara sequência de mídias
              try {
                if (messageText) {
                  // fire-and-forget pra não atrasar o webhook
                  fetch(`${supabaseUrl}/functions/v1/live-campaign-trigger`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${supabaseKey}`,
                    },
                    body: JSON.stringify({
                      phone,
                      message: messageText,
                      sender_name: senderName || null,
                      whatsapp_number_id: whatsappNumberDbId,
                    }),
                  }).catch((err) => console.error('[LIVE-CAMPAIGN] trigger error:', err));
                }
              } catch (liveErr) {
                console.error('[LIVE-CAMPAIGN] erro não-crítico:', liveErr);
              }
              // ========== [FIM] Live campaign trigger ==========

              // Check for pending automation flow continuation (button reply OR any text reply)
              let automationFlowHandled = false;
              {
                const buttonText = messageText.trim().toLowerCase();
                const isButtonReply = msg.type === 'button' || msg.type === 'interactive';
                try {
                  // Filter by phone suffix at the DB level (last 8 digits) so we don't miss
                  // pending replies when there are thousands of active ones from a mass dispatch.
                  const phoneSuffix = phone.replace(/\D/g, '').slice(-8);
                  const { data: pendingReplies } = await supabase
                    .from('automation_pending_replies')
                    .select('*')
                    .eq('is_active', true)
                    .gt('expires_at', new Date().toISOString())
                    .like('phone', `%${phoneSuffix}`)
                    .order('created_at', { ascending: false })
                    .limit(5);

                  // Defensive: confirm suffix actually matches (LIKE pattern is anchored at end)
                  const pendingReply = pendingReplies?.find(pr => {
                    const prSuffix = pr.phone.replace(/\D/g, '').slice(-8);
                    return prSuffix === phoneSuffix;
                  }) || null;

                  if (pendingReply) {
                    automationFlowHandled = true;
                    console.log(`Found pending reply for ${phone}, type=${msg.type}, text: "${buttonText}", branches:`, JSON.stringify(pendingReply.button_branches));
                    // Mark as consumed
                    await supabase.from('automation_pending_replies').update({ is_active: false }).eq('id', pendingReply.id);

                    // Determine which branch to follow
                    const branches = (pendingReply.button_branches || {}) as Record<string, string>;
                    let targetStepId: string | null = null;
                    
                    // Check if button text matches any branch (text→stepId format)
                    if (isButtonReply) {
                      for (const [branchLabel, branchTarget] of Object.entries(branches)) {
                        if (branchLabel.toLowerCase() === buttonText) {
                          targetStepId = branchTarget;
                          break;
                        }
                      }
                    }
                    // For text replies without branch match, just continue to next step (default)

                    // Resolve target: find step index by step ID, or default to next step
                    const { data: flowSteps } = await supabase
                      .from('automation_steps')
                      .select('id, step_order')
                      .eq('flow_id', pendingReply.flow_id)
                      .order('step_order');

                    // pending_step_index already points to the next step to execute
                    // (saved as current_index + 1 by test-flow, or current_index by continue-flow for wait_for_reply)
                    let startFromStep = pendingReply.pending_step_index;
                    if (targetStepId && flowSteps) {
                      const targetIdx = flowSteps.findIndex(s => s.id === targetStepId);
                      if (targetIdx >= 0) {
                        startFromStep = targetIdx;
                        console.log(`Branch resolved: "${buttonText}" → step ${targetIdx} (${targetStepId})`);
                      }
                    }

                    // Continue flow execution from the resolved step
                    fetch(`${supabaseUrl}/functions/v1/automation-continue-flow`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        flowId: pendingReply.flow_id,
                        phone,
                        startFromStep,
                        recipientData: pendingReply.recipient_data,
                        whatsappNumberId: pendingReply.whatsapp_number_id,
                      }),
                    }).catch(err => console.error('automation-continue-flow error:', err));
                    console.log(`[meta-webhook] Automation flow handled, skipping router for ${phone}`);
                  }
                } catch (prErr) {
                  console.error('Pending reply check error:', prErr);
                }
              }

              // ===== CENTRAL ROUTER =====
              if (!automationFlowHandled && (messageText || mediaType !== 'text')) {
                const routeText = messageText || `[${mediaType}]`;
                const referralInput = referralData || null;
                const route = await routeMessage(supabase, {
                  phone, messageText: routeText, isGroup: false,
                  referral: referralInput,
                  whatsappNumberId: whatsappNumberDbId,
                });
                console.log(`[meta-router] ${phone} → ${route.agent} (${route.reason})`);

                switch (route.agent) {
                  case 'livete':
                    fetch(`${supabaseUrl}/functions/v1/livete-respond`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phone, messageText: routeText, whatsappNumberId: whatsappNumberDbId, mediaUrl, mediaType }),
                    }).catch(err => console.error('livete-respond trigger error:', err));
                    break;

                  case 'continue_session': {
                    const cooldownActive = await isOperatorCooldownActive(supabase, phone);
                    if (!cooldownActive && route.session) {
                      console.log(`Active AI session found for ${phone}, auto-responding...`);
                      const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: route.session.prompt, phone, messageText: routeText, mediaUrl, mediaType, whatsappNumberId: whatsappNumberDbId }),
                      });
                      const aiData = await aiRes.json();

                      if (aiRes.ok && aiData.reply) {
                        const typingDelay = Math.min(Math.max(aiData.reply.length * 50, 2000), 12000);
                        await new Promise(r => setTimeout(r, typingDelay));

                        const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ phone, message: aiData.reply, whatsappNumberId: route.session.whatsapp_number_id }),
                        });

                        let aiMsgId: string | null = null;
                        try { const sendData = await sendRes.json(); aiMsgId = sendData?.messageId || null; } catch (_) {}

                        await supabase.from('whatsapp_messages').insert({
                          phone, message: `[IA] ${aiData.reply}`, direction: 'outgoing',
                          status: 'sent', message_id: aiMsgId, whatsapp_number_id: whatsappNumberDbId || null,
                        });

                        const newCount = (route.session.messages_sent || 0) + 1;
                        if (newCount >= (route.session.max_messages || 50)) {
                          await supabase.from('automation_ai_sessions').update({ is_active: false, messages_sent: newCount }).eq('id', route.session.id);
                        } else {
                          await supabase.from('automation_ai_sessions').update({ messages_sent: newCount, updated_at: new Date().toISOString() }).eq('id', route.session.id);
                        }
                        console.log(`AI auto-reply sent to ${phone}: ${aiData.reply.slice(0, 50)}...`);
                      }
                    } else if (cooldownActive) {
                      console.log(`Operator cooldown active for ${phone}, skipping AI auto-respond`);
                    }
                    break;
                  }

                  case 'ads': {
                    const adsCooldown = await isOperatorCooldownActive(supabase, phone);
                    if (!adsCooldown) {
                      try {
                        const adsRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-ads-respond`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ phone, messageText: routeText, campaignId: route.adCampaignId, whatsappNumberId: whatsappNumberDbId, channel: 'meta' }),
                        });
                        const adsData = await adsRes.json();

                        if (adsRes.ok && adsData.reply) {
                          const typingDelay = Math.min(Math.max(adsData.reply.length * 50, 2000), 12000);
                          await new Promise(r => setTimeout(r, typingDelay));

                          // Send keyword media via Meta if present
                          if (adsData.keywordMediaUrl) {
                            try {
                              await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  phone,
                                  mediaUrl: adsData.keywordMediaUrl,
                                  mediaType: adsData.keywordMediaType || 'document',
                                  caption: adsData.keywordMediaCaption || '',
                                  whatsappNumberId: whatsappNumberDbId,
                                }),
                              });
                              await supabase.from('whatsapp_messages').insert({
                                phone, message: `[IA-ADS] 📎 ${adsData.keywordMediaCaption || 'arquivo'}`, direction: 'outgoing',
                                status: 'sent', whatsapp_number_id: whatsappNumberDbId, media_url: adsData.keywordMediaUrl, media_type: adsData.keywordMediaType,
                              });
                            } catch (mediaErr) {
                              console.error('[meta-router] keyword media send error:', mediaErr);
                            }
                          }

                          if (adsData.reply.trim()) {
                            await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                              method: 'POST',
                              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ phone, message: adsData.reply, whatsappNumberId: whatsappNumberDbId }),
                            });

                            await supabase.from('whatsapp_messages').insert({
                              phone, message: `[IA-ADS] ${adsData.reply}`, direction: 'outgoing',
                              status: 'sent', whatsapp_number_id: whatsappNumberDbId,
                            });
                          }
                        } else if (adsRes.ok && adsData.keywordMediaUrl) {
                          try {
                            await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                              method: 'POST',
                              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                phone,
                                mediaUrl: adsData.keywordMediaUrl,
                                mediaType: adsData.keywordMediaType || 'document',
                                caption: adsData.keywordMediaCaption || '',
                                whatsappNumberId: whatsappNumberDbId,
                              }),
                            });
                            await supabase.from('whatsapp_messages').insert({
                              phone, message: `[IA-ADS] 📎 ${adsData.keywordMediaCaption || 'arquivo'}`, direction: 'outgoing',
                              status: 'sent', whatsapp_number_id: whatsappNumberDbId, media_url: adsData.keywordMediaUrl, media_type: adsData.keywordMediaType,
                            });
                          } catch (mediaErr) {
                            console.error('[meta-router] keyword media send error:', mediaErr);
                          }
                        }
                      } catch (err) {
                        console.error('[meta-router] ads-respond error:', err);
                      }
                    }
                    break;
                  }

                  case 'concierge':
                    fetch(`${supabaseUrl}/functions/v1/concierge-respond`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phone, messageText: routeText, whatsappNumberId: whatsappNumberDbId, channel: 'meta', mediaUrl, mediaType }),
                    }).catch(err => console.error('concierge-respond trigger error:', err));
                    break;

                  case 'legacy':
                  default:
                    fetch(`${supabaseUrl}/functions/v1/automation-trigger-incoming`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phone, messageText, instance: whatsappNumberDbId || 'meta' }),
                    }).catch(err => console.error('automation-trigger-incoming error:', err));
                    break;

                  case 'none':
                    break;
                }
              }

              // ===== END CENTRAL ROUTER =====
            }

            // Upsert chat_contacts with display_name
            if (senderName) {
              await supabase
                .from('chat_contacts')
                .upsert(
                  { phone, display_name: senderName },
                  { onConflict: 'phone', ignoreDuplicates: false }
                );
            }

            // Update orders
            const phoneWithoutCountry = phone.startsWith('55') ? phone.slice(2) : phone;
            const phoneVariations = [phone, phoneWithoutCountry];
            if (phoneWithoutCountry.length === 11 && phoneWithoutCountry.charAt(2) === '9') {
              phoneVariations.push(phoneWithoutCountry.slice(0, 2) + phoneWithoutCountry.slice(3));
              phoneVariations.push('55' + phoneWithoutCountry.slice(0, 2) + phoneWithoutCountry.slice(3));
            }

            const { data: customers } = await supabase
              .from('customers')
              .select('id')
              .in('whatsapp', phoneVariations);

            if (customers && customers.length > 0) {
              const customerIds = customers.map(c => c.id);
              await supabase
                .from('orders')
                .update({
                  has_unread_messages: true,
                  last_customer_message_at: new Date().toISOString(),
                })
                .in('customer_id', customerIds)
                .neq('stage', 'shipped');
            }
          }
        }

        // Process status updates
        if (value.statuses) {
          const statusRank: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };

          for (const status of value.statuses) {
            const messageId = status.id;
            let newStatus = 'sent';
            switch (status.status) {
              case 'sent': newStatus = 'sent'; break;
              case 'delivered': newStatus = 'delivered'; break;
              case 'read': newStatus = 'read'; break;
              case 'failed': newStatus = 'failed'; break;
            }

            const updateData: Record<string, unknown> = { status: newStatus };

            // Capture error details for failed messages
            if (newStatus === 'failed' && status.errors && status.errors.length > 0) {
              const err = status.errors[0];
              updateData.error_code = String(err.code || '');
              const details = err.error_data?.details || err.message || err.title || 'Erro desconhecido';
              updateData.error_message = `${err.title || 'Erro'} (${err.code || '?'}): ${details}`;
              console.log(`Message ${messageId} failed: code=${err.code}, title=${err.title}, details=${details}`);
            }

            // Prevent status downgrade (e.g. don't overwrite 'read' with 'delivered')
            // First check current status
            const { data: existingMsg } = await supabase
              .from('whatsapp_messages')
              .select('status')
              .eq('message_id', messageId)
              .maybeSingle();

            if (existingMsg) {
              const currentRank = statusRank[existingMsg.status] ?? -1;
              const newRank = statusRank[newStatus] ?? -1;
              // Only update if new status is higher rank (or it's a failure)
              if (newRank > currentRank || newStatus === 'failed') {
                const { error: updateError, count } = await supabase
                  .from('whatsapp_messages')
                  .update(updateData)
                  .eq('message_id', messageId);

                if (updateError) {
                  console.error(`Status update failed for ${messageId}: ${updateError.message}`);
                }

                // Also update dispatch_recipients if this is a mass dispatch message
                if (newStatus === 'delivered' || newStatus === 'read' || newStatus === 'failed') {
                  await supabase
                    .from('dispatch_recipients')
                    .update({ status: newStatus })
                    .eq('message_wamid', messageId);

                  // Also update carousel campaign deliveries (campanha_envios).
                  // delivered -> entregue, read -> lido.
                  // failed: classificado — rate limit reagenda em minutos (sem
                  // contar tentativa), inentregável (131026 etc.) vira
                  // 'nao_entregavel' (terminal), erro temporário reagenda em
                  // ~30min até o limite e então 'falhou'. Rank-protegido.
                  const ceRank: Record<string, number> = { enviado: 1, entregue: 2, lido: 3 };
                  const { data: ce } = await supabase
                    .from('campanha_envios')
                    .select('id, status, tentativas')
                    .eq('message_wamid', messageId)
                    .maybeSingle();
                  if (ce) {
                    if (newStatus === 'failed') {
                      const errCode = status.errors?.[0]?.code ?? null;
                      const cls = classifySendError(
                        typeof errCode === 'number' ? errCode : Number(errCode) || null,
                        updateData.error_message as string,
                      );
                      const attempts = (ce.tentativas || 0) + (cls.countsAttempt ? 1 : 0);
                      let ceStatus: string;
                      let proxima: string | null;
                      let keepWamid: boolean;
                      if (cls.status === 'nao_entregavel') {
                        ceStatus = 'nao_entregavel';
                        proxima = null;
                        keepWamid = true;
                      } else if (cls.countsAttempt && attempts >= 3) {
                        ceStatus = 'falhou';
                        proxima = null;
                        keepWamid = true;
                      } else {
                        ceStatus = 'pendente';
                        proxima = new Date(Date.now() + (cls.retryMs ?? 30 * 60 * 1000)).toISOString();
                        keepWamid = false;
                      }
                      await supabase
                        .from('campanha_envios')
                        .update({
                          tentativas: attempts,
                          erro: updateData.error_message as string ?? 'Falha pós-envio (webhook)',
                          status: ceStatus,
                          message_wamid: keepWamid ? messageId : null,
                          proxima_tentativa: proxima,
                        })
                        .eq('id', ce.id);
                    } else {
                      const mapped = newStatus === 'read' ? 'lido' : 'entregue';
                      const currRank = ceRank[ce.status] ?? 0;
                      if ((ceRank[mapped] ?? 0) > currRank) {
                        await supabase
                          .from('campanha_envios')
                          .update({ status: mapped })
                          .eq('id', ce.id);
                      }
                    }
                  }
                }


              }
            } else {
              console.log(`Status update: no message found for wamid ${messageId.substring(0, 30)}...`);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Meta webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

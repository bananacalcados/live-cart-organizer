import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeMessage, isOperatorCooldownActive } from "../_shared/message-router.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AnyPayload = Record<string, unknown>;

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value == null) return null;
  return String(value);
}

function getMessageText(payload: AnyPayload): string | null {
  const text = payload.text as unknown;
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object') {
    const msg = (text as Record<string, unknown>).message;
    return asString(msg);
  }
  return null;
}

interface MediaInfo {
  mediaUrl: string;
  mediaType: string;
  caption: string | null;
}

function getMediaInfo(payload: AnyPayload): MediaInfo | null {
  // Image
  const image = payload.image as Record<string, unknown> | undefined;
  if (image) {
    const url = asString(image.imageUrl) || asString(image.url);
    if (url) return { mediaUrl: url, mediaType: 'image', caption: asString(image.caption) };
  }
  // Video
  const video = payload.video as Record<string, unknown> | undefined;
  if (video) {
    const url = asString(video.videoUrl) || asString(video.url);
    if (url) return { mediaUrl: url, mediaType: 'video', caption: asString(video.caption) };
  }
  // Audio
  const audio = payload.audio as Record<string, unknown> | undefined;
  if (audio) {
    const url = asString(audio.audioUrl) || asString(audio.url);
    if (url) return { mediaUrl: url, mediaType: 'audio', caption: null };
  }
  // Document
  const doc = payload.document as Record<string, unknown> | undefined;
  if (doc) {
    const url = asString(doc.documentUrl) || asString(doc.url);
    if (url) return { mediaUrl: url, mediaType: 'document', caption: asString(doc.fileName) || asString(doc.caption) };
  }
  // Sticker
  const sticker = payload.sticker as Record<string, unknown> | undefined;
  if (sticker) {
    const url = asString(sticker.stickerUrl) || asString(sticker.url);
    if (url) return { mediaUrl: url, mediaType: 'image', caption: '🏷️ Sticker' };
  }
  return null;
}

/**
 * Normalize phone number for storage and matching.
 * Returns isLid=true when the phone looks like a WhatsApp Linked ID (>13 digits, not a group).
 */
function normalizePhone(payload: AnyPayload): { phone: string; isGroup: boolean; isLid: boolean } {
  const rawPhone = asString(payload.phone) || '';
  const chatLid = asString(payload.chatLid);
  
  const isGroup = rawPhone.includes('-group') || rawPhone.includes('@g.us') || 
                  chatLid?.includes('-group') || chatLid?.includes('@g.us') ||
                  Boolean(payload.isGroup);
  
  if (isGroup) {
    const groupId = rawPhone.replace('@g.us', '').replace('-group', '').replace(/\D/g, '');
    return { phone: groupId, isGroup: true, isLid: false };
  }
  
  let phone = rawPhone.replace(/\D/g, '');
  
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
  
  if (phone.startsWith('55') && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    phone = '55' + ddd + '9' + number;
    console.log(`Normalized 12-digit BR phone to 13: ${rawPhone} -> ${phone}`);
  }
  
  // Detect WhatsApp LID (Linked ID) — these are internal IDs, not real phone numbers
  const isLid = phone.length > 13;
  if (isLid) {
    console.log(`WhatsApp LID detected: ${rawPhone} -> ${phone} (${phone.length} digits)`);
  } else if (phone.length < 12) {
    console.log(`Unusual phone format detected: ${rawPhone} -> ${phone}`);
  }
  
  return { phone, isGroup: false, isLid };
}

/**
 * Resolve a WhatsApp LID to the real phone number by looking up existing messages
 * from the same sender_name that have a valid phone (12-13 digits).
 */
async function resolveLidToPhone(
  supabase: any,
  lidPhone: string,
  senderName: string | null
): Promise<string | null> {
  // First try: check if we already have messages saved with this LID phone and a known real phone mapping
  // Look in chat_contacts for a LID entry that might have been linked
  
  // Best approach: find messages from the same sender_name with a valid phone
  if (senderName) {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('phone')
      .eq('sender_name', senderName)
      .eq('direction', 'incoming')
      .neq('phone', lidPhone)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (data && data.length > 0) {
      // Find a phone with valid Brazilian format (12-13 digits)
      for (const row of data) {
        const digits = (row.phone || '').replace(/\D/g, '');
        if (digits.length >= 12 && digits.length <= 13 && digits.startsWith('55')) {
          console.log(`Resolved LID ${lidPhone} to real phone ${row.phone} via sender_name "${senderName}"`);
          return row.phone;
        }
      }
    }
  }
  
  console.warn(`Could not resolve LID ${lidPhone} to a real phone number (senderName: ${senderName})`);
  return null;
}

/**
 * Resolve whatsapp_number_id from multiple sources:
 * 1. ?number_id= query param
 * 2. instanceId in payload → lookup in whatsapp_numbers table
 * 3. connectedPhone in payload → lookup in whatsapp_numbers table
 */
async function resolveWhatsappNumberId(
  supabase: any,
  url: URL,
  payload: AnyPayload
): Promise<string | null> {
  // 1. instanceId lookup (highest priority — the payload always carries the real source instance)
  const instanceId = asString(payload.instanceId);
  if (instanceId) {
    const { data: numRow } = await supabase
      .from('whatsapp_numbers')
      .select('id')
      .eq('zapi_instance_id', instanceId)
      .eq('provider', 'zapi')
      .limit(1)
      .maybeSingle();
    if (numRow) {
      console.log(`Resolved whatsapp_number_id from instanceId ${instanceId}: ${numRow.id}`);
      return numRow.id;
    }
    console.warn(`instanceId ${instanceId} not found in whatsapp_numbers table`);
  }

  // 2. connectedPhone lookup (fallback)
  const connectedPhone = asString(payload.connectedPhone);
  if (connectedPhone) {
    const cleanPhone = connectedPhone.replace(/\D/g, '');
    const { data: numRow } = await supabase
      .from('whatsapp_numbers')
      .select('id')
      .eq('provider', 'zapi')
      .or(`phone_number.eq.${cleanPhone},phone_number.eq.+${cleanPhone},phone_number.ilike.%${cleanPhone.slice(-8)}%`)
      .limit(1)
      .maybeSingle();
    if (numRow) {
      console.log(`Resolved whatsapp_number_id from connectedPhone ${connectedPhone}: ${numRow.id}`);
      return numRow.id;
    }
    console.warn(`connectedPhone ${connectedPhone} not found in whatsapp_numbers table`);
  }

  // 3. Query param (last resort — proxy may share the same param for all instances)
  const fromParam = url.searchParams.get('number_id');
  if (fromParam) {
    console.log(`Resolved whatsapp_number_id from query param (fallback): ${fromParam}`);
    return fromParam;
  }

  console.error('FAILED to resolve whatsapp_number_id from any source');
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing backend configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload = (await req.json()) as AnyPayload;
    console.log('Webhook received:', JSON.stringify(payload));

    const url = new URL(req.url);
    const whatsappNumberId = await resolveWhatsappNumberId(supabase, url, payload);

    console.log(`Final resolved whatsapp_number_id: ${whatsappNumberId}`);

    // 1) ReceivedCallback (text and/or media messages)
    const rawPhone = asString(payload.phone);
    const messageText = getMessageText(payload);
    const mediaInfo = getMediaInfo(payload);

    if (rawPhone && (messageText || mediaInfo)) {
      const { phone, isGroup } = normalizePhone(payload);
      const messageId = asString(payload.messageId) || asString(payload.zapiMessageId);
      const fromMe = Boolean(payload.fromMe);
      const statusRaw = asString(payload.status);
      const status = (statusRaw ? statusRaw.toLowerCase() : (fromMe ? 'sent' : 'received'));

      // Build display message: use caption/text or fallback to media type label
      const displayMessage = messageText || mediaInfo?.caption || (mediaInfo ? `📎 ${mediaInfo.mediaType}` : '');

      console.log(`Processing message: phone=${phone}, isGroup=${isGroup}, fromMe=${fromMe}, media=${mediaInfo?.mediaType || 'none'}, numberId=${whatsappNumberId}`);

      if (fromMe) {
        // Dedup: match by phone suffix (8 digits) + message + whatsapp_number_id
        // Uses RPC function to handle phone format variations (with/without country code)
        if (messageId && displayMessage) {
          const aiPrefixes = ['[IA]', '[IA-ADS]', '[IA-CONCIERGE]', '[IA-LIVETE]'];
          const messagesToMatch = [
            displayMessage,
            ...aiPrefixes.map((prefix) => `${prefix} ${displayMessage}`),
          ];

          if (mediaInfo?.mediaType === 'image') {
            messagesToMatch.push(
              ...aiPrefixes.map((prefix) => `${prefix} 📷 ${displayMessage}`)
            );
          }

          // Also match the frontend label for media messages (e.g. "[áudio]" vs "📎 audio")
          const mediaLabelMap: Record<string, string> = { audio: '[áudio]', image: '[imagem]', video: '[vídeo]', document: '[documento]' };
          if (mediaInfo?.mediaType && mediaLabelMap[mediaInfo.mediaType]) {
            messagesToMatch.push(mediaLabelMap[mediaInfo.mediaType]);
          }

          for (const matchMsg of messagesToMatch) {
            const { data: existing } = await supabase.rpc('dedup_outgoing_message', {
              p_phone: phone,
              p_message: matchMsg,
              p_whatsapp_number_id: whatsappNumberId || null,
              p_cutoff_minutes: 5,
            });

            const row = existing?.[0];
            if (row) {
              if (!row.message_id) {
                const { error: updateError } = await supabase
                  .from('whatsapp_messages')
                  .update({ message_id: messageId, status })
                  .eq('id', row.id);
                if (updateError) {
                  console.error('Error updating outgoing message (dedup):', updateError);
                }
              }
              console.log(`Dedup matched via suffix for phone ${phone}, msg: ${matchMsg.substring(0, 50)}`);
              return new Response(JSON.stringify({ success: true, dedup: true }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
          }
        }

        // Fallback: save as outgoing
        const { error: insertError } = await supabase.from('whatsapp_messages').insert({
          phone,
          message: displayMessage,
          direction: 'outgoing',
          message_id: messageId,
          status,
          is_group: isGroup,
          whatsapp_number_id: whatsappNumberId,
          ...(mediaInfo ? { media_type: mediaInfo.mediaType, media_url: mediaInfo.mediaUrl } : {}),
        });

        if (insertError) {
          console.error('Error saving outgoing message:', insertError);
        }
      } else {
        // Incoming message
        const senderName = asString(payload.senderName) || asString(payload.chatName) || asString(payload.pushName) || null;

        // Dedup incoming: skip if same message_id + whatsapp_number_id already exists
        let skipInsert = false;
        if (messageId) {
          const { data: existingIncoming } = await supabase
            .from('whatsapp_messages')
            .select('id')
            .eq('message_id', messageId)
            .eq('phone', phone)
            .eq('direction', 'incoming')
            .eq('whatsapp_number_id', whatsappNumberId)
            .limit(1);
          if (existingIncoming && existingIncoming.length > 0) {
            console.log(`Incoming dedup: message_id ${messageId} already exists for number ${whatsappNumberId}, skipping`);
            skipInsert = true;
          }
        }

        let insertError: unknown = null;
        if (!skipInsert) {
          const { error } = await supabase.from('whatsapp_messages').insert({
            phone,
            message: displayMessage,
            direction: 'incoming',
            message_id: messageId,
            status,
            is_group: isGroup,
            sender_name: senderName,
            whatsapp_number_id: whatsappNumberId,
            ...(mediaInfo ? { media_type: mediaInfo.mediaType, media_url: mediaInfo.mediaUrl } : {}),
          });
          insertError = error;

          if (error) {
            console.error('Error saving incoming message:', error);
          }
        } else {
          return new Response(JSON.stringify({ success: true, dedup: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Reopen any finished conversation when customer sends a new message
        // Uses suffix matching to handle phone format variations (with/without 9th digit)
        if (!isGroup && !skipInsert) {
          const { data: reopenCount } = await supabase.rpc('reopen_finished_conversation', { p_phone: phone });
          if (reopenCount && reopenCount > 0) {
            console.log(`Reopened ${reopenCount} finished conversation(s) for ${phone}`);
          }
        }

        // NPS capture (only individual chats, only text)
        if (!isGroup && messageText) {
          const trimmed = messageText.trim();
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
        }
        
        // Upsert chat_contacts with display_name from sender
        if (senderName && !isGroup) {
          const { error: contactError } = await supabase
            .from('chat_contacts')
            .upsert(
              { phone, display_name: senderName },
              { onConflict: 'phone', ignoreDuplicates: false }
            );
          if (contactError) console.error('Error upserting chat contact:', contactError);

          // ========== [NOVO] Captura de lead de anúncio WhatsApp ==========
          try {
            const { data: adKeywords } = await supabase
              .from('whatsapp_ad_keywords')
              .select('keyword, campaign_label')
              .eq('is_active', true);

            if (adKeywords && adKeywords.length > 0 && messageText) {
              const msgLower = messageText.toLowerCase();
              const matchedKeyword = adKeywords.find(kw =>
                msgLower.includes(kw.keyword.toLowerCase())
              );

              if (matchedKeyword) {
                console.log(`[AD-LEAD] Keyword "${matchedKeyword.keyword}" detectada de ${phone}`);

                let leadStatus = 'prospect';
                const phoneSuffix = phone.slice(-8);

                const { data: existingCustomer } = await supabase
                  .from('pos_customers')
                  .select('id')
                  .or(`whatsapp.ilike.%${phoneSuffix}`)
                  .limit(1)
                  .maybeSingle();

                if (existingCustomer) leadStatus = 'customer';

                const { error: leadError } = await supabase
                  .from('lp_leads')
                  .insert({
                    name: senderName || null,
                    phone: phone,
                    campaign_tag: matchedKeyword.campaign_label,
                    source: 'whatsapp_ad',
                    converted: false,
                    metadata: {
                      campaign_label: matchedKeyword.campaign_label,
                      keyword_matched: matchedKeyword.keyword,
                      original_message: messageText.slice(0, 500),
                      lead_status: leadStatus,
                      captured_at: new Date().toISOString(),
                    },
                  });

                if (leadError) {
                  console.error('[AD-LEAD] Erro ao salvar lead:', leadError);
                } else {
                  console.log(`[AD-LEAD] Lead salvo: ${phone} | campanha: ${matchedKeyword.campaign_label}`);
                }
              }
            }
          } catch (adLeadErr) {
            console.error('[AD-LEAD] Erro geral (não-crítico):', adLeadErr);
          }
          // ========== [FIM] Captura de lead de anúncio WhatsApp ==========

          // ========== [ORGANIC LEAD CAPTURE] ==========
          // Save any non-customer incoming contact as an organic lead
          try {
            const phoneSuffix8 = phone.slice(-8);

            // Check if already a known customer (zoppy_customers or pos_customers)
            const [{ data: zoppyMatch }, { data: posMatch }] = await Promise.all([
              supabase.from('zoppy_customers').select('id').or(`phone.ilike.%${phoneSuffix8}`).limit(1).maybeSingle(),
              supabase.from('pos_customers').select('id').or(`whatsapp.ilike.%${phoneSuffix8}`).limit(1).maybeSingle(),
            ]);

            if (!zoppyMatch && !posMatch) {
              // Calculate week-based campaign tag: contato-whats-W-MM-YY
              const now = new Date();
              const dayOfMonth = now.getDate();
              const weekNum = dayOfMonth <= 7 ? 1 : dayOfMonth <= 14 ? 2 : dayOfMonth <= 21 ? 3 : 4;
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              const yy = String(now.getFullYear()).slice(-2);
              const campaignTag = `contato-whats-${weekNum}-${mm}-${yy}`;

              // Check if lead already exists in ANY weekly campaign
              const { data: existingLead } = await supabase
                .from('lp_leads')
                .select('id, campaign_tag')
                .eq('phone', phone)
                .like('campaign_tag', 'contato-whats-%')
                .limit(1)
                .maybeSingle();

              if (existingLead) {
                // If exists but in a DIFFERENT week, move to current week
                if (existingLead.campaign_tag !== campaignTag) {
                  await supabase.from('lp_leads')
                    .update({ campaign_tag: campaignTag, name: senderName || existingLead.campaign_tag } as any)
                    .eq('id', existingLead.id);
                  console.log(`[ORGANIC-LEAD] Moved ${phone} from ${existingLead.campaign_tag} to ${campaignTag}`);
                }
                // Same week → do nothing
              } else {
                // Also skip if already a lead from an ad campaign
                const { data: adLead } = await supabase
                  .from('lp_leads')
                  .select('id')
                  .eq('phone', phone)
                  .not('campaign_tag', 'like', 'contato-whats-%')
                  .limit(1)
                  .maybeSingle();

                // Insert new organic lead (even if they have an ad lead — it's a different campaign)
                await supabase.from('lp_leads').insert({
                  name: senderName || null,
                  phone: phone,
                  campaign_tag: campaignTag,
                  source: 'organic_whatsapp',
                  converted: false,
                  metadata: { captured_at: new Date().toISOString() },
                });
                console.log(`[ORGANIC-LEAD] Saved ${phone} to ${campaignTag}`);
              }
            }
          } catch (organicErr) {
            console.error('[ORGANIC-LEAD] Erro (não-crítico):', organicErr);
          }
          // ========== [FIM ORGANIC LEAD CAPTURE] ==========
        }

        // For groups, save the group name
        if (isGroup) {
          const groupName = asString(payload.chatName) || asString(payload.groupName) || asString(payload.name) || null;
          if (groupName) {
            const { error: groupContactError } = await supabase
              .from('chat_contacts')
              .upsert(
                { phone, display_name: groupName },
                { onConflict: 'phone', ignoreDuplicates: false }
              );
            if (groupContactError) console.error('Error upserting group contact:', groupContactError);
          }
        }

        if (insertError) {
          console.error('Error saving incoming message (post):', insertError);
        } else {
          console.log(`Saved incoming ${mediaInfo ? mediaInfo.mediaType : 'text'} message from ${phone}`);
          
          // ===== CENTRAL ROUTER =====
          if (!isGroup && (messageText || mediaInfo)) {
            const routeText = messageText || mediaInfo?.caption || (mediaInfo ? `[${mediaInfo.mediaType}]` : '');
            const route = await routeMessage(supabase, {
              phone, messageText: routeText, isGroup, whatsappNumberId,
            });
            console.log(`[zapi-router] ${phone} → ${route.agent} (${route.reason})`);

            switch (route.agent) {
              case 'livete':
                fetch(`${supabaseUrl}/functions/v1/livete-respond`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone, messageText: routeText, whatsappNumberId, mediaUrl: mediaInfo?.mediaUrl || null, mediaType: mediaInfo?.mediaType || null }),
                }).catch(err => console.error('livete-respond trigger error:', err));
                break;

              case 'continue_session': {
                const cooldownActive = await isOperatorCooldownActive(supabase, phone);
                if (!cooldownActive && route.session) {
                  const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: route.session.prompt, phone, messageText: routeText, mediaUrl: mediaInfo?.mediaUrl || null, mediaType: mediaInfo?.mediaType || null, whatsappNumberId }),
                  });
                  const aiData = await aiRes.json();

                  if (aiRes.ok && aiData.reply) {
                    const typingDelay = Math.min(Math.max(aiData.reply.length * 50, 2000), 12000);
                    await new Promise(r => setTimeout(r, typingDelay));

                    await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phone, message: aiData.reply, whatsapp_number_id: whatsappNumberId }),
                    });

                    await supabase.from('whatsapp_messages').insert({
                      phone, message: `[IA] ${aiData.reply}`, direction: 'outgoing',
                      status: 'sent', whatsapp_number_id: whatsappNumberId,
                    });

                    const newCount = (route.session.messages_sent || 0) + 1;
                    if (newCount >= (route.session.max_messages || 50)) {
                      await supabase.from('automation_ai_sessions').update({ is_active: false, messages_sent: newCount }).eq('id', route.session.id);
                    } else {
                      await supabase.from('automation_ai_sessions').update({ messages_sent: newCount, updated_at: new Date().toISOString() }).eq('id', route.session.id);
                    }
                  }
                } else if (cooldownActive) {
                  console.log(`[zapi-router] Operator cooldown active for ${phone}, skipping AI`);
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
                      body: JSON.stringify({ phone, messageText: routeText, campaignId: route.adCampaignId, whatsappNumberId, channel: 'zapi' }),
                    });
                    const adsData = await adsRes.json();

                    if (adsRes.ok && adsData.reply) {
                      const typingDelay = Math.min(Math.max(adsData.reply.length * 50, 2000), 12000);
                      await new Promise(r => setTimeout(r, typingDelay));

                      // Send keyword media attachment if present
                      if (adsData.keywordMediaUrl) {
                        try {
                          await fetch(`${supabaseUrl}/functions/v1/zapi-send-media`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              phone,
                              mediaUrl: adsData.keywordMediaUrl,
                              mediaType: adsData.keywordMediaType || 'document',
                              caption: adsData.keywordMediaCaption || '',
                              whatsapp_number_id: whatsappNumberId,
                            }),
                          });
                          await supabase.from('whatsapp_messages').insert({
                            phone, message: `[IA-ADS] 📎 ${adsData.keywordMediaCaption || 'arquivo'}`, direction: 'outgoing',
                            status: 'sent', whatsapp_number_id: whatsappNumberId, media_url: adsData.keywordMediaUrl, media_type: adsData.keywordMediaType,
                          });
                        } catch (mediaErr) {
                          console.error('[zapi-router] keyword media send error:', mediaErr);
                        }
                      }

                      // Send text reply (may be empty if send_mode is media_only)
                      if (adsData.reply.trim()) {
                        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ phone, message: adsData.reply, whatsapp_number_id: whatsappNumberId }),
                        });

                        await supabase.from('whatsapp_messages').insert({
                          phone, message: `[IA-ADS] ${adsData.reply}`, direction: 'outgoing',
                          status: 'sent', whatsapp_number_id: whatsappNumberId,
                        });
                      }
                    } else if (adsRes.ok && adsData.keywordMediaUrl) {
                      // Reply is empty but we have media to send (media_only mode)
                      try {
                        await fetch(`${supabaseUrl}/functions/v1/zapi-send-media`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            phone,
                            mediaUrl: adsData.keywordMediaUrl,
                            mediaType: adsData.keywordMediaType || 'document',
                            caption: adsData.keywordMediaCaption || '',
                            whatsapp_number_id: whatsappNumberId,
                          }),
                        });
                        await supabase.from('whatsapp_messages').insert({
                          phone, message: `[IA-ADS] 📎 ${adsData.keywordMediaCaption || 'arquivo'}`, direction: 'outgoing',
                          status: 'sent', whatsapp_number_id: whatsappNumberId, media_url: adsData.keywordMediaUrl, media_type: adsData.keywordMediaType,
                        });
                      } catch (mediaErr) {
                        console.error('[zapi-router] keyword media send error:', mediaErr);
                      }
                    }
                  } catch (err) {
                    console.error('[zapi-router] ads-respond error:', err);
                  }
                }
                break;
              }

              case 'concierge':
                fetch(`${supabaseUrl}/functions/v1/concierge-respond`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone, messageText: displayMessage, whatsappNumberId, channel: 'zapi', mediaUrl: mediaInfo?.mediaUrl || null, mediaType: mediaInfo?.mediaType || null }),
                }).catch(err => console.error('concierge-respond trigger error:', err));
                break;

              case 'legacy':
              default:
                fetch(`${supabaseUrl}/functions/v1/automation-trigger-incoming`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone, messageText: displayMessage, instance: 'zapi', isGroup, whatsappNumberId }),
                }).catch(err => console.error('automation-trigger-incoming error:', err));
                break;

              case 'none':
                break;
            }
          } else if (!isGroup) {
            fetch(`${supabaseUrl}/functions/v1/automation-trigger-incoming`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, messageText: displayMessage, instance: 'zapi', isGroup, whatsappNumberId }),
            }).catch(err => console.error('automation-trigger-incoming error:', err));
          }
          // ===== END CENTRAL ROUTER =====
        }
      }
    }

    // 2) MessageStatusCallback — only update for delivery-critical statuses
    // Skip "read" updates to reduce DB load (they are cosmetic and very high volume)
    const statusRaw = asString(payload.status);
    const ids = Array.isArray(payload.ids) ? (payload.ids as unknown[]).map(asString).filter(Boolean) as string[] : [];
    const singleId = asString(payload.id);
    const allIds = ids.length > 0 ? ids : (singleId ? [singleId] : []);

    if (statusRaw && allIds.length > 0) {
      const newStatus = statusRaw.toLowerCase();
      // Limit batch size to avoid long queries
      const batchIds = allIds.slice(0, 10);
      // For delivered, skip mass dispatch messages to reduce DB load
      let query = supabase
        .from('whatsapp_messages')
        .update({ status: newStatus })
        .in('message_id', batchIds);

      if (newStatus === 'delivered') {
        query = query.eq('is_mass_dispatch', false);
      }

      const { error } = await query;
      if (error) {
        console.error('Error updating status:', error);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

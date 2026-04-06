import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeMessage, isOperatorCooldownActive } from "../_shared/message-router.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhone(rawPhone: string): string {
  let phone = rawPhone.replace(/\D/g, '');
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
  // Brazilian mobile normalization: ensure 13 digits (55 + DDD + 9XXXXXXXX)
  // Always add 9 prefix for 8-digit local numbers, even if they happen to start with 9
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

async function getAccessTokenForPhoneNumberId(supabase: ReturnType<typeof createClient>, metaPhoneNumberId: string): Promise<{ accessToken: string; numberId: string } | null> {
  const { data } = await supabase
    .from('whatsapp_numbers')
    .select('id, access_token')
    .eq('phone_number_id', metaPhoneNumberId)
    .eq('is_active', true)
    .maybeSingle();
  if (data) return { accessToken: data.access_token, numberId: data.id };

  // Fallback to default
  const { data: def } = await supabase
    .from('whatsapp_numbers')
    .select('id, access_token')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (def) return { accessToken: def.access_token, numberId: def.id };

  const fallbackToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '';
  return fallbackToken ? { accessToken: fallbackToken, numberId: '' } : null;
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

    if (body.object !== 'whatsapp_business_account') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;

        // Determine which WhatsApp number received this
        const metaPhoneNumberId = value.metadata?.phone_number_id || '';
        const creds = await getAccessTokenForPhoneNumberId(supabase, metaPhoneNumberId);
        const accessToken = creds?.accessToken || '';
        const whatsappNumberDbId = creds?.numberId || null;

        // Process incoming messages
        if (value.messages) {
          for (const msg of value.messages) {
            const phone = normalizePhone(msg.from);
            const messageId = msg.id;
            const timestamp = msg.timestamp
              ? new Date(parseInt(msg.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            let messageText = '';
            let mediaType = 'text';
            let mediaUrl: string | null = null;
            let rawMediaId: string | null = null;

            switch (msg.type) {
              case 'text':
                messageText = msg.text?.body || '';
                break;
              case 'button':
                // Quick reply button response from template
                messageText = msg.button?.text || '';
                mediaType = 'text';
                break;
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
            });

            if (error) {
              console.error('Error saving incoming message:', error);
            } else {
              console.log(`Saved incoming message from ${phone} (${senderName || 'unknown'})`);

              // Reopen any finished conversation when customer sends a new message
              const { data: finished } = await supabase
                .from('chat_finished_conversations')
                .select('id, finish_reason')
                .eq('phone', phone)
                .maybeSingle();
              if (finished) {
                await supabase.from('chat_finished_conversations').delete().eq('id', finished.id);
                console.log(`Reopened finished conversation for ${phone} (was: ${finished.finish_reason})`);
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

              // Check for pending automation flow continuation (button reply OR any text reply)
              {
                const buttonText = messageText.trim().toLowerCase();
                const isButtonReply = msg.type === 'button' || msg.type === 'interactive';
                try {
                  const { data: pendingReply } = await supabase
                    .from('automation_pending_replies')
                    .select('*')
                    .eq('phone', phone)
                    .eq('is_active', true)
                    .gt('expires_at', new Date().toISOString())
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  if (pendingReply) {
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

                    let startFromStep = pendingReply.pending_step_index + 1; // default: next step
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
                  }
                } catch (prErr) {
                  console.error('Pending reply check error:', prErr);
                }
              }

              // ===== CENTRAL ROUTER =====
              if (messageText || mediaType !== 'text') {
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
        // Skip delivered/read for mass dispatch messages to avoid DB overload during bulk sends
        if (value.statuses) {
          for (const status of value.statuses) {
            const messageId = status.id;
            let newStatus = 'sent';
            switch (status.status) {
              case 'sent': newStatus = 'sent'; break;
              case 'delivered': newStatus = 'delivered'; break;
              case 'read': newStatus = 'read'; break;
              case 'failed': newStatus = 'failed'; break;
            }

            // For delivered/read, only update non-mass-dispatch messages (individual chat)
            // For sent/failed, always update (failed is critical for error tracking)
            if (newStatus === 'delivered' || newStatus === 'read') {
              await supabase
                .from('whatsapp_messages')
                .update({ status: newStatus })
                .eq('message_id', messageId)
                .eq('is_mass_dispatch', false);
              continue;
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

            await supabase
              .from('whatsapp_messages')
              .update(updateData)
              .eq('message_id', messageId);
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

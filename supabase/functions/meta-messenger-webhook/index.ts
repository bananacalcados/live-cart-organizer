import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchInstagramSenderUsername } from "../_shared/meta-instagram-profile.ts";
import { routeMessage, isOperatorCooldownActive } from "../_shared/message-router.ts";
import { processCommentAutomation } from "../_shared/instagram-comment-automation.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET: Webhook Verification
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = Deno.env.get('META_WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Messenger webhook verified');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // POST: Incoming messages
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';

    const body = await req.json();
    console.log('Messenger webhook payload:', JSON.stringify(body).slice(0, 1000));

    if (body.object !== 'page' && body.object !== 'instagram') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const channel = body.object === 'instagram' ? 'instagram' : 'messenger';

    for (const entry of body.entry || []) {
      // ── Handle messaging events (DMs) ──
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // Skip read receipts
        if (event.read) {
          const mid = event.read.mid;
          if (mid) {
            await supabase
              .from('whatsapp_messages')
              .update({ status: 'read' })
              .eq('message_id', mid);
          }
          continue;
        }

        // Skip message_edit and delivery events
        if (event.message_edit || event.delivery) continue;

        // Skip echo messages (messages we sent) — the frontend already inserts
        // the outgoing record after a successful send, so we only insert here
        // if no record with the same message_id exists yet (e.g. sent from
        // another device or the Meta platform directly).
        if (event.message?.is_echo) {
          const mid = event.message?.mid;
          const att = event.message?.attachments?.[0];
          const attType = att?.type || 'text';
          const attUrl = att?.payload?.url || null;
          const echoMessage = event.message?.text || (att ? `[${attType}]` : '[media]');
          if (mid) {
            const { data: existing, error: existingError } = await supabase
              .from('whatsapp_messages')
              .select('id, media_url, media_type, sender_name')
              .eq('message_id', mid)
              .order('created_at', { ascending: false })
              .limit(1);

            if (existingError) {
              console.error('Error checking echo message:', existingError);
            }

            if (existing && existing.length > 0) {
              const existingRow = existing[0];
              const { error: updateError } = await supabase
                .from('whatsapp_messages')
                .update({
                  phone: event.recipient?.id || '',
                  message: echoMessage,
                  status: 'sent',
                  media_type: attType,
                  media_url: attUrl,
                })
                .eq('id', existingRow.id);

              if (updateError) {
                console.error('Error upgrading echo message:', updateError);
              } else {
                console.log(`Echo upgraded with media metadata: ${mid}`);
              }
              continue;
            }
          }

          const { error: insertEchoError } = await supabase.from('whatsapp_messages').insert({
            phone: event.recipient?.id || '',
            message: echoMessage,
            direction: 'outgoing',
            message_id: mid || null,
            status: 'sent',
            media_type: attType,
            media_url: attUrl,
            channel,
            is_group: false,
          });

          if (insertEchoError) {
            console.error('Error inserting echo message:', insertEchoError);
          }
          continue;
        }

        // Dedup: Meta re-delivers webhooks. The message mid is unique, so skip if
        // this incoming DM was already stored (avoids duplicates + double AI replies).
        const incomingMid = event.message?.mid || null;
        if (incomingMid) {
          const { data: dupDm } = await supabase
            .from('whatsapp_messages')
            .select('id')
            .eq('message_id', incomingMid)
            .eq('direction', 'incoming')
            .limit(1);
          if (dupDm && dupDm.length > 0) {
            console.log(`[${channel}] Dedup: incoming ${incomingMid} already exists, skipping`);
            continue;
          }
        }

        let messageText = '';
        let mediaType = 'text';
        let mediaUrl: string | null = null;
        let referralData: Record<string, unknown> | null = null;


        if (event.message) {
          messageText = event.message.text || '';

          // Handle reply_to (story reply context from Instagram)
          if (event.message.reply_to?.story) {
            const storyUrl = event.message.reply_to.story.url || null;
            const storyId = event.message.reply_to.story.id || null;
            referralData = {
              source_type: 'story_reply',
              source_id: storyId,
              media_url: storyUrl,
              headline: 'Resposta ao Story',
            };
            if (!messageText) messageText = '[resposta ao story]';
          } else if (event.message.reply_to?.mid) {
            // Generic reply reference
            referralData = {
              source_type: 'message_reply',
              source_id: event.message.reply_to.mid,
            };
          }

          // Handle attachments
          if (event.message.attachments?.length > 0) {
            const att = event.message.attachments[0];
            const rawType = att.type || 'text';
            if (rawType === 'ephemeral' || rawType === 'unsupported_type') {
              mediaType = rawType === 'ephemeral' ? 'story' : 'unsupported';
              mediaUrl = att.payload?.url || null;
              if (!messageText) {
                messageText = rawType === 'ephemeral' ? '[story reply]' : '[unsupported media]';
              }
              // Enrich referral with story media if not already set
              if (rawType === 'ephemeral' && mediaUrl && !referralData) {
                referralData = {
                  source_type: 'story_reply',
                  media_url: mediaUrl,
                  headline: 'Resposta ao Story',
                };
              }
            } else if (rawType === 'share') {
              // Shared post/reel
              mediaType = 'share';
              mediaUrl = att.payload?.url || null;
              if (!messageText) messageText = '[post compartilhado]';
              if (!referralData) {
                referralData = {
                  source_type: 'shared_post',
                  media_url: mediaUrl,
                  headline: 'Post/Reel Compartilhado',
                };
              }
            } else if (rawType === 'story_mention') {
              mediaType = 'story';
              mediaUrl = att.payload?.url || null;
              if (!messageText) messageText = '[menção no story]';
              if (!referralData) {
                referralData = {
                  source_type: 'story_mention',
                  media_url: mediaUrl,
                  headline: 'Menção no Story',
                };
              }
            } else if (rawType === 'reel') {
              mediaType = 'video';
              mediaUrl = att.payload?.url || null;
              if (!messageText) messageText = '[reel compartilhado]';
              if (!referralData) {
                referralData = {
                  source_type: 'reel',
                  media_url: mediaUrl,
                  headline: 'Reel',
                };
              }
            } else {
              mediaType = rawType; // image, video, audio, file
              mediaUrl = att.payload?.url || null;
              if (!messageText) messageText = `[${mediaType}]`;
            }
          }

          // If still empty (Instagram sometimes sends empty text with story replies etc)
          if (!messageText && !mediaUrl) {
            messageText = '[mensagem sem conteúdo]';
          }
        } else if (event.postback) {
          messageText = event.postback.payload || event.postback.title || '[postback]';
        } else if (event.referral) {
          messageText = event.referral.ref ? `[referral: ${event.referral.ref}]` : '[via anúncio]';
          referralData = {
            source_type: event.referral.source || 'ad',
            source_id: event.referral.ad_id || null,
            source_url: event.referral.ads_context_data?.ad_link || null,
            headline: event.referral.ads_context_data?.ad_title || null,
            media_url: event.referral.ads_context_data?.photo_url || event.referral.ads_context_data?.video_url || null,
            video_url: event.referral.ads_context_data?.video_url || null,
          };
        } else {
          console.log(`Skipping unknown event from ${senderId}:`, JSON.stringify(event).slice(0, 300));
          continue;
        }

        if (referralData) {
          console.log(`Instagram referral for ${senderId}:`, JSON.stringify(referralData));
        }

        // Get sender profile name (use Instagram-specific fields)
        let senderName: string | null = null;
        if (pageAccessToken) {
          try {
            if (channel === 'instagram') {
              senderName = await fetchInstagramSenderUsername(pageAccessToken, senderId);
              console.log(`Instagram profile for ${senderId}: username=${senderName}`);
            } else {
              const profileRes = await fetch(
                `https://graph.facebook.com/v21.0/${senderId}?fields=name,profile_pic&access_token=${pageAccessToken}`
              );
              if (profileRes.ok) {
                const profile = await profileRes.json();
                senderName = profile.name || null;
                console.log(`Profile for ${senderId}: name=${profile.name}`);
              } else {
                console.log(`Profile fetch failed for ${senderId}: ${profileRes.status}`);
              }
            }
          } catch (e) {
            console.error('Error fetching sender profile:', e);
          }
        }

        // Save message
        const { error } = await supabase.from('whatsapp_messages').insert({
          phone: senderId,
          message: messageText,
          direction: 'incoming',
          message_id: event.message?.mid || null,
          status: 'received',
          media_type: mediaType,
          media_url: mediaUrl,
          is_group: false,
          channel,
          sender_name: senderName,
          referral: referralData,
        });

        if (error) {
          console.error('Error saving message:', error);
        } else {
          console.log(`Saved ${channel} DM from ${senderId} (${senderName || 'unknown'}): ${messageText.slice(0, 80)}`);
        }

        // Upsert chat_contacts with display_name
        if (senderName) {
          await supabase
            .from('chat_contacts')
            .upsert(
              { phone: senderId, display_name: senderName },
              { onConflict: 'phone', ignoreDuplicates: false }
            );
        }

        // ===== CENTRAL ROUTER — AI for Instagram DMs =====
        if (channel === 'instagram' && messageText) {
          try {
            const route = await routeMessage(supabase, {
              phone: senderId,
              messageText,
              isGroup: false,
              referral: referralData,
            });
            console.log(`[ig-router] ${senderId} → ${route.agent} (${route.reason})`);

            switch (route.agent) {
              case 'concierge':
                fetch(`${supabaseUrl}/functions/v1/concierge-respond`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    phone: senderId,
                    messageText,
                    channel: 'instagram',
                    mediaUrl,
                    mediaType,
                  }),
                }).catch(err => console.error('[ig-router] concierge-respond error:', err));
                break;

              case 'continue_session': {
                const cooldownActive = await isOperatorCooldownActive(supabase, senderId);
                if (!cooldownActive && route.session) {
                  try {
                    const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ prompt: route.session.prompt, phone: senderId, messageText, mediaUrl, mediaType }),
                    });
                    const aiData = await aiRes.json();
                    if (aiRes.ok && aiData.reply) {
                      const typingDelay = Math.min(Math.max(aiData.reply.length * 50, 2000), 12000);
                      await new Promise(r => setTimeout(r, typingDelay));

                      await fetch(`${supabaseUrl}/functions/v1/meta-messenger-send`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ recipientId: senderId, message: aiData.reply, channel: 'instagram' }),
                      });

                      await supabase.from('whatsapp_messages').insert({
                        phone: senderId, message: `[IA] ${aiData.reply}`, direction: 'outgoing',
                        status: 'sent', channel: 'instagram',
                      });

                      const newCount = (route.session.messages_sent || 0) + 1;
                      if (newCount >= (route.session.max_messages || 50)) {
                        await supabase.from('automation_ai_sessions').update({ is_active: false, messages_sent: newCount }).eq('id', route.session.id);
                      } else {
                        await supabase.from('automation_ai_sessions').update({ messages_sent: newCount, updated_at: new Date().toISOString() }).eq('id', route.session.id);
                      }
                    }
                  } catch (err) {
                    console.error('[ig-router] continue_session error:', err);
                  }
                }
                break;
              }

              case 'none':
              default:
                break;
            }
          } catch (routeErr) {
            console.error('[ig-router] routing error:', routeErr);
          }
        }
      }

      // ── Handle changes events (comments, live comments, story mentions, etc.) ──
      for (const change of entry.changes || []) {
        if ((change.field === 'comments' || change.field === 'live_comments') && change.value) {
          const comment = change.value;
          const fromId = comment.from?.id;
          const username = comment.from?.username;
          const text = comment.text || '[comentário]';
          const mediaType = comment.media?.media_product_type || 'post';
          const isLiveComment = change.field === 'live_comments' || mediaType === 'LIVE';

          if (!fromId) continue;

          const senderName = username ? `@${username}` : null;
          const commentSurface = isLiveComment
            ? 'Live'
            : mediaType === 'REELS'
              ? 'Reel'
              : 'post';
          const messageText = `💬 Comentário no ${commentSurface}: ${text}`;

          const { error } = await supabase.from('whatsapp_messages').insert({
            phone: fromId,
            message: messageText,
            direction: 'incoming',
            message_id: comment.id || null,
            status: 'received',
            media_type: 'text',
            is_group: false,
            channel: 'instagram',
            sender_name: senderName,
          });

          if (error) {
            console.error('Error saving comment:', error);
          } else {
            console.log(`Saved Instagram comment from ${username || fromId}: ${text.slice(0, 50)}`);

            // ── Also save into live_comments for active IG live event ──
            // This is what enables the Private Reply auto-discovery in the DM modal.
            try {
              // Critério: o evento marcado como "Live em curso agora" (live_active_until > now()).
              // Esse flag é ligado manualmente na UI e expira em 8h.
              const { data: activeEvent } = await supabase
                .from('events')
                .select('id, name')
                .gt('live_active_until', new Date().toISOString())
                .order('live_active_until', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (activeEvent && comment.id && username) {
                const { error: lcErr } = await supabase
                  .from('live_comments')
                  .insert({
                    event_id: activeEvent.id,
                    comment_id: comment.id,
                    username: username,
                    comment_text: text,
                    raw_timestamp: comment.timestamp ? new Date(comment.timestamp * 1000).toISOString() : new Date().toISOString(),
                    source_pc: isLiveComment ? 'meta-webhook-live' : 'meta-webhook',
                  });
                if (lcErr && lcErr.code !== '23505') {
                  console.error('Error saving to live_comments:', lcErr);
                } else if (!lcErr) {
                  console.log(`Saved IG comment to live_comments (event ${activeEvent.name}): ${comment.id}`);
                }
              }
            } catch (lcExc) {
              console.error('live_comments insert exception:', lcExc);
            }

            // Process comment automation rules (auto-reply, DM, flows)
            try {
              const automationResult = await processCommentAutomation(supabase, {
                commentId: comment.id,
                fromId,
                username: senderName,
                text,
                mediaType,
              });
              if (automationResult.actions.length > 0) {
                console.log(`Comment automations triggered: ${automationResult.actions.join(', ')}`);
              }
            } catch (autoErr) {
              console.error('Error processing comment automation:', autoErr);
            }
          }


          // Upsert chat_contacts
          if (senderName) {
            await supabase
              .from('chat_contacts')
              .upsert(
                { phone: fromId, display_name: senderName },
                { onConflict: 'phone', ignoreDuplicates: false }
              );
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Messenger webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

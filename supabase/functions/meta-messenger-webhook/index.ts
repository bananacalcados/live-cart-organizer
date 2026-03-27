import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchInstagramSenderUsername } from "../_shared/meta-instagram-profile.ts";

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
          if (mid) {
            const { data: existing } = await supabase
              .from('whatsapp_messages')
              .select('id')
              .eq('message_id', mid)
              .limit(1);
            if (existing && existing.length > 0) {
              console.log(`Echo skipped (already exists): ${mid}`);
              continue;
            }
          }
          await supabase.from('whatsapp_messages').insert({
            phone: event.recipient?.id || '',
            message: event.message?.text || '[media]',
            direction: 'outgoing',
            message_id: mid || null,
            status: 'sent',
            media_type: event.message?.attachments?.[0]?.type || 'text',
            channel,
            is_group: false,
          });
          continue;
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
      }

      // ── Handle changes events (comments, story mentions, etc.) ──
      for (const change of entry.changes || []) {
        if (change.field === 'comments' && change.value) {
          const comment = change.value;
          const fromId = comment.from?.id;
          const username = comment.from?.username;
          const text = comment.text || '[comentário]';
          const mediaType = comment.media?.media_product_type || 'post';

          if (!fromId) continue;

          const senderName = username ? `@${username}` : null;
          const messageText = `💬 Comentário no ${mediaType === 'REELS' ? 'Reel' : 'post'}: ${text}`;

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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { prepareZApiImagePayload } from "../_shared/zapi-media.ts";
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";
import { getPausedGroupSendUntil, isLikelyGroupId } from "../_shared/group-send-guard.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendGroupRequest {
  groupId: string; // e.g. "120363058412332916@g.us"
  message?: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'poll';
  mediaUrl?: string;
  caption?: string;
  mentionAll?: boolean;
  // For campaign bulk sends
  campaignId?: string;
  groupDbId?: string; // UUID from whatsapp_groups table
  whatsapp_number_id?: string; // UUID to resolve Z-API credentials dynamically
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const reqBody = await req.json();
    const { groupId, message, type = 'text', mediaUrl, caption, campaignId, groupDbId, mentionAll, whatsapp_number_id }: SendGroupRequest = reqBody;

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let instanceId: string, token: string, clientToken: string;
    try {
      const creds = await resolveZApiCredentials(whatsapp_number_id);
      instanceId = creds.instanceId;
      token = creds.token;
      clientToken = creds.clientToken;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Z-API credentials not configured', details: e.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!groupId) {
      return new Response(
        JSON.stringify({ error: 'groupId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (isLikelyGroupId(groupId)) {
      const pausedUntil = await getPausedGroupSendUntil(supabase);
      if (pausedUntil) {
        return new Response(
          JSON.stringify({ error: 'Group sends temporarily paused', pausedUntil }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    let endpoint: string;
    let body: Record<string, unknown>;

    // If mentionAll, fetch participants first
    let mentionedPhones: string[] = [];
    if (mentionAll) {
      try {
        const partRes = await fetch(`${baseUrl}/group-participants/${groupId}`, {
          method: 'GET',
          headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
        });
        const partData = await partRes.json();
        const participants = Array.isArray(partData) ? partData : (partData.participants || []);
        mentionedPhones = participants.map((p: any) => {
          const phone = p.phone || (p.id ? p.id.replace('@c.us', '') : '');
          return phone;
        }).filter(Boolean);
        console.log(`Mention all: ${mentionedPhones.length} participants`);
      } catch (e) {
        console.error('Error fetching participants for mention:', e);
      }
    }
    if (type === 'text') {
      endpoint = `${baseUrl}/send-text`;
      body = { phone: groupId, message: message || '' };
      if (mentionedPhones.length > 0) {
        body.mentioned = mentionedPhones;
      }
    } else if (type === 'poll') {
      const pollOptions = (reqBody as any).pollOptions;
      if (!pollOptions || !Array.isArray(pollOptions) || pollOptions.length < 2) {
        return new Response(
          JSON.stringify({ error: 'Poll requires at least 2 options' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const reqPollMax = (reqBody as any).pollMaxOptions;
      endpoint = `${baseUrl}/send-poll`;
      body = {
        phone: groupId,
        message: message || 'Enquete',
        pollMaxOptions: reqPollMax === 0 ? pollOptions.length : (reqPollMax || 1),
        poll: pollOptions.map((opt: string) => ({ name: opt })),
      };
    } else if (type === 'image' && mediaUrl) {
      endpoint = `${baseUrl}/send-image`;
      // IMPORTANTE: enviamos a URL direta para a Z-API. Tentamos no passado converter
      // para base64 inline para fazer autoOrient server-side, mas isso causava falhas
      // silenciosas em grupos (payload muito grande -> Z-API responde 200 mas não entrega).
      // A correção de orientação EXIF é feita no client (src/lib/imageOrientation.ts)
      // antes do upload para o Storage.
      body = { phone: groupId, image: mediaUrl, caption: caption || message || '' };
      if (mentionedPhones.length > 0) {
        body.mentioned = mentionedPhones;
      }
    } else if (type === 'video' && mediaUrl) {
      endpoint = `${baseUrl}/send-video`;
      body = { phone: groupId, video: mediaUrl, caption: caption || message || '' };
      if (mentionedPhones.length > 0) {
        body.mentioned = mentionedPhones;
      }
    } else if (type === 'audio' && mediaUrl) {
      endpoint = `${baseUrl}/send-audio`;
      body = { phone: groupId, audio: mediaUrl };
    } else if (type === 'document' && mediaUrl) {
      endpoint = `${baseUrl}/send-document`;
      body = { phone: groupId, document: mediaUrl, fileName: caption || 'document' };
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid type or missing mediaUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Client-Token': clientToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    let data: any;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.error('Z-API raw response (not JSON):', rawText);
      data = { raw: rawText };
    }

    if (!res.ok) {
      console.error('Z-API send group error:', data);

      // Log failure if campaign
      if (campaignId && groupDbId) {
        await supabase.from('group_campaign_messages').update({
          status: 'failed',
          error_message: JSON.stringify(data),
        }).eq('campaign_id', campaignId).eq('group_id', groupDbId);
      }

      return new Response(
        JSON.stringify({ error: 'Failed to send', details: data }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log success if campaign
    if (campaignId && groupDbId) {
      await supabase.from('group_campaign_messages').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        message_id: data.messageId || data.zapiMessageId || null,
      }).eq('campaign_id', campaignId).eq('group_id', groupDbId);
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending group message:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
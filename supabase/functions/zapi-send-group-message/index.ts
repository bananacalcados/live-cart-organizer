import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendGroupRequest {
  groupId: string; // e.g. "120363058412332916@g.us"
  message?: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string;
  caption?: string;
  // For campaign bulk sends
  campaignId?: string;
  groupDbId?: string; // UUID from whatsapp_groups table
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !token || !clientToken) {
      return new Response(
        JSON.stringify({ error: 'Z-API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { groupId, message, type = 'text', mediaUrl, caption, campaignId, groupDbId }: SendGroupRequest = await req.json();

    if (!groupId) {
      return new Response(
        JSON.stringify({ error: 'groupId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    let endpoint: string;
    let body: Record<string, unknown>;

    if (type === 'text') {
      endpoint = `${baseUrl}/send-text`;
      body = { phone: groupId, message: message || '' };
    } else if (type === 'image' && mediaUrl) {
      endpoint = `${baseUrl}/send-image`;
      body = { phone: groupId, image: mediaUrl, caption: caption || message || '' };
    } else if (type === 'video' && mediaUrl) {
      endpoint = `${baseUrl}/send-video`;
      body = { phone: groupId, video: mediaUrl, caption: caption || message || '' };
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

    const data = await res.json();

    if (!res.ok) {
      console.error('Z-API send group error:', data);

      // Log failure if campaign
      if (campaignId && groupDbId) {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
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
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
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

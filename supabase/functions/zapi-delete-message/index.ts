import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, messageId, dbMessageId, whatsapp_number_id } = await req.json();

    if (!phone || !messageId) {
      return new Response(
        JSON.stringify({ error: 'phone and messageId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { instanceId, token, clientToken } = await resolveZApiCredentials(whatsapp_number_id);

    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }

    const zapiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/messages?messageId=${encodeURIComponent(messageId)}&phone=${formattedPhone}`;

    const response = await fetch(zapiUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Z-API delete error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to delete message', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (dbMessageId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await supabase.from('whatsapp_messages').delete().eq('id', dbMessageId);
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error deleting message:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

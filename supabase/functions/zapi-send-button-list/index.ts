import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, message, imageUrl, buttons, instanceId, token, clientToken } = await req.json();

    if (!phone) {
      return new Response(JSON.stringify({ error: 'Phone is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const zapiInstanceId = instanceId || Deno.env.get('ZAPI_INSTANCE_ID') || '';
    const zapiToken = token || Deno.env.get('ZAPI_TOKEN') || '';
    const zapiClientToken = clientToken || Deno.env.get('ZAPI_CLIENT_TOKEN') || '';

    if (!zapiInstanceId || !zapiToken) {
      return new Response(JSON.stringify({ error: 'Z-API credentials not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) formattedPhone = '55' + formattedPhone;

    const url = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}/send-button-list`;

    // Build Z-API button list payload
    const buttonList = (buttons || []).map((btn: { id: string; title: string }, i: number) => ({
      id: btn.id || `btn_${i}`,
      label: btn.title || `Opção ${i + 1}`,
    }));

    const body: Record<string, unknown> = {
      phone: formattedPhone,
      message: message || '',
      buttonList,
    };

    // Add image if provided
    if (imageUrl) {
      body.image = imageUrl;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (zapiClientToken) {
      headers['Client-Token'] = zapiClientToken;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Z-API button list error:', data);
      return new Response(JSON.stringify({ error: 'Failed to send button list', details: data }), {
        status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Z-API button list sent:', data);
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error sending Z-API button list:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

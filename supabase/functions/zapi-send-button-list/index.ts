import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { phone, message, imageUrl, buttons, whatsapp_number_id } = await req.json();

    if (!phone) {
      return new Response(JSON.stringify({ error: 'Phone is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { instanceId, token, clientToken } = await resolveZApiCredentials(whatsapp_number_id);

    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) formattedPhone = '55' + formattedPhone;

    const endpoint = imageUrl ? 'send-button-list-image' : 'send-button-list';
    const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`;

    const buttonArray = (buttons || []).map((btn: { id: string; title: string }, i: number) => ({
      id: btn.id || `btn_${i}`,
      label: btn.title || `Opção ${i + 1}`,
    }));

    const body: Record<string, unknown> = {
      phone: formattedPhone,
      message: message || '',
    };

    if (imageUrl) {
      body.buttonList = { image: imageUrl, buttons: buttonArray };
    } else {
      body.buttonList = buttonArray;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (clientToken) headers['Client-Token'] = clientToken;

    console.log('Z-API button list request:', JSON.stringify({ url: endpoint, body }));

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    let data: any;
    try {
      data = responseText ? JSON.parse(responseText) : { raw: responseText };
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok) {
      console.error('Z-API button list error:', response.status, data);
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

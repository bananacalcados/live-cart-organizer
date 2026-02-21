import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    // Use send-button-list-image when image is provided, otherwise send-button-list
    const endpoint = imageUrl ? 'send-button-list-image' : 'send-button-list';
    const url = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}/${endpoint}`;

    // Build buttons array
    const buttonArray = (buttons || []).map((btn: { id: string; title: string }, i: number) => ({
      id: btn.id || `btn_${i}`,
      label: btn.title || `Opção ${i + 1}`,
    }));

    // Build payload in the correct Z-API format
    const body: Record<string, unknown> = {
      phone: formattedPhone,
      message: message || '',
    };

    if (imageUrl) {
      // For send-button-list-image: buttonList is an object with image + buttons
      body.buttonList = {
        image: imageUrl,
        buttons: buttonArray,
      };
    } else {
      // For send-button-list without image: buttonList is just the array
      body.buttonList = buttonArray;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (zapiClientToken) {
      headers['Client-Token'] = zapiClientToken;
    }

    console.log('Z-API button list request:', JSON.stringify({ url: endpoint, body }));

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Safe response parsing - Z-API may return empty or non-JSON responses
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

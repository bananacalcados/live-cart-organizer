import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, message, whatsapp_number_id } = await req.json();

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: 'Phone and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Sending message to ${phone}, whatsapp_number_id=${whatsapp_number_id}`);

    const { instanceId, token, clientToken } = await resolveZApiCredentials(whatsapp_number_id);

    // Format phone number - don't modify group IDs
    let formattedPhone = phone.replace(/\D/g, '');
    const isGroup = phone.includes('@') || phone.includes('-') || formattedPhone.startsWith('120');
    if (!isGroup && !formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }

    const zapiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

    const response = await fetch(zapiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
      body: JSON.stringify({
        phone: formattedPhone,
        message: message,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Z-API error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to send message', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Message sent successfully:', data);
    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error sending message:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
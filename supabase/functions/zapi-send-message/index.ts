import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    let instanceId: string | undefined;
    let token: string | undefined;
    let clientToken: string | undefined;

    // Try to resolve credentials from DB
    if (whatsapp_number_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data, error } = await supabase
        .from("whatsapp_numbers")
        .select("zapi_instance_id, zapi_token, zapi_client_token")
        .eq("id", whatsapp_number_id)
        .eq("provider", "zapi")
        .single();

      console.log(`DB lookup result: data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`);

      if (!error && data?.zapi_instance_id && data?.zapi_token && data?.zapi_client_token) {
        instanceId = data.zapi_instance_id;
        token = data.zapi_token;
        clientToken = data.zapi_client_token;
        console.log(`Using DB credentials for instance ${instanceId}`);
      } else {
        console.warn(`DB lookup failed for ${whatsapp_number_id}, falling back to env vars`);
      }
    }

    // Fallback to env vars
    if (!instanceId || !token || !clientToken) {
      instanceId = Deno.env.get("ZAPI_INSTANCE_ID");
      token = Deno.env.get("ZAPI_TOKEN");
      clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN");
      console.log(`Using env var credentials, instanceId=${instanceId}`);
    }

    if (!instanceId || !token || !clientToken) {
      throw new Error("Z-API credentials not configured");
    }

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
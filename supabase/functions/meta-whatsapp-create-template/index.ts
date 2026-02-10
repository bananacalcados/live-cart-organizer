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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { whatsappNumberId, name, category, language, components } = body;

    if (!name || !category || !language || !components) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: name, category, language, components' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get credentials from whatsapp_numbers table
    let accessToken = '';
    let businessAccountId = '';

    if (whatsappNumberId) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token, business_account_id')
        .eq('id', whatsappNumberId)
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        accessToken = data.access_token;
        businessAccountId = data.business_account_id;
      }
    }

    if (!accessToken || !businessAccountId) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token, business_account_id')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        accessToken = data.access_token;
        businessAccountId = data.business_account_id;
      }
    }

    if (!accessToken || !businessAccountId) {
      return new Response(
        JSON.stringify({ error: 'WhatsApp credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Submit template to Meta Graph API
    const graphUrl = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates`;

    const templatePayload: Record<string, unknown> = {
      name,
      category,
      language,
      components,
    };

    console.log('Submitting template to Meta:', JSON.stringify(templatePayload));

    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templatePayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Meta API error creating template:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to create template', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Template created successfully:', data);

    return new Response(
      JSON.stringify({ success: true, template: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error creating template:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

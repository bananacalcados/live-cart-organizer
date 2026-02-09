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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const whatsappNumberId = url.searchParams.get('whatsappNumberId');

    // Get credentials
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
      // Fallback to default
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

    // Fetch templates from Meta Graph API
    const graphUrl = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?status=APPROVED&limit=100`;

    const response = await fetch(graphUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Meta API error fetching templates:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch templates', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, templates: data.data || [] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching templates:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

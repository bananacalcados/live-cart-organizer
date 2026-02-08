import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload = await req.json();
    console.log('Webhook received:', JSON.stringify(payload));

    // Z-API sends different event types
    // Common events: ReceivedCallback, MessageStatusCallback, etc.
    
    // Handle incoming text messages
    if (payload.text && payload.phone) {
      const phone = payload.phone.replace(/\D/g, '');
      
      const { error } = await supabase.from('whatsapp_messages').insert({
        phone: phone,
        message: payload.text.message || payload.text,
        direction: 'incoming',
        message_id: payload.messageId || payload.zapiMessageId,
        status: 'received',
      });

      if (error) {
        console.error('Error saving message:', error);
      } else {
        console.log('Message saved successfully');
      }
    }

    // Handle message status updates
    if (payload.status && payload.id) {
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({ status: payload.status })
        .eq('message_id', payload.id);

      if (error) {
        console.error('Error updating status:', error);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

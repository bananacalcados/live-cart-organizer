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

    // Find all pending messages whose scheduled_at has passed
    const now = new Date().toISOString();
    const { data: pendingMessages, error: fetchErr } = await supabase
      .from('group_campaign_scheduled_messages')
      .select('id, scheduled_at, campaign_id')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(10); // Process up to 10 per invocation to stay within timeout

    if (fetchErr) {
      console.error('Error fetching pending messages:', fetchErr);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch pending messages', details: fetchErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!pendingMessages || pendingMessages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No pending messages to send', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${pendingMessages.length} pending messages to dispatch`);

    let dispatched = 0;
    let failed = 0;

    for (const msg of pendingMessages) {
      try {
        // Call the existing scheduled send function
        const sendRes = await fetch(`${supabaseUrl}/functions/v1/zapi-group-scheduled-send`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scheduledMessageId: msg.id }),
        });

        const sendData = await sendRes.json();

        if (sendRes.ok && sendData.success) {
          dispatched++;
          console.log(`Dispatched message ${msg.id}: ${sendData.sentCount} sent, ${sendData.failedCount} failed`);
        } else {
          failed++;
          console.error(`Failed to dispatch message ${msg.id}:`, sendData.error || 'Unknown error');
        }
      } catch (err) {
        failed++;
        console.error(`Error dispatching message ${msg.id}:`, err.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: pendingMessages.length,
        dispatched,
        failed,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Cron scheduled messages error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

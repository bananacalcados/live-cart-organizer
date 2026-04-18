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

    const now = new Date().toISOString();

    // Pick up PENDING messages whose scheduled_at has passed
    // AND SENDING messages that need continuation (batch processing)
    // Skip messages that are currently locked (another invocation is processing them)
    // For grouped blocks, only pick the first block (block_order = 0 or lowest)
    const { data: pendingMessages, error: fetchErr } = await supabase
      .from('group_campaign_scheduled_messages')
      .select('id, scheduled_at, campaign_id, status, message_group_id, block_order, locked_until')
      .or(
        `and(status.eq.pending,scheduled_at.lte.${now}),` +
        `and(status.eq.sending,or(locked_until.is.null,locked_until.lt.${now}))`
      )
      .neq('status', 'grouped') // skip grouped blocks
      .order('block_order', { ascending: true })
      .order('scheduled_at', { ascending: true })
      .limit(20);

    if (fetchErr) {
      console.error('Error fetching messages:', fetchErr);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch', details: fetchErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!pendingMessages || pendingMessages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No messages to process', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduplicate: for grouped messages, only dispatch the first block
    // Also skip messages that are still locked by another invocation
    const nowMs = Date.now();
    const seenGroupIds = new Set<string>();
    const deduped = pendingMessages.filter(msg => {
      // Skip if locked (another invocation is actively processing)
      if (msg.locked_until && new Date(msg.locked_until).getTime() > nowMs) {
        console.log(`Skipping ${msg.id}: locked until ${msg.locked_until}`);
        return false;
      }
      if (msg.message_group_id) {
        if (seenGroupIds.has(msg.message_group_id)) return false;
        seenGroupIds.add(msg.message_group_id);
      }
      return true;
    }).slice(0, 5);

    console.log(`Found ${pendingMessages.length} raw, ${deduped.length} deduplicated messages to dispatch`);

    let dispatched = 0;
    let failed = 0;

    for (const msg of deduped) {
      try {
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
          console.log(`Dispatched ${msg.id}: batch ${sendData.batchSent}/${sendData.total}, complete=${sendData.complete}`);
        } else {
          failed++;
          console.error(`Failed ${msg.id}:`, sendData.error || 'Unknown');
        }
      } catch (err) {
        failed++;
        console.error(`Error dispatching ${msg.id}:`, err.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: deduped.length, dispatched, failed }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Cron error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

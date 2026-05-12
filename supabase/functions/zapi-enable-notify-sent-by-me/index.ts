import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Enables "Notificar enviadas por mim" for ALL active Z-API instances and
 * sets the on-receive webhook URL to point to our zapi-webhook.
 *
 * Without this enabled at Z-API panel level, messages sent from the official
 * WhatsApp app on the phone are NOT delivered to our webhook.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: numbers, error } = await supabase
      .from('whatsapp_numbers')
      .select('id, label, zapi_instance_id, zapi_token, zapi_client_token, phone_number')
      .eq('provider', 'zapi')
      .eq('is_active', true);

    if (error) throw error;

    const webhookUrl = `${SUPABASE_URL}/functions/v1/zapi-webhook`;
    const results: any[] = [];

    for (const n of numbers || []) {
      if (!n.zapi_instance_id || !n.zapi_token || !n.zapi_client_token) {
        results.push({ id: n.id, label: n.label, skipped: 'missing_credentials' });
        continue;
      }

      const base = `https://api.z-api.io/instances/${n.zapi_instance_id}/token/${n.zapi_token}`;
      const headers = { 'Content-Type': 'application/json', 'Client-Token': n.zapi_client_token };

      const calls = [
        // 1. Enable "notify sent by me"
        fetch(`${base}/update-notify-sent-by-me`, {
          method: 'PUT', headers, body: JSON.stringify({ value: true }),
        }).then(async r => ({ step: 'notify-sent-by-me', ok: r.ok, body: await r.text() })),

        // 2. Set on-receive webhook URL (this is the URL that gets fromMe events too)
        fetch(`${base}/update-webhook-received`, {
          method: 'PUT', headers, body: JSON.stringify({ value: webhookUrl }),
        }).then(async r => ({ step: 'webhook-received', ok: r.ok, body: await r.text() })),

        // 3. Set on-message-status webhook (delivery/read receipts)
        fetch(`${base}/update-webhook-message-status`, {
          method: 'PUT', headers, body: JSON.stringify({ value: webhookUrl }),
        }).then(async r => ({ step: 'webhook-status', ok: r.ok, body: await r.text() })),
      ];

      const stepResults = await Promise.all(calls);
      results.push({ id: n.id, label: n.label, phone: n.phone_number, steps: stepResults });
    }

    return new Response(JSON.stringify({ success: true, webhookUrl, results }, null, 2), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[zapi-enable-notify-sent-by-me] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
